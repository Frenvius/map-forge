import { ZoneToolId } from '~/domain/zones';

export type HouseToolId = 'house' | 'house_exit';

export type ToolId = 'select' | 'brush' | 'pen' | 'eraser' | 'spawn' | ZoneToolId | HouseToolId;

export interface ToolMeta {
  id: ToolId;
  label: string;
}

export const TOOLS: ToolMeta[] = [
  { id: 'select', label: 'Select' },
  { id: 'brush', label: 'Brush' },
  { id: 'pen', label: 'Pen - click to add points, drag for curves, Enter/double-click to apply, Esc to cancel' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'spawn', label: 'Spawn' },
  { id: 'zone_pz', label: 'Protection zone (Ctrl-drag to erase)' },
  { id: 'zone_nopvp', label: 'No-PVP zone (Ctrl-drag to erase)' },
  { id: 'zone_nologout', label: 'No-logout zone (Ctrl-drag to erase)' },
  { id: 'zone_pvp', label: 'PVP zone (Ctrl-drag to erase)' }
];

export type EraserMode = 'items' | 'ground' | 'creatures';

export interface EraserModeMeta {
  id: EraserMode;
  label: string;
}

export const ERASER_MODES: EraserModeMeta[] = [
  { id: 'items', label: 'Erase items (keep ground)' },
  { id: 'ground', label: 'Erase ground only' },
  { id: 'creatures', label: 'Erase creatures and spawns' }
];

export const isZoneTool = (id: ToolId): id is ZoneToolId => id.startsWith('zone_');

export const isHouseTool = (id: ToolId): id is HouseToolId => id === 'house' || id === 'house_exit';
