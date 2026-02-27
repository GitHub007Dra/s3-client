import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { ConnectionConfig } from '../../../shared/types';
import { StorageService } from '../../services/storageService';

interface ConnectionState {
  connections: ConnectionConfig[];
  currentConnectionId: string | null;
  loading: boolean;
  error: string | null;
}

const initialState: ConnectionState = {
  connections: StorageService.loadConnections(),
  currentConnectionId: null,
  loading: false,
  error: null,
};

const connectionsSlice = createSlice({
  name: 'connections',
  initialState,
  reducers: {
    setConnections: (state, action: PayloadAction<ConnectionConfig[]>) => {
      state.connections = action.payload;
      StorageService.saveConnections(action.payload);
    },
    addConnection: (state, action: PayloadAction<ConnectionConfig>) => {
      state.connections.push(action.payload);
      StorageService.saveConnections(state.connections);
    },
    updateConnection: (state, action: PayloadAction<ConnectionConfig>) => {
      const index = state.connections.findIndex(c => c.id === action.payload.id);
      if (index !== -1) {
        state.connections[index] = action.payload;
        StorageService.saveConnections(state.connections);
      }
    },
    deleteConnection: (state, action: PayloadAction<string>) => {
      state.connections = state.connections.filter(c => c.id !== action.payload);
      if (state.currentConnectionId === action.payload) {
        state.currentConnectionId = null;
      }
      StorageService.saveConnections(state.connections);
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
  setConnections,
  addConnection,
  updateConnection,
  deleteConnection,
  setCurrentConnection,
  setLoading,
  setError,
} = connectionsSlice.actions;

export default connectionsSlice.reducer;