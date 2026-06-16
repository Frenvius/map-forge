import { getSetting, setSetting } from '~/adapter/settings';
import {
  PANELS,
  PanelId,
  DockZone,
  MapCorner,
  FloatRect,
  isPanelId,
  panelMeta,
  ResizeSide,
  DropTarget,
  DockColumn,
  DockLayout,
  MIN_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_HEIGHT,
  DEFAULT_DOCK_LAYOUT,
  DEFAULT_PANEL_WIDTH,
  DEFAULT_MINIMAP_SIZE,
  DEFAULT_PANEL_HEIGHT
} from '~/domain/dock';

export interface Bounds {
  width: number;
  height: number;
}

const SETTINGS_KEY = 'dockLayout';

const PANEL_KINDS = Object.keys(PANELS) as (keyof typeof PANELS)[];

export function placedIds(layout: DockLayout): PanelId[] {
  const ids = new Set<PanelId>();
  for (const zone of ['left', 'right'] as DockZone[]) for (const col of layout[zone]) for (const id of col) ids.add(id);
  for (const id of Object.keys(layout.float)) ids.add(id);
  for (const id of Object.keys(layout.corner)) ids.add(id);
  return [...ids];
}

export function defaultDockLayout(): DockLayout {
  return {
    left: DEFAULT_DOCK_LAYOUT.left.map((c) => [...c]),
    right: DEFAULT_DOCK_LAYOUT.right.map((c) => [...c]),
    float: {},
    width: {},
    height: {},
    corner: {}
  };
}

export function locate(layout: DockLayout, id: PanelId): { zone: DockZone; col: number; row: number } | null {
  for (const zone of ['left', 'right'] as DockZone[]) {
    const cols = layout[zone];
    for (let c = 0; c < cols.length; c++) {
      const r = cols[c].indexOf(id);
      if (r >= 0) return { zone, col: c, row: r };
    }
  }
  return null;
}

export function zoneOf(layout: DockLayout, id: PanelId): DockZone | null {
  return locate(layout, id)?.zone ?? null;
}

export function isFloating(layout: DockLayout, id: PanelId): boolean {
  return !!layout.float[id];
}

export function floatRectOf(layout: DockLayout, id: PanelId): FloatRect | null {
  return layout.float[id] ?? null;
}

export function widthOf(layout: DockLayout, id: PanelId): number {
  return layout.width[id] ?? DEFAULT_PANEL_WIDTH;
}

export function columnWidthOf(layout: DockLayout, zone: DockZone, col: number): number {
  const c = layout[zone][col];
  return c && c.length ? widthOf(layout, c[0]) : DEFAULT_PANEL_WIDTH;
}

export function heightOf(layout: DockLayout, id: PanelId): number {
  return layout.height[id] ?? DEFAULT_PANEL_HEIGHT;
}

export function cornerOf(layout: DockLayout, id: PanelId): MapCorner | null {
  return layout.corner[id] ?? null;
}

export function removePanel(layout: DockLayout, id: PanelId): DockLayout {
  const strip = (cols: DockColumn[]) => cols.map((c) => c.filter((p) => p !== id)).filter((c) => c.length > 0);
  const float = { ...layout.float };
  const corner = { ...layout.corner };
  delete float[id];
  delete corner[id];
  return { left: strip(layout.left), right: strip(layout.right), float, corner, width: layout.width, height: layout.height };
}

export function dockCorner(layout: DockLayout, id: PanelId, corner: MapCorner): DockLayout {
  const base = removePanel(layout, id);
  const width = { ...base.width, [id]: base.width[id] ?? DEFAULT_MINIMAP_SIZE };
  const height = { ...base.height, [id]: base.height[id] ?? DEFAULT_MINIMAP_SIZE };
  return { ...base, width, height, corner: { ...base.corner, [id]: corner } };
}

