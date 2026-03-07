import { S3ClientManager } from '../../../shared/s3-client';
import type { S3Object, FileItem, PresignedUrl } from '../../../shared/types';
import type { AppDispatch } from '../../store';
import { setFiles, setLoading, setError } from '../../store/slices/filesSlice';

/**
 * 对象操作模块
 */
export class ObjectsService {
  private s3ClientManager: S3ClientManager;
  private dispatch: AppDispatch;

  constructor(s3ClientManager: S3ClientManager, dispatch: AppDispatch) {
    this.s3ClientManager = s3ClientManager;
    this.dispatch = dispatch;
  }

  /**
   * 列出对象
   */
  async listObjects(connectionId: string, bucket: string, prefix?: string): Promise<S3Object[]> {
    try {
      this.dispatch(setLoading(true));
      const objects = await this.s3ClientManager.listObjects(connectionId, bucket, prefix);
      const fileItems: FileItem[] = objects.map(obj => ({
        name: obj.key.split('/').pop() || obj.key,
        path: obj.key,
        isFolder: obj.key.endsWith('/'),
        size: obj.size,
        lastModified: obj.lastModified,
      }));
      this.dispatch(setFiles(fileItems));
      this.dispatch(setLoading(false));
      return objects;
    } catch (error) {
      this.dispatch(setError('Failed to list objects'));
      this.dispatch(setLoading(false));
      throw error;
    }
  }

  /**
   * 获取对象头信息
   */
  async headObject(connectionId: string, bucket: string, key: string) {
    return await this.s3ClientManager.headObject(connectionId, bucket, key);
  }

  /**
   * 上传对象
   */
  async putObject(connectionId: string, bucket: string, key: string, data: Uint8Array) {
    return await this.s3ClientManager.putObject(connectionId, bucket, key, data);
  }

  /**
   * 删除对象
   */
  async deleteObject(connectionId: string, bucket: string, key: string): Promise<void> {
    try {
      await this.s3ClientManager.deleteObject(connectionId, bucket, key);
    } catch (error) {
      console.error('Delete object failed:', error);
      throw error;
    }
  }

  /**
   * 删除文件夹（递归删除所有对象）
   */
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

  /**
   * 创建文件夹（S3中创建以/结尾的空对象）
   */
  async createFolder(connectionId: string, bucket: string, key: string): Promise<void> {
    try {
      await this.s3ClientManager.putObject(connectionId, bucket, key, new Uint8Array(0));
    } catch (error) {
      console.error('Create folder failed:', error);
      throw error;
    }
  }

  /**
   * 获取预签名URL
   */
  async getPresignedUrl(connectionId: string, bucket: string, key: string, expiresIn: number): Promise<PresignedUrl> {
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
  }
}