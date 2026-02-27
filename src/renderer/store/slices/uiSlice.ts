import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { UIState } from '../../../shared/types';

const initialState: UIState = {
  viewMode: 'grid',
  selectedItems: [],
  rightClickMenu: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setViewMode: (state, action: PayloadAction<'grid' | 'list'>) => {
      state.viewMode = action.payload;
    },
    setSelectedItems: (state, action: PayloadAction<string[]>) => {
      state.selectedItems = action.payload;
    },
    setRightClickMenu: (state, action: PayloadAction<UIState['rightClickMenu']>) => {
      state.rightClickMenu = action.payload;
    },
    clearRightClickMenu: (state) => {
      state.rightClickMenu = null;
    },
  },
});

export const {
  setViewMode,
  setSelectedItems,
  setRightClickMenu,
  clearRightClickMenu,
} = uiSlice.actions;

export default uiSlice.reducer;