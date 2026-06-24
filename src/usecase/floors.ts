export const GROUND_LAYER = 7;
export const MAP_MAX_LAYER = 15;
export const MAP_MIN_LAYER = 0;

let floorShiftTiles = 1;

export function setFloorShift(tiles: number): void {
  floorShiftTiles = Number.isFinite(tiles) && tiles >= 0 ? tiles : 1;
}

export function floorShift(): number {
  return floorShiftTiles;
}

export interface FloorRange {
  startZ: number;
  endZ: number;
}

export function visibleFloorRange(current: number): FloorRange {
  const floor = Math.min(MAP_MAX_LAYER, Math.max(MAP_MIN_LAYER, current));
  const startZ = floor <= GROUND_LAYER ? GROUND_LAYER : Math.min(MAP_MAX_LAYER, floor + 2);
  return { startZ, endZ: floor };
}

export type SelectionMode = 'current' | 'lower' | 'visible';

export interface FloorBox {
  z: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export function selectionFloorBoxes(
  current: number,
  mode: SelectionMode,
  compensate: boolean,
  ax: number,
  ay: number,
  bx: number,
  by: number
): FloorBox[] {
  const deepest = mode === 'current' ? current : mode === 'lower' ? MAP_MAX_LAYER : visibleFloorRange(current).startZ;
  const boxes: FloorBox[] = [];
  for (let z = current; z <= deepest; z++) {
    const shift = compensate ? (z - current) * floorShiftTiles : 0;
    const fax = ax - shift;
    const fay = ay - shift;
    const fbx = bx - shift;
    const fby = by - shift;
    if (Math.max(fax, fbx) < 0 || Math.max(fay, fby) < 0) continue;
    boxes.push({ z, ax: Math.max(0, fax), ay: Math.max(0, fay), bx: Math.max(0, fbx), by: Math.max(0, fby) });
  }
  return boxes;
}
