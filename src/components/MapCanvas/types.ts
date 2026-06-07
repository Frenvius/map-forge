import { ToolId } from '~/domain/tools';
import { ThingType } from '~/domain/tibia';
import { ActiveBrush } from '~/domain/palette';
import { MapMeta, Position } from '~/domain/map';

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
}

export interface MapCanvasProps {
  map: MapMeta;
  items: Map<number, ThingType>;
  itemNames: Map<number, string>;
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
  onToolChange: (tool: ToolId) => void;
  activeBrush: ActiveBrush | null;
  activeTool: ToolId;
}
