import { invoke } from '@tauri-apps/api/core';

import { defaultDataDir } from '~/adapter/assets';

export const BORDER_EDGES = ['n', 'e', 's', 'w', 'cnw', 'cne', 'csw', 'cse', 'dnw', 'dne', 'dsw', 'dse'] as const;
export type BorderEdge = (typeof BORDER_EDGES)[number];

export interface BorderDef {
  id: number;
  group: number | null;
  name: string | null;
  items: Partial<Record<BorderEdge, number>>;
}

export interface GroundItem {
  id: number;
  chance: number;
}

export interface BorderRef {
  align: string;
  id: number | null;
  to: string | null;
}

export interface GroundBrush {
  name: string;
  serverLookid: number | null;
  zOrder: number | null;
  items: GroundItem[];
  borders: BorderRef[];
  friends: string[];
}

export interface NamedBrush {
  name: string;
  serverLookid: number | null;
}

export interface DoodadBrush {
  name: string;
  serverLookid: number | null;
  draggable: boolean;
  onBlocking: boolean;
  thickness: string | null;
  items: GroundItem[];
  compositeCount: number;
}

export interface WallSegment {
  type: string;
  items: GroundItem[];
  doorCount: number;
}

export interface WallBrush {
  name: string;
  serverLookid: number | null;
  draggable: boolean;
  onBlocking: boolean;
  thickness: string | null;
  segments: WallSegment[];
  extraCount: number;
}

export interface ItemEntry {
  fromId: number;
  toId: number | null;
}

export interface TilesetCategory {
  kind: string;
  items: ItemEntry[];
  brushes: string[];
  flags: string[];
}

export interface TilesetDef {
  name: string;
  categories: TilesetCategory[];
}

export const TILESET_ITEM_KINDS = ['raw', 'items'];

function parseXml(text: string): Document {
  const safe = text.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;');
  const doc = new DOMParser().parseFromString(safe, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error) throw new Error(error.textContent?.trim() || 'invalid XML');
  return doc;
}

async function readText(dir: string, file: string): Promise<string> {
  return invoke<string>('read_file_text', { path: `${dir}/${file}` });
}

