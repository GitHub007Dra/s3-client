import { S3ClientManager } from '../../shared/s3-client';
import type { ConnectionConfig, S3Bucket, S3Object, UploadTask, PresignedUrl, UploadChunk, FileItem } from '../../shared/types';
import type { AppDispatch } from '../store';
import { addUploadTask, updateUploadTask } from '../store/slices/uploadsSlice';
import { setFiles, setLoading as setFilesLoading, setError as setFilesError } from '../store/slices/filesSlice';
import { setConnections, setCurrentConnection, setLoading as setConnectionsLoading, setError as setConnectionsError } from '../store/slices/connectionsSlice';

export class S3Service {
  private s3ClientManager: S3ClientManager;
  private dispatch: AppDispatch;

  constructor(dispatch: AppDispatch) {
    this.s3ClientManager = S3ClientManager.getInstance();
    this.dispatch = dispatch;
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

  async uploadFile(file: File, connectionId: string, bucket: string, key: string): Promise<UploadTask> {
    const taskId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const task: UploadTask = {
      id: taskId,
      file,
      key,
      bucket,
      connectionId,
      status: 'pending',
      progress: 0,
      speed: 0,
      uploaded: 0,
      total: file.size,
      chunks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.dispatch(addUploadTask(task));

    try {
      // Check if file size exceeds threshold for multipart upload
      const threshold = 5 * 1024 * 1024; // 5MB
      if (file.size > threshold) {
        return await this.uploadWithMultipart(file, connectionId, bucket, key, taskId);
      } else {
        return await this.uploadSinglePart(file, connectionId, bucket, key, taskId);
      }
    } catch (error) {
      this.dispatch(updateUploadTask({
        id: taskId,
        status: 'failed',
      }));
      throw error;
    }
  }

  private async uploadSinglePart(file: File, connectionId: string, bucket: string, key: string, taskId: string): Promise<UploadTask> {
    const chunkSize = 1024 * 1024; // 1MB chunks
    const chunks: UploadChunk[] = [];
    let uploaded = 0;
    const total = file.size;
    const startTime = Date.now();

    for (let i = 0; i < file.size; i += chunkSize) {
      const chunk = file.slice(i, Math.min(i + chunkSize, file.size));
      const chunkNumber = i / chunkSize + 1;
      
      try {
        // 将 Blob 转换为 Uint8Array，因为 AWS SDK 不支持直接使用 Blob
        const arrayBuffer = await chunk.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const response = await this.s3ClientManager.putObject(connectionId, bucket, key, uint8Array);
        
        uploaded += chunk.size;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = uploaded / elapsed;
        const progress = (uploaded / total) * 100;

        chunks.push({
          partNumber: chunkNumber,
          etag: response.etag || '',
          size: chunk.size,
          uploaded: chunk.size,
          status: 'completed',
        });

        this.dispatch(updateUploadTask({
          id: taskId,
          progress,
          speed,
          uploaded,
          chunks,
          status: progress === 100 ? 'completed' : 'uploading',
          updatedAt: new Date(),
        }));
      } catch (error) {
        this.dispatch(updateUploadTask({
          id: taskId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        } as any));
        throw error;
      }
    }

    return {
      id: taskId,
      file: file,
      key: key,
      bucket: bucket,
      connectionId: connectionId,
      status: 'completed',
      progress: 100,
      speed: 0,
      uploaded: total,
      total: total,
      chunks: chunks,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private async uploadWithMultipart(file: File, connectionId: string, bucket: string, key: string, taskId: string): Promise<UploadTask> {
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    const chunks: UploadChunk[] = [];
    let uploaded = 0;
    const total = file.size;
    const startTime = Date.now();
    let uploadId: string = '';

    try {
      // Step 1: Initiate multipart upload
      uploadId = await this.s3ClientManager.initiateMultipartUpload(connectionId, bucket, key);

      // Step 2: Upload parts
      for (let i = 0; i < file.size; i += chunkSize) {
        const chunk = file.slice(i, Math.min(i + chunkSize, file.size));
        const chunkNumber = i / chunkSize + 1;
        
        try {
          // 将 Blob 转换为 Uint8Array，因为 AWS SDK 不支持直接使用 Blob
          const arrayBuffer = await chunk.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);
          const response = await this.s3ClientManager.uploadPart(connectionId, uploadId, bucket, key, chunkNumber, uint8Array);
          
          uploaded += chunk.size;
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = uploaded / elapsed;
          const progress = (uploaded / total) * 100;

          chunks.push({
            partNumber: chunkNumber,
            etag: response.ETag || '',
            size: chunk.size,
            uploaded: chunk.size,
            status: 'completed',
          });

          this.dispatch(updateUploadTask({
            id: taskId,
            progress,
            speed,
            uploaded,
            chunks,
            status: progress === 100 ? 'completed' : 'uploading',
            updatedAt: new Date(),
          }));
        } catch (error) {
          this.dispatch(updateUploadTask({
            id: taskId,
            status: 'failed',
          } as any));
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
        file: file,
        key: key,
        bucket: bucket,
        connectionId: connectionId,
        status: 'completed',
        progress: 100,
        speed: 0,
        uploaded: total,
        total: total,
        chunks: chunks,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      // Step 4: Abort multipart upload on failure
      await this.s3ClientManager.abortMultipartUpload(connectionId, uploadId, bucket, key);
      throw error;
    }
  }

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