import { invoke } from '@tauri-apps/api/core';

import { PaletteTileset } from '~/domain/palette';
import { MapSpawns, SpawnArea, CreatureLook, buildMapSpawns, emptyMapSpawns, CreaturePlacement } from '~/domain/creature';

export interface CreatureDirs {
  dataDir: string;
  monsterDir: string | null;
  npcDir: string | null;
}

interface CreatureEntry {
  name: string;
  isNpc: boolean;
  lookType: number;
  lookItem: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  addons: number;
  mount: number;
}

interface RustCreatureEntry {
  name: string;
  is_npc: boolean;
  look_type: number;
  look_item: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  addons: number;
  mount: number;
}

export async function resolveCreatureDirs(mapPath: string): Promise<CreatureDirs | null> {
  const dirs = await invoke<{ data_dir: string; monster_dir: string | null; npc_dir: string | null } | null>(
    'resolve_creature_dirs',
    { mapPath }
  );
  if (!dirs) return null;
  return { dataDir: dirs.data_dir, monsterDir: dirs.monster_dir, npcDir: dirs.npc_dir };
}

export async function scanCreatures(dirs: CreatureDirs): Promise<CreatureEntry[]> {
  const rows = await invoke<RustCreatureEntry[]>('scan_creatures', {
    monsterDir: dirs.monsterDir,
    npcDir: dirs.npcDir
  });
  return rows.map((r) => ({
    name: r.name,
    isNpc: r.is_npc,
    lookType: r.look_type,
    lookItem: r.look_item,
    head: r.head,
    body: r.body,
    legs: r.legs,
    feet: r.feet,
    addons: r.addons,
    mount: r.mount
  }));
}

export function creatureDbFromEntries(entries: CreatureEntry[]): Map<string, CreatureLook> {
  const db = new Map<string, CreatureLook>();
  for (const e of entries) {
    db.set(e.name.toLowerCase(), {
      lookType: e.lookType,
      head: e.head,
      body: e.body,
      legs: e.legs,
      feet: e.feet,
      mount: e.mount,
      addons: e.addons,
      isNpc: e.isNpc
    });
  }
  return db;
}

export function creatureTilesetsFromEntries(entries: CreatureEntry[]): PaletteTileset[] {
  const monsters = [];
  const npcs = [];
  for (const e of entries) {
    if (!e.lookType) continue;
    const brush = {
      key: `creature:${e.name}`,
      name: e.name,
      kind: 'creature' as const,
      lookType: e.lookType,
      isNpc: e.isNpc,
      creature: { type: e.lookType, head: e.head, body: e.body, legs: e.legs, feet: e.feet }
    };
    (e.isNpc ? npcs : monsters).push(brush);
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  monsters.sort(byName);
  npcs.sort(byName);
  const out: PaletteTileset[] = [];
  if (monsters.length) out.push({ name: 'Monsters', brushes: monsters });
  if (npcs.length) out.push({ name: 'NPCs', brushes: npcs });
  return out;
}

const dataSidecarPath = (mapPath: string) => mapPath.replace(/\.otbm$/i, '-data.xml');

export async function readMapDataDir(mapPath: string): Promise<string | null> {
  try {
    const content = await invoke<string>('read_file_text', { path: dataSidecarPath(mapPath) });
    const m = /<dataDirectory\b[^>]*\bpath="([^"]*)"/i.exec(content);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function writeMapDataDir(mapPath: string, dataDir: string): Promise<void> {
  const escaped = dataDir.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<mapconfig>\n  <dataDirectory path="${escaped}"/>\n</mapconfig>\n`;
  await invoke('write_file_text', { path: dataSidecarPath(mapPath), contents: xml });
}

const attr = (s: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(s);
  return m ? m[1] : null;
};

const num = (s: string, name: string): number => {
  const v = attr(s, name);
  return v ? Number(v) : 0;
};

export async function loadCreatureDb(dir: string): Promise<Map<string, CreatureLook>> {
  const db = new Map<string, CreatureLook>();
  let content: string;
  try {
    content = await invoke<string>('read_file_text', { path: `${dir}/creatures.xml` });
  } catch {
    return db;
  }
  const re = /<creature\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const a = m[1];
    const name = attr(a, 'name');
    if (!name) continue;
    db.set(name.toLowerCase(), {
      lookType: num(a, 'looktype'),
      head: num(a, 'lookhead'),
      body: num(a, 'lookbody'),
      legs: num(a, 'looklegs'),
      feet: num(a, 'lookfeet'),
      mount: num(a, 'lookmount'),
      addons: num(a, 'lookaddons'),
      isNpc: (attr(a, 'type') ?? 'monster').toLowerCase() === 'npc'
    });
  }
  return db;
}

const MISSING_OUTFIT = { lookType: 130, head: 0, body: 0, legs: 0, feet: 0 };

function resolveOutfit(name: string, db: Map<string, CreatureLook>) {
  const look = db.get(name.toLowerCase());
  if (!look || !look.lookType) return MISSING_OUTFIT;
  return { lookType: look.lookType, head: look.head, body: look.body, legs: look.legs, feet: look.feet };
}

const intAttr = (el: Element, name: string): number => Number(el.getAttribute(name) ?? 0);

export async function loadSpawns(spawnPath: string, db: Map<string, CreatureLook>): Promise<MapSpawns> {
  let content: string;
  try {
    content = await invoke<string>('read_file_text', { path: spawnPath });
  } catch {
    return emptyMapSpawns();
  }

  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const areas: SpawnArea[] = [];
  const placements: CreaturePlacement[] = [];

  for (const spawn of Array.from(doc.getElementsByTagName('spawn'))) {
    const cx = intAttr(spawn, 'centerx');
    const cy = intAttr(spawn, 'centery');
    const cz = intAttr(spawn, 'centerz');
    areas.push({ x: cx, y: cy, z: cz, radius: intAttr(spawn, 'radius') });

    for (const child of Array.from(spawn.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag !== 'monster' && tag !== 'npc') continue;
      const name = child.getAttribute('name') ?? '';
      const outfit = resolveOutfit(name, db);
      placements.push({
        x: cx + intAttr(child, 'x'),
        y: cy + intAttr(child, 'y'),
        z: intAttr(child, 'z'),
        name,
        isNpc: tag === 'npc',
        lookType: outfit.lookType,
        head: outfit.head,
        body: outfit.body,
        legs: outfit.legs,
        feet: outfit.feet,
        spawntime: intAttr(child, 'spawntime') || 60,
        direction: child.getAttribute('direction') != null ? intAttr(child, 'direction') : 2
      });
    }
  }

  return buildMapSpawns(areas, placements);
}