function numAttr(el: Element, name: string): number | null {
  const raw = el.getAttribute(name);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseBorders(text: string): BorderDef[] {
  const doc = parseXml(text);
  const out: BorderDef[] = [];
  for (const el of doc.querySelectorAll('border')) {
    const id = numAttr(el, 'id');
    if (id == null) continue;
    const items: Partial<Record<BorderEdge, number>> = {};
    for (const bi of el.querySelectorAll('borderitem')) {
      const edge = bi.getAttribute('edge') as BorderEdge | null;
      const item = numAttr(bi, 'item');
      if (edge && item != null && (BORDER_EDGES as readonly string[]).includes(edge)) items[edge] = item;
    }
    out.push({ id, group: numAttr(el, 'group'), name: el.getAttribute('name')?.trim() || null, items });
  }
  return out;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function serializeBorders(defs: BorderDef[]): string {
  const lines = ['<materials>'];
  for (const b of defs) {
    const group = b.group != null ? ` group="${b.group}"` : '';
    const name = b.name ? ` name="${escapeAttr(b.name)}"` : '';
    lines.push(`\t<border id="${b.id}"${group}${name}>`);
    for (const edge of BORDER_EDGES) {
      const item = b.items[edge];
      if (item != null) lines.push(`\t\t<borderitem edge="${edge}" item="${item}"/>`);
    }
    lines.push('\t</border>');
  }
  lines.push('</materials>', '');
  return lines.join('\n');
}

export async function loadBorders(dir = defaultDataDir()): Promise<BorderDef[]> {
  return parseBorders(await readText(dir, 'borders.xml'));
}

export async function saveBorders(defs: BorderDef[], dir = defaultDataDir()): Promise<void> {
  await invoke('write_file_text', { path: `${dir}/borders.xml`, contents: serializeBorders(defs) });
}

export function parseGrounds(text: string): GroundBrush[] {
  const doc = parseXml(text);
  const out: GroundBrush[] = [];
  for (const el of doc.querySelectorAll('brush')) {
    if (el.getAttribute('type') !== 'ground') continue;
    const name = el.getAttribute('name');
    if (!name) continue;
    const items: GroundItem[] = [];
    for (const it of el.querySelectorAll('item')) {
      const id = numAttr(it, 'id');
      if (id != null) items.push({ id, chance: numAttr(it, 'chance') ?? 0 });
    }
    const borders: BorderRef[] = [];
    for (const b of el.querySelectorAll('border')) {
      if (!b.hasAttribute('align')) continue;
      borders.push({ align: b.getAttribute('align') ?? 'outer', id: numAttr(b, 'id'), to: b.getAttribute('to') });
    }
    const friends: string[] = [];
    for (const f of el.querySelectorAll('friend')) {
      const fn = f.getAttribute('name');
      if (fn) friends.push(fn);
    }
    const serverLookid = numAttr(el, 'server_lookid') ?? numAttr(el, 'lookid');
    if (items.length === 0 && serverLookid == null) continue;
    out.push({ name, serverLookid, zOrder: numAttr(el, 'z-order'), items, borders, friends });
  }
  return out;
}

export async function loadGrounds(dir = defaultDataDir()): Promise<GroundBrush[]> {
  return parseGrounds(await readText(dir, 'grounds.xml'));
}

export function groundLookid(brush: GroundBrush): number | null {
  if (!brush.items.length) return brush.serverLookid;
  return brush.items.reduce((a, b) => (b.chance > a.chance ? b : a)).id;
}

function applyGroundToEl(doc: Document, el: Element, brush: GroundBrush): void {
  const lookid = groundLookid(brush);
  if (lookid != null) el.setAttribute('server_lookid', String(lookid));
  if (brush.zOrder != null) el.setAttribute('z-order', String(brush.zOrder));
  else el.removeAttribute('z-order');

  const preserved: Element[] = [];
  for (const c of [...el.children]) {
    const tag = c.tagName.toLowerCase();
    if (tag === 'item' || tag === 'friend' || (tag === 'border' && c.hasAttribute('align'))) continue;
    preserved.push(c);
  }
  while (el.firstChild) el.removeChild(el.firstChild);

  const add = (node: Element) => {
    el.appendChild(doc.createTextNode('\n\t\t'));
    el.appendChild(node);
  };
  for (const it of brush.items) {
    const n = doc.createElement('item');
    n.setAttribute('id', String(it.id));
    n.setAttribute('chance', String(it.chance));
    add(n);
  }
  for (const b of brush.borders) {
    const n = doc.createElement('border');
    n.setAttribute('align', b.align);
    if (b.to != null) n.setAttribute('to', b.to);
    if (b.id != null) n.setAttribute('id', String(b.id));
    add(n);
  }
  for (const f of brush.friends) {
    const n = doc.createElement('friend');
    n.setAttribute('name', f);
    add(n);
  }
  for (const p of preserved) add(p);
  el.appendChild(doc.createTextNode('\n\t'));
}

function findBrushEl(doc: Document, type: string, name: string): Element | undefined {
  return [...doc.querySelectorAll('brush')].find((b) => b.getAttribute('type') === type && b.getAttribute('name') === name);
}

async function writeDoc(doc: Document, dir: string, file: string): Promise<void> {
  await invoke('write_file_text', { path: `${dir}/${file}`, contents: new XMLSerializer().serializeToString(doc) });
}

const findGroundEl = (doc: Document, name: string) => findBrushEl(doc, 'ground', name);

async function writeGroundsDoc(doc: Document, dir: string): Promise<void> {
  await writeDoc(doc, dir, 'grounds.xml');
}

export async function saveGround(brush: GroundBrush, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'grounds.xml'));
  const el = findGroundEl(doc, brush.name);
  if (!el) throw new Error(`ground brush not found: ${brush.name}`);
  applyGroundToEl(doc, el, brush);
  await writeGroundsDoc(doc, dir);
}

