import React from 'react';

import { ToolId } from '~/domain/tools';
import { ActiveBrush, PaletteCategoryId } from '~/domain/palette';

export interface PaletteReveal {
  category: PaletteCategoryId;
  serverId: number;
  name?: string;
  nonce: number;
}

export interface ToolContextValue {
  activeTool: ToolId;
  activeBrush: ActiveBrush | null;
  activeHouseId: number | null;
  ctrlErase: boolean;
  reveal: PaletteReveal | null;
  setActiveTool: (tool: ToolId) => void;
  selectBrush: (brush: ActiveBrush | null) => void;
  setActiveHouse: (id: number | null) => void;
  revealInPalette: (category: PaletteCategoryId, serverId: number, name?: string) => void;
}

export interface ToolProviderProps {
  children: React.ReactNode;
}
