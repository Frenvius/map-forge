import { Position } from '~/domain/map';
import { MapSpawns, SpawnArea, buildMapSpawns, CreaturePlacement } from '~/domain/creature';

export interface CreatureLookInput {
  name: string;
  isNpc: boolean;
  lookType: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
}

const covers = (a: SpawnArea, x: number, y: number, z: number): boolean =>
  a.z === z && Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= a.radius;

const samePos = (p: { x: number; y: number; z: number }, pos: Position): boolean =>
  p.x === pos.x && p.y === pos.y && p.z === pos.z;

export function placeCreature(
  spawns: MapSpawns,
  pos: Position,
  look: CreatureLookInput,
  spawntime: number,
  radius: number,
  autoSpawn: boolean
): MapSpawns {
  const covered = spawns.areas.some((a) => covers(a, pos.x, pos.y, pos.z));
  if (!covered && !autoSpawn) return spawns;
  const placements = spawns.placements.filter((p) => !samePos(p, pos));
  placements.push({
    x: pos.x,
    y: pos.y,
    z: pos.z,
    name: look.name,
    isNpc: look.isNpc,
    lookType: look.lookType,
    head: look.head,
    body: look.body,
    legs: look.legs,
    feet: look.feet,
    spawntime,
    direction: 2
  });
  const areas = covered ? spawns.areas : [...spawns.areas, { x: pos.x, y: pos.y, z: pos.z, radius: Math.max(1, radius) }];
  return buildMapSpawns(areas, placements);
}

export function removeCreatureAt(spawns: MapSpawns, pos: Position): MapSpawns {
  return buildMapSpawns(
    spawns.areas,
    spawns.placements.filter((p) => !samePos(p, pos))
  );
}

export function moveCreature(spawns: MapSpawns, from: Position, to: Position): MapSpawns {
  const placements = spawns.placements.map((p) => (samePos(p, from) ? { ...p, x: to.x, y: to.y, z: to.z } : p));
  return buildMapSpawns(spawns.areas, placements);
}

export function updateCreature(spawns: MapSpawns, pos: Position, spawntime: number, direction: number): MapSpawns {
  const placements = spawns.placements.map((p) => (samePos(p, pos) ? { ...p, spawntime, direction } : p));
  return buildMapSpawns(spawns.areas, placements);
}

export function placeSpawn(spawns: MapSpawns, pos: Position, radius: number): MapSpawns {
  if (spawns.areas.some((a) => samePos(a, pos))) return spawns;
  return buildMapSpawns([...spawns.areas, { x: pos.x, y: pos.y, z: pos.z, radius: Math.max(1, radius) }], spawns.placements);
}

export function removeSpawnAt(spawns: MapSpawns, pos: Position): MapSpawns {
  return buildMapSpawns(
    spawns.areas.filter((a) => !samePos(a, pos)),
    spawns.placements
  );
}

export function moveSpawn(spawns: MapSpawns, from: Position, to: Position): MapSpawns {
  const areas = spawns.areas.map((a) => (samePos(a, from) ? { ...a, x: to.x, y: to.y, z: to.z } : a));
  return buildMapSpawns(areas, spawns.placements);
}

export function setSpawnSize(spawns: MapSpawns, pos: Position, radius: number): MapSpawns {
  const areas = spawns.areas.map((a) => (samePos(a, pos) ? { ...a, radius: Math.max(1, radius) } : a));
  return buildMapSpawns(areas, spawns.placements);
}

export function updateSpawn(spawns: MapSpawns, center: Position, radius: number, spawntime: number): MapSpawns {
  const r = Math.max(1, radius);
  const areas = spawns.areas.map((a) => (samePos(a, center) ? { ...a, radius: r } : a));
  const area: SpawnArea = { x: center.x, y: center.y, z: center.z, radius: r };
  const placements = spawns.placements.map((p) => (covers(area, p.x, p.y, p.z) ? { ...p, spawntime } : p));
  return buildMapSpawns(areas, placements);
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function emitCreature(c: CreaturePlacement, cx: number, cy: number): string {
  const tag = c.isNpc ? 'npc' : 'monster';
  return `\t\t<${tag} name="${esc(c.name)}" x="${c.x - cx}" y="${c.y - cy}" z="${c.z}" spawntime="${c.spawntime}" direction="${c.direction}"/>`;
}

export function serializeSpawnXml(spawns: MapSpawns): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<spawns>'];
  const assigned = new Set<CreaturePlacement>();

  for (const a of spawns.areas) {
    lines.push(`\t<spawn centerx="${a.x}" centery="${a.y}" centerz="${a.z}" radius="${a.radius}">`);
    for (const c of spawns.placements) {
      if (assigned.has(c) || !covers(a, c.x, c.y, c.z)) continue;
      assigned.add(c);
      lines.push(emitCreature(c, a.x, a.y));
    }
    lines.push('\t</spawn>');
  }

  for (const c of spawns.placements) {
    if (assigned.has(c)) continue;
    lines.push(`\t<spawn centerx="${c.x}" centery="${c.y}" centerz="${c.z}" radius="1">`);
    lines.push(emitCreature(c, c.x, c.y));
    lines.push('\t</spawn>');
  }

  lines.push('</spawns>', '');
  return lines.join('\n');
}