export function resizeCorner(
  layout: DockLayout,
  id: PanelId,
  corner: MapCorner,
  side: ResizeSide,
  dx: number,
  dy: number,
  bounds?: Bounds
): DockLayout {
  const minW = Math.max(MIN_PANEL_WIDTH, panelMeta(id).minWidth);
  const minH = Math.max(MIN_PANEL_HEIGHT, panelMeta(id).minHeight);
  const sx = corner.includes('left') ? 1 : -1;
  const sy = corner.includes('top') ? 1 : -1;

  const usesX = side.includes('left') || side.includes('right');
  const usesY = side.includes('top') || side.includes('bottom');

  let width = (layout.width[id] ?? DEFAULT_MINIMAP_SIZE) + (usesX ? sx * dx : 0);
  let height = (layout.height[id] ?? DEFAULT_MINIMAP_SIZE) + (usesY ? sy * dy : 0);

  width = Math.max(minW, bounds ? Math.min(width, bounds.width) : width);
  height = Math.max(minH, bounds ? Math.min(height, bounds.height) : height);

  return { ...layout, width: { ...layout.width, [id]: width }, height: { ...layout.height, [id]: height } };
}

export function canStackInto(column: DockColumn, dragId: PanelId, maxStack: number): boolean {
  if (!panelMeta(dragId).stackable) return false;
  if (column.length >= maxStack) return false;
  return column.every((p) => panelMeta(p).stackable);
}

export function dockAt(layout: DockLayout, id: PanelId, target: DropTarget, maxStack: number): DockLayout {
  const base = removePanel(layout, id);
  const cols = base[target.zone].map((c) => [...c]);
  let width = base.width;

  const insertColumn = (at: number) => cols.splice(Math.max(0, Math.min(at, cols.length)), 0, [id]);

  if (target.row === null || cols.length === 0) {
    insertColumn(target.col);
  } else {
    const ci = Math.max(0, Math.min(target.col, cols.length - 1));
    const column = cols[ci];
    if (!canStackInto(column, id, maxStack)) {
      insertColumn(ci + 1);
    } else {
      const at = Math.max(0, Math.min(target.row, column.length));
      if (at === 0 && column.length > 0) width = { ...width, [id]: widthOf(layout, column[0]) };
      column.splice(at, 0, id);
    }
  }

  return { ...base, width, [target.zone]: cols };
}

export function floatAt(layout: DockLayout, id: PanelId, rect: FloatRect): DockLayout {
  const base = removePanel(layout, id);
  return { ...base, float: { ...base.float, [id]: rect } };
}

export function resizeColumn(layout: DockLayout, zone: DockZone, col: number, width: number): DockLayout {
  const c = layout[zone][col];
  if (!c || !c.length) return layout;
  const min = Math.max(MIN_PANEL_WIDTH, ...c.map((id) => panelMeta(id).minWidth));
  const clamped = Math.max(min, Math.min(width, MAX_PANEL_WIDTH));
  return { ...layout, width: { ...layout.width, [c[0]]: clamped } };
}

export function resizeHeight(layout: DockLayout, id: PanelId, height: number): DockLayout {
  const clamped = Math.max(panelMeta(id).minHeight || MIN_PANEL_HEIGHT, height);
  return { ...layout, height: { ...layout.height, [id]: clamped } };
}

export function resizeFloat(
  layout: DockLayout,
  id: PanelId,
  side: ResizeSide,
  dx: number,
  dy: number,
  bounds?: Bounds
): DockLayout {
  const rect = layout.float[id];
  if (!rect || !panelMeta(id).resizable) return layout;

  const minW = Math.max(MIN_PANEL_WIDTH, panelMeta(id).minWidth);
  const minH = Math.max(MIN_PANEL_HEIGHT, panelMeta(id).minHeight);

  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (side.includes('left')) left += dx;
  if (side.includes('right')) right += dx;
  if (side.includes('top')) top += dy;
  if (side.includes('bottom')) bottom += dy;

  if (right - left < minW) {
    if (side.includes('left')) left = right - minW;
    else right = left + minW;
  }
  if (bottom - top < minH) {
    if (side.includes('top')) top = bottom - minH;
    else bottom = top + minH;
  }

  left = Math.max(0, left);
  top = Math.max(0, top);
  if (bounds) {
    right = Math.min(bounds.width, right);
    bottom = Math.min(bounds.height, bottom);
  }

  const next: FloatRect = { x: left, y: top, width: Math.max(minW, right - left), height: Math.max(minH, bottom - top) };
  return { ...layout, float: { ...layout.float, [id]: next } };
}

