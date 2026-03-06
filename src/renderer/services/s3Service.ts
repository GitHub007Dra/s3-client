import { S3ClientManager } from '../../shared/s3-client';
import type { ConnectionConfig, S3Bucket, S3Object, PresignedUrl, FileItem } from '../../shared/types';
import type { AppDispatch } from '../store';
import {
  addTransferTask,
  updateTransferTask,
  pauseTransferTask,
  cancelTransferTask,
  resumeTransferTask,
  type TransferTask,
  type TransferChunk,
} from '../store/slices/transfersSlice';
import { setFiles, setLoading as setFilesLoading, setError as setFilesError } from '../store/slices/filesSlice';
import { setItems, setCurrentConnection, setLoading as setConnectionsLoading, setError as setConnectionsError } from '../store/slices/connectionsSlice';
import { StorageService } from './storageService';

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

// 进度回调类型
export type ProgressCallback = (progress: number, speed: number, transferred: number) => void;

// 恢复上传需要的参数
interface ResumeUploadParams {
  taskId: string;
  file: File;
  connectionId: string;
  bucket: string;
  key: string;
  uploadId: string;
  completedChunks: TransferChunk[];
}

// 恢复下载需要的参数
interface ResumeDownloadParams {
  taskId: string;
  connectionId: string;
  bucket: string;
  key: string;
  fileName: string;
  fileHandle: FileSystemFileHandle;
  writable: FileSystemWritableFileStream;
  startByte: number;
}

export class S3Service {
  private s3ClientManager: S3ClientManager;
  private dispatch: AppDispatch;
  // 使用静态变量确保所有实例共享同一个 Map
  private static abortControllers: Map<string, AbortController> = new Map();
  // 存储下载文件句柄，用于断点续传
  private static downloadHandles: Map<string, { handle: FileSystemFileHandle; writable: FileSystemWritableFileStream }> = new Map();
  // 存储上传的 File 对象（Redux 不能序列化 File，需要在内存中保持引用）
  private static uploadFiles: Map<string, File> = new Map();

  constructor(dispatch: AppDispatch) {
    this.s3ClientManager = S3ClientManager.getInstance();
    this.dispatch = dispatch;
  }

  // 获取静态 abortControllers
  private getAbortControllers(): Map<string, AbortController> {
    return S3Service.abortControllers;
  }

  // 获取下载句柄存储
  private getDownloadHandles(): Map<string, { handle: FileSystemFileHandle; writable: FileSystemWritableFileStream }> {
    return S3Service.downloadHandles;
  }

