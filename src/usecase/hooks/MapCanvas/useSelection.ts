import React from 'react';

import { Position } from '~/domain/map';
import { SelTile } from '~/components/MapCanvas/types';

import { ChunkMeshCache } from './useChunkMeshes';

export interface BoxSelection {
  startTile: Position;
  curTile: Position;
  additive: boolean;
}

export interface Selection {
  entries: React.MutableRefObject<Map<string, SelTile>>;
  box: React.MutableRefObject<BoxSelection | null>;
  spawn: React.MutableRefObject<Position | null>;
  creature: React.MutableRefObject<Position | null>;
  waypoint: React.MutableRefObject<Position | null>;
  selectTile: (pos: Position, all: boolean) => void;
  selectSpawn: (pos: Position | null) => void;
  selectCreature: (pos: Position | null) => void;
  selectWaypoint: (pos: Position | null) => void;
  selectBox: (z: number, ax: number, ay: number, bx: number, by: number, additive: boolean) => void;
  clear: () => void;
}

export function useSelection(meshes: ChunkMeshCache): Selection {
  const entries = React.useRef(new Map<string, SelTile>());
  const box = React.useRef<BoxSelection | null>(null);
  const spawn = React.useRef<Position | null>(null);
  const creature = React.useRef<Position | null>(null);
  const waypoint = React.useRef<Position | null>(null);

  function selectMarker(ref: React.MutableRefObject<Position | null>, pos: Position | null) {
    const prev = ref.current;
    if (prev && (!pos || prev.x !== pos.x || prev.y !== pos.y || prev.z !== pos.z)) {
      meshes.discardAt(prev.x, prev.y, prev.z);
    }
    ref.current = pos;
    if (pos) meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function selectSpawn(pos: Position | null) {
    selectMarker(spawn, pos);
  }

  function selectCreature(pos: Position | null) {
    selectMarker(creature, pos);
  }

  function selectWaypoint(pos: Position | null) {
    selectMarker(waypoint, pos);
  }

  function clear() {
    selectSpawn(null);
    selectCreature(null);
    selectWaypoint(null);
    if (entries.current.size === 0) return;
    meshes.discardTiles(entries.current.values());
    entries.current.clear();
  }

  function selectTile(pos: Position, all: boolean) {
    clear();
    entries.current.set(`${pos.z},${pos.x},${pos.y}`, { x: pos.x, y: pos.y, z: pos.z, all });
    meshes.discardAt(pos.x, pos.y, pos.z);
  }

  function selectBox(z: number, ax: number, ay: number, bx: number, by: number, additive: boolean) {
    if (!additive) clear();
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    const added: SelTile[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const tile = { x, y, z, all: true };
        entries.current.set(`${z},${x},${y}`, tile);
        added.push(tile);
      }
    }
    meshes.discardTiles(added);
  }

  return {
    entries,
    box,
    spawn,
    creature,
    waypoint,
    selectTile,
    selectSpawn,
    selectCreature,
    selectWaypoint,
    selectBox,
    clear
  };
}
