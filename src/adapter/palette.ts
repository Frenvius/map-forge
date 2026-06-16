import { invoke } from '@tauri-apps/api/core';

import { defaultDataDir } from '~/adapter/assets';
import { BrushKind, PaletteData, PaletteBrush, PaletteTileset } from '~/domain/palette';

function sanitizeXml(text: string): string {
  return text.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(sanitizeXml(text), 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(error.textContent?.trim() || 'invalid XML');
  return doc;
}

async function readXml(dir: string, name: string): Promise<Document> {
  const text = await invoke<string>('read_file_text', { path: `${dir}/${name}` });
  return parseXml(text);
}

function numAttr(el: Element, name: string): number | undefined {
  const raw = el.getAttribute(name);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function topLevel(doc: Document, tag: string): Element[] {
  return Array.from(doc.documentElement.children).filter((el) => el.tagName === tag);
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((child) => child.tagName === tag);
}

function firstItemId(el: Element): number | undefined {
  for (const item of el.querySelectorAll('item')) {
    const id = numAttr(item, 'id');
    if (id != null) return id;
  }
  return undefined;
}

function brushLook(brushEl: Element): number | undefined {
  return numAttr(brushEl, 'server_lookid') ?? firstItemId(brushEl);
}

function expandRange(item: Element): number[] {
  const id = numAttr(item, 'id');
  if (id != null) return [id];
  const from = numAttr(item, 'fromid');
  const to = numAttr(item, 'toid');
  if (from != null && to != null && to >= from) {
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return [];
}

type BrushIndex = Map<string, { kind: BrushKind; look?: number }>;

function indexBrushes(doc: Document, kind: BrushKind, into: BrushIndex): void {
  for (const brushEl of topLevel(doc, 'brush')) {
    const name = brushEl.getAttribute('name');
    if (!name || into.has(name)) continue;
    into.set(name, { kind, look: brushLook(brushEl) });
  }
}

function collectBrushSection(tsEl: Element, sectionTags: string[], index: BrushIndex): PaletteBrush[] {
  const tsName = tsEl.getAttribute('name') ?? '';
  const out: PaletteBrush[] = [];
  const seen = new Set<string>();
  for (const tag of sectionTags) {
    for (const section of directChildren(tsEl, tag)) {
      for (const ref of directChildren(section, 'brush')) {
        const refName = ref.getAttribute('name');
        if (!refName) continue;
        const entry = index.get(refName);
        if (!entry || seen.has(refName)) continue;
        seen.add(refName);
        out.push({ key: `${tsName}:${refName}`, name: refName, kind: entry.kind, lookServerId: entry.look });
      }
      for (const item of directChildren(section, 'item')) {
        for (const id of expandRange(item)) {
          const k = `${tsName}:terrain-item:${id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ key: k, name: `Item ${id}`, kind: 'rawItem', lookServerId: id });
        }
      }
    }
  }
  return out;
}

function collectItemIds(tsEl: Element, tags: string[], keyTag: string, into?: Set<number>): PaletteBrush[] {
  const tsName = tsEl.getAttribute('name') ?? '';
  const out: PaletteBrush[] = [];
  const seen = new Set<number>();
  for (const tag of tags) {
    for (const section of directChildren(tsEl, tag)) {
      for (const item of directChildren(section, 'item')) {
        for (const id of expandRange(item)) {
          if (seen.has(id)) continue;
          seen.add(id);
          into?.add(id);
          out.push({ key: `${tsName}:${keyTag}:${id}`, name: `Item ${id}`, kind: 'rawItem', lookServerId: id });
        }
      }
    }
  }
  return out;
}

const ITEM_SECTION_TAGS = ['items', 'items_and_raw'];
const RAW_SECTION_TAGS = ['raw', 'terrain_and_raw', 'doodad_and_raw', 'items_and_raw', 'collections_and_raw'];

function collectItems(tsEl: Element): PaletteBrush[] {
  return collectItemIds(tsEl, ITEM_SECTION_TAGS, 'item');
}

function collectRaw(tsEl: Element, claimed: Set<number>): PaletteBrush[] {
  return collectItemIds(tsEl, RAW_SECTION_TAGS, 'raw', claimed);
}

function buildOthersTileset(serverIds: number[], claimed: Set<number>): PaletteTileset | null {
  const brushes: PaletteBrush[] = [];
  for (const id of serverIds) {
    if (claimed.has(id)) continue;
    brushes.push({ key: `Others:raw:${id}`, name: `Item ${id}`, kind: 'rawItem', lookServerId: id });
  }
  return brushes.length ? { name: 'Others', brushes } : null;
}

const CREATURE_GROUP_LABELS: Record<string, string> = { monster: 'Monsters', npc: 'NPCs' };

function buildCreatureTilesets(doc: Document): PaletteTileset[] {
  const groups = new Map<string, PaletteBrush[]>();
  for (const c of doc.querySelectorAll('creature')) {
    const looktype = numAttr(c, 'looktype');
    if (looktype == null || looktype === 0) continue;
    const name = c.getAttribute('name') ?? '';
    const type = c.getAttribute('type') ?? 'monster';
    const list = groups.get(type) ?? [];
    list.push({
      key: `creature:${name}`,
      name,
      kind: 'creature',
      lookType: looktype,
      isNpc: type === 'npc',
      creature: {
        type: looktype,
        head: numAttr(c, 'lookhead'),
        body: numAttr(c, 'lookbody'),
        legs: numAttr(c, 'looklegs'),
        feet: numAttr(c, 'lookfeet')
      }
    });
    groups.set(type, list);
  }
  return [...groups.entries()]
    .map(([type, brushes]) => ({ name: CREATURE_GROUP_LABELS[type] ?? type, brushes }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function allServerIds(): Promise<number[]> {
  try {
    return await invoke<number[]>('all_server_ids');
  } catch {
    return [];
  }
}

export async function loadPalette(dir = defaultDataDir()): Promise<PaletteData> {
  const [tilesetsDoc, groundsDoc, wallsDoc, doodadsDoc, creaturesDoc, serverIds] = await Promise.all([
    readXml(dir, 'tilesets.xml'),
    readXml(dir, 'grounds.xml'),
    readXml(dir, 'walls.xml'),
    readXml(dir, 'doodads.xml'),
    readXml(dir, 'creatures.xml'),
    allServerIds()
  ]);

  const index: BrushIndex = new Map();
  indexBrushes(groundsDoc, 'ground', index);
  indexBrushes(wallsDoc, 'wall', index);
  indexBrushes(doodadsDoc, 'doodad', index);

  const data: PaletteData = { terrain: [], doodad: [], item: [], raw: [], creature: [], waypoints: [], houses: [] };
  const claimed = new Set<number>();

  for (const tsEl of topLevel(tilesetsDoc, 'tileset')) {
    const name = tsEl.getAttribute('name') ?? '';
    const terrain = collectBrushSection(tsEl, ['terrain', 'terrain_and_raw'], index);
    const doodad = collectBrushSection(tsEl, ['doodad', 'doodad_and_raw'], index);
    const item = collectItems(tsEl);
    const raw = collectRaw(tsEl, claimed);
    if (terrain.length) data.terrain.push({ name, brushes: terrain });
    if (doodad.length) data.doodad.push({ name, brushes: doodad });
    if (item.length) data.item.push({ name, brushes: item });
    if (raw.length) data.raw.push({ name, brushes: raw });
  }

  const others = buildOthersTileset(serverIds, claimed);
  if (others) data.raw.push(others);

  data.creature = buildCreatureTilesets(creaturesDoc);

  return data;
}
