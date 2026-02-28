import { S3Client, ListBucketsCommand, CreateBucketCommand, DeleteBucketCommand, ListObjectsCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ConnectionConfig {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  isDefault?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface S3ServiceConfig {
  service: 's3' | 's3-object-lambda' | 's3-control' | 's3-data-landsat' | 's3-data-archive';
  signingRegion?: string;
  signingService?: string;
}

export interface S3Object {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  storageClass: string;
  owner?: {
    displayName: string;
    id: string;
  };
  metadata?: Record<string, string>;
}

export interface S3Bucket {
  name: string;
  creationDate: Date;
  region: string;
  owner?: {
    displayName: string;
    id: string;
  };
}

export class S3ClientManager {
  private clients: Map<string, S3Client> = new Map();
  private configs: Map<string, ConnectionConfig> = new Map();
  
  // 单例模式
  private static instance: S3ClientManager | null = null;

  private constructor() {}

  static getInstance(): S3ClientManager {
    if (!S3ClientManager.instance) {
      S3ClientManager.instance = new S3ClientManager();
    }
    return S3ClientManager.instance;
  }

  async connect(config: ConnectionConfig): Promise<void> {
    console.log('[S3ClientManager] connect called with config:', {
      id: config.id,
      name: config.name,
      endpoint: config.endpoint,
      region: config.region,
      hasAccessKey: !!config.accessKeyId,
      hasSecretKey: !!config.secretAccessKey,
    });
    
    // 阿里云 OSS 特殊处理
    const isAliyunOSS = config.endpoint.includes('aliyuncs.com');
    console.log('[S3ClientManager] Is Aliyun OSS:', isAliyunOSS);
    
    // 保留完整的 endpoint URL（带 https://）
    const endpointUrl = config.endpoint.startsWith('http')
      ? config.endpoint
      : `https://${config.endpoint}`;
    
    const s3Config: any = {
      endpoint: endpointUrl,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
      forcePathStyle: !isAliyunOSS, // 阿里云 OSS 不需要 forcePathStyle
    };

    console.log('[S3ClientManager] Creating S3Client with config:', {
      endpoint: s3Config.endpoint,
      region: s3Config.region,
      forcePathStyle: s3Config.forcePathStyle,
    });
    
    const client = new S3Client(s3Config);
    console.log('[S3ClientManager] S3Client created, storing in map');
    this.clients.set(config.id, client);
    this.configs.set(config.id, config);
    console.log('[S3ClientManager] Client stored successfully');
  }

  disconnect(connectionId: string): void {
    this.clients.delete(connectionId);
    this.configs.delete(connectionId);
  }

  getClient(connectionId: string): S3Client | undefined {
    return this.clients.get(connectionId);
  }

  getConfig(connectionId: string): ConnectionConfig | undefined {
    return this.configs.get(connectionId);
  }

  async testConnection(connectionId: string): Promise<boolean> {
    const client = this.getClient(connectionId);
    if (!client) return false;

    try {
      const command = new ListBucketsCommand({});
      await client.send(command);
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async listBuckets(connectionId: string): Promise<S3Bucket[]> {
    console.log('[S3ClientManager] listBuckets called for connectionId:', connectionId);
    
    const client = this.getClient(connectionId);
    console.log('[S3ClientManager] Client found:', !!client);
    
    if (!client) {
      console.error('[S3ClientManager] No client found for connectionId:', connectionId);
      throw new Error('No client found for connection');
    }

    console.log('[S3ClientManager] Sending ListBucketsCommand...');
    const command = new ListBucketsCommand({});
    
    try {
      // 添加超时处理
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error('[S3ClientManager] Request timeout after 30 seconds');
        controller.abort();
      }, 30000);
      
      const response = await client.send(command, {
        abortSignal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log('[S3ClientManager] ListBuckets response:', response);
      console.log('[S3ClientManager] Buckets in response:', response.Buckets);
      
      const buckets = (response.Buckets || []).map(bucket => ({
        name: bucket.Name || '',
        creationDate: bucket.CreationDate || new Date(),
        region: this.getConfig(connectionId)?.region || '',
      }));
      
      console.log('[S3ClientManager] Mapped buckets:', buckets);
      return buckets;
    } catch (error: any) {
      console.error('[S3ClientManager] Error in listBuckets:', error.name, error.message);
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请检查网络连接和Endpoint配置');
      }
      if (error.$fault === 'client') {
        console.error('[S3ClientManager] Client error - 可能的原因:');
        console.error('  - Endpoint 地址错误');
        console.error('  - 凭证无效');
        console.error('  - 网络无法访问');
        console.error('  - CORS 配置问题');
      }
      throw error;
    }
  }

  async createBucket(connectionId: string, name: string, region?: string): Promise<S3Bucket> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new CreateBucketCommand({
      Bucket: name,
      CreateBucketConfiguration: region ? {
        LocationConstraint: region as any
      } : undefined
    });

    await client.send(command);
    
    return {
      name,
      creationDate: new Date(),
      region: region || this.getConfig(connectionId)?.region || '',
    };
  }

  async deleteBucket(connectionId: string, name: string): Promise<void> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new DeleteBucketCommand({
      Bucket: name
    });

    await client.send(command);
  }

  async listObjects(connectionId: string, bucket: string, prefix?: string): Promise<S3Object[]> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new ListObjectsCommand({
      Bucket: bucket,
      Prefix: prefix
    });

    const response = await client.send(command);
    
    return (response.Contents || []).map(obj => ({
      key: obj.Key || '',
      size: obj.Size || 0,
      etag: obj.ETag || '',
      lastModified: obj.LastModified || new Date(),
      storageClass: obj.StorageClass || '',
      owner: obj.Owner ? {
        displayName: obj.Owner.DisplayName || '',
        id: obj.Owner.ID || ''
      } : undefined
    }));
  }

  async getObject(connectionId: string, bucket: string, key: string): Promise<any> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });

    return await client.send(command);
  }

  async putObject(connectionId: string, bucket: string, key: string, body: Buffer | Uint8Array | Blob | ReadableStream | undefined, metadata?: Record<string, string>): Promise<S3Object> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      Metadata: metadata
    });

    const response = await client.send(command);
    
    return {
      key,
      size: (response as any).ContentLength || 0,
      etag: response.ETag || '',
      lastModified: (response as any).LastModified || new Date(),
      storageClass: (response as any).StorageClass || '',
    };
  }

  async deleteObject(connectionId: string, bucket: string, key: string): Promise<void> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    });

    await client.send(command);
  }

  async copyObject(connectionId: string, sourceBucket: string, sourceKey: string, destinationBucket: string, destinationKey: string): Promise<S3Object> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new CopyObjectCommand({
      CopySource: `${sourceBucket}/${sourceKey}`,
      Bucket: destinationBucket,
      Key: destinationKey
    });

    const response = await client.send(command);
    
    return {
      key: destinationKey,
      size: (response as any).CopyObjectResult?.ContentLength || 0,
      etag: (response as any).CopyObjectResult?.ETag || '',
      lastModified: (response as any).CopyObjectResult?.LastModified || new Date(),
      storageClass: (response as any).CopyObjectResult?.StorageClass || '',
    };
  }

  async initiateMultipartUpload(connectionId: string, bucket: string, key: string, metadata?: Record<string, string>): Promise<string> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      Metadata: metadata
    });

    const response = await client.send(command);
    return response.UploadId || '';
  }

  async uploadPart(connectionId: string, uploadId: string, bucket: string, key: string, partNumber: number, body: Buffer | Uint8Array | Blob | ReadableStream | undefined): Promise<{ ETag: string }> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body
    });

    const response = await client.send(command);
    return { ETag: response.ETag || '' };
  }

  async completeMultipartUpload(connectionId: string, uploadId: string, bucket: string, key: string, parts: { PartNumber: number, ETag: string }[]): Promise<S3Object> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
      }
    });

    const response = await client.send(command);
    
    return {
      key,
      size: (response as any).ContentLength || 0,
      etag: response.ETag || '',
      lastModified: (response as any).LastModified || new Date(),
      storageClass: (response as any).StorageClass || '',
    };
  }

  async abortMultipartUpload(connectionId: string, uploadId: string, bucket: string, key: string): Promise<void> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId
    });

    await client.send(command);
  }

  async headObject(connectionId: string, bucket: string, key: string): Promise<{ ContentLength: number; ContentType?: string; LastModified?: Date; ETag?: string; metadata?: Record<string, string> }> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    });

    const response = await client.send(command);
    
    return {
      ContentLength: response.ContentLength || 0,
      ContentType: response.ContentType,
      LastModified: response.LastModified,
      ETag: response.ETag,
      metadata: response.Metadata,
    };
  }

  async getPresignedUrl(connectionId: string, bucket: string, key: string, options: { expiresIn: number, method: 'GET' | 'PUT', fileName?: string }): Promise<string> {
    const client = this.getClient(connectionId);
    if (!client) throw new Error('No client found for connection');

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // 添加 ResponseContentDisposition 让浏览器直接下载
      ...(options.fileName && {
        ResponseContentDisposition: `attachment; filename="${options.fileName}"`,
      }),
    });

    return getSignedUrl(client, command, {
      expiresIn: options.expiresIn,
      signableHeaders: new Set(['host']),
    });
  }
}