export async function createGround(brush: GroundBrush, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'grounds.xml'));
  const root = doc.querySelector('materials') ?? doc.documentElement;
  const el = doc.createElement('brush');
  el.setAttribute('name', brush.name);
  el.setAttribute('type', 'ground');
  applyGroundToEl(doc, el, brush);
  root.appendChild(doc.createTextNode('\t'));
  root.appendChild(el);
  root.appendChild(doc.createTextNode('\n'));
  await writeGroundsDoc(doc, dir);
}

export async function deleteGround(name: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'grounds.xml'));
  findGroundEl(doc, name)?.remove();
  await writeGroundsDoc(doc, dir);
}

export async function renameGround(oldName: string, newName: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'grounds.xml'));
  const el = findGroundEl(doc, oldName);
  if (!el) throw new Error(`ground brush not found: ${oldName}`);
  el.setAttribute('name', newName);
  for (const f of doc.querySelectorAll('friend')) if (f.getAttribute('name') === oldName) f.setAttribute('name', newName);
  for (const b of doc.querySelectorAll('border')) if (b.getAttribute('to') === oldName) b.setAttribute('to', newName);
  await writeGroundsDoc(doc, dir);
}

function directItems(el: Element): GroundItem[] {
  const items: GroundItem[] = [];
  for (const c of el.children) {
    if (c.tagName.toLowerCase() !== 'item') continue;
    const id = numAttr(c, 'id');
    if (id != null) items.push({ id, chance: numAttr(c, 'chance') ?? 0 });
  }
  return items;
}

function directCount(el: Element, tag: string): number {
  let n = 0;
  for (const c of el.children) if (c.tagName.toLowerCase() === tag) n++;
  return n;
}

export function parseWalls(text: string): WallBrush[] {
  const doc = parseXml(text);
  const out: WallBrush[] = [];
  for (const el of doc.querySelectorAll('brush')) {
    if (el.getAttribute('type') !== 'wall') continue;
    const name = el.getAttribute('name');
    if (!name) continue;
    const segments: WallSegment[] = [];
    let extraCount = 0;
    const mainItems = directItems(el);
    if (mainItems.length) segments.push({ type: 'main', items: mainItems, doorCount: 0 });
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase();
      if (tag === 'wall') {
        segments.push({ type: c.getAttribute('type') ?? 'wall', items: directItems(c), doorCount: directCount(c, 'door') });
      } else if (tag === 'alternate' || tag === 'composite') extraCount++;
    }
    out.push({
      name,
      serverLookid: numAttr(el, 'server_lookid') ?? numAttr(el, 'lookid'),
      draggable: el.getAttribute('draggable') === 'true',
      onBlocking: el.getAttribute('on_blocking') === 'true',
      thickness: el.getAttribute('thickness'),
      segments,
      extraCount
    });
  }
  return out;
}

function setContainerItems(doc: Document, el: Element, items: GroundItem[], indent: string, closing: string): void {
  const preserved: Element[] = [];
  for (const c of [...el.children]) if (c.tagName.toLowerCase() !== 'item') preserved.push(c);
  while (el.firstChild) el.removeChild(el.firstChild);
  const add = (node: Element) => {
    el.appendChild(doc.createTextNode(indent));
    el.appendChild(node);
  };
  for (const it of items) {
    const n = doc.createElement('item');
    n.setAttribute('id', String(it.id));
    n.setAttribute('chance', String(it.chance));
    add(n);
  }
  for (const p of preserved) add(p);
  el.appendChild(doc.createTextNode(closing));
}

