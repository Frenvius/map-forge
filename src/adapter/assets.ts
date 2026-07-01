import { invoke } from '@tauri-apps/api/core';

import { Thing } from '~/domain/thing';
import { ThingType } from '~/domain/tibia';
import { getSetting } from '~/adapter/settings';
import { CreatureLook } from '~/domain/creature';
import { loadCreatureDb } from '~/adapter/creatures';
import { CLIENT_VERSIONS } from '~/lib/formats/tibia/types';
import { decodeDatResponse } from '~/lib/formats/tibia/datDecoder';

export const DEFAULT_VERSION = 860;
export const DATA_DIR_KEY = 'dataDir';

let cachedDataDir = '';

export async function initDataDir(version = DEFAULT_VERSION): Promise<string> {
  const customRoot = (await getSetting<string>(DATA_DIR_KEY, '')).trim();
  cachedDataDir = await invoke<string>('default_data_dir', { version, customRoot: customRoot || null });
  return cachedDataDir;
}

export async function defaultDataRoot(): Promise<string> {
  return invoke<string>('default_data_root');
}

export async function copyDataDir(from: string, to: string): Promise<void> {
  await invoke('copy_data_dir', { from, to });
}

export function defaultDataDir(): string {
  return cachedDataDir;
}

export async function openDataDir(path: string): Promise<void> {
  await invoke('open_data_dir', { path });
}

export async function openUrl(url: string): Promise<void> {
  await invoke('open_url', { url });
}

const SPAWN_MARKER_SERVER_ID = 1507;
const WAYPOINT_MARKER_SERVER_ID = 1397;

export interface LoadedAssets {
  items: Map<number, Thing>;
  outfits: Map<number, ThingType>;
  itemNames: Map<number, string>;
  creatures: Map<string, CreatureLook>;
  spawnMarkerClientId: number;
  waypointMarkerClientId: number;
  sprPath: string;
  transparency: boolean;
  spritesCount: number;
  otbItemCount: number;
  spriteSize: number;
}

export async function mapClientIds(serverIds: number[]): Promise<number[]> {
  if (serverIds.length === 0) return [];
  return invoke<number[]>('map_client_ids', { serverIds });
}

interface OtfiFlags {
  extended: boolean;
  transparency: boolean;
  frameDurations: boolean;
  frameGroups: boolean;
  metadataFile: string;
  spritesFile: string;
}

function parseOtfi(content: string): Partial<OtfiFlags> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    out[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return {
    extended: out['extended'] === 'true',
    transparency: out['transparency'] === 'true',
    frameDurations: out['frame-durations'] === 'true',
    frameGroups: out['frame-groups'] === 'true',
    metadataFile: out['metadata-file'] || undefined,
    spritesFile: out['sprites-file'] || undefined
  };
}

async function readOtfi(dir: string): Promise<Partial<OtfiFlags>> {
  try {
    const content = await invoke<string>('read_file_text', { path: `${dir}/Tibia.otfi` });
    return parseOtfi(content);
  } catch {
    return {};
  }
}

export async function loadItemNamesPath(path: string): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  let content: string;
  try {
    content = await invoke<string>('read_file_text', { path });
  } catch {
    return names;
  }
  const re = /<item\s+id="(\d+)"[^>]*\bname="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.set(Number(m[1]), m[2]);
  }
  return names;
}

async function loadItemNames(dir: string): Promise<Map<number, string>> {
  return loadItemNamesPath(`${dir}/items.xml`);
}

export interface MapItemsPaths {
  otb: string;
  xml: string | null;
}

export async function resolveMapItems(mapPath: string): Promise<MapItemsPaths | null> {
  return (await invoke<MapItemsPaths | null>('resolve_items_dir', { mapPath })) ?? null;
}

export interface OtbmVersionInfo {
  otbm_version: number;
  items_major: number;
  items_minor: number;
  data_dir: string | null;
  version: number | null;
}

export async function peekOtbmVersion(path: string): Promise<OtbmVersionInfo> {
  return invoke<OtbmVersionInfo>('peek_otbm_version', { path });
}

export async function loadOtb(path: string): Promise<number> {
  return invoke<number>('load_otb', { path });
}

interface RustSprHeader {
  signature: number;
  extended: boolean;
  sprite_count: number;
  sprite_size: number;
}

export async function loadAssets(dataDir: string, clientDir: string, version = DEFAULT_VERSION): Promise<LoadedAssets> {
  const otfi = await readOtfi(clientDir);
  const extended = otfi.extended ?? CLIENT_VERSIONS.find((c) => c.value === version)?.supportsExtended ?? false;
  const transparency = otfi.transparency ?? false;
  const datPath = `${clientDir}/${otfi.metadataFile ?? 'Tibia.dat'}`;
  const sprPath = `${clientDir}/${otfi.spritesFile ?? 'Tibia.spr'}`;

  const otbItemCount = await invoke<number>('load_otb', { path: `${dataDir}/items.otb` }).catch(() => 0);
  await invoke<number>('load_materials', { dataDir }).catch(() => undefined);
  const itemNames = await loadItemNames(dataDir);
  const creatures = await loadCreatureDb(dataDir);
  const [spawnMarkerClientId, waypointMarkerClientId] =
    otbItemCount > 0 ? await mapClientIds([SPAWN_MARKER_SERVER_ID, WAYPOINT_MARKER_SERVER_ID]) : [0, 0];

  const datFlags = {
    extended,
    frameDurations: otfi.frameDurations ?? null,
    frameGroups: otfi.frameGroups ?? null
  };
  const datResponse = await invoke<Uint8Array | ArrayBuffer>('parse_dat_file_bin', { path: datPath, version, datFlags });
  const datBuf = datResponse instanceof Uint8Array ? datResponse : new Uint8Array(datResponse);
  const dat = decodeDatResponse(datBuf);

  const sprHeader = await invoke<RustSprHeader>('open_spr_file', { path: sprPath, extended });

  return {
    items: dat.items,
    outfits: dat.outfits,
    itemNames,
    creatures,
    spawnMarkerClientId: spawnMarkerClientId ?? 0,
    waypointMarkerClientId: waypointMarkerClientId ?? 0,
    sprPath,
    transparency,
    spritesCount: sprHeader.sprite_count,
    otbItemCount,
    spriteSize: sprHeader.sprite_size
  };
}
