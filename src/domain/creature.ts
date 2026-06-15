export interface CreatureLook {
  lookType: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  addons: number;
  mount: number;
  isNpc: boolean;
}

export interface SpawnArea {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface CreaturePlacement {
  x: number;
  y: number;
  z: number;
  name: string;
  isNpc: boolean;
  lookType: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  spawntime: number;
  direction: number;
}

export interface MapSpawns {
  areas: SpawnArea[];
  placements: CreaturePlacement[];
  byChunk: Map<string, CreaturePlacement[]>;
  areasByZ: Map<number, SpawnArea[]>;
}

const CHUNK = 32;

export function buildMapSpawns(areas: SpawnArea[], placements: CreaturePlacement[]): MapSpawns {
  const byChunk = new Map<string, CreaturePlacement[]>();
  const areasByZ = new Map<number, SpawnArea[]>();
  for (const a of areas) {
    const list = areasByZ.get(a.z);
    if (list) list.push(a);
    else areasByZ.set(a.z, [a]);
  }
  for (const p of placements) {
    const key = `${p.z},${Math.floor(p.x / CHUNK)},${Math.floor(p.y / CHUNK)}`;
    const arr = byChunk.get(key);
    if (arr) arr.push(p);
    else byChunk.set(key, [p]);
  }
  return { areas, placements, byChunk, areasByZ };
}

export const emptyMapSpawns = (): MapSpawns => buildMapSpawns([], []);
