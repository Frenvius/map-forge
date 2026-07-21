import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

import { Waypoint } from '~/domain/waypoint';
import {
  Town,
  MapMeta,
  Position,
  ChunkTiles,
  PreviewTile,
  OtbmProgress,
  MapProperties,
  MapStatistics,
  ChunkTooltips
} from '~/domain/map';

export const packChunkKey = (cx: number, cy: number): number => (cx << 16) | cy;

function toUint8(response: Uint8Array | ArrayBuffer): Uint8Array {
  return response instanceof Uint8Array ? response : new Uint8Array(response);
}

function decodeMeta(buffer: Uint8Array): MapMeta {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let o = 0;
  const id = view.getUint32(o, true);
  o += 4;
  const width = view.getUint16(o, true);
  o += 2;
  const height = view.getUint16(o, true);
  o += 2;
  const minX = view.getUint16(o, true);
  o += 2;
  const minY = view.getUint16(o, true);
  o += 2;
  const maxX = view.getUint16(o, true);
  o += 2;
  const maxY = view.getUint16(o, true);
  o += 2;
  const tileCount = view.getUint32(o, true);
  o += 4;

  const floorCount = view.getUint8(o);
  o += 1;
  const floors: number[] = [];
  for (let i = 0; i < floorCount; i++) {
    floors.push(view.getUint8(o));
    o += 1;
  }

  const teleports = new Map<string, Position>();
  const teleportCount = view.getUint32(o, true);
  o += 4;
  for (let i = 0; i < teleportCount; i++) {
    const sx = view.getUint16(o, true);
    const sy = view.getUint16(o + 2, true);
    const sz = view.getUint8(o + 4);
    const dx = view.getUint16(o + 5, true);
    const dy = view.getUint16(o + 7, true);
    const dz = view.getUint8(o + 9);
    o += 10;
    teleports.set(`${sx},${sy},${sz}`, { x: dx, y: dy, z: dz });
  }

  const centerX = view.getUint16(o, true);
  o += 2;
  const centerY = view.getUint16(o, true);
  o += 2;
  const centerFloor = view.getUint8(o);
  o += 1;

  return {
    id,
    width,
    height,
    tileCount,
    bounds: { minX, minY, maxX, maxY },
    teleports,
    floors,
    center: { x: centerX, y: centerY, floor: centerFloor }
  };
}

export async function openOtbm(path: string, onProgress?: OtbmProgress): Promise<MapMeta> {
  let unlisten: UnlistenFn | undefined;
  if (onProgress) {
    unlisten = await listen<number>('otbm_progress', (e) => onProgress('parse', e.payload));
  }
  try {
    const response = await invoke<Uint8Array | ArrayBuffer>('open_otbm', { path });
    return decodeMeta(toUint8(response));
  } finally {
    unlisten?.();
  }
}

export async function openScriptedMap(path: string): Promise<MapMeta> {
  const response = await invoke<Uint8Array | ArrayBuffer>('open_scripted_map', { path });
  return decodeMeta(toUint8(response));
}

export async function saveScriptedMap(mapId: number, path: string): Promise<void> {
  await invoke('save_scripted_map', { mapId, path });
}

export async function newOtbm(width: number, height: number): Promise<MapMeta> {
  const response = await invoke<Uint8Array | ArrayBuffer>('new_otbm', { width, height });
  return decodeMeta(toUint8(response));
}

export async function closeMap(mapId: number): Promise<void> {
  await invoke('close_map', { mapId });
}

export async function saveOtbm(mapId: number, path: string, onProgress?: (value: number, label: string) => void): Promise<void> {
  let unlisten: UnlistenFn | undefined;
  if (onProgress) {
    unlisten = await listen<[number, string]>('save_progress', (e) => onProgress(e.payload[0], e.payload[1]));
  }
  try {
    await invoke('save_otbm', { mapId, path });
  } finally {
    unlisten?.();
  }
}

export async function backupMap(path: string, keep: number): Promise<void> {
  await invoke('backup_map', { path, keep });
}

export async function getTowns(mapId: number): Promise<Town[]> {
  return invoke<Town[]>('get_towns', { mapId });
}

export interface IdMarker {
  x: number;
  y: number;
  z: number;
  actionId: number;
  uniqueId: number;
}

export async function listIdMarkers(mapId: number): Promise<IdMarker[]> {
  return invoke<IdMarker[]>('list_id_markers', { mapId });
}

export interface ItemMarker {
  x: number;
  y: number;
  z: number;
  clientId: number;
  serverId: number;
  hasContents: boolean;
}

