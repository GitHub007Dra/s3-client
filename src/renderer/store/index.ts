import { configureStore } from '@reduxjs/toolkit';
import connectionsReducer from './slices/connectionsSlice';
import filesReducer from './slices/filesSlice';
import uploadsReducer from './slices/uploadsSlice';
import transfersReducer from './slices/transfersSlice';
import uiReducer from './slices/uiSlice';
import themeReducer from './slices/themeSlice';

export const store = configureStore({
  reducer: {
    connections: connectionsReducer,
    files: filesReducer,
    uploads: uploadsReducer,
    transfers: transfersReducer,
    ui: uiReducer,
    theme: themeReducer,
  },
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {connections: ConnectionState, files: FilesState, uploads: UploadsState, transfers: TransfersState, ui: UIState, theme: ThemeState}
export type AppDispatch = typeof store.dispatch;