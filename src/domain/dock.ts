export type DockZone = 'left' | 'right';

export type PanelId = 'palette' | 'tools';

export interface PanelMeta {
  id: PanelId;
  title: string;
  variant: 'panel' | 'strip';
}

export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockLayout {
  left: PanelId[];
  right: PanelId[];
  float: Partial<Record<PanelId, FloatRect>>;
  width: Partial<Record<PanelId, number>>;
}

export const DOCK_ZONES: DockZone[] = ['left', 'right'];

export const PANELS: Record<PanelId, PanelMeta> = {
  palette: { id: 'palette', title: 'Palette', variant: 'panel' },
  tools: { id: 'tools', title: 'Tools', variant: 'strip' }
};

export const DEFAULT_DOCK_LAYOUT: DockLayout = { left: ['tools'], right: ['palette'], float: {}, width: {} };

export const DEFAULT_FLOAT_WIDTH = 280;
export const DEFAULT_FLOAT_HEIGHT = 420;

export const DEFAULT_PANEL_WIDTH = 256;
export const MIN_PANEL_WIDTH = 180;
export const MAX_PANEL_WIDTH = 600;
