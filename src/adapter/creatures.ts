import { invoke } from '@tauri-apps/api/core';

import { MapSpawns, SpawnArea, CreatureLook, buildMapSpawns, emptyMapSpawns, CreaturePlacement } from '~/domain/creature';

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
