export type DockZone = 'left' | 'right';

export type PanelKind = 'palette' | 'tools' | 'minimap' | 'properties';

export type PanelId = string;

export type DockColumn = PanelId[];

const INSTANCE_SEP = '#';

export const baseKind = (id: PanelId): PanelKind => id.split(INSTANCE_SEP)[0] as PanelKind;

export const instancePanelId = (kind: PanelKind, n: number): PanelId => `${kind}${INSTANCE_SEP}${n}`;

export const isPanelId = (id: unknown): id is PanelId => typeof id === 'string' && PANELS[baseKind(id)] !== undefined;

export const panelMeta = (id: PanelId): PanelMeta => PANELS[baseKind(id)];

export type ResizeSide = 'top' | 'left' | 'right' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type MapCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface PanelMeta {
  id: PanelKind;
  title: string;
  variant: 'panel' | 'strip';
  resizable: boolean;
  stackable: boolean;
  minWidth: number;
  minHeight: number;
  cornerDockable: boolean;
}

export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockLayout {
  left: DockColumn[];
  right: DockColumn[];
  float: Partial<Record<PanelId, FloatRect>>;
  width: Partial<Record<PanelId, number>>;
  height: Partial<Record<PanelId, number>>;
  corner: Partial<Record<PanelId, MapCorner>>;
}

export interface DropTarget {
  zone: DockZone;
  col: number;
  row: number | null;
}

export const DOCK_ZONES: DockZone[] = ['left', 'right'];

export const DEFAULT_PANEL_WIDTH = 256;
export const MIN_PANEL_WIDTH = 180;
export const MAX_PANEL_WIDTH = 600;

export const DEFAULT_PANEL_HEIGHT = 260;
export const MIN_PANEL_HEIGHT = 120;

export const PANELS: Record<PanelKind, PanelMeta> = {
  palette: {
    id: 'palette',
    title: 'Palette',
    variant: 'panel',
    resizable: true,
    stackable: true,
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    cornerDockable: false
  },
  tools: {
    id: 'tools',
    title: 'Tools',
    variant: 'strip',
    resizable: false,
    stackable: false,
    minWidth: 0,
    minHeight: 0,
    cornerDockable: false
  },
  minimap: {
    id: 'minimap',
    title: 'Minimap',
    variant: 'panel',
    resizable: true,
    stackable: true,
    minWidth: 160,
    minHeight: 160,
    cornerDockable: true
  },
  properties: {
    id: 'properties',
    title: 'Item Properties',
    variant: 'panel',
    resizable: true,
    stackable: true,
    minWidth: MIN_PANEL_WIDTH,
    minHeight: 200,
    cornerDockable: false
  }
};

export const DEFAULT_DOCK_LAYOUT: DockLayout = {
  left: [['tools']],
  right: [['palette']],
  float: {},
  width: {},
  height: {},
  corner: {}
};

export const DEFAULT_MINIMAP_SIZE = 240;

export const CORNER_MARGIN = 8;

export const MAP_CORNERS: MapCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export const DEFAULT_FLOAT_WIDTH = 280;
export const DEFAULT_FLOAT_HEIGHT = 420;

export const MIN_STACK = 2;
export const MAX_STACK = 6;
export const DEFAULT_MAX_STACK = 4;
