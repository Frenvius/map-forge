import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

import { Waypoint } from '~/domain/waypoint';
import { Town, MapMeta, Position, ChunkTiles, PreviewTile, OtbmProgress, MapProperties, MapStatistics } from '~/domain/map';

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

export async function getTowns(mapId: number): Promise<Town[]> {
  return invoke<Town[]>('get_towns', { mapId });
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
  patch: Pick<MapProperties, 'description' | 'spawnFile' | 'houseFile' | 'otbmVersion' | 'itemsMinor'>
): Promise<void> {
  await invoke('set_map_properties', { mapId, patch });
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
  automagic: boolean
): Promise<number[]> {
  return invoke<number[]>('paint_tiles', { mapId, z, xs, ys, serverId, isGround, isDoodad, automagic });
}

export async function deleteItem(mapId: number, z: number, x: number, y: number, automagic: boolean): Promise<number[]> {
  return invoke<number[]>('delete_item', { mapId, z, x, y, automagic });
}

export async function eraseArea(
  mapId: number,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  automagic: boolean
): Promise<number[]> {
  return invoke<number[]>('erase_area', { mapId, z, x0, y0, x1, y1, automagic });
}

export async function deleteSelection(
  mapId: number,
  z: number,
  xs: number[],
  ys: number[],
  all: boolean[],
  automagic: boolean
): Promise<number[]> {
  return invoke<number[]>('delete_selection', { mapId, z, xs, ys, all, automagic });
}

export async function copySelection(mapId: number, z: number, xs: number[], ys: number[], all: boolean[]): Promise<number> {
  return invoke<number>('copy_selection', { mapId, z, xs, ys, all });
}

export async function pasteSelection(mapId: number, x: number, y: number, z: number): Promise<number[]> {
  return invoke<number[]>('paste_selection', { mapId, x, y, z });
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

export async function previewPaint(
  mapId: number,
  z: number,
  xs: number[],
  ys: number[],
  serverId: number,
  isGround: boolean,
  isDoodad: boolean
): Promise<PreviewTile[]> {
  const response = await invoke<Uint8Array | ArrayBuffer>('preview_paint', { mapId, z, xs, ys, serverId, isGround, isDoodad });
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

export async function undoEdit(mapId: number): Promise<[number, number][]> {
  return invoke<[number, number][]>('undo_edit', { mapId });
}

export async function redoEdit(mapId: number): Promise<[number, number][]> {
  return invoke<[number, number][]>('redo_edit', { mapId });
}

export async function fetchMapChunks(mapId: number, z: number, keys: number[]): Promise<Map<string, ChunkTiles>> {
  const result = new Map<string, ChunkTiles>();
  if (keys.length === 0) return result;

  const response = await invoke<Uint8Array | ArrayBuffer>('get_map_chunks', { mapId, z, keys });
  const u8 = toUint8(response);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

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

    const tileX = new Uint16Array(tileCount);
    const tileY = new Uint16Array(tileCount);
    const itemOffset = new Uint32Array(tileCount + 1);
    const clientList: number[] = [];
    const serverList: number[] = [];
    let acc = 0;
    for (let t = 0; t < tileCount; t++) {
      tileX[t] = view.getUint16(o, true);
      o += 2;
      tileY[t] = view.getUint16(o, true);
      o += 2;
      const nItems = view.getUint16(o, true);
      o += 2;
      itemOffset[t] = acc;
      for (let j = 0; j < nItems; j++) {
        clientList.push(view.getUint16(o, true));
        o += 2;
        serverList.push(view.getUint16(o, true));
        o += 2;
      }
      acc += nItems;
    }
    itemOffset[tileCount] = acc;
    result.set(`${cx},${cy}`, {
      tileX,
      tileY,
      itemOffset,
      clientIds: Uint16Array.from(clientList),
      serverIds: Uint16Array.from(serverList)
    });
  }
  return result;
}
