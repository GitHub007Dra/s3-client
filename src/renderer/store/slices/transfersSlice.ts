import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

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

// 传输块信息（用于断点续传）
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
  file?: File; // 上传时有文件对象
  key: string; // S3 中的路径
  bucket: string;
  connectionId: string;
  status: TransferStatus;
  progress: number; // 0-100
  speed: number; // bytes per second
  transferred: number; // 已传输字节数
  total: number; // 总字节数
  chunks: TransferChunk[]; // 分片信息
  resumable: boolean; // 是否支持断点续传
  uploadId?: string; // S3 分片上传 ID
  localPath?: string; // 下载时本地保存路径
  resumedFrom?: number; // 断点续传的起始位置
  error?: string; // 错误信息
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

const initialState: TransfersState = {
  tasks: {},
  activeTasks: [],
  completedTasks: [],
  failedTasks: [],
  pausedTasks: [],
};

const removeTaskFromStatusLists = (state: TransfersState, id: string) => {
  state.activeTasks = state.activeTasks.filter((tid) => tid !== id);
  state.pausedTasks = state.pausedTasks.filter((tid) => tid !== id);
  state.completedTasks = state.completedTasks.filter((tid) => tid !== id);
  state.failedTasks = state.failedTasks.filter((tid) => tid !== id);
};

const addTaskToStatusList = (state: TransfersState, task: TransferTask) => {
  switch (task.status) {
    case 'uploading':
    case 'downloading':
      if (!state.activeTasks.includes(task.id)) {
        state.activeTasks.push(task.id);
      }
      break;
    case 'paused':
      if (!state.pausedTasks.includes(task.id)) {
        state.pausedTasks.push(task.id);
      }
      break;
    case 'completed':
      if (!state.completedTasks.includes(task.id)) {
        state.completedTasks.push(task.id);
      }
      break;
    case 'failed':
      if (!state.failedTasks.includes(task.id)) {
        state.failedTasks.push(task.id);
      }
      break;
  }
};

const transfersSlice = createSlice({
  name: 'transfers',
  initialState,
  reducers: {
    // 添加传输任务
    addTransferTask: (state, action: PayloadAction<TransferTask>) => {
      const task = action.payload;
      state.tasks[task.id] = task;
      removeTaskFromStatusLists(state, task.id);
      addTaskToStatusList(state, task);
    },

    // 更新传输任务
    updateTransferTask: (state, action: PayloadAction<Partial<TransferTask> & { id: string }>) => {
      const { id, ...updates } = action.payload;
      const task = state.tasks[id];
      if (!task) return;

      // 更新任务信息
      Object.assign(task, updates, { updatedAt: new Date() });

      // 处理状态变化
      const newStatus = updates.status;
      if (newStatus) {
        // 从所有状态列表中移除
        removeTaskFromStatusLists(state, id);
        addTaskToStatusList(state, task);
      }
    },

    // 暂停传输任务
    pauseTransferTask: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      const task = state.tasks[id];
      if (task && (task.status === 'uploading' || task.status === 'downloading')) {
        task.status = 'paused';
        task.updatedAt = new Date();
        state.activeTasks = state.activeTasks.filter((tid) => tid !== id);
        if (!state.pausedTasks.includes(id)) {
          state.pausedTasks.push(id);
        }
      }
    },

    // 恢复传输任务
    resumeTransferTask: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      const task = state.tasks[id];
      if (task && (task.status === 'paused' || task.status === 'failed')) {
        task.status = task.type === 'upload' ? 'uploading' : 'downloading';
        task.speed = 0;
        task.error = undefined;
        task.updatedAt = new Date();
        removeTaskFromStatusLists(state, id);
        if (!state.activeTasks.includes(id)) {
          state.activeTasks.push(id);
        }
      }
    },

    // 取消传输任务
    cancelTransferTask: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      const task = state.tasks[id];
      if (task) {
        task.status = 'cancelled';
        task.speed = 0;
        task.updatedAt = new Date();
        removeTaskFromStatusLists(state, id);
      }
    },

    // 移除传输任务
    removeTransferTask: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      delete state.tasks[id];
      state.activeTasks = state.activeTasks.filter((tid) => tid !== id);
      state.pausedTasks = state.pausedTasks.filter((tid) => tid !== id);
      state.completedTasks = state.completedTasks.filter((tid) => tid !== id);
      state.failedTasks = state.failedTasks.filter((tid) => tid !== id);
    },

    // 清除已完成的任务
    clearCompletedTransfers: (state) => {
      state.completedTasks.forEach((id) => {
        delete state.tasks[id];
      });
      state.completedTasks = [];
    },

    // 清除失败的任务
    clearFailedTransfers: (state) => {
      state.failedTasks.forEach((id) => {
        delete state.tasks[id];
      });
      state.failedTasks = [];
    },

    // 更新分片进度
    updateTransferChunk: (
      state,
      action: PayloadAction<{
        taskId: string;
        chunk: Partial<TransferChunk> & { partNumber: number };
      }>
    ) => {
      const { taskId, chunk } = action.payload;
      const task = state.tasks[taskId];
      if (!task) return;

      const existingChunk = task.chunks.find((c) => c.partNumber === chunk.partNumber);
      if (existingChunk) {
        Object.assign(existingChunk, chunk);
      } else {
        task.chunks.push(chunk as TransferChunk);
      }

      // 重新计算进度
      const totalTransferred = task.chunks.reduce((sum, c) => sum + c.transferred, 0);
      task.transferred = totalTransferred;
      task.progress = task.total > 0 ? Math.min(100, (totalTransferred / task.total) * 100) : 0;
      task.updatedAt = new Date();
    },
  },
});

export const {
  addTransferTask,
  updateTransferTask,
  pauseTransferTask,
  resumeTransferTask,
  cancelTransferTask,
  removeTransferTask,
  clearCompletedTransfers,
  clearFailedTransfers,
  updateTransferChunk,
} = transfersSlice.actions;

export default transfersSlice.reducer;