export async function listItemsWithClientIds(mapId: number, clientIds: number[]): Promise<ItemMarker[]> {
  return invoke<ItemMarker[]>('list_items_with_client_ids', { mapId, clientIds });
}

export async function clearMarkerAt(mapId: number, x: number, y: number, z: number, action: boolean): Promise<void> {
  return invoke('clear_marker_at', { mapId, x, y, z, action });
}

export async function removeItemAt(mapId: number, z: number, x: number, y: number, clientId: number): Promise<number[]> {
  return invoke<number[]>('remove_item_at', { mapId, z, x, y, clientId });
}

export async function removeItemsWithClientIds(mapId: number, clientIds: number[]): Promise<[number, number][]> {
  return invoke<[number, number][]>('remove_items_with_client_ids', { mapId, clientIds });
}

export async function stripActionIds(mapId: number): Promise<number> {
  return invoke<number>('strip_action_ids', { mapId });
}

export async function stripUniqueIds(mapId: number): Promise<number> {
  return invoke<number>('strip_unique_ids', { mapId });
}

export async function setTowns(mapId: number, towns: Town[]): Promise<void> {
  await invoke('set_towns', { mapId, towns });
}

export async function getWaypoints(mapId: number): Promise<Waypoint[]> {
  return invoke<Waypoint[]>('get_waypoints', { mapId });
}

export async function getMapProperties(mapId: number): Promise<MapProperties> {
  return invoke<MapProperties>('get_map_properties', { mapId });
}

export async function setMapProperties(
  mapId: number,
  patch: Pick<MapProperties, 'width' | 'height' | 'description' | 'spawnFile' | 'houseFile' | 'otbmVersion' | 'itemsMinor'>
): Promise<void> {
  await invoke('set_map_properties', { mapId, patch });
}

export interface PaintResult {
  touched: number[];
  chunks: Map<string, ChunkTiles>;
}

export async function getMapStatistics(mapId: number): Promise<MapStatistics> {
  return invoke<MapStatistics>('map_statistics', { mapId });
}

export async function paintTiles(
  mapId: number,
  z: number,
  xs: number[],
  ys: number[],
  serverId: number,
  isGround: boolean,
  isDoodad: boolean,
  automagic: boolean,
  brushName = ''
): Promise<PaintResult> {
  const response = await invoke<Uint8Array | ArrayBuffer>('paint_tiles', {
    mapId,
    z,
    xs,
    ys,
    serverId,
    isGround,
    isDoodad,
    automagic,
    brushName
  });
  const u8 = toUint8(response);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const count = view.getUint32(0, true);
  const touched: number[] = new Array(count);
  for (let i = 0; i < count; i++) touched[i] = view.getUint32(4 + i * 4, true);
  return { touched, chunks: decodeChunks(view, 4 + count * 4) };
}

export async function paintZone(
  mapId: number,
  z: number,
  xs: number[],
  ys: number[],
  flag: number,
  set: boolean
): Promise<number[]> {
  return invoke<number[]>('paint_zone', { mapId, z, xs, ys, flag, set });
}

export async function setHouse(
  mapId: number,
  z: number,
  xs: number[],
  ys: number[],
  houseId: number,
  set: boolean
): Promise<number[]> {
  return invoke<number[]>('set_house', { mapId, z, xs, ys, houseId, set });
}

export async function houseSizes(mapId: number): Promise<Record<number, number>> {
  return invoke<Record<number, number>>('house_sizes', { mapId });
}

export async function deleteItem(
  mapId: number,
  z: number,
  x: number,
  y: number,
  automagic: boolean,
  groundOnly: boolean
): Promise<number[]> {
  return invoke<number[]>('delete_item', { mapId, z, x, y, automagic, groundOnly });
}

export async function eraseBrush(
  mapId: number,
  z: number,
  x: number,
  y: number,
  serverId: number,
  automagic: boolean
): Promise<number[]> {
  return invoke<number[]>('erase_brush', { mapId, z, x, y, serverId, automagic });
}

export async function borderizeBrush(mapId: number, z: number, xs: number[], ys: number[], remove: boolean): Promise<number[]> {
  return invoke<number[]>('borderize_brush', { mapId, z, xs, ys, remove });
}

export async function eraseArea(
  mapId: number,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  automagic: boolean,
  groundOnly: boolean
): Promise<number[]> {
  return invoke<number[]>('erase_area', { mapId, z, x0, y0, x1, y1, automagic, groundOnly });
}

export interface DeleteResult {
  removed: number;
  touched: [number, number][];
}

export async function deleteSelection(
  mapId: number,
  zs: number[],
  xs: number[],
  ys: number[],
  all: boolean[],
  automagic: boolean
): Promise<DeleteResult> {
  return invoke<DeleteResult>('delete_selection', { mapId, zs, xs, ys, all, automagic });
}

