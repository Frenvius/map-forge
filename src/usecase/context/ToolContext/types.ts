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
  reveal: PaletteReveal | null;
  setActiveTool: (tool: ToolId) => void;
  selectBrush: (brush: ActiveBrush | null) => void;
  revealInPalette: (category: PaletteCategoryId, serverId: number, name?: string) => void;
}

export interface ToolProviderProps {
  children: React.ReactNode;
}