export function clampFloatsToBounds(layout: DockLayout, bounds: Bounds): DockLayout {
  let changed = false;
  const float: DockLayout['float'] = {};
  for (const id of Object.keys(layout.float) as PanelId[]) {
    const rect = layout.float[id];
    if (!rect) continue;
    const width = Math.min(rect.width, bounds.width);
    const height = Math.min(rect.height, bounds.height);
    const x = Math.max(0, Math.min(rect.x, bounds.width - width));
    const y = Math.max(0, Math.min(rect.y, bounds.height - height));
    if (x !== rect.x || y !== rect.y || width !== rect.width || height !== rect.height) changed = true;
    float[id] = { x, y, width, height };
  }
  return changed ? { ...layout, float } : layout;
}

function isValidRect(value: unknown): value is FloatRect {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (['x', 'y', 'width', 'height'] as const).every((k) => typeof r[k] === 'number');
}

const CORNER_VALUES: MapCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function isValidCorner(value: unknown): value is MapCorner {
  return CORNER_VALUES.includes(value as MapCorner);
}

function parseColumns(arr: unknown): DockColumn[] {
  if (!Array.isArray(arr)) return [];
  const cols: DockColumn[] = [];
  for (const entry of arr) {
    if (Array.isArray(entry)) {
      const col = entry.filter((id) => isPanelId(id)) as PanelId[];
      if (col.length) cols.push(col);
    } else if (isPanelId(entry)) {
      cols.push([entry]);
    }
  }
  return cols;
}

function parseDockLayout(parsed: Partial<DockLayout> | null): DockLayout {
  if (!parsed || typeof parsed !== 'object') return defaultDockLayout();

  const seen = new Set<PanelId>();
  const dedup = (cols: DockColumn[]) =>
    cols.map((c) => c.filter((id) => (seen.has(id) ? false : (seen.add(id), true)))).filter((c) => c.length > 0);
  const left = dedup(parseColumns(parsed.left));
  const right = dedup(parseColumns(parsed.right));

  const corner: DockLayout['corner'] = {};
  if (parsed.corner && typeof parsed.corner === 'object') {
    for (const [id, c] of Object.entries(parsed.corner as Record<string, unknown>)) {
      if (isPanelId(id) && !seen.has(id) && panelMeta(id).cornerDockable && isValidCorner(c)) {
        corner[id] = c;
        seen.add(id);
      }
    }
  }

  const float: DockLayout['float'] = {};
  if (parsed.float && typeof parsed.float === 'object') {
    for (const [id, rect] of Object.entries(parsed.float as Record<string, unknown>)) {
      if (isPanelId(id) && !seen.has(id) && isValidRect(rect)) {
        float[id] = rect;
        seen.add(id);
      }
    }
  }

  const width: DockLayout['width'] = {};
  if (parsed.width && typeof parsed.width === 'object') {
    for (const [id, w] of Object.entries(parsed.width as Record<string, unknown>)) {
      if (isPanelId(id) && typeof w === 'number') width[id] = w;
    }
  }

  const height: DockLayout['height'] = {};
  if (parsed.height && typeof parsed.height === 'object') {
    for (const [id, h] of Object.entries(parsed.height as Record<string, unknown>)) {
      if (isPanelId(id) && typeof h === 'number') height[id] = h;
    }
  }

  for (const id of PANEL_KINDS) {
    if (seen.has(id) || id === 'minimap') continue;
    (DEFAULT_DOCK_LAYOUT.left.some((c) => c.includes(id)) ? left : right).push([id]);
    seen.add(id);
  }

  return { left, right, float, width, height, corner };
}

export async function loadDockLayout(): Promise<DockLayout> {
  const parsed = await getSetting<Partial<DockLayout> | null>(SETTINGS_KEY, null);
  return parseDockLayout(parsed);
}

export function saveDockLayout(layout: DockLayout): void {
  void setSetting(SETTINGS_KEY, layout);
}
