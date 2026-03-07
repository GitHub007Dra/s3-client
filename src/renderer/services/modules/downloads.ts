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
 * 下载模块
 */
export class DownloadsService {
  private s3ClientManager: S3ClientManager;
  private dispatch: AppDispatch;
  // 使用静态变量确保所有实例共享同一个 Map
  private static abortControllers: Map<string, AbortController> = new Map();
  // 存储下载文件句柄，用于断点续传
  private static downloadHandles: Map<string, { handle: FileSystemFileHandle; writable: FileSystemWritableFileStream }> = new Map();

  constructor(s3ClientManager: S3ClientManager, dispatch: AppDispatch) {
    this.s3ClientManager = s3ClientManager;
    this.dispatch = dispatch;
  }

  private getAbortControllers(): Map<string, AbortController> {
    return DownloadsService.abortControllers;
  }

  private getDownloadHandles(): Map<string, { handle: FileSystemFileHandle; writable: FileSystemWritableFileStream }> {
    return DownloadsService.downloadHandles;
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
   * 下载文件（支持断点续传）
   */
  async downloadFile(
    connectionId: string,
    bucket: string,
    key: string,
    fileName: string
  ): Promise<TransferTask> {
    const taskId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 先获取文件大小
    const objectInfo = await this.s3ClientManager.headObject(connectionId, bucket, key);
    const totalSize = objectInfo.ContentLength || 0;

    const task: TransferTask = {
      id: taskId,
      type: 'download',
      fileName,
      key,
      bucket,
      connectionId,
      status: 'pending',
      progress: 0,
      speed: 0,
      transferred: 0,
      total: totalSize,
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
      return await this.downloadWithResume(connectionId, bucket, key, fileName, taskId, abortController);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 保存暂停状态
        const pausedTask = { ...task, status: 'paused' as const };
        StorageService.saveTransferTask(pausedTask);
        this.dispatch(pauseTransferTask(taskId));
      } else {
        // 保存失败状态
        const failedTask = { 
          ...task, 
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Download failed'
        };
        StorageService.saveTransferTask(failedTask);
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Download failed',
        }));
      }
      throw error;
    } finally {
      this.getAbortControllers().delete(taskId);
    }
  }

  /**
   * 带断点续传的下载
   */
  private async downloadWithResume(
    connectionId: string,
    bucket: string,
    key: string,
    fileName: string,
    taskId: string,
    abortController: AbortController
  ): Promise<TransferTask> {
    // 更新状态为下载中
    this.dispatch(updateTransferTask({
      id: taskId,
      status: 'uploading',
    }));

    // 获取文件大小
    const objectInfo = await this.s3ClientManager.headObject(connectionId, bucket, key);
    const totalSize = objectInfo.ContentLength || 0;
    const startTime = Date.now();
    let transferred = 0;

    // 使用 Range 请求下载整个文件（简化版）
    const data = await this.retryableS3Operation(
      () => this.s3ClientManager.getObject(connectionId, bucket, key),
      'downloadFile'
    );

    // 创建 Blob 并触发下载
    const blob = new Blob([data as any]);
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    transferred = totalSize;

    // 计算速度和进度
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? transferred / elapsed : 0;
    const progress = (transferred / totalSize) * 100;

    // 下载完成
    const completedTask: TransferTask = {
      id: taskId,
      type: 'download',
      fileName,
      key,
      bucket,
      connectionId,
      status: 'completed',
      progress: 100,
      speed: 0,
      transferred: totalSize,
      total: totalSize,
      chunks: [],
      resumable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.dispatch(updateTransferTask({
      id: taskId,
      progress,
      speed,
      transferred,
      status: 'completed',
    }));

    return completedTask;
  }

  /**
   * 暂停下载
   */
  pauseDownload(taskId: string): void {
    const controller = this.getAbortControllers().get(taskId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * 取消下载
   */
  cancelDownload(taskId: string): void {
    const controller = this.getAbortControllers().get(taskId);
    if (controller) {
      controller.abort();
    }
    // 清理下载句柄
    this.getDownloadHandles().delete(taskId);
  }
}