function applyWallToEl(doc: Document, el: Element, brush: WallBrush): void {
  if (brush.serverLookid != null) el.setAttribute('server_lookid', String(brush.serverLookid));
  el.setAttribute('draggable', brush.draggable ? 'true' : 'false');
  el.setAttribute('on_blocking', brush.onBlocking ? 'true' : 'false');
  if (brush.thickness) el.setAttribute('thickness', brush.thickness);
  else el.removeAttribute('thickness');

  const main = brush.segments.find((s) => s.type === 'main');
  for (const c of [...el.children]) {
    if (c.tagName.toLowerCase() !== 'wall') continue;
    const seg = brush.segments.find((s) => s.type === c.getAttribute('type'));
    if (seg) setContainerItems(doc, c, seg.items, '\n\t\t\t', '\n\t\t');
  }
  if (main) {
    const preserved: Element[] = [];
    for (const c of [...el.children]) if (c.tagName.toLowerCase() !== 'item') preserved.push(c);
    while (el.firstChild) el.removeChild(el.firstChild);
    const add = (node: Element) => {
      el.appendChild(doc.createTextNode('\n\t\t'));
      el.appendChild(node);
    };
    for (const it of main.items) {
      const n = doc.createElement('item');
      n.setAttribute('id', String(it.id));
      n.setAttribute('chance', String(it.chance));
      add(n);
    }
    for (const p of preserved) add(p);
    el.appendChild(doc.createTextNode('\n\t'));
  }
}

const findWallEl = (doc: Document, name: string) => findBrushEl(doc, 'wall', name);

export async function loadWalls(dir = defaultDataDir()): Promise<WallBrush[]> {
  return parseWalls(await readText(dir, 'walls.xml'));
}

export async function saveWall(brush: WallBrush, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'walls.xml'));
  const el = findWallEl(doc, brush.name);
  if (!el) throw new Error(`wall brush not found: ${brush.name}`);
  applyWallToEl(doc, el, brush);
  await writeDoc(doc, dir, 'walls.xml');
}

export async function createWall(brush: WallBrush, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'walls.xml'));
  const root = doc.querySelector('materials') ?? doc.documentElement;
  const el = doc.createElement('brush');
  el.setAttribute('name', brush.name);
  el.setAttribute('type', 'wall');
  for (const seg of brush.segments) {
    if (seg.type === 'main') continue;
    const w = doc.createElement('wall');
    w.setAttribute('type', seg.type);
    setContainerItems(doc, w, seg.items, '\n\t\t\t', '\n\t\t');
    el.appendChild(doc.createTextNode('\n\t\t'));
    el.appendChild(w);
  }
  el.appendChild(doc.createTextNode('\n\t'));
  root.appendChild(doc.createTextNode('\t'));
  root.appendChild(el);
  root.appendChild(doc.createTextNode('\n'));
  await writeDoc(doc, dir, 'walls.xml');
}

export async function deleteWall(name: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'walls.xml'));
  findWallEl(doc, name)?.remove();
  await writeDoc(doc, dir, 'walls.xml');
}

export async function renameWall(oldName: string, newName: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'walls.xml'));
  const el = findWallEl(doc, oldName);
  if (!el) throw new Error(`wall brush not found: ${oldName}`);
  el.setAttribute('name', newName);
  for (const f of doc.querySelectorAll('friend')) if (f.getAttribute('name') === oldName) f.setAttribute('name', newName);
  await writeDoc(doc, dir, 'walls.xml');
}

export function parseDoodads(text: string): DoodadBrush[] {
  const doc = parseXml(text);
  const out: DoodadBrush[] = [];
  for (const el of doc.querySelectorAll('brush')) {
    if (el.getAttribute('type') !== 'doodad') continue;
    const name = el.getAttribute('name');
    if (!name) continue;
    const items: GroundItem[] = [];
    let compositeCount = 0;
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase();
      if (tag === 'item') {
        const id = numAttr(c, 'id');
        if (id != null) items.push({ id, chance: numAttr(c, 'chance') ?? 0 });
      } else if (tag === 'composite') compositeCount++;
    }
    out.push({
      name,
      serverLookid: numAttr(el, 'server_lookid') ?? numAttr(el, 'lookid'),
      draggable: el.getAttribute('draggable') === 'true',
      onBlocking: el.getAttribute('on_blocking') === 'true',
      thickness: el.getAttribute('thickness'),
      items,
      compositeCount
    });
  }
  return out;
}

