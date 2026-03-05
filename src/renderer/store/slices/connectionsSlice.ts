import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { ConnectionItem, ConnectionConfig } from '../../../shared/types';
import { StorageService } from '../../services/storageService';

interface ConnectionState {
  items: ConnectionItem[];
  currentConnectionId: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ConnectionState = {
  items: StorageService.loadConnections(),
  currentConnectionId: null,
  loading: false,
  error: null,
};

const connectionsSlice = createSlice({
  name: 'connections',
  initialState,
  reducers: {
    setItems: (state, action: PayloadAction<ConnectionItem[]>) => {
      state.items = action.payload;
      StorageService.saveConnections(action.payload);
    },
    // 添加目录
    addFolder: (state, action: PayloadAction<{ name: string; parentId: string | null }>) => {
      const newFolder: ConnectionItem = {
        id: Date.now().toString(),
        type: 'folder',
        name: action.payload.name,
        parentId: action.payload.parentId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      state.items.push(newFolder);
      StorageService.saveConnections(state.items);
    },
    // 添加连接
    addConnection: (state, action: PayloadAction<{ config: ConnectionConfig; parentId: string | null }>) => {
      const newItem: ConnectionItem = {
        id: action.payload.config.id,
        type: 'connection',
        name: action.payload.config.name,
        parentId: action.payload.parentId,
        createdAt: new Date(),
        updatedAt: new Date(),
        connection: action.payload.config,
      };
      state.items.push(newItem);
      StorageService.saveConnections(state.items);
    },
    // 更新目录
    updateFolder: (state, action: PayloadAction<{ id: string; name: string }>) => {
      const index = state.items.findIndex(item => item.id === action.payload.id && item.type === 'folder');
      if (index !== -1) {
        state.items[index].name = action.payload.name;
        state.items[index].updatedAt = new Date();
        StorageService.saveConnections(state.items);
      }
    },
    // 更新连接
    updateConnection: (state, action: PayloadAction<ConnectionConfig>) => {
      const index = state.items.findIndex(item => item.id === action.payload.id && item.type === 'connection');
      if (index !== -1) {
        state.items[index].name = action.payload.name;
        state.items[index].connection = action.payload;
        state.items[index].updatedAt = new Date();
        StorageService.saveConnections(state.items);
      }
    },
    // 删除项目（目录或连接）
    deleteItem: (state, action: PayloadAction<string>) => {
      const deleteRecursively = (id: string) => {
        // 先删除所有子项
        const children = state.items.filter(item => item.parentId === id);
        children.forEach(child => deleteRecursively(child.id));
        // 删除当前项
        state.items = state.items.filter(item => item.id !== id);
      };
      
      deleteRecursively(action.payload);
      
      if (state.currentConnectionId === action.payload) {
        state.currentConnectionId = null;
      }
      StorageService.saveConnections(state.items);
    },
    // 移动项目
    moveItem: (state, action: PayloadAction<{ id: string; parentId: string | null }>) => {
      const index = state.items.findIndex(item => item.id === action.payload.id);
      if (index !== -1) {
        // 防止循环引用
        let parent = state.items.find(item => item.id === action.payload.parentId);
        while (parent) {
          if (parent.id === action.payload.id) {
            return; // 不能移动到自己或子目录下
          }
          parent = state.items.find(item => item.id === parent?.parentId);
        }
        
        state.items[index].parentId = action.payload.parentId;
        state.items[index].updatedAt = new Date();
        StorageService.saveConnections(state.items);
      }
    },
    setCurrentConnection: (state, action: PayloadAction<string | null>) => {
      state.currentConnectionId = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  setItems,
  addFolder,
  addConnection,
  updateFolder,
  updateConnection,
  deleteItem,
  moveItem,
  setCurrentConnection,
  setLoading,
  setError,
} = connectionsSlice.actions;

export default connectionsSlice.reducer;
