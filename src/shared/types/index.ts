// 连接项类型：目录或连接
export type ConnectionItemType = 'folder' | 'connection';

export interface ConnectionItem {
  id: string;
  type: ConnectionItemType;
  name: string;
  parentId: string | null; // null 表示根目录
  createdAt: Date;
  updatedAt: Date;
  // 当 type 为 'connection' 时有值
  connection?: ConnectionConfig;
}

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

export interface Bucket {
  id: string;
  name: string;
  region: string;
  creationDate: Date;
}

export interface UploadTask {
  id: string;
  file: File;
  key: string;
  bucket: string;
  connectionId: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  speed: number;
  uploaded: number;
  total: number;
  chunks: UploadChunk[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadChunk {
  partNumber: number;
  etag?: string;
  size: number;
  uploaded: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
}

export interface PresignedUrl {
  url: string;
  expiresAt: Date;
  duration: number; // in seconds
  type: 'download' | 'upload';
}

export interface ShareLink {
  id: string;
  url: string;
  expiresAt: Date;
  createdAt: Date;
  objectKey: string;
  bucket: string;
}

export interface FileItem {
  name: string;
  path: string;
  isFolder: boolean;
  size?: number;
  lastModified?: Date;
}

export interface ConnectionState {
  items: ConnectionItem[]; // 连接和目录的统一列表
  currentConnectionId: string | null;
  loading: boolean;
  error: string | null;
}

export interface FilesState {
  buckets: Bucket[];
  currentBucket: Bucket | null;
  currentPath: string;
  items: FileItem[];
  loading: boolean;
  error: string | null;
  breadcrumb: string[];
}

export interface UploadsState {
  tasks: Record<string, UploadTask>;
  activeTasks: string[];
  completedTasks: string[];
  failedTasks: string[];
}

// 传输任务类型
export type TransferType = 'upload' | 'download';
export type TransferStatus =
  | 'pending'
  | 'uploading'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

// 传输块信息
export interface TransferChunk {
  partNumber: number;
  etag?: string;
  size: number;
  transferred: number;
  status: 'pending' | 'transferring' | 'completed' | 'failed';
}

// 传输任务接口
export interface TransferTask {
  id: string;
  type: TransferType;
  fileName: string;
  file?: File;
  key: string;
  bucket: string;
  connectionId: string;
  status: TransferStatus;
  progress: number;
  speed: number;
  transferred: number;
  total: number;
  chunks: TransferChunk[];
  resumable: boolean;
  uploadId?: string;
  localPath?: string;
  resumedFrom?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// 传输状态接口
export interface TransfersState {
  tasks: Record<string, TransferTask>;
  activeTasks: string[];
  completedTasks: string[];
  failedTasks: string[];
  pausedTasks: string[];
}

export interface UIState {
  viewMode: 'grid' | 'list';
  selectedItems: string[];
  rightClickMenu: {
    visible: boolean;
    x: number;
    y: number;
    item: any;
  } | null;
}