export async function loadDoodads(dir = defaultDataDir()): Promise<DoodadBrush[]> {
  return parseDoodads(await readText(dir, 'doodads.xml'));
}

function applyDoodadToEl(doc: Document, el: Element, brush: DoodadBrush): void {
  if (brush.serverLookid != null) el.setAttribute('server_lookid', String(brush.serverLookid));
  el.setAttribute('draggable', brush.draggable ? 'true' : 'false');
  el.setAttribute('on_blocking', brush.onBlocking ? 'true' : 'false');
  if (brush.thickness) el.setAttribute('thickness', brush.thickness);
  else el.removeAttribute('thickness');

  const preserved: Element[] = [];
  for (const c of [...el.children]) if (c.tagName.toLowerCase() !== 'item') preserved.push(c);
  while (el.firstChild) el.removeChild(el.firstChild);

  const add = (node: Element) => {
    el.appendChild(doc.createTextNode('\n\t\t'));
    el.appendChild(node);
  };
  for (const it of brush.items) {
    const n = doc.createElement('item');
    n.setAttribute('id', String(it.id));
    n.setAttribute('chance', String(it.chance));
    add(n);
  }
  for (const p of preserved) add(p);
  el.appendChild(doc.createTextNode('\n\t'));
}

const findDoodadEl = (doc: Document, name: string) => findBrushEl(doc, 'doodad', name);

export async function saveDoodad(brush: DoodadBrush, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'doodads.xml'));
  const el = findDoodadEl(doc, brush.name);
  if (!el) throw new Error(`doodad brush not found: ${brush.name}`);
  applyDoodadToEl(doc, el, brush);
  await writeDoc(doc, dir, 'doodads.xml');
}

export async function createDoodad(brush: DoodadBrush, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'doodads.xml'));
  const root = doc.querySelector('materials') ?? doc.documentElement;
  const el = doc.createElement('brush');
  el.setAttribute('name', brush.name);
  el.setAttribute('type', 'doodad');
  applyDoodadToEl(doc, el, brush);
  root.appendChild(doc.createTextNode('\t'));
  root.appendChild(el);
  root.appendChild(doc.createTextNode('\n'));
  await writeDoc(doc, dir, 'doodads.xml');
}

export async function deleteDoodad(name: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'doodads.xml'));
  findDoodadEl(doc, name)?.remove();
  await writeDoc(doc, dir, 'doodads.xml');
}

export async function renameDoodad(oldName: string, newName: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'doodads.xml'));
  const el = findDoodadEl(doc, oldName);
  if (!el) throw new Error(`doodad brush not found: ${oldName}`);
  el.setAttribute('name', newName);
  await writeDoc(doc, dir, 'doodads.xml');
}

export async function loadAllServerIds(): Promise<number[]> {
  return invoke<number[]>('all_server_ids').catch(() => []);
}

export function parseTilesets(text: string): TilesetDef[] {
  const doc = parseXml(text);
  const out: TilesetDef[] = [];
  for (const el of doc.querySelectorAll('tileset')) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const categories: TilesetCategory[] = [];
    for (const c of el.children) {
      const items: ItemEntry[] = [];
      for (const it of c.children) {
        if (it.tagName.toLowerCase() !== 'item') continue;
        const fromId = numAttr(it, 'fromid') ?? numAttr(it, 'id');
        if (fromId != null) items.push({ fromId, toId: numAttr(it, 'toid') });
      }
      const brushes: string[] = [];
      const flags: string[] = [];
      for (const b of c.children) {
        const t = b.tagName.toLowerCase();
        if (t === 'brush') {
          const bn = b.getAttribute('name');
          if (bn) brushes.push(bn);
        } else if (t === 'flag') {
          const fn = b.getAttribute('name');
          if (fn) flags.push(fn);
        }
      }
      categories.push({ kind: c.tagName.toLowerCase(), items, brushes, flags });
    }
    out.push({ name, categories });
  }
  return out;
}

