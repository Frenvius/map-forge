export type PaletteCategoryId = 'terrain' | 'doodad' | 'item' | 'raw' | 'creature' | 'waypoints' | 'houses' | 'generator';

export interface PaletteCategoryMeta {
  id: PaletteCategoryId;
  label: string;
}

export const PALETTE_CATEGORIES: PaletteCategoryMeta[] = [
  { id: 'terrain', label: 'Terrain Palette' },
  { id: 'doodad', label: 'Doodad Palette' },
  { id: 'item', label: 'Item Palette' },
  { id: 'raw', label: 'RAW Palette' },
  { id: 'creature', label: 'Creature Palette' },
  { id: 'waypoints', label: 'Waypoint Palette' },
  { id: 'houses', label: 'House Palette' },
  { id: 'generator', label: 'Generator' }
];

export type BrushKind = 'ground' | 'wall' | 'doodad' | 'rawItem' | 'creature';

export interface CreatureLook {
  type: number;
  head?: number;
  body?: number;
  legs?: number;
  feet?: number;
}

export interface PaletteBrush {
  key: string;
  name: string;
  kind: BrushKind;
  lookServerId?: number;
  lookType?: number;
  isNpc?: boolean;
  creature?: CreatureLook;
}

export interface PaletteTileset {
  name: string;
  brushes: PaletteBrush[];
}

export interface ActiveBrush {
  key: string;
  name: string;
  kind: BrushKind;
  serverId?: number;
  isGround: boolean;
  preview?: string;
  cols?: number;
  rows?: number;
  lookType?: number;
  isNpc?: boolean;
  head?: number;
  body?: number;
  legs?: number;
  feet?: number;
}

export type PaletteData = Record<PaletteCategoryId, PaletteTileset[]>;
