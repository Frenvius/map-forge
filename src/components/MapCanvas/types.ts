import React from 'react';

import { Thing } from '~/domain/thing';
import { ThingType } from '~/domain/tibia';
import { MapHouses } from '~/domain/house';
import { MapSpawns } from '~/domain/creature';
import { ZoneVisibility } from '~/domain/zones';
import { SelectionMode } from '~/usecase/floors';
import { TooltipTypes } from '~/domain/tooltips';
import { MapWaypoints } from '~/domain/waypoint';
import { ToolId, EraserMode } from '~/domain/tools';
import { MapView, MapMeta, Position } from '~/domain/map';
import { ActiveBrush, PaletteCategoryId } from '~/domain/palette';
import { HuntArea, HuntMeta, HuntMonster, HuntViewPreview } from '~/usecase/context/ToolContext/types';

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

export interface SelectedItem extends HoverItem {
  x: number;
  y: number;
  z: number;
}

export interface HoverInfo {
  x: number;
  y: number;
  z: number;
  hasTile: boolean;
  item: HoverItem | null;
  box: { w: number; h: number } | null;
}

export interface ContextMenuState {
  clientX: number;
  clientY: number;
  tile: Position;
  dest: Position | null;
  item: HoverItem | null;
  ground: HoverItem | null;
  groundName: string | null;
  doodad: HoverItem | null;
  doodadName: string | null;
  spawn: Position | null;
  creature: Position | null;
  waypoint: Position | null;
  houseId: number | null;
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
  itemNames?: Map<number, string> | null;
  spawns: MapSpawns | null;
  onEditSpawns: (next: MapSpawns) => void;
  waypoints: MapWaypoints | null;
  onEditWaypoints: (next: MapWaypoints) => void;
  waypointEditRef?: React.MutableRefObject<((next: MapWaypoints) => void) | null>;
  houses: MapHouses | null;
  onEditHouses: (next: MapHouses) => void;
  onHousesDirty: () => void;
  placingWaypoint: string | null;
  onPlaceWaypoint: () => void;
  floorZ: number;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onFloorChange: (z: number) => void;
  onHover: (info: HoverInfo | null) => void;
  onSelect: (item: SelectedItem | null) => void;
  onStatus: (message: string) => void;
  onItemProperties?: () => void;
  onEdit?: (z: number) => void;
  paused?: boolean;
  initialCenter: { x: number; y: number };
  onViewChange?: (cx: number, cy: number) => void;
  viewRef?: React.MutableRefObject<MapView | null>;
  centerRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
  highlightRef?: React.MutableRefObject<((x: number, y: number, z: number) => void) | null>;
  refetchRef?: React.MutableRefObject<((tagged: [number, number][]) => void) | null>;
  importGhost?: { width: number; height: number; minZ: number; maxZ: number; preview: HTMLCanvasElement | null } | null;
  onImportDrop?: (pos: Position) => void;
  onImportCancel?: () => void;
}

export interface MapCanvasContextInputs {
  items: Map<number, Thing>;
  outfits: Map<number, ThingType>;
  itemNames: Map<number, string>;
  sprPath: string;
  transparency: boolean;
  spawnMarkerClientId: number;
  waypointMarkerClientId: number;
  showSpawns: boolean;
  showCreatures: boolean;
  showWaypoints: boolean;
  showHouses: boolean;
  showBlocking: boolean;
  showShade: boolean;
  showTooltips: boolean;
  tooltipTypes: TooltipTypes;
  automagic: boolean;
  selectionMode: SelectionMode;
  compensateSelection: boolean;
  zoneVisibility: ZoneVisibility;
  spawnTime: number;
  spawnRadius: number;
  autoCreateSpawn: boolean;
  eraseMonsters: boolean;
  eraseSpawns: boolean;
  mergePaste: boolean;
  copyPositionFormat: string;
  activeTool: ToolId;
  eraserMode: EraserMode;
  activeBrush: ActiveBrush | null;
  activeTile: { name: string; serverId: number; paintId: number } | null;
  penWidth: number;
  activeHouseId: number | null;
  onToolChange: (tool: ToolId) => void;
  onSelectBrush: (brush: ActiveBrush | null) => void;
  onRevealBrush?: (category: PaletteCategoryId, serverId: number, name?: string) => void;
  onSelectHouse: (houseId: number) => void;
  huntAreaSelecting: boolean;
  huntEditing: boolean;
  huntView: HuntViewPreview;
  huntMonsters: HuntMonster[];
  onHuntArea: (area: HuntArea | null) => void;
  onHuntAreaSelecting: (active: boolean) => void;
  onHuntMeta: (meta: HuntMeta | null) => void;
}

export type MapCanvasInputs = MapCanvasProps & MapCanvasContextInputs;