export async function loadTilesets(dir = defaultDataDir()): Promise<TilesetDef[]> {
  return parseTilesets(await readText(dir, 'tilesets.xml'));
}

function applyTilesetToEl(doc: Document, el: Element, def: TilesetDef): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const cat of def.categories) {
    const c = doc.createElement(cat.kind);
    const addChild = (node: Element) => {
      c.appendChild(doc.createTextNode('\n\t\t\t'));
      c.appendChild(node);
    };
    for (const it of cat.items) {
      const n = doc.createElement('item');
      if (it.toId != null) {
        n.setAttribute('fromid', String(it.fromId));
        n.setAttribute('toid', String(it.toId));
      } else {
        n.setAttribute('id', String(it.fromId));
      }
      addChild(n);
    }
    for (const b of cat.brushes) {
      const n = doc.createElement('brush');
      n.setAttribute('name', b);
      addChild(n);
    }
    for (const f of cat.flags) {
      const n = doc.createElement('flag');
      n.setAttribute('name', f);
      addChild(n);
    }
    c.appendChild(doc.createTextNode('\n\t\t'));
    el.appendChild(doc.createTextNode('\n\t\t'));
    el.appendChild(c);
  }
  el.appendChild(doc.createTextNode('\n\t'));
}

const findTilesetEl = (doc: Document, name: string) =>
  [...doc.querySelectorAll('tileset')].find((t) => t.getAttribute('name') === name);

export async function saveTileset(def: TilesetDef, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'tilesets.xml'));
  const el = findTilesetEl(doc, def.name);
  if (!el) throw new Error(`tileset not found: ${def.name}`);
  applyTilesetToEl(doc, el, def);
  await writeDoc(doc, dir, 'tilesets.xml');
}

export async function createTileset(def: TilesetDef, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'tilesets.xml'));
  const root = doc.querySelector('materials') ?? doc.documentElement;
  const el = doc.createElement('tileset');
  el.setAttribute('name', def.name);
  applyTilesetToEl(doc, el, def);
  root.appendChild(doc.createTextNode('\t'));
  root.appendChild(el);
  root.appendChild(doc.createTextNode('\n'));
  await writeDoc(doc, dir, 'tilesets.xml');
}

export async function deleteTileset(name: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'tilesets.xml'));
  findTilesetEl(doc, name)?.remove();
  await writeDoc(doc, dir, 'tilesets.xml');
}

export async function renameTileset(oldName: string, newName: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'tilesets.xml'));
  const el = findTilesetEl(doc, oldName);
  if (!el) throw new Error(`tileset not found: ${oldName}`);
  el.setAttribute('name', newName);
  await writeDoc(doc, dir, 'tilesets.xml');
}

export async function renameTilesetBrushRefs(oldName: string, newName: string, dir = defaultDataDir()): Promise<void> {
  const doc = parseXml(await readText(dir, 'tilesets.xml'));
  let changed = false;
  for (const b of doc.querySelectorAll('brush'))
    if (b.getAttribute('name') === oldName) {
      b.setAttribute('name', newName);
      changed = true;
    }
  if (changed) await writeDoc(doc, dir, 'tilesets.xml');
}

export function readMaterialText(dir: string, file: string): Promise<string> {
  return readText(dir, file);
}

export function writeMaterialText(dir: string, file: string, text: string): Promise<void> {
  return invoke('write_file_text', { path: `${dir}/${file}`, contents: text });
}
