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
  selectTile: (pos: Position, all: boolean) => void;
  selectBox: (z: number, ax: number, ay: number, bx: number, by: number, additive: boolean) => void;
  clear: () => void;
}

export function useSelection(meshes: ChunkMeshCache): Selection {
  const entries = React.useRef(new Map<string, SelTile>());
  const box = React.useRef<BoxSelection | null>(null);

  function clear() {
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

  return { entries, box, selectTile, selectBox, clear };
}
