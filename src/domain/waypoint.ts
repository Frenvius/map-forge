export interface Waypoint {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface MapWaypoints {
  list: Waypoint[];
  byChunk: Map<string, Waypoint[]>;
}

const CHUNK = 32;

export function buildMapWaypoints(list: Waypoint[]): MapWaypoints {
  const byChunk = new Map<string, Waypoint[]>();
  for (const w of list) {
    const key = `${w.z},${Math.floor(w.x / CHUNK)},${Math.floor(w.y / CHUNK)}`;
    const arr = byChunk.get(key);
    if (arr) arr.push(w);
    else byChunk.set(key, [w]);
  }
  return { list, byChunk };
}

export const emptyMapWaypoints = (): MapWaypoints => buildMapWaypoints([]);

export function waypointAt(wps: MapWaypoints, x: number, y: number, z: number): Waypoint | undefined {
  const key = `${z},${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
  return wps.byChunk.get(key)?.find((w) => w.x === x && w.y === y);
}
