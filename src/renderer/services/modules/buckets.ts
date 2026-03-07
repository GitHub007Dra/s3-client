import { S3ClientManager } from '../../../shared/s3-client';
import type { ConnectionConfig, S3Bucket } from '../../../shared/types';
import type { AppDispatch } from '../../store';
import { setError } from '../../store/slices/filesSlice';

/**
 * 存储桶操作模块
 */
export class BucketsService {
  private s3ClientManager: S3ClientManager;
  private dispatch: AppDispatch;

  constructor(s3ClientManager: S3ClientManager, dispatch: AppDispatch) {
    this.s3ClientManager = s3ClientManager;
    this.dispatch = dispatch;
  }

  /**
   * 测试连接
   */
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

  /**
   * 连接到S3
   */
  async connect(config: ConnectionConfig): Promise<void> {
    await this.s3ClientManager.connect(config);
  }

  /**
   * 断开连接
   */
  disconnect(connectionId: string): void {
    this.s3ClientManager.disconnect(connectionId);
  }

  /**
   * 获取客户端
   */
  getClient(connectionId: string) {
    return this.s3ClientManager.getClient(connectionId);
  }

  /**
   * 列出存储桶
   */
  async listBuckets(connectionId: string): Promise<S3Bucket[]> {
    try {
      const client = this.s3ClientManager.getClient(connectionId);
      if (!client) throw new Error('No client found for connection');
      
      const buckets = await this.s3ClientManager.listBuckets(connectionId);
      return buckets;
    } catch (error) {
      this.dispatch(setError('Failed to list buckets'));
      throw error;
    }
  }
}