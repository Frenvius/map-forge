import React from 'react';

import { BrushOption } from '~/adapter/biomes';
import { ToolId, EraserMode } from '~/domain/tools';
import { ResolvedBiome, GenerateOptions } from '~/domain/biome';
import { ActiveBrush, PaletteCategoryId } from '~/domain/palette';
import { MountainOptions, ResolvedMountain } from '~/domain/mountain';

export interface GenerateSignal {
  biomes: ResolvedBiome[];
  opts: GenerateOptions;
  mountain: ResolvedMountain | null;
  mountainOpts: MountainOptions | null;
  nonce: number;
}

export interface PaletteReveal {
  category: PaletteCategoryId;
  serverId: number;
  name?: string;
  nonce: number;
}

export interface PaletteCategorySignal {
  category: PaletteCategoryId;
  nonce: number;
}

export interface ToolContextValue {
  activeTool: ToolId;
  activeBrush: ActiveBrush | null;
  penBrush: BrushOption | null;
  penWidth: number;
  activeHouseId: number | null;
  ctrlErase: boolean;
  eraserMode: EraserMode;
  reveal: PaletteReveal | null;
  paletteCategory: PaletteCategorySignal | null;
  generateSignal: GenerateSignal | null;
  generationProgress: string | null;
  setGenerationProgress: (label: string | null) => void;
  requestGenerate: (
    biomes: ResolvedBiome[],
    opts: GenerateOptions,
    mountain?: ResolvedMountain | null,
    mountainOpts?: MountainOptions | null
  ) => void;
  setActiveTool: (tool: ToolId) => void;
  selectBrush: (brush: ActiveBrush | null) => void;
  setPenBrush: (brush: BrushOption | null) => void;
  setPenWidth: (width: number) => void;
  setActiveHouse: (id: number | null) => void;
  setEraserMode: (mode: EraserMode) => void;
  revealInPalette: (category: PaletteCategoryId, serverId: number, name?: string) => void;
  setPaletteCategory: (category: PaletteCategoryId) => void;
  registerPalette: (id: string, category: PaletteCategoryId) => void;
  unregisterPalette: (id: string) => void;
  shouldHandleReveal: (id: string) => boolean;
}

export interface ToolProviderProps {
  children: React.ReactNode;
}
