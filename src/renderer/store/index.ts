import { configureStore } from '@reduxjs/toolkit';
import connectionsReducer from './slices/connectionsSlice';
import filesReducer from './slices/filesSlice';
import uploadsReducer from './slices/uploadsSlice';
import uiReducer from './slices/uiSlice';

export const store = configureStore({
  reducer: {
    connections: connectionsReducer,
    files: filesReducer,
    uploads: uploadsReducer,
    ui: uiReducer,
  },
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {connections: ConnectionState, files: FilesState, uploads: UploadsState, ui: UIState}
export type AppDispatch = typeof store.dispatch;