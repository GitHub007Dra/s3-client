import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { FileItem, Bucket, FilesState } from '../../../shared/types';

const initialState: FilesState = {
  buckets: [],
  currentBucket: null,
  currentPath: '',
  items: [],
  loading: false,
  error: null,
  breadcrumb: [],
};

const filesSlice = createSlice({
  name: 'files',
  initialState,
  reducers: {
    setBuckets: (state, action: PayloadAction<Bucket[]>) => {
      state.buckets = action.payload;
    },
    setCurrentBucket: (state, action: PayloadAction<Bucket | null>) => {
      state.currentBucket = action.payload;
    },
    setFiles: (state, action: PayloadAction<FileItem[]>) => {
      state.items = action.payload;
    },
    setCurrentPath: (state, action: PayloadAction<string>) => {
      state.currentPath = action.payload;
    },
    setBreadcrumb: (state, action: PayloadAction<string[]>) => {
      state.breadcrumb = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    addItem: (state, action: PayloadAction<FileItem>) => {
      state.items.push(action.payload);
    },
    removeItem: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(item => item.path !== action.payload);
    },
    updateItem: (state, action: PayloadAction<FileItem>) => {
      const index = state.items.findIndex(item => item.path === action.payload.path);
      if (index !== -1) {
        state.items[index] = action.payload;
      }
    },
  },
});

export const {
  setBuckets,
  setCurrentBucket,
  setFiles,
  setCurrentPath,
  setBreadcrumb,
  setLoading,
  setError,
  addItem,
  removeItem,
  updateItem,
} = filesSlice.actions;

export default filesSlice.reducer;