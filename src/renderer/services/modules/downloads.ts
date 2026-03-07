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

// File System Access API 类型声明
declare global {
  interface Window {
    showSaveFilePicker(options?: {
      suggestedName?: string;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle>;
  }

  interface FileSystemFileHandle {
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemWritableFileStream {
    write(data: { type: 'write'; position: number; data: Uint8Array }): Promise<void>;
    close(): Promise<void>;
  }
}

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
// 分块大小 (1MB)
const CHUNK_SIZE = 1024 * 1024;

/**
 * 下载模块（支持断点续传）
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
      // 使用 File System Access API 让用户选择保存位置
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{
          description: 'All Files',
          accept: { '*/*': [] }
        }]
      });

      // 创建可写流
      const writable = await fileHandle.createWritable();

      // 保存句柄用于断点续传
      this.getDownloadHandles().set(taskId, { handle: fileHandle, writable });

      return await this.downloadWithResume(
        connectionId, bucket, key, fileName, taskId,
        abortController, fileHandle, writable, 0, totalSize
      );
    } catch (error: any) {
      // 用户取消选择文件
      if (error.name === 'AbortError') {
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'cancelled',
        }));
      } else {
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
   * 带断点续传的下载实现
   */
  private async downloadWithResume(
    connectionId: string,
    bucket: string,
    key: string,
    fileName: string,
    taskId: string,
    abortController: AbortController,
    fileHandle: FileSystemFileHandle,
    writable: FileSystemWritableFileStream,
    startByte: number,
    totalSize: number
  ): Promise<TransferTask> {
    // 更新状态为下载中
    this.dispatch(updateTransferTask({
      id: taskId,
      status: 'downloading',
    }));

    const startTime = Date.now();
    let transferred = startByte;
    const chunks: TransferChunk[] = [];

    try {
      // 分块下载
      for (let currentByte = startByte; currentByte < totalSize; currentByte += CHUNK_SIZE) {
        // 检查是否被暂停或取消
        if (abortController.signal.aborted) {
          const abortError = new Error('Download aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const endByte = Math.min(currentByte + CHUNK_SIZE - 1, totalSize - 1);
        const range = `bytes=${currentByte}-${endByte}`;
        const chunkNumber = Math.floor(currentByte / CHUNK_SIZE) + 1;

        try {
          // 使用 Range 请求下载分块
          const response = await this.retryableS3Operation(
            () => this.s3ClientManager.getObject(connectionId, bucket, key, range),
            `downloadChunk-${chunkNumber}`
          );

          // 获取数据
          const chunkData = await response.Body?.transformToByteArray?.() ||
                           new Uint8Array(await new Response(response.Body).arrayBuffer());

          // 写入文件
          await writable.write({ type: 'write', position: currentByte, data: chunkData });

          transferred += chunkData.byteLength;

          // 计算速度和进度
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? (transferred - startByte) / elapsed : 0;
          const progress = (transferred / totalSize) * 100;

          // 记录分块信息
          const chunk: TransferChunk = {
            partNumber: chunkNumber,
            size: chunkData.byteLength,
            etag: response.ETag || '',
            transferred: chunkData.byteLength,
            status: 'completed',
          };
          chunks.push(chunk);

          // 更新进度
          this.dispatch(updateTransferTask({
            id: taskId,
            progress,
            speed,
            transferred,
            chunks: [...chunks],
            updatedAt: new Date(),
          }));

          // 保存任务状态用于断点续传
          const currentTask: TransferTask = {
            id: taskId,
            type: 'download',
            fileName,
            key,
            bucket,
            connectionId,
            status: 'downloading',
            progress,
            speed,
            transferred,
            total: totalSize,
            chunks: [...chunks],
            resumable: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          StorageService.saveTransferTask(currentTask);
        } catch (error) {
          console.error(`Chunk ${chunkNumber} download failed:`, error);
          throw error;
        }
      }

      // 关闭写入流
      await writable.close();

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
        chunks,
        resumable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.dispatch(updateTransferTask({
        id: taskId,
        progress: 100,
        speed: 0,
        transferred: totalSize,
        status: 'completed',
        updatedAt: new Date(),
      }));

      // 清理
      this.getDownloadHandles().delete(taskId);
      StorageService.removeTransferTask(taskId);

      return completedTask;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 暂停 - 保存状态
        const pausedTask: TransferTask = {
          id: taskId,
          type: 'download',
          fileName,
          key,
          bucket,
          connectionId,
          status: 'paused',
          progress: (transferred / totalSize) * 100,
          speed: 0,
          transferred,
          total: totalSize,
          chunks: [...chunks],
          resumable: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        StorageService.saveTransferTask(pausedTask);
        this.dispatch(pauseTransferTask(taskId));
      } else {
        // 失败
        const failedTask: TransferTask = {
          id: taskId,
          type: 'download',
          fileName,
          key,
          bucket,
          connectionId,
          status: 'failed',
          progress: (transferred / totalSize) * 100,
          speed: 0,
          transferred,
          total: totalSize,
          chunks: [...chunks],
          resumable: true,
          error: error instanceof Error ? error.message : 'Download failed',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        StorageService.saveTransferTask(failedTask);
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Download failed',
        }));
      }
      throw error;
    }
  }

  /**
   * 恢复下载任务
   */
  async resumeDownload(
    task: TransferTask,
    fileHandle?: FileSystemFileHandle
  ): Promise<TransferTask> {
    const taskId = task.id;
    const startByte = task.transferred || 0;

    // 创建 AbortController
    const abortController = new AbortController();
    this.getAbortControllers().set(taskId, abortController);

    try {
      let writable: FileSystemWritableFileStream;
      let handle: FileSystemFileHandle;

      if (fileHandle) {
        // 使用传入的文件句柄
        handle = fileHandle;
        writable = await fileHandle.createWritable({ keepExistingData: true });
      } else {
        // 尝试获取之前保存的句柄
        const savedHandle = this.getDownloadHandles().get(taskId);
        if (savedHandle) {
          handle = savedHandle.handle;
          writable = savedHandle.writable;
        } else {
          // 重新选择文件
          handle = await window.showSaveFilePicker({
            suggestedName: task.fileName,
            types: [{
              description: 'All Files',
              accept: { '*/*': [] }
            }]
          });
          writable = await handle.createWritable({ keepExistingData: true });
        }
      }

      // 保存句柄
      this.getDownloadHandles().set(taskId, { handle, writable });

      return await this.downloadWithResume(
        task.connectionId,
        task.bucket,
        task.key,
        task.fileName,
        taskId,
        abortController,
        handle,
        writable,
        startByte,
        task.total
      );
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.dispatch(pauseTransferTask(taskId));
      } else {
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Resume failed',
        }));
      }
      throw error;
    } finally {
      this.getAbortControllers().delete(taskId);
    }
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
    StorageService.removeTransferTask(taskId);
  }

  /**
   * 获取下载句柄（用于断点续传检查）
   */
  getDownloadHandle(taskId: string): { handle: FileSystemFileHandle; writable: FileSystemWritableFileStream } | undefined {
    return this.getDownloadHandles().get(taskId);
  }
}
