import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { UploadTask, UploadsState } from '../../../shared/types';

const initialState: UploadsState = {
  tasks: {},
  activeTasks: [],
  completedTasks: [],
  failedTasks: [],
};

const uploadsSlice = createSlice({
  name: 'uploads',
  initialState,
  reducers: {
    addUploadTask: (state, action: PayloadAction<UploadTask>) => {
      state.tasks[action.payload.id] = action.payload;
      state.activeTasks.push(action.payload.id);
    },
    updateUploadTask: (state, action: PayloadAction<Partial<UploadTask>>) => {
      const taskId = action.payload.id;
      if (taskId && state.tasks[taskId]) {
        const task = state.tasks[taskId];
        Object.assign(task, action.payload);
        
        if (action.payload.status === 'completed') {
          state.activeTasks = state.activeTasks.filter(id => id !== task.id);
          state.completedTasks.push(task.id);
        } else if (action.payload.status === 'failed') {
          state.activeTasks = state.activeTasks.filter(id => id !== task.id);
          state.failedTasks.push(task.id);
        }
      }
    },
    removeUploadTask: (state, action: PayloadAction<string>) => {
      delete state.tasks[action.payload];
      state.activeTasks = state.activeTasks.filter(id => id !== action.payload);
      state.completedTasks = state.completedTasks.filter(id => id !== action.payload);
      state.failedTasks = state.failedTasks.filter(id => id !== action.payload);
    },
    clearCompletedUploads: (state) => {
      state.completedTasks.forEach(id => {
        delete state.tasks[id];
      });
      state.completedTasks = [];
    },
  },
});

export const {
  addUploadTask,
  updateUploadTask,
  removeUploadTask,
  clearCompletedUploads,
} = uploadsSlice.actions;

export default uploadsSlice.reducer;