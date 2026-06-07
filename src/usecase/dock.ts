import { getSetting, setSetting } from '~/adapter/settings';
import {
  PANELS,
  PanelId,
  DockZone,
  FloatRect,
  DockLayout,
  MIN_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  DEFAULT_DOCK_LAYOUT,
  DEFAULT_PANEL_WIDTH
} from '~/domain/dock';

const SETTINGS_KEY = 'dockLayout';

const PANEL_IDS = Object.keys(PANELS) as PanelId[];

export function defaultDockLayout(): DockLayout {
  return { left: [...DEFAULT_DOCK_LAYOUT.left], right: [...DEFAULT_DOCK_LAYOUT.right], float: {}, width: {} };
}

export function zoneOf(layout: DockLayout, id: PanelId): DockZone | null {
  if (layout.left.includes(id)) return 'left';
  if (layout.right.includes(id)) return 'right';
  return null;
}

export function indexOf(layout: DockLayout, id: PanelId): number {
  const zone = zoneOf(layout, id);
  return zone ? layout[zone].indexOf(id) : -1;
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

function removeId(layout: DockLayout, id: PanelId): DockLayout {
  const float = { ...layout.float };
  delete float[id];
  return {
    left: layout.left.filter((p) => p !== id),
    right: layout.right.filter((p) => p !== id),
    float,
    width: layout.width
  };
}

export function dockAt(layout: DockLayout, id: PanelId, zone: DockZone, index: number): DockLayout {
  const base = removeId(layout, id);
  const arr = [...base[zone]];
  arr.splice(Math.max(0, Math.min(index, arr.length)), 0, id);
  return { ...base, [zone]: arr };
}

export function floatAt(layout: DockLayout, id: PanelId, rect: FloatRect): DockLayout {
  const base = removeId(layout, id);
  return { ...base, float: { ...base.float, [id]: rect } };
}

export function resizeAt(layout: DockLayout, id: PanelId, width: number): DockLayout {
  const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(width, MAX_PANEL_WIDTH));
  return { ...layout, width: { ...layout.width, [id]: clamped } };
}

function isValidRect(value: unknown): value is FloatRect {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (['x', 'y', 'width', 'height'] as const).every((k) => typeof r[k] === 'number');
}

function parseDockLayout(parsed: Partial<DockLayout> | null): DockLayout {
  if (!parsed || typeof parsed !== 'object') return defaultDockLayout();

  const known = (arr: unknown): PanelId[] =>
    Array.isArray(arr) ? (arr.filter((id) => PANEL_IDS.includes(id as PanelId)) as PanelId[]) : [];

  const seen = new Set<PanelId>();
  const dedup = (arr: PanelId[]) => arr.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  const left = dedup(known(parsed.left));
  const right = dedup(known(parsed.right));

  const float: DockLayout['float'] = {};
  if (parsed.float && typeof parsed.float === 'object') {
    for (const id of PANEL_IDS) {
      const rect = (parsed.float as Record<string, unknown>)[id];
      if (!seen.has(id) && isValidRect(rect)) {
        float[id] = rect;
        seen.add(id);
      }
    }
  }

  const width: DockLayout['width'] = {};
  if (parsed.width && typeof parsed.width === 'object') {
    for (const id of PANEL_IDS) {
      const w = (parsed.width as Record<string, unknown>)[id];
      if (typeof w === 'number') width[id] = w;
    }
  }

  for (const id of PANEL_IDS) {
    if (seen.has(id)) continue;
    (DEFAULT_DOCK_LAYOUT.left.includes(id) ? left : right).push(id);
    seen.add(id);
  }

  return { left, right, float, width };
}

export async function loadDockLayout(): Promise<DockLayout> {
  const parsed = await getSetting<Partial<DockLayout> | null>(SETTINGS_KEY, null);
  return parseDockLayout(parsed);
}

export function saveDockLayout(layout: DockLayout): void {
  void setSetting(SETTINGS_KEY, layout);
}