  // 获取上传文件存储
  private getUploadFiles(): Map<string, File> {
    return S3Service.uploadFiles;
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
          // 时间同步错误需要更长的等待时间，让系统时间同步
          await this.delay(RETRY_DELAY * 3);
        } else if (this.isRetryableError(error) && attempt < maxRetries) {
          console.log(`[${operationName}] Retrying (${attempt + 1}/${maxRetries})...`);
          await this.delay(RETRY_DELAY * (attempt + 1)); // 指数退避
        } else {
          // 不可重试的错误，直接抛出
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  async testConnection(config: ConnectionConfig): Promise<boolean> {
    try {
      await this.s3ClientManager.connect(config);
      const success = await this.s3ClientManager.testConnection(config.id);
      this.s3ClientManager.disconnect(config.id);
      return success;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async connect(config: ConnectionConfig): Promise<void> {
    await this.s3ClientManager.connect(config);
  }

  async listBuckets(connectionId: string): Promise<S3Bucket[]> {
    try {
      const client = this.s3ClientManager.getClient(connectionId);
      if (!client) throw new Error('No client found for connection');
      
      const buckets = await this.s3ClientManager.listBuckets(connectionId);
      return buckets;
    } catch (error) {
      this.dispatch(setFilesError('Failed to list buckets'));
      throw error;
    }
  }

  async listObjects(connectionId: string, bucket: string, prefix?: string): Promise<S3Object[]> {
    try {
      this.dispatch(setFilesLoading(true));
      const objects = await this.s3ClientManager.listObjects(connectionId, bucket, prefix);
      const fileItems: FileItem[] = objects.map(obj => ({
        name: obj.key.split('/').pop() || obj.key,
        path: obj.key,
        isFolder: obj.key.endsWith('/'),
        size: obj.size,
        lastModified: obj.lastModified,
      }));
      this.dispatch(setFiles(fileItems));
      this.dispatch(setFilesLoading(false));
      return objects;
    } catch (error) {
      this.dispatch(setFilesError('Failed to list objects'));
      this.dispatch(setFilesLoading(false));
      throw error;
    }
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
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? transferred / elapsed : 0;
        const progress = (transferred / total) * 100;

        chunks.push({
          partNumber: chunkNumber,
          etag: response.etag || '',
          size: chunk.size,
          transferred: chunk.size,
          status: 'completed',
        });

        this.dispatch(updateTransferTask({
          id: taskId,
          progress,
          speed,
          transferred,
          chunks: [...chunks],
          status: progress === 100 ? 'completed' : 'uploading',
          updatedAt: new Date(),
        }));
      } catch (error) {
        // 记录失败的块，但继续上传其他块
        chunks.push({
          partNumber: chunkNumber,
          size: chunk.size,
          transferred: 0,
          status: 'failed',
        });
        
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        }));
        throw error;
      }
    }

    // 完成后从 storage 中移除
    StorageService.removeTransferTask(taskId);

    // 刷新文件列表
    try {
      const prefix = key.includes('/') ? key.substring(0, key.lastIndexOf('/') + 1) : undefined;
      await this.listObjects(connectionId, bucket, prefix);
    } catch (error) {
      console.error('Failed to refresh file list after upload:', error);
    }

    return {
      id: taskId,
      type: 'upload',
      fileName: file.name,
      file,
      key,
      bucket,
      connectionId,
      status: 'completed',
      progress: 100,
      speed: 0,
      transferred: total,
      total: total,
      chunks,
      resumable: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 分片上传（支持断点续传）
   */
  private async uploadWithMultipart(
    file: File,
    connectionId: string,
    bucket: string,
    key: string,
    taskId: string,
    abortController: AbortController,
    resumeParams?: ResumeUploadParams
  ): Promise<TransferTask> {
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    let chunks: TransferChunk[] = resumeParams?.completedChunks || [];
    let transferred = chunks.reduce((sum, c) => sum + c.transferred, 0);
    const total = file.size;
    const startTime = Date.now();
    let uploadId: string = resumeParams?.uploadId || '';

    try {
      // 更新状态为上传中
      this.dispatch(updateTransferTask({
        id: taskId,
        status: 'uploading',
        transferred,
        progress: (transferred / total) * 100,
      }));

      // Step 1: Initiate multipart upload (如果是恢复上传，使用已有的 uploadId)
      if (!uploadId) {
        uploadId = await this.s3ClientManager.initiateMultipartUpload(connectionId, bucket, key);
      }

      // 计算已完成的 part numbers
      const completedPartNumbers = new Set(chunks.filter(c => c.status === 'completed').map(c => c.partNumber));
      const totalParts = Math.ceil(file.size / chunkSize);

      // Step 2: Upload parts (跳过已完成的)
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        // 如果该 part 已完成，跳过
        if (completedPartNumbers.has(partNumber)) {
          continue;
        }

        // 检查是否被暂停或取消
        if (abortController.signal.aborted) {
          const abortError = new Error('Upload aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const start = (partNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        
        try {
          // 将 Blob 转换为 Uint8Array
          const arrayBuffer = await chunk.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          
          // 使用带重试机制的 uploadPart
          const response = await this.retryableS3Operation(
            () => this.s3ClientManager.uploadPart(connectionId, uploadId, bucket, key, partNumber, uint8Array),
            `uploadPart-${partNumber}`
          );
          
          transferred += chunk.size;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? transferred / elapsed : 0;
          const progress = (transferred / total) * 100;

          // 更新或添加 chunk
          const existingChunkIndex = chunks.findIndex(c => c.partNumber === partNumber);
          const newChunk: TransferChunk = {
            partNumber,
            etag: response.ETag || '',
            size: chunk.size,
            transferred: chunk.size,
            status: 'completed',
          };

          if (existingChunkIndex >= 0) {
            chunks[existingChunkIndex] = newChunk;
          } else {
            chunks.push(newChunk);
          }

          this.dispatch(updateTransferTask({
            id: taskId,
            progress,
            speed,
            transferred,
            chunks: [...chunks],
            uploadId,
            status: progress === 100 ? 'completed' : 'uploading',
            updatedAt: new Date(),
          }));

          // 保存进度到 storage
          const currentTask: TransferTask = {
            id: taskId,
            type: 'upload',
            fileName: file.name,
            key,
            bucket,
            connectionId,
            status: 'uploading',
            progress,
            speed,
            transferred,
            total,
            chunks: [...chunks],
            resumable: true,
            uploadId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          StorageService.saveTransferTask(currentTask);
        } catch (error) {
          // 记录失败的块
          const existingChunkIndex = chunks.findIndex(c => c.partNumber === partNumber);
          const failedChunk: TransferChunk = {
            partNumber,
            size: end - start,
            transferred: 0,
            status: 'failed',
          };

          if (existingChunkIndex >= 0) {
            chunks[existingChunkIndex] = failedChunk;
          } else {
            chunks.push(failedChunk);
          }
          
          this.dispatch(updateTransferTask({
            id: taskId,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Upload failed',
          }));
          throw error;
        }
      }

      // Step 3: Complete multipart upload
      await this.s3ClientManager.completeMultipartUpload(connectionId, uploadId, bucket, key, chunks.map(chunk => ({
        PartNumber: chunk.partNumber,
        ETag: chunk.etag || '',
      })));

      // 完成后从 storage 中移除
      StorageService.removeTransferTask(taskId);

      // 刷新文件列表
      try {
        const prefix = key.includes('/') ? key.substring(0, key.lastIndexOf('/') + 1) : undefined;
        await this.listObjects(connectionId, bucket, prefix);
      } catch (error) {
        console.error('Failed to refresh file list after upload:', error);
      }

      return {
        id: taskId,
        type: 'upload',
        fileName: file.name,
        file,
        key,
        bucket,
        connectionId,
        status: 'completed',
        progress: 100,
        speed: 0,
        transferred: total,
        total: total,
        chunks,
        resumable: true,
        uploadId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error: any) {
      // Step 4: 如果是暂停，保存状态以便恢复；如果是错误，中止上传
      if (error.name === 'AbortError') {
        // 保存暂停状态到 storage
        const pausedTask: TransferTask = {
          id: taskId,
          type: 'upload',
          fileName: file.name,
          key,
          bucket,
          connectionId,
          status: 'paused',
          progress: (transferred / total) * 100,
          speed: 0,
          transferred,
          total,
          chunks: [...chunks],
          resumable: true,
          uploadId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        StorageService.saveTransferTask(pausedTask);
      } else if (uploadId) {
        // 保存失败状态
        const failedTask: TransferTask = {
          id: taskId,
          type: 'upload',
          fileName: file.name,
          key,
          bucket,
          connectionId,
          status: 'failed',
          progress: (transferred / total) * 100,
          speed: 0,
          transferred,
          total,
          chunks: [...chunks],
          resumable: true,
          uploadId,
          error: error instanceof Error ? error.message : 'Upload failed',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        StorageService.saveTransferTask(failedTask);
        
        try {
          await this.s3ClientManager.abortMultipartUpload(connectionId, uploadId, bucket, key);
        } catch (abortError) {
          console.error('Failed to abort multipart upload:', abortError);
        }
      }
      throw error;
    }
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
   * 下载文件（支持断点续传和进度回调）
   */
  private async downloadWithResume(
    connectionId: string,
    bucket: string,
    key: string,
    fileName: string,
    taskId: string,
    abortController: AbortController,
    resumeParams?: ResumeDownloadParams
  ): Promise<TransferTask> {
    // 获取文件总大小
    const headObject = await this.s3ClientManager.headObject(connectionId, bucket, key);
    const total = headObject.ContentLength || 0;

    // 更新状态为下载中
    this.dispatch(updateTransferTask({
      id: taskId,
      status: 'downloading',
    }));

    const chunks: TransferChunk[] = resumeParams ? 
      // 如果是恢复下载，保留之前的 chunks
      [] : 
      [];
    
    // 如果是恢复下载，从已下载位置开始
    let transferred = resumeParams?.startByte || 0;
    const startTime = Date.now();
    const chunkSize = 1024 * 1024; // 1MB chunks
    const startChunk = resumeParams ? Math.floor(resumeParams.startByte / chunkSize) : 0;

    // 检查浏览器是否支持 File System Access API
    const supportsFileSystem = 'showSaveFilePicker' in window;

    let writable: FileSystemWritableFileStream | null = resumeParams?.writable || null;

    try {
      if (supportsFileSystem && !writable) {
        // 使用 File System Access API - 立即弹出保存对话框
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
        });
        const newWritable = await handle.createWritable();
        writable = newWritable;
        
        // 保存句柄以便断点续传使用
        this.getDownloadHandles().set(taskId, { handle, writable: newWritable });
      } else if (!supportsFileSystem) {
        // 不支持 File System Access API，回退到原来的方式
        // 获取预签名 URL，带上文件名让浏览器直接弹出保存对话框
        const presignedUrlString = await this.s3ClientManager.getPresignedUrl(connectionId, bucket, key, {
          expiresIn: 3600,
          method: 'GET',
          fileName: fileName,
        });

        const response = await fetch(presignedUrlString, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        
        // 创建下载链接并触发下载
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);

        console.log(`File downloaded: ${fileName}`);
        
        // 完成后从 storage 中移除
        StorageService.removeTransferTask(taskId);
        
        return {
          id: taskId,
          type: 'download',
          fileName,
          key,
          bucket,
          connectionId,
          status: 'completed',
          progress: 100,
          speed: 0,
          transferred: total,
          total,
          chunks: [],
          resumable: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      // 使用 File System Access API 分块下载并写入文件
      const numChunks = Math.ceil(total / chunkSize);

      for (let i = startChunk; i < numChunks; i++) {
        // 检查是否被暂停或取消
        if (abortController.signal.aborted) {
          const abortError = new Error('Download aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, total - 1);
        const chunkNumber = i + 1;

        // 获取预签名 URL（不带文件名，因为我们要自己处理下载）
        const presignedUrlString = await this.s3ClientManager.getPresignedUrl(connectionId, bucket, key, {
          expiresIn: 3600,
          method: 'GET',
        });

        try {
          // 使用 Range 请求下载部分内容
          const response = await fetch(presignedUrlString, {
            headers: {
              Range: `bytes=${start}-${end}`,
            },
            signal: abortController.signal,
          });

          if (!response.ok && response.status !== 206) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const blob = await response.blob();
          
          // 写入文件
          if (writable) {
            await writable.write(blob);
          }
          
          const chunkSizeActual = blob.size;
          transferred += chunkSizeActual;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? transferred / elapsed : 0;
          const progress = total > 0 ? (transferred / total) * 100 : 0;

          chunks.push({
            partNumber: chunkNumber,
            size: chunkSizeActual,
            transferred: chunkSizeActual,
            status: 'completed',
          });

          this.dispatch(updateTransferTask({
            id: taskId,
            progress,
            speed,
            transferred,
            chunks: [...chunks],
            status: progress === 100 ? 'completed' : 'downloading',
            updatedAt: new Date(),
          }));

          // 保存进度到 storage
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
            total,
            chunks: [...chunks],
            resumable: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          StorageService.saveTransferTask(currentTask);
        } catch (error) {
          chunks.push({
            partNumber: chunkNumber,
            size: end - start + 1,
            transferred: 0,
            status: 'failed',
          });
          
          this.dispatch(updateTransferTask({
            id: taskId,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Download failed',
          }));
          throw error;
        }
      }

      // 关闭文件写入流
      if (writable) {
        await writable.close();
      }
      
      // 清理句柄
      this.getDownloadHandles().delete(taskId);
      
      // 完成后从 storage 中移除
      StorageService.removeTransferTask(taskId);
      
      console.log(`File downloaded: ${fileName}`);

    } catch (error: any) {
      // 清理资源
      if (error.name === 'AbortError') {
        // 保存暂停状态到 storage
        const pausedTask: TransferTask = {
          id: taskId,
          type: 'download',
          fileName,
          key,
          bucket,
          connectionId,
          status: 'paused',
          progress: total > 0 ? (transferred / total) * 100 : 0,
          speed: 0,
          transferred,
          total,
          chunks: [...chunks],
          resumable: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        StorageService.saveTransferTask(pausedTask);
        
        // 不关闭 writable，保留以便恢复
        throw error;
      } else {
        if (writable) {
          await writable.abort();
        }
        
        // 保存失败状态
        const failedTask: TransferTask = {
          id: taskId,
          type: 'download',
          fileName,
          key,
          bucket,
          connectionId,
          status: 'failed',
          progress: total > 0 ? (transferred / total) * 100 : 0,
          speed: 0,
          transferred,
          total,
          chunks: [...chunks],
          resumable: true,
          error: error instanceof Error ? error.message : 'Download failed',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        StorageService.saveTransferTask(failedTask);
        
        // 清理句柄
        this.getDownloadHandles().delete(taskId);
      }
      
      // 如果是用户取消选择文件，不算错误
      if (error.name === 'AbortError' || (error as any).code === 'ERR_ABORTED') {
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'cancelled',
        }));
        throw error;
      }
      
      this.dispatch(updateTransferTask({
        id: taskId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Download failed',
      }));
      throw error;
    }

    return {
      id: taskId,
      type: 'download',
      fileName,
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
  }

  /**
   * 暂停传输任务
   */
  pauseTransfer(taskId: string): void {
    const abortController = this.getAbortControllers().get(taskId);
    if (abortController) {
      abortController.abort();
      this.dispatch(pauseTransferTask(taskId));
    }
  }

  /**
   * 取消传输任务
   */
  cancelTransfer(taskId: string): void {
    const abortController = this.getAbortControllers().get(taskId);
    if (abortController) {
      abortController.abort();
    }
    this.dispatch(cancelTransferTask(taskId));
    // 从 storage 中移除
    StorageService.removeTransferTask(taskId);
    // 清理下载句柄
    this.getDownloadHandles().delete(taskId);
  }

  /**
   * 恢复传输任务
   */
  async resumeTransfer(task: TransferTask, file?: File): Promise<void> {
    // 更新状态为恢复中
    this.dispatch(resumeTransferTask(task.id));
    
    // 创建新的 AbortController
    const abortController = new AbortController();
    this.getAbortControllers().set(task.id, abortController);

    try {
      if (task.type === 'upload') {
        // 从内存 Map 获取 File 对象，或直接使用传入的 file
        const uploadFile = file || this.getUploadFiles().get(task.id);
        if (!uploadFile) {
          throw new Error('Upload resume requires file');
        }
        
        // 恢复分片上传
        if (task.uploadId) {
          const resumeParams: ResumeUploadParams = {
            taskId: task.id,
            file: uploadFile,
            connectionId: task.connectionId,
            bucket: task.bucket,
            key: task.key,
            uploadId: task.uploadId,
            completedChunks: task.chunks.filter(c => c.status === 'completed'),
          };
          
          await this.uploadWithMultipart(
            uploadFile,
            task.connectionId,
            task.bucket,
            task.key,
            task.id,
            abortController,
            resumeParams
          );
        } else {
          // 普通上传恢复（重新上传）
          await this.uploadSinglePart(
            uploadFile,
            task.connectionId,
            task.bucket,
            task.key,
            task.id,
            abortController
          );
        }
      } else if (task.type === 'download') {
        // 检查是否有保存的文件句柄
        const savedHandle = this.getDownloadHandles().get(task.id);
        
        if (savedHandle) {
          // 使用保存的句柄恢复下载
          const resumeParams: ResumeDownloadParams = {
            taskId: task.id,
            connectionId: task.connectionId,
            bucket: task.bucket,
            key: task.key,
            fileName: task.fileName,
            fileHandle: savedHandle.handle,
            writable: savedHandle.writable,
            startByte: task.transferred,
          };
          
          await this.downloadWithResume(
            task.connectionId,
            task.bucket,
            task.key,
            task.fileName,
            task.id,
            abortController,
            resumeParams
          );
        } else {
          // 重新选择文件位置
          await this.downloadWithResume(
            task.connectionId,
            task.bucket,
            task.key,
            task.fileName,
            task.id,
            abortController
          );
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 暂停 - 状态已在方法中保存
        console.log('Transfer paused:', task.id);
      } else {
        console.error('Resume transfer failed:', error);
        // 保存失败状态
        const failedTask = {
          ...task,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Resume failed',
        };
        StorageService.saveTransferTask(failedTask);
        this.dispatch(updateTransferTask({
          id: task.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Resume failed',
        }));
      }
    } finally {
      this.getAbortControllers().delete(task.id);
    }
  }

  /**
   * 获取预签名 URL
   */
  async getPresignedUrl(connectionId: string, bucket: string, key: string, expiresIn: number): Promise<PresignedUrl> {
    try {
      const url = await this.s3ClientManager.getPresignedUrl(connectionId, bucket, key, {
        expiresIn,
        method: 'GET',
      });
      
      return {
        url,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        duration: expiresIn,
        type: 'download',
      };
    } catch (error) {
      throw error;
    }
  }

  async manageConnections(configs: ConnectionConfig[]): Promise<void> {
    try {
      this.dispatch(setConnectionsLoading(true));
      
      // Test all connections
      const validConnections = await Promise.all(
        configs.map(async (config) => {
          const isValid = await this.testConnection(config);
          return isValid ? config : null;
        })
      );

      const connections = validConnections.filter(Boolean) as ConnectionConfig[];
      
      // Convert to ConnectionItem format and dispatch
      const items = connections.map(conn => ({
        id: conn.id,
        type: 'connection' as const,
        name: conn.name,
        parentId: null,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
        connection: conn,
      }));
      
      this.dispatch(setItems(items));
      
      // Set first connection as default if none is set
      if (connections.length > 0 && !connections.find(c => c.isDefault)) {
        connections[0].isDefault = true;
        this.dispatch(setCurrentConnection(connections[0].id));
      }

      this.dispatch(setConnectionsLoading(false));
    } catch (error) {
      this.dispatch(setConnectionsError('Failed to manage connections'));
      this.dispatch(setConnectionsLoading(false));
      throw error;
    }
  }

  async createFolder(connectionId: string, bucket: string, key: string): Promise<void> {
    try {
      // S3 中创建文件夹实际上是创建一个以 / 结尾的空对象
      await this.s3ClientManager.putObject(connectionId, bucket, key, new Uint8Array(0));
    } catch (error) {
      console.error('Create folder failed:', error);
      throw error;
    }
  }

  async deleteObject(connectionId: string, bucket: string, key: string): Promise<void> {
    try {
      await this.s3ClientManager.deleteObject(connectionId, bucket, key);
    } catch (error) {
      console.error('Delete object failed:', error);
      throw error;
    }
  }

  async deleteFolder(connectionId: string, bucket: string, prefix: string): Promise<void> {
    try {
      // 1. 列出该文件夹下的所有对象
      const objects = await this.s3ClientManager.listObjects(connectionId, bucket, prefix);
      
      // 2. 删除所有对象
      for (const obj of objects) {
        await this.s3ClientManager.deleteObject(connectionId, bucket, obj.key);
      }
    } catch (error) {
      console.error('Delete folder failed:', error);
      throw error;
    }
  }
}
