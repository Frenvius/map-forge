import React from 'react';

import { Position, PreviewTile } from '~/domain/map';

export interface MoveDrag {
  from: Position;
  startX: number;
  startY: number;
  active: boolean;
}

export interface MarkerDrag {
  kind: 'creature' | 'spawn' | 'waypoint';
  from: Position;
  lookType: number;
  radius: number;
  startX: number;
  startY: number;
  active: boolean;
}

export interface MapScene {
  frameTick: React.MutableRefObject<number>;
  lastChunksDrawn: React.MutableRefObject<number>;
  ghostRef: React.RefObject<HTMLImageElement>;
  highlightRef: React.RefObject<HTMLDivElement>;
  selectionBoxRef: React.RefObject<HTMLDivElement>;
  spawnBoxRef: React.RefObject<HTMLDivElement>;
  houseExitsRef: React.RefObject<HTMLDivElement>;
  boxGhostRef: React.RefObject<HTMLDivElement>;
  boxGhostTiles: React.MutableRefObject<PreviewTile[] | null>;
  hoveredTile: React.MutableRefObject<Position | null>;
  lastHoverKey: React.MutableRefObject<string | null>;
  painting: React.MutableRefObject<boolean>;
  erasing: React.MutableRefObject<boolean>;
  lastPaintKey: React.MutableRefObject<string | null>;
  moveDrag: React.MutableRefObject<MoveDrag | null>;
  moveDest: React.MutableRefObject<Position | null>;
  pendingMove: React.MutableRefObject<Float32Array | null>;
  markerDrag: React.MutableRefObject<MarkerDrag | null>;
  markerDest: React.MutableRefObject<Position | null>;
  spawnResize: React.MutableRefObject<{ center: Position; radius: number } | null>;
}

export function useMapScene(): MapScene {
  return {
    frameTick: React.useRef(0),
    lastChunksDrawn: React.useRef(0),
    ghostRef: React.useRef<HTMLImageElement>(null),
    highlightRef: React.useRef<HTMLDivElement>(null),
    selectionBoxRef: React.useRef<HTMLDivElement>(null),
    spawnBoxRef: React.useRef<HTMLDivElement>(null),
    houseExitsRef: React.useRef<HTMLDivElement>(null),
    boxGhostRef: React.useRef<HTMLDivElement>(null),
    boxGhostTiles: React.useRef<PreviewTile[] | null>(null),
    hoveredTile: React.useRef<Position | null>(null),
    lastHoverKey: React.useRef<string | null>(null),
    painting: React.useRef(false),
    erasing: React.useRef(false),
    lastPaintKey: React.useRef<string | null>(null),
    moveDrag: React.useRef<MoveDrag | null>(null),
    moveDest: React.useRef<Position | null>(null),
    pendingMove: React.useRef<Float32Array | null>(null),
    markerDrag: React.useRef<MarkerDrag | null>(null),
    markerDest: React.useRef<Position | null>(null),
    spawnResize: React.useRef<{ center: Position; radius: number } | null>(null)
  };
}
