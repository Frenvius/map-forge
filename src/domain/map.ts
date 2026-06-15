export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface MapMeta {
  id: number;
  width: number;
  height: number;
  tileCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  teleports: Map<string, Position>;
  floors: number[];
  center: { x: number; y: number; floor: number };
}

export interface StoredMapView {
  cx: number;
  cy: number;
  zoom: number;
  floor: number;
}

export interface ChunkTiles {
  tileX: Uint16Array;
  tileY: Uint16Array;
  flags: Uint32Array;
  houseIds: Uint32Array;
  itemOffset: Uint32Array;
  clientIds: Uint16Array;
  serverIds: Uint16Array;
  counts: Uint8Array;
}

export interface PreviewTile {
  x: number;
  y: number;
  clientIds: Uint16Array;
}

export interface Town {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface MapProperties {
  width: number;
  height: number;
  description: string;
  spawnFile: string;
  houseFile: string;
  otbmVersion: number;
  itemsMajor: number;
  itemsMinor: number;
  townCount: number;
  waypointCount: number;
  waypointFile: string;
}

export interface MapFloorStat {
  z: number;
  tileCount: number;
}

export interface MapStatistics {
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  tileCount: number;
  itemCount: number;
  teleportCount: number;
  townCount: number;
  houseTileCount: number;
  floors: MapFloorStat[];
}

export interface MinimapImage {
  minX: number;
  minY: number;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface MapView {
  camX: number;
  camY: number;
  zoom: number;
  vw: number;
  vh: number;
}

export type OtbmProgress = (phase: 'parse' | 'decode', value: number) => void;
