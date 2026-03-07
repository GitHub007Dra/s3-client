// 模块导出
export { BucketsService } from './buckets';
export { ObjectsService } from './objects';
export { UploadsService } from './uploads';
export { DownloadsService } from './downloads';
export { ConnectionsService } from './connections';

import { S3ClientManager } from '../../../shared/s3-client';
import type { ConnectionConfig, S3Bucket, S3Object, PresignedUrl, FileItem, TransferTask } from '../../../shared/types';
import type { AppDispatch } from '../../store';
import { BucketsService } from './buckets';
import { ObjectsService } from './objects';
import { UploadsService } from './uploads';
import { DownloadsService } from './downloads';
import { ConnectionsService } from './connections';

/**
 * S3 服务统一入口
 * 整合所有模块，提供统一的API
 */
export class S3Service {
  private bucketsService: BucketsService;
  private objectsService: ObjectsService;
  private uploadsService: UploadsService;
  private downloadsService: DownloadsService;
  private connectionsService: ConnectionsService;

  constructor(dispatch: AppDispatch) {
    const s3ClientManager = S3ClientManager.getInstance();
    
    // 初始化所有子服务
    this.bucketsService = new BucketsService(s3ClientManager, dispatch);
    this.objectsService = new ObjectsService(s3ClientManager, dispatch);
    this.uploadsService = new UploadsService(s3ClientManager, dispatch);
    this.downloadsService = new DownloadsService(s3ClientManager, dispatch);
    this.connectionsService = new ConnectionsService(this.bucketsService, dispatch);
  }

  // ==================== 存储桶操作 ====================
  
  async testConnection(config: ConnectionConfig): Promise<boolean> {
    return this.bucketsService.testConnection(config);
  }

  async connect(config: ConnectionConfig): Promise<void> {
    return this.bucketsService.connect(config);
  }

  disconnect(connectionId: string): void {
    return this.bucketsService.disconnect(connectionId);
  }

  async listBuckets(connectionId: string): Promise<S3Bucket[]> {
    return this.bucketsService.listBuckets(connectionId);
  }

  // ==================== 对象操作 ====================

  async listObjects(connectionId: string, bucket: string, prefix?: string): Promise<S3Object[]> {
    return this.objectsService.listObjects(connectionId, bucket, prefix);
  }

  async headObject(connectionId: string, bucket: string, key: string) {
    return this.objectsService.headObject(connectionId, bucket, key);
  }

  async putObject(connectionId: string, bucket: string, key: string, data: Uint8Array) {
    return this.objectsService.putObject(connectionId, bucket, key, data);
  }

  async deleteObject(connectionId: string, bucket: string, key: string): Promise<void> {
    return this.objectsService.deleteObject(connectionId, bucket, key);
  }

  async deleteFolder(connectionId: string, bucket: string, prefix: string): Promise<void> {
    return this.objectsService.deleteFolder(connectionId, bucket, prefix);
  }

  async createFolder(connectionId: string, bucket: string, key: string): Promise<void> {
    return this.objectsService.createFolder(connectionId, bucket, key);
  }

  async getPresignedUrl(connectionId: string, bucket: string, key: string, expiresIn: number): Promise<PresignedUrl> {
    return this.objectsService.getPresignedUrl(connectionId, bucket, key, expiresIn);
  }

  // ==================== 上传操作 ====================

  async uploadFile(file: File, connectionId: string, bucket: string, key: string): Promise<TransferTask> {
    return this.uploadsService.uploadFile(file, connectionId, bucket, key);
  }

  pauseUpload(taskId: string): void {
    return this.uploadsService.pauseUpload(taskId);
  }

  cancelUpload(taskId: string): void {
    return this.uploadsService.cancelUpload(taskId);
  }

  getUploadFile(taskId: string): File | undefined {
    return this.uploadsService.getUploadFile(taskId);
  }

  // ==================== 下载操作 ====================

  async downloadFile(connectionId: string, bucket: string, key: string, fileName: string): Promise<TransferTask> {
    return this.downloadsService.downloadFile(connectionId, bucket, key, fileName);
  }

  pauseDownload(taskId: string): void {
    return this.downloadsService.pauseDownload(taskId);
  }

  cancelDownload(taskId: string): void {
    return this.downloadsService.cancelDownload(taskId);
  }

  // ==================== 连接管理 ====================

  async manageConnections(configs: ConnectionConfig[]): Promise<void> {
    return this.connectionsService.manageConnections(configs);
  }
}