import React from 'react';

import { ToolId } from '~/domain/tools';
import { ThingType } from '~/domain/tibia';
import { MapSpawns } from '~/domain/creature';
import { MapWaypoints } from '~/domain/waypoint';
import { MapView, MapMeta, Position } from '~/domain/map';
import { ActiveBrush, PaletteCategoryId } from '~/domain/palette';

export interface Camera {
  x: number;
  y: number;
}

export interface MeshInfo {
  count: number;
  version: number;
  epoch: number;
  complete: boolean;
  lastUsed: number;
}

export interface SelTile {
  x: number;
  y: number;
  z: number;
  all: boolean;
}

export interface HoverItem {
  serverId: number;
  clientId: number;
  name: string;
  count: number;
}

export interface HoverInfo {
  x: number;
  y: number;
  z: number;
  hasTile: boolean;
  item: HoverItem | null;
}

export interface ContextMenuState {
  clientX: number;
  clientY: number;
  tile: Position;
  dest: Position | null;
  item: HoverItem | null;
  ground: HoverItem | null;
  spawn: Position | null;
  creature: Position | null;
  waypoint: Position | null;
  hasSelection: boolean;
  canPaste: boolean;
}

export interface SpawnForm {
  x: number;
  y: number;
  z: number;
  radius: number;
  spawntime: number;
}

export interface CreatureForm {
  x: number;
  y: number;
  z: number;
  name: string;
  spawntime: number;
  direction: number;
}

export interface WaypointForm {
  x: number;
  y: number;
  z: number;
  name: string;
}

export interface MapCanvasProps {
  map: MapMeta;
  items: Map<number, ThingType>;
  outfits: Map<number, ThingType>;
  itemNames: Map<number, string>;
  spawns: MapSpawns | null;
  showSpawns: boolean;
  showCreatures: boolean;
  spawnMarkerClientId: number;
  spawnTime: number;
  spawnRadius: number;
  autoCreateSpawn: boolean;
  onEditSpawns: (next: MapSpawns) => void;
  waypoints: MapWaypoints | null;
  showWaypoints: boolean;
  waypointMarkerClientId: number;
  onEditWaypoints: (next: MapWaypoints) => void;
  waypointEditRef?: React.MutableRefObject<((next: MapWaypoints) => void) | null>;
  placingWaypoint: string | null;
  onPlaceWaypoint: () => void;
  sprPath: string;
  transparency: boolean;
  floorZ: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onZoomChange: (zoom: number) => void;
  onFloorChange: (z: number) => void;
  onHover: (info: HoverInfo | null) => void;
  onSelect: (item: HoverItem | null) => void;
  onSelectBrush: (brush: ActiveBrush | null) => void;
  onRevealBrush?: (category: PaletteCategoryId, serverId: number, name?: string) => void;
  onToolChange: (tool: ToolId) => void;
  activeBrush: ActiveBrush | null;
  activeTool: ToolId;
  automagic: boolean;
  copyPositionFormat: string;
  onEdit?: (z: number) => void;
  paused?: boolean;
  initialCenter: { x: number; y: number };
  onViewChange?: (cx: number, cy: number) => void;
  viewRef?: React.MutableRefObject<MapView | null>;
  centerRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
}