export async function copySelection(mapId: number, zs: number[], xs: number[], ys: number[], all: boolean[]): Promise<number> {
  return invoke<number>('copy_selection', { mapId, zs, xs, ys, all });
}

export async function pasteSelection(
  mapId: number,
  x: number,
  y: number,
  z: number,
  merge: boolean
): Promise<[number, number][]> {
  return invoke<[number, number][]>('paste_selection', { mapId, x, y, z, merge });
}

export interface ImportInfo {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  tileCount: number;
  floors: number[];
  townCount: number;
  waypointCount: number;
}

export interface ImportCommitRequest {
  mapId: number;
  dx: number;
  dy: number;
  dz: number;
  houseIdMap: Record<number, number>;
  importTowns: boolean;
  importWaypoints: boolean;
  importHouses: boolean;
}

export interface ImportResult {
  touched: [number, number][];
  townIdMap: Record<number, number>;
  tilesImported: number;
  tilesDiscarded: number;
  teleportsOffset: number;
  townsMerged: number;
  waypointsMerged: number;
  bounds: [number, number, number, number];
  floors: number[];
}

export async function importLoad(path: string): Promise<ImportInfo> {
  return invoke<ImportInfo>('import_load', { path });
}

export async function importCommit(req: ImportCommitRequest): Promise<ImportResult> {
  return invoke<ImportResult>('import_commit', { req });
}

export async function importCancel(): Promise<void> {
  await invoke('import_cancel');
}

export interface ImportPreview {
  width: number;
  height: number;
  ground: Uint16Array;
  top: Uint16Array;
}

export async function importPreview(z: number): Promise<ImportPreview> {
  const response = await invoke<Uint8Array | ArrayBuffer>('import_preview', { z });
  const u8 = toUint8(response);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const width = view.getUint16(0, true);
  const height = view.getUint16(2, true);
  const cells = width * height;
  const ground = new Uint16Array(cells);
  const top = new Uint16Array(cells);
  let o = 4;
  for (let i = 0; i < cells; i++) {
    ground[i] = view.getUint16(o, true);
    top[i] = view.getUint16(o + 2, true);
    o += 4;
  }
  return { width, height, ground, top };
}

export async function moveItem(
  mapId: number,
  z: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  automagic: boolean
): Promise<number[]> {
  return invoke<number[]>('move_item', { mapId, z, fromX, fromY, toX, toY, automagic });
}

export async function moveSelection(
  mapId: number,
  zs: number[],
  xs: number[],
  ys: number[],
  all: boolean[],
  dx: number,
  dy: number,
  automagic: boolean
): Promise<[number, number][]> {
  return invoke<[number, number][]>('move_selection', { mapId, zs, xs, ys, all, dx, dy, automagic });
}

export async function previewPaint(
  mapId: number,
  z: number,
  xs: number[],
  ys: number[],
  serverId: number,
  isGround: boolean,
  isDoodad: boolean,
  brushName = '',
  deltaOnly = false
): Promise<PreviewTile[]> {
  const response = await invoke<Uint8Array | ArrayBuffer>('preview_paint', {
    mapId,
    z,
    xs,
    ys,
    serverId,
    isGround,
    isDoodad,
    brushName,
    deltaOnly
  });
  const u8 = toUint8(response);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = 0;
  const count = view.getUint32(o, true);
  o += 4;
  const tiles: PreviewTile[] = [];
  for (let i = 0; i < count; i++) {
    const x = view.getUint16(o, true);
    const y = view.getUint16(o + 2, true);
    const n = view.getUint16(o + 4, true);
    o += 6;
    const clientIds = new Uint16Array(n);
    for (let j = 0; j < n; j++) {
      clientIds[j] = view.getUint16(o, true);
      o += 2;
    }
    tiles.push({ x, y, clientIds });
  }
  return tiles;
}

export interface EditResult {
  applied: boolean;
  touched: [number, number][];
  sidecar: string;
}

export async function undoEdit(mapId: number): Promise<EditResult> {
  return invoke<EditResult>('undo_edit', { mapId });
}

export async function redoEdit(mapId: number): Promise<EditResult> {
  return invoke<EditResult>('redo_edit', { mapId });
}

export async function attachUndoSidecar(mapId: number, before: string, after: string): Promise<void> {
  await invoke('attach_undo_sidecar', { mapId, before, after });
}

export async function pushUndoSidecar(mapId: number, before: string, after: string): Promise<void> {
  await invoke('push_undo_sidecar', { mapId, before, after });
}

