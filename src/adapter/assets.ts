import { invoke } from '@tauri-apps/api/core';

import { ThingType } from '~/domain/tibia';
import { decodeDatResponse } from '~/adapter/datDecoder';

export const DEFAULT_DATA_DIR = 'D:/workspace/projects/nosbor/data/860';
export const DEFAULT_VERSION = 860;

export interface LoadedAssets {
  items: Map<number, ThingType>;
  outfits: Map<number, ThingType>;
  itemNames: Map<number, string>;
  sprPath: string;
  transparency: boolean;
  spritesCount: number;
  otbItemCount: number;
}

export async function mapClientIds(serverIds: number[]): Promise<number[]> {
  if (serverIds.length === 0) return [];
  return invoke<number[]>('map_client_ids', { serverIds });
}

interface OtfiFlags {
  extended: boolean;
  transparency: boolean;
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

async function loadItemNames(dir: string): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  let content: string;
  try {
    content = await invoke<string>('read_file_text', { path: `${dir}/items.xml` });
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

interface RustSprHeader {
  signature: number;
  extended: boolean;
  sprite_count: number;
}

export async function loadAssets(dir = DEFAULT_DATA_DIR, version = DEFAULT_VERSION): Promise<LoadedAssets> {
  const otfi = await readOtfi(dir);
  const extended = otfi.extended ?? false;
  const transparency = otfi.transparency ?? false;
  const datPath = `${dir}/${otfi.metadataFile ?? 'Tibia.dat'}`;
  const sprPath = `${dir}/${otfi.spritesFile ?? 'Tibia.spr'}`;

  const otbItemCount = await invoke<number>('load_otb', { path: `${dir}/items.otb` });
  await invoke<number>('load_materials', { dataDir: dir }).catch((err) => console.error('Failed to load materials', err));
  const itemNames = await loadItemNames(dir);

  const datResponse = await invoke<Uint8Array | ArrayBuffer>('parse_dat_file_bin', { path: datPath, version });
  const datBuf = datResponse instanceof Uint8Array ? datResponse : new Uint8Array(datResponse);
  const dat = decodeDatResponse(datBuf);

  const sprHeader = await invoke<RustSprHeader>('open_spr_file', { path: sprPath, extended });

  return {
    items: dat.items,
    outfits: dat.outfits,
    itemNames,
    sprPath,
    transparency,
    spritesCount: sprHeader.sprite_count,
    otbItemCount
  };
}
