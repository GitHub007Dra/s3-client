import { S3ClientManager } from '../../../shared/s3-client';
import type { AppDispatch } from '../../store';
import {
  addTransferTask,
  updateTransferTask,
  pauseTransferTask,
  type TransferTask,
  type TransferChunk,
} from '../../store/slices/transfersSlice';
import { StorageService } from '../storageService';
import { Upload } from '@aws-sdk/lib-storage';

// 可重试的错误类型
const RETRYABLE_ERRORS = [
  'RequestTimeTooSkewed',
  'time difference',
  'clock settings',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'socket hang up',
  'network error',
  'timeout',
];

// 最大重试次数
const MAX_RETRIES = 3;
// 重试延迟（毫秒）
const RETRY_DELAY = 1000;

/**
 * 上传模块
 */
export class UploadsService {
  private s3ClientManager: S3ClientManager;
  private dispatch: AppDispatch;
  // 使用静态变量确保所有实例共享同一个 Map
  private static abortControllers: Map<string, AbortController> = new Map();
  // 存储上传的 File 对象（Redux 不能序列化 File，需要在内存中保持引用）
  private static uploadFiles: Map<string, File> = new Map();
  private static cancelledTaskIds: Set<string> = new Set();

  constructor(s3ClientManager: S3ClientManager, dispatch: AppDispatch) {
    this.s3ClientManager = s3ClientManager;
    this.dispatch = dispatch;
  }

  private getAbortControllers(): Map<string, AbortController> {
    return UploadsService.abortControllers;
  }

  private getUploadFiles(): Map<string, File> {
    return UploadsService.uploadFiles;
  }

  private getCancelledTaskIds(): Set<string> {
    return UploadsService.cancelledTaskIds;
  }

  // 检查错误是否可重试
  private isRetryableError(error: any): boolean {
    if (!error) return false;
    const errorMessage = (error.message || error.toString() || '').toLowerCase();
    const errorCode = (error.code || error.name || '').toLowerCase();
    
    return RETRYABLE_ERRORS.some(pattern =>
      errorMessage.includes(pattern.toLowerCase()) ||
      errorCode.includes(pattern.toLowerCase())
    );
  }