export async function setHistoryLimits(mapId: number, maxSteps: number, maxBytes: number): Promise<void> {
  await invoke('set_history_limits', { mapId, maxSteps, maxBytes });
}

function decodeChunks(view: DataView, offset: number): Map<string, ChunkTiles> {
  const result = new Map<string, ChunkTiles>();
  let o = offset;
  const chunkCount = view.getUint32(o, true);
  o += 4;
  for (let c = 0; c < chunkCount; c++) {
    const cx = view.getUint16(o, true);
    o += 2;
    const cy = view.getUint16(o, true);
    o += 2;
    const tileCount = view.getUint32(o, true);
    o += 4;

    const tileX = new Uint16Array(tileCount);
    const tileY = new Uint16Array(tileCount);
    const flags = new Uint32Array(tileCount);
    const houseIds = new Uint32Array(tileCount);
    const itemOffset = new Uint32Array(tileCount + 1);
    const clientList: number[] = [];
    const serverList: number[] = [];
    const countList: number[] = [];
    let acc = 0;
    for (let t = 0; t < tileCount; t++) {
      tileX[t] = view.getUint16(o, true);
      o += 2;
      tileY[t] = view.getUint16(o, true);
      o += 2;
      flags[t] = view.getUint32(o, true);
      o += 4;
      houseIds[t] = view.getUint32(o, true);
      o += 4;
      const nItems = view.getUint16(o, true);
      o += 2;
      itemOffset[t] = acc;
      for (let j = 0; j < nItems; j++) {
        clientList.push(view.getUint16(o, true));
        o += 2;
        serverList.push(view.getUint16(o, true));
        o += 2;
        countList.push(view.getUint8(o));
        o += 1;
      }
      acc += nItems;
    }
    itemOffset[tileCount] = acc;
    result.set(`${cx},${cy}`, {
      tileX,
      tileY,
      flags,
      houseIds,
      itemOffset,
      clientIds: Uint16Array.from(clientList),
      serverIds: Uint16Array.from(serverList),
      counts: Uint8Array.from(countList)
    });
  }
  return result;
}

export async function fetchMapChunks(mapId: number, z: number, keys: number[]): Promise<Map<string, ChunkTiles>> {
  if (keys.length === 0) return new Map();
  const response = await invoke<Uint8Array | ArrayBuffer>('get_map_chunks', { mapId, z, keys });
  const u8 = toUint8(response);
  return decodeChunks(new DataView(u8.buffer, u8.byteOffset, u8.byteLength), 0);
}

export async function fetchChunkTooltips(mapId: number, z: number, keys: number[]): Promise<Map<string, ChunkTooltips>> {
  const result = new Map<string, ChunkTooltips>();
  if (keys.length === 0) return result;

  const response = await invoke<Uint8Array | ArrayBuffer>('get_chunk_tooltips', { mapId, z, keys });
  const u8 = toUint8(response);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const decoder = new TextDecoder();

  let o = 0;
  const chunkCount = view.getUint32(o, true);
  o += 4;
  for (let c = 0; c < chunkCount; c++) {
    const cx = view.getUint16(o, true);
    o += 2;
    const cy = view.getUint16(o, true);
    o += 2;
    const tileCount = view.getUint32(o, true);
    o += 4;

    const tiles: ChunkTooltips = [];
    for (let t = 0; t < tileCount; t++) {
      const x = view.getUint16(o, true);
      const y = view.getUint16(o + 2, true);
      const actionId = view.getUint16(o + 4, true);
      const uniqueId = view.getUint16(o + 6, true);
      const doorId = view.getUint16(o + 8, true);
      o += 10;
      const textLen = view.getUint16(o, true);
      o += 2;
      const text = textLen ? decoder.decode(u8.subarray(o, o + textLen)) : '';
      o += textLen;
      const descLen = view.getUint16(o, true);
      o += 2;
      const desc = descLen ? decoder.decode(u8.subarray(o, o + descLen)) : '';
      o += descLen;
      tiles.push({ x, y, actionId, uniqueId, doorId, text, desc });
    }
    result.set(`${cx},${cy}`, tiles);
  }
  return result;
}

export interface TileItemEntry {
  tier: number;
  desc: string;
  text: string;
  charges: number;
  subtype: number;
  serverId: number;
  clientId: number;
  actionId: number;
  uniqueId: number;
}

export interface TilePropertiesPayload {
  flags: number;
  doorId: number;
  houseId: number;
  items: TileItemEntry[];
}

export async function getTileItems(mapId: number, z: number, x: number, y: number): Promise<TilePropertiesPayload> {
  return invoke<TilePropertiesPayload>('get_tile_items', { mapId, z, x, y });
}
