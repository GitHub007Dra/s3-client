import { S3ClientManager } from '../../shared/s3-client';
import type { ConnectionConfig, S3Bucket, S3Object, PresignedUrl, FileItem } from '../../shared/types';
import type { AppDispatch } from '../store';
import {
  addTransferTask,
  updateTransferTask,
  pauseTransferTask,
  cancelTransferTask,
  type TransferTask,
  type TransferChunk,
} from '../store/slices/transfersSlice';
import { setFiles, setLoading as setFilesLoading, setError as setFilesError } from '../store/slices/filesSlice';
import { setConnections, setCurrentConnection, setLoading as setConnectionsLoading, setError as setConnectionsError } from '../store/slices/connectionsSlice';

// 进度回调类型
export type ProgressCallback = (progress: number, speed: number, transferred: number) => void;

export class S3Service {
  private s3ClientManager: S3ClientManager;
  private dispatch: AppDispatch;
  // 使用静态变量确保所有实例共享同一个 Map
  private static abortControllers: Map<string, AbortController> = new Map();

  constructor(dispatch: AppDispatch) {
    this.s3ClientManager = S3ClientManager.getInstance();
    this.dispatch = dispatch;
  }

  // 获取静态 abortControllers
  private getAbortControllers(): Map<string, AbortController> {
    return S3Service.abortControllers;
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
    const task: TransferTask = {
      id: taskId,
      type: 'upload',
      fileName: file.name,
      file,
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
        // 用户取消或暂停
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'cancelled',
        }));
      } else {
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
        throw new Error('Upload aborted');
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
    abortController: AbortController
  ): Promise<TransferTask> {
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    const chunks: TransferChunk[] = [];
    let transferred = 0;
    const total = file.size;
    const startTime = Date.now();
    let uploadId: string = '';

    try {
      // 更新状态为上传中
      this.dispatch(updateTransferTask({
        id: taskId,
        status: 'uploading',
      }));

      // Step 1: Initiate multipart upload
      uploadId = await this.s3ClientManager.initiateMultipartUpload(connectionId, bucket, key);

      // Step 2: Upload parts
      for (let i = 0; i < file.size; i += chunkSize) {
        // 检查是否被暂停或取消
        if (abortController.signal.aborted) {
          throw new Error('Upload aborted');
        }

        const chunk = file.slice(i, Math.min(i + chunkSize, file.size));
        const chunkNumber = Math.floor(i / chunkSize) + 1;
        
        try {
          // 将 Blob 转换为 Uint8Array
          const arrayBuffer = await chunk.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const response = await this.s3ClientManager.uploadPart(connectionId, uploadId, bucket, key, chunkNumber, uint8Array);
          
          transferred += chunk.size;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? transferred / elapsed : 0;
          const progress = (transferred / total) * 100;

          chunks.push({
            partNumber: chunkNumber,
            etag: response.ETag || '',
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
            uploadId,
            status: progress === 100 ? 'completed' : 'uploading',
            updatedAt: new Date(),
          }));
        } catch (error) {
          // 记录失败的块
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

      // Step 3: Complete multipart upload
      await this.s3ClientManager.completeMultipartUpload(connectionId, uploadId, bucket, key, chunks.map(chunk => ({
        PartNumber: chunk.partNumber,
        ETag: chunk.etag || '',
      })));

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
      // Step 4: Abort multipart upload on failure
      if (uploadId && error.name !== 'AbortError') {
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
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'cancelled',
        }));
      } else {
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
    abortController: AbortController
  ): Promise<TransferTask> {
    // 获取文件总大小
    const headObject = await this.s3ClientManager.headObject(connectionId, bucket, key);
    const total = headObject.ContentLength || 0;

    // 更新状态为下载中
    this.dispatch(updateTransferTask({
      id: taskId,
      status: 'downloading',
    }));

    const chunks: TransferChunk[] = [];
    let transferred = 0;
    const startTime = Date.now();
    const chunkSize = 1024 * 1024; // 1MB chunks
    const numChunks = Math.ceil(total / chunkSize);

    // 检查浏览器是否支持 File System Access API
    const supportsFileSystem = 'showSaveFilePicker' in window;

    let writable: FileSystemWritableFileStream | null = null;

    try {
      if (supportsFileSystem) {
        // 使用 File System Access API - 立即弹出保存对话框
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: fileName,
        });
        writable = await handle.createWritable();
      } else {
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

      for (let i = 0; i < numChunks; i++) {
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
      console.log(`File downloaded: ${fileName}`);

    } catch (error: any) {
      // 清理资源
      if (writable) {
        await writable.abort();
      }
      
      if (error.name === 'AbortError') {
        this.dispatch(updateTransferTask({
          id: taskId,
          status: 'cancelled',
        }));
        throw error;
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
      this.dispatch(setConnections(connections));
      
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