  // 延迟函数
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 带重试机制的 S3 操作包装器
  private async retryableS3Operation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = MAX_RETRIES
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // 检查是否是时间同步错误
        const errorMessage = (error.message || error.toString() || '').toLowerCase();
        if (errorMessage.includes('time') && errorMessage.includes('difference')) {
          console.warn(`[${operationName}] Time sync error detected, waiting before retry...`);
          await this.delay(RETRY_DELAY * 3);
        } else if (this.isRetryableError(error) && attempt < maxRetries) {
          console.log(`[${operationName}] Retrying (${attempt + 1}/${maxRetries})...`);
          await this.delay(RETRY_DELAY * (attempt + 1));
        } else {
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * 上传文件（支持断点续传）
   */
  async uploadFile(file: File, connectionId: string, bucket: string, key: string): Promise<TransferTask> {
    const taskId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return this.startUpload(file, connectionId, bucket, key, taskId, 0);
  }

  /**
   * 使用已有任务 ID 重新开始上传。当前 SDK 上传路径无法真正复用旧 uploadId，
   * 但保留任务 ID 可以避免恢复时在传输中心生成重复任务。
   */
  async restartUpload(
    task: TransferTask,
    file: File
  ): Promise<TransferTask> {
    return this.startUpload(
      file,
      task.connectionId,
      task.bucket,
      task.key,
      task.id,
      task.transferred
    );
  }

  private async startUpload(
    file: File,
    connectionId: string,
    bucket: string,
    key: string,
    taskId: string,
    resumedFrom: number
  ): Promise<TransferTask> {
    this.getCancelledTaskIds().delete(taskId);
    
    // 将 File 存入内存 Map（Redux 不能序列化 File 对象）
    this.getUploadFiles().set(taskId, file);
    
    const task: TransferTask = {
      id: taskId,
      type: 'upload',
      fileName: file.name,
      key,
      bucket,
      connectionId,
      status: 'pending',
      progress: 0,
      speed: 0,
      transferred: 0,
      total: file.size,
      chunks: [],
      resumable: true,
      resumedFrom,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.dispatch(addTransferTask(task));

    // 创建 AbortController 用于暂停/取消
    const abortController = new AbortController();
    this.getAbortControllers().set(taskId, abortController);

    try {
      // Check if file size exceeds threshold for multipart upload
      const threshold = 5 * 1024 * 1024; // 5MB
      if (file.size > threshold) {
        return await this.uploadWithMultipart(file, connectionId, bucket, key, taskId, abortController);
      } else {
        return await this.uploadSinglePart(file, connectionId, bucket, key, taskId, abortController);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 用户取消或暂停 - 保存任务状态到 storage
        const wasCancelled = this.getCancelledTaskIds().has(taskId);
        const currentTask = { ...task, status: wasCancelled ? 'cancelled' as const : 'paused' as const };
        if (wasCancelled) {
          StorageService.removeTransferTask(taskId);
          this.dispatch(updateTransferTask({ id: taskId, status: 'cancelled', speed: 0 }));
        } else {
          StorageService.saveTransferTask(currentTask);
          this.dispatch(pauseTransferTask(taskId));
        }
      } else {
        // 保存失败状态到 storage
        const failedTask = { 
          ...task, 
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Upload failed'
        };
        StorageService.saveTransferTask(failedTask);
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        }));
      }
      throw error;
    } finally {
      this.getAbortControllers().delete(taskId);
      this.getCancelledTaskIds().delete(taskId);
    }
  }

  /**
   * 单部分上传（支持进度跟踪）
   */
  private async uploadSinglePart(
    file: File,
    connectionId: string,
    bucket: string,
    key: string,
    taskId: string,
    abortController: AbortController
  ): Promise<TransferTask> {
    const total = file.size;
    const startTime = Date.now();
    let lastUpdateTime = Date.now();
    let lastTransferred = 0;

    // 更新状态为上传中
    this.dispatch(updateTransferTask({
      id: taskId,
      status: 'uploading',
    }));

    try {
      // 检查是否被暂停或取消
      if (abortController.signal.aborted) {
        const abortError = new Error('Upload aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }

      const client = this.s3ClientManager.getClient(connectionId);
      if (!client) {
        throw new Error('No client found for connection');
      }

      // 使用 @aws-sdk/lib-storage 的 Upload 类，支持进度跟踪
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: file,
        },
        queueSize: 4, // 并发上传数
        partSize: 5 * 1024 * 1024, // 每个分片 5MB
        leavePartsOnError: false,
      });

      // 监听进度事件
      upload.on('httpUploadProgress', (progress) => {
        const loaded = progress.loaded ?? 0;
        const progressTotal = progress.total ?? total;
        const now = Date.now();
        const elapsed = (now - lastUpdateTime) / 1000;
        
        // 计算速度 (bytes per second)
        let speed = 0;
        if (elapsed > 0) {
          speed = (loaded - lastTransferred) / elapsed;
        }
        
        // 计算进度百分比
        const progressPercent = progressTotal > 0 ? Math.round((loaded / progressTotal) * 100) : 0;

        // 每 100ms 更新一次，避免过于频繁的 dispatch
        if (now - lastUpdateTime > 100 || progressPercent === 100) {
          this.dispatch(updateTransferTask({
            id: taskId,
            progress: progressPercent,
            transferred: loaded,
            total: progressTotal,
            speed: speed > 0 ? speed : 0,
          }));
          
          lastUpdateTime = now;
          lastTransferred = loaded;
        }
      });

      // 处理取消
      const abortHandler = () => {
        upload.abort();
      };
      abortController.signal.addEventListener('abort', abortHandler);

      const response = await upload.done();
      
      // 移除事件监听
      abortController.signal.removeEventListener('abort', abortHandler);
      
      // 计算平均速度
      const totalElapsed = (Date.now() - startTime) / 1000;
      const avgSpeed = totalElapsed > 0 ? total / totalElapsed : 0;

      // 上传完成
      const completedTask: TransferTask = {
        id: taskId,
        type: 'upload',
        fileName: file.name,
        key,
        bucket,
        connectionId,
        status: 'completed',
        progress: 100,
        speed: avgSpeed,
        transferred: total,
        total,
        chunks: [{
          partNumber: 1,
          size: total,
          etag: response.ETag || '',
          transferred: total,
          status: 'completed' as const,
        }],
        resumable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.dispatch(updateTransferTask(completedTask));
      
      // 清理内存中的 File 对象
      this.getUploadFiles().delete(taskId);
      
      return completedTask;
    } catch (error) {
      console.error(`File upload failed:`, error);
      throw error;
    }
  }

  /**
   * 分片上传（用于大文件）
   */
  private async uploadWithMultipart(
    file: File,
    connectionId: string,
    bucket: string,
    key: string,
    taskId: string,
    abortController: AbortController
  ): Promise<TransferTask> {
    // 更新状态为上传中
    this.dispatch(updateTransferTask({
      id: taskId,
      status: 'uploading',
    }));

    // 分片上传逻辑（简化版，实际需要使用 createMultipartUpload, uploadPart, completeMultipartUpload）
    return await this.uploadSinglePart(file, connectionId, bucket, key, taskId, abortController);
  }

  /**
   * 暂停上传
   */
  pauseUpload(taskId: string): void {
    const controller = this.getAbortControllers().get(taskId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * 取消上传
   */
  cancelUpload(taskId: string): void {
    this.getCancelledTaskIds().add(taskId);
    const controller = this.getAbortControllers().get(taskId);
    if (controller) {
      controller.abort();
    }
    // 清理内存中的 File 对象
    this.getUploadFiles().delete(taskId);
  }

  /**
   * 获取上传的 File 对象
   */
  getUploadFile(taskId: string): File | undefined {
    return this.getUploadFiles().get(taskId);
  }
}
