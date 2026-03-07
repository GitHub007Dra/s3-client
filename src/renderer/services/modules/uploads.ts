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
        const currentTask = { ...task, status: 'paused' as const };
        StorageService.saveTransferTask(currentTask);
        this.dispatch(pauseTransferTask(taskId));
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
    }
  }

  /**
   * 单部分上传（支持断点续传）
   */
  private async uploadSinglePart(
    file: File,
    connectionId: string,
    bucket: string,
    key: string,
    taskId: string,
    abortController: AbortController
  ): Promise<TransferTask> {
    const chunkSize = 1024 * 1024; // 1MB chunks
    const chunks: TransferChunk[] = [];
    let transferred = 0;
    const total = file.size;
    const startTime = Date.now();

    // 更新状态为上传中
    this.dispatch(updateTransferTask({
      id: taskId,
      status: 'uploading',
    }));

    for (let i = 0; i < file.size; i += chunkSize) {
      // 检查是否被暂停或取消
      if (abortController.signal.aborted) {
        const abortError = new Error('Upload aborted');
        abortError.name = 'AbortError';
        throw abortError;
      }

      const chunk = file.slice(i, Math.min(i + chunkSize, file.size));
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      
      try {
        // 将 Blob 转换为 Uint8Array
        const arrayBuffer = await chunk.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const response = await this.s3ClientManager.putObject(connectionId, bucket, key, uint8Array);
        
        transferred += chunk.size;
        
        // 计算速度和进度
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? transferred / elapsed : 0;
        const progress = (transferred / total) * 100;

        // 更新进度
        this.dispatch(updateTransferTask({
          id: taskId,
          progress,
          speed,
          transferred,
          chunks: [...chunks, {
            partNumber: chunkNumber,
            size: chunk.size,
            etag: response.etag,
            transferred: chunk.size,
            status: 'completed' as const,
          }],
        }));
      } catch (error) {
        console.error(`Chunk ${chunkNumber} upload failed:`, error);
        throw error;
      }
    }

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
      speed: 0,
      transferred: total,
      total,
      chunks,
      resumable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.dispatch(updateTransferTask(completedTask));
    
    // 清理内存中的 File 对象
    this.getUploadFiles().delete(taskId);
    
    return completedTask;
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