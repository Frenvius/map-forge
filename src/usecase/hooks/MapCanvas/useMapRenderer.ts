import React from 'react';

import { isZoneTool } from '~/domain/tools';
import { visibleZoneBits } from '~/domain/zones';
import { visibleFloorRange } from '~/usecase/floors';
import { slotUV, GLRenderer } from '~/usecase/glRenderer';
import { packChunkKey, fetchMapChunks } from '~/adapter/map';
import { MapCanvasInputs } from '~/components/MapCanvas/types';
import { SpawnArea, CreaturePlacement } from '~/domain/creature';
import { Position, ChunkTiles, PreviewTile } from '~/domain/map';
import { isCountStack, getSpriteIndex, stackSpriteIndex } from '~/domain/tibia';
import {
  TILE,
  CHUNK,
  CHUNK_WORLD,
  MAX_ELEVATION,
  LOWER_FLOOR_DIM,
  BUILD_BUDGET_MS,
  BUILD_BUDGET_MAX
} from '~/components/MapCanvas/constants';

import { MapScene } from './useMapScene';
import { Selection } from './useSelection';
import { MapCamera } from './useMapCamera';
import { SpriteAtlas } from './useSpriteAtlas';
import { ChunkTilesCache } from './useChunkTiles';
import { ChunkMeshCache } from './useChunkMeshes';
import {
  spawnFactor,
  spawnTileKey,
  buildThingGhost,
  appendCreatures,
  buildTopItemMesh,
  buildCreatureGhost,
  buildSpawnAreaGhost,
  spawnCountsForChunk
} from './meshBuilder';

export interface StatRefs {
  fpsRef: React.RefObject<HTMLSpanElement>;
  stallRef: React.RefObject<HTMLSpanElement>;
  maxRef: React.RefObject<HTMLSpanElement>;
  jsRef: React.RefObject<HTMLSpanElement>;
  chunkRef: React.RefObject<HTMLSpanElement>;
}

export interface RendererDeps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  gl: React.MutableRefObject<GLRenderer | null>;
  camera: MapCamera;
  inputs: React.MutableRefObject<MapCanvasInputs>;
  atlas: SpriteAtlas;
  tiles: ChunkTilesCache;
  meshes: ChunkMeshCache;
  selection: Selection;
  scene: MapScene;
  stats: StatRefs;
}

export function useMapRenderer(deps: RendererDeps) {
  const { canvasRef, gl, camera, inputs, atlas, tiles, meshes, selection, scene, stats } = deps;
  const { frameTick, lastChunksDrawn } = scene;
  const prevPreviewKeys = React.useRef<string[]>([]);

  function flushTileRequests() {
    if (inputs.current.paused) return;
    if (tiles.pending.current.size === 0) return;
    const byZ = new Map<number, number[]>();
    for (const k of tiles.pending.current) {
      const [z, cx, cy] = k.split(',').map(Number);
      let arr = byZ.get(z);
      if (!arr) {
        arr = [];
        byZ.set(z, arr);
      }
      arr.push(packChunkKey(cx, cy));
    }
    tiles.pending.current.clear();
    for (const [z, keys] of byZ) {
      fetchMapChunks(inputs.current.map.id, z, keys)
        .then((res) => {
          for (const packed of keys) {
            const cx = packed >>> 16;
            const cy = packed & 0xffff;
            const key = `${z},${cx},${cy}`;
            tiles.store(key, res.get(`${cx},${cy}`) ?? null, frameTick.current);
            meshes.forget(key);
          }
          atlas.version.current++;
        })
        .catch((err) => console.error('Failed to fetch chunks', err));
    }
  }

  function spawnPreview(): { from: Position; fromRadius: number; area: SpawnArea } | null {
    const rs = scene.spawnResize.current;
    if (!rs) return null;
    const a = inputs.current.spawns?.areasByZ.get(rs.center.z)?.find((x) => x.x === rs.center.x && x.y === rs.center.y);
    return {
      from: { x: rs.center.x, y: rs.center.y, z: rs.center.z },
      fromRadius: a?.radius ?? rs.radius,
      area: { x: rs.center.x, y: rs.center.y, z: rs.center.z, radius: rs.radius }
    };
  }

  function previewChunkKeys(pv: { from: Position; fromRadius: number; area: SpawnArea }): string[] {
    const keys = new Set<string>();
    const add = (x: number, y: number, z: number, r: number) => {
      for (let cy = Math.floor((y - r) / CHUNK); cy <= Math.floor((y + r) / CHUNK); cy++) {
        for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) {
          keys.add(`${z},${cx},${cy}`);
        }
      }
    };
    add(pv.from.x, pv.from.y, pv.from.z, pv.fromRadius);
    add(pv.area.x, pv.area.y, pv.area.z, pv.area.radius);
    return [...keys];
  }

  function buildChunkMesh(cx: number, cy: number, z: number, missing: Set<number>) {
    const { items, outfits, spawns, showSpawns, showCreatures, showHouses, zoneVisibility } = inputs.current;
    const key = `${z},${cx},${cy}`;
    const ct = tiles.data.current.get(key) as ChunkTiles | null | undefined;
    const sel = selection.entries.current;
    const useSel = sel.size > 0;
    const inst: number[] = [];
    let complete = true;

    const tileKey = (x: number, y: number) => x * 65536 + y;
    const creaturesByTile = new Map<number, CreaturePlacement[]>();
    const chunkCreatures = showCreatures ? spawns?.byChunk.get(key) : undefined;
    if (chunkCreatures) {
      for (const c of chunkCreatures) {
        const tk = tileKey(c.x, c.y);
        const arr = creaturesByTile.get(tk);
        if (arr) arr.push(c);
        else creaturesByTile.set(tk, [c]);
      }
    }

    let spawnAreas = showSpawns ? spawns?.areasByZ.get(z) : undefined;
    if (showSpawns) {
      const pv = spawnPreview();
      if (pv && pv.area.z === z) {
        spawnAreas = (spawnAreas ?? []).filter((a) => !(a.x === pv.from.x && a.y === pv.from.y)).concat([pv.area]);
      }
    }
    const spawnCounts = spawnAreas ? spawnCountsForChunk(spawnAreas, cx, cy) : null;
    const spawnCenters = new Set<number>();
    const markerClientId = inputs.current.spawnMarkerClientId;
    const markerThing = spawnAreas && spawnAreas.length > 0 && markerClientId ? items.get(markerClientId) : undefined;
    if (spawnAreas) {
      const minX = cx * CHUNK;
      const minY = cy * CHUNK;
      for (const a of spawnAreas) {
        if (a.x >= minX && a.x < minX + CHUNK && a.y >= minY && a.y < minY + CHUNK) {
          spawnCenters.add(spawnTileKey(a.x, a.y));
        }
      }
    }

    if (ct) {
      for (let i = 0; i < ct.tileX.length; i++) {
        const tx = ct.tileX[i];
        const ty = ct.tileY[i];
        const end = ct.itemOffset[i + 1];
        const top = end - 1;
        const selEntry = useSel ? sel.get(`${z},${tx},${ty}`) : undefined;
        const spawnCount = spawnCounts?.get(spawnTileKey(tx, ty));
        const groundSpawn = spawnCount ? spawnFactor(spawnCount) : 1;
        const houseBit = showHouses && ct.houseIds[i] ? 256 : 0;
        const zoneBits = (ct.flags[i] ? visibleZoneBits(ct.flags[i], zoneVisibility) : 0) | houseBit;
        let drawElevation = 0;
        for (let ii = ct.itemOffset[i]; ii < end; ii++) {
          const thing = items.get(ct.clientIds[ii]);
          if (!thing || thing.spriteIndex.length === 0) continue;
          const px = thing.patternX > 0 ? tx % thing.patternX : 0;
          const py = thing.patternY > 0 ? ty % thing.patternY : 0;
          const countStack = isCountStack(thing);
          const stackIdx = countStack ? stackSpriteIndex(thing, ct.counts[ii]) : 0;
          const ox = (thing.offsetX || 0) + drawElevation;
          const oy = (thing.offsetY || 0) + drawElevation;
          const tint = selEntry ? (selEntry.all || ii === top ? 1 : 0) : 0;
          const spawn = groundSpawn !== 1 && (thing.isGround || thing.isGroundBorder) ? groundSpawn : 1;

          for (let l = 0; l < thing.layers; l++) {
            for (let h = 0; h < thing.height; h++) {
              for (let w = 0; w < thing.width; w++) {
                const sid = thing.spriteIndex[countStack ? stackIdx : getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
                if (!sid) continue;
                const data = atlas.data.current.get(sid);
                if (!data) {
                  missing.add(sid);
                  complete = false;
                  continue;
                }
                atlas.lastUsed.current.set(sid, frameTick.current);
                if (data.empty) continue;
                const slot = atlas.slotFor(sid, data);
                if (slot < 0) {
                  complete = false;
                  continue;
                }
                const { u0, v0 } = slotUV(slot);
                inst.push((tx - w) * TILE - ox, (ty - h) * TILE - oy, u0, v0, tint, spawn, zoneBits);
              }
            }
          }

          if (thing.hasElevation) drawElevation = Math.min(drawElevation + thing.elevation, MAX_ELEVATION);
        }

        if (creaturesByTile.size > 0) {
          const here = creaturesByTile.get(tileKey(tx, ty));
          if (here) {
            creaturesByTile.delete(tileKey(tx, ty));
            const sc = selection.creature.current;
            const cSel = !!sc && sc.z === z && sc.x === tx && sc.y === ty;
            if (!appendCreatures(inst, here, outfits, atlas, frameTick.current, missing, cSel)) complete = false;
          }
        }

        if (markerThing && spawnCenters.has(spawnTileKey(tx, ty))) {
          const selSpawn = selection.spawn.current;
          const markerTint = selSpawn && selSpawn.z === z && selSpawn.x === tx && selSpawn.y === ty ? 1 : 0;
          for (let l = 0; l < markerThing.layers; l++) {
            for (let h = 0; h < markerThing.height; h++) {
              for (let w = 0; w < markerThing.width; w++) {
                const sid = markerThing.spriteIndex[getSpriteIndex(markerThing, w, h, l, 0, 0, 0, 0)];
                if (!sid) continue;
                const data = atlas.data.current.get(sid);
                if (!data) {
                  missing.add(sid);
                  complete = false;
                  continue;
                }
                atlas.lastUsed.current.set(sid, frameTick.current);
                if (data.empty) continue;
                const slot = atlas.slotFor(sid, data);
                if (slot < 0) {
                  complete = false;
                  continue;
                }
                const { u0, v0 } = slotUV(slot);
                inst.push((tx - w) * TILE, (ty - h) * TILE, u0, v0, markerTint, 1, 0);
              }
            }
          }
        }
      }
    }

    for (const arr of creaturesByTile.values()) {
      const sc = selection.creature.current;
      const cSel = !!sc && arr.length > 0 && sc.z === z && sc.x === arr[0].x && sc.y === arr[0].y;
      if (!appendCreatures(inst, arr, outfits, atlas, frameTick.current, missing, cSel)) complete = false;
    }

    const chunkWaypoints = inputs.current.showWaypoints ? inputs.current.waypoints?.byChunk.get(key) : undefined;
    const wpThing =
      chunkWaypoints?.length && inputs.current.waypointMarkerClientId
        ? items.get(inputs.current.waypointMarkerClientId)
        : undefined;
    if (wpThing && chunkWaypoints) {
      const selWp = selection.waypoint.current;
      for (const wp of chunkWaypoints) {
        const tint = selWp && selWp.z === z && selWp.x === wp.x && selWp.y === wp.y ? 1 : 0;
        for (let l = 0; l < wpThing.layers; l++) {
          for (let h = 0; h < wpThing.height; h++) {
            for (let w = 0; w < wpThing.width; w++) {
              const sid = wpThing.spriteIndex[getSpriteIndex(wpThing, w, h, l, 0, 0, 0, 0)];
              if (!sid) continue;
              const data = atlas.data.current.get(sid);
              if (!data) {
                missing.add(sid);
                complete = false;
                continue;
              }
              atlas.lastUsed.current.set(sid, frameTick.current);
              if (data.empty) continue;
              const slot = atlas.slotFor(sid, data);
              if (slot < 0) {
                complete = false;
                continue;
              }
              const { u0, v0 } = slotUV(slot);
              inst.push((wp.x - w) * TILE, (wp.y - h) * TILE, u0, v0, tint, 1, 0);
            }
          }
        }
      }
    }

    meshes.store(key, new Float32Array(inst), {
      count: inst.length / 7,
      version: atlas.version.current,
      epoch: atlas.epoch.current,
      complete,
      lastUsed: frameTick.current
    });
  }

  function buildPreviewGhost(previewTiles: PreviewTile[], missing: Set<number>): Float32Array {
    const { items } = inputs.current;
    const inst: number[] = [];
    for (const t of previewTiles) {
      const tx = t.x;
      const ty = t.y;
      let drawElevation = 0;
      for (let ii = 0; ii < t.clientIds.length; ii++) {
        const thing = items.get(t.clientIds[ii]);
        if (!thing || thing.spriteIndex.length === 0) continue;
        const px = thing.patternX > 0 ? tx % thing.patternX : 0;
        const py = thing.patternY > 0 ? ty % thing.patternY : 0;
        const ox = (thing.offsetX || 0) + drawElevation;
        const oy = (thing.offsetY || 0) + drawElevation;

        for (let l = 0; l < thing.layers; l++) {
          for (let h = 0; h < thing.height; h++) {
            for (let w = 0; w < thing.width; w++) {
              const sid = thing.spriteIndex[getSpriteIndex(thing, w, h, l, px, py, 0, 0)];
              if (!sid) continue;
              const data = atlas.data.current.get(sid);
              if (!data) {
                missing.add(sid);
                continue;
              }
              atlas.lastUsed.current.set(sid, frameTick.current);
              if (data.empty) continue;
              const slot = atlas.slotFor(sid, data);
              if (slot < 0) continue;
              const { u0, v0 } = slotUV(slot);
              inst.push((tx - w) * TILE - ox, (ty - h) * TILE - oy, u0, v0, 0, 1, 0);
            }
          }
        }

        if (thing.hasElevation) drawElevation = Math.min(drawElevation + thing.elevation, MAX_ELEVATION);
      }
    }
    return new Float32Array(inst);
  }

  function updateGhost(camX: number, camY: number, zoom: number) {
    const ghost = scene.ghostRef.current;
    const outline = scene.highlightRef.current;
    if (!ghost || !outline) return;

    const tool = inputs.current.activeTool;
    const brush = inputs.current.activeBrush;
    const tile = scene.hoveredTile.current;
    const showBrush = tool === 'brush' && brush != null && brush.serverId != null;
    const showEraser = tool === 'eraser';
    const showZone = isZoneTool(tool);

    if (selection.box.current || !tile || (!showBrush && !showEraser && !showZone)) {
      ghost.style.display = 'none';
      outline.style.display = 'none';
      return;
    }

    if (showEraser || showZone) {
      const s = TILE * zoom;
      ghost.style.display = 'none';
      outline.style.display = 'block';
      outline.style.width = `${s}px`;
      outline.style.height = `${s}px`;
      outline.style.transform = `translate(${(tile.x * TILE - camX) * zoom}px, ${(tile.y * TILE - camY) * zoom}px)`;
      outline.style.borderColor = showEraser ? 'rgb(248, 113, 113)' : 'rgb(125, 211, 252)';
      outline.style.backgroundColor = showEraser ? 'rgba(239, 68, 68, 0.18)' : 'rgba(56, 189, 248, 0.14)';
      return;
    }

    if (!brush) return;
    outline.style.borderColor = '';
    outline.style.backgroundColor = '';
    const cols = brush.cols ?? 1;
    const rows = brush.rows ?? 1;
    const screenX = ((tile.x + 1 - cols) * TILE - camX) * zoom;
    const screenY = ((tile.y + 1 - rows) * TILE - camY) * zoom;
    const w = cols * TILE * zoom;
    const h = rows * TILE * zoom;
    const transform = `translate(${screenX}px, ${screenY}px)`;

    if (brush.preview) {
      if (ghost.getAttribute('src') !== brush.preview) ghost.src = brush.preview;
      ghost.style.display = 'block';
      ghost.style.width = `${w}px`;
      ghost.style.height = `${h}px`;
      ghost.style.transform = transform;
      outline.style.display = 'none';
      return;
    }

    ghost.style.display = 'none';
    outline.style.display = 'block';
    outline.style.width = `${w}px`;
    outline.style.height = `${h}px`;
    outline.style.transform = transform;
  }

  function updateSpawnBox(camX: number, camY: number, zoom: number) {
    const el = scene.spawnBoxRef.current;
    if (!el) return;
    const resize = scene.spawnResize.current;
    const sc = selection.spawn.current;
    const area = sc ? inputs.current.spawns?.areasByZ.get(sc.z)?.find((a) => a.x === sc.x && a.y === sc.y) : undefined;
    const c = resize ? resize.center : sc;
    const r = resize ? resize.radius : area?.radius;
    if (!c || r == null || c.z !== inputs.current.floorZ || !inputs.current.showSpawns) {
      el.style.display = 'none';
      return;
    }
    const x0 = (c.x - r) * TILE;
    const y0 = (c.y - r) * TILE;
    const size = (2 * r + 1) * TILE * zoom;
    el.style.display = 'block';
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = `translate(${(x0 - camX) * zoom}px, ${(y0 - camY) * zoom}px)`;
  }

  function updateHouseExits(camX: number, camY: number, zoom: number) {
    const layer = scene.houseExitsRef.current;
    if (!layer) return;
    if (!inputs.current.showHouses) {
      layer.style.display = 'none';
      return;
    }
    layer.style.display = 'block';
    const size = TILE * zoom;
    const floor = inputs.current.floorZ;
    for (const child of Array.from(layer.children) as HTMLElement[]) {
      const x = Number(child.dataset.x);
      const y = Number(child.dataset.y);
      const z = Number(child.dataset.z);
      if (z !== floor) {
        child.style.display = 'none';
        continue;
      }
      child.style.display = 'flex';
      child.style.width = `${size}px`;
      child.style.height = `${size}px`;
      child.style.transform = `translate(${(x * TILE - camX) * zoom}px, ${(y * TILE - camY) * zoom}px)`;
    }
  }

  function updateSelectionBox(camX: number, camY: number, zoom: number) {
    const el = scene.selectionBoxRef.current;
    const ghost = scene.boxGhostRef.current;
    const bs = selection.box.current;
    if (!bs) {
      if (el) el.style.display = 'none';
      if (ghost) ghost.style.display = 'none';
      return;
    }
    const minX = Math.min(bs.startTile.x, bs.curTile.x);
    const minY = Math.min(bs.startTile.y, bs.curTile.y);
    const maxX = Math.max(bs.startTile.x, bs.curTile.x);
    const maxY = Math.max(bs.startTile.y, bs.curTile.y);
    const screenX = (minX * TILE - camX) * zoom;
    const screenY = (minY * TILE - camY) * zoom;
    const w = (maxX - minX + 1) * TILE * zoom;
    const h = (maxY - minY + 1) * TILE * zoom;
    const transform = `translate(${screenX}px, ${screenY}px)`;

    if (el) {
      el.style.display = 'block';
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transform = transform;
    }

    if (!ghost) return;
    const tool = inputs.current.activeTool;
    const brush = inputs.current.activeBrush;
    if (tool === 'brush' && brush && brush.serverId != null && brush.preview && !inputs.current.automagic) {
      const cols = brush.cols ?? 1;
      const rows = brush.rows ?? 1;
      ghost.style.display = 'block';
      ghost.style.transform = transform;
      ghost.style.width = `${w}px`;
      ghost.style.height = `${h}px`;
      ghost.style.opacity = '0.5';
      ghost.style.backgroundColor = 'transparent';
      ghost.style.backgroundImage = `url(${brush.preview})`;
      ghost.style.backgroundRepeat = 'repeat';
      ghost.style.backgroundSize = `${cols * TILE * zoom}px ${rows * TILE * zoom}px`;
    } else if (tool === 'eraser') {
      ghost.style.display = 'block';
      ghost.style.transform = transform;
      ghost.style.width = `${w}px`;
      ghost.style.height = `${h}px`;
      ghost.style.opacity = '1';
      ghost.style.backgroundImage = 'none';
      ghost.style.backgroundColor = 'rgba(239, 68, 68, 0.28)';
    } else {
      ghost.style.display = 'none';
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    const renderer = gl.current;
    if (!canvas || !renderer) return;

    const { sprPath, transparency, floorZ } = inputs.current;
    const zoom = camera.zoomRef.current;
    frameTick.current++;

    const dpr = window.devicePixelRatio || 1;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;

    const screenScale = zoom * dpr;
    const inv = 1 / screenScale;
    const crisp = screenScale >= 1 || Math.abs(inv - Math.round(inv)) < 0.01;

    let bufW: number;
    let bufH: number;
    let scale: number;
    if (crisp) {
      scale = screenScale;
      bufW = Math.round(vw * dpr);
      bufH = Math.round(vh * dpr);
    } else {
      const intDpr = Math.max(1, Math.round(dpr));
      scale = intDpr;
      bufW = Math.ceil((vw / zoom) * intDpr);
      bufH = Math.ceil((vh / zoom) * intDpr);
    }
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }

    const { x: camX, y: camY } = camera.ref.current;
    const viewRef = inputs.current.viewRef;
    if (viewRef) viewRef.current = { camX, camY, zoom, vw, vh };
    renderer.beginFrame(bufW, bufH, camX, camY, scale, 1);

    const { minX, minY, maxX, maxY } = inputs.current.map.bounds;
    const minCx = Math.floor(minX / CHUNK);
    const minCy = Math.floor(minY / CHUNK);
    const maxCx = Math.floor(maxX / CHUNK);
    const maxCy = Math.floor(maxY / CHUNK);

    const { startZ, endZ } = visibleFloorRange(floorZ);
    const dimLowerFloors = startZ !== endZ;

    const missing = new Set<number>();
    const deadline = performance.now() + BUILD_BUDGET_MS;
    let builds = 0;
    let drawn = 0;

    const pv = spawnPreview();
    const curPreviewKeys = pv ? previewChunkKeys(pv) : [];
    for (const k of new Set([...prevPreviewKeys.current, ...curPreviewKeys])) meshes.forget(k);
    prevPreviewKeys.current = curPreviewKeys;

    for (let z = startZ; z >= endZ; z--) {
      if (dimLowerFloors && z === endZ) renderer.dimViewport(LOWER_FLOOR_DIM);

      const shift = (z - endZ) * TILE;
      renderer.setFloorOffset(shift, shift);

      const fCamX = camX - shift;
      const fCamY = camY - shift;
      const startCx = Math.max(minCx, Math.floor(fCamX / CHUNK_WORLD));
      const endCx = Math.min(maxCx, Math.floor((fCamX + vw / zoom) / CHUNK_WORLD));
      const startCy = Math.max(minCy, Math.floor(fCamY / CHUNK_WORLD));
      const endCy = Math.min(maxCy, Math.floor((fCamY + vh / zoom) / CHUNK_WORLD));

      for (let cy = startCy; cy <= endCy; cy++) {
        for (let cx = startCx; cx <= endCx; cx++) {
          const ct = tiles.get(cx, cy, z, frameTick.current);
          if (ct === undefined) {
            tiles.request(cx, cy, z);
            continue;
          }
          if (ct === null) continue;
          const key = `${z},${cx},${cy}`;
          const m = meshes.data.current.get(key);
          const fresh = m && m.epoch === atlas.epoch.current && (m.complete || m.version === atlas.version.current);
          if (!fresh && builds < BUILD_BUDGET_MAX && performance.now() < deadline) {
            buildChunkMesh(cx, cy, z, missing);
            builds++;
          }
          const mm = meshes.data.current.get(key);
          if (mm) {
            mm.lastUsed = frameTick.current;
            if (mm.count > 0) {
              renderer.drawChunkMesh(key);
              drawn++;
            }
          }
        }
      }
    }
    const md = scene.moveDrag.current;
    if (md && md.active && scene.moveDest.current) {
      const ctx = { items: inputs.current.items, tiles, atlas };
      const ghost = buildTopItemMesh(
        ctx,
        frameTick.current,
        floorZ,
        md.from,
        scene.moveDest.current.x - md.from.x,
        scene.moveDest.current.y - md.from.y
      );
      if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.55);
    } else if (scene.pendingMove.current) {
      renderer.drawGhost(scene.pendingMove.current, camX, camY, scale, 0.55);
    }

    const mk = scene.markerDrag.current;
    if (mk && mk.active && scene.markerDest.current) {
      const d = scene.markerDest.current;
      if (mk.kind === 'creature') {
        const ghost = buildCreatureGhost(
          mk.lookType,
          d.x,
          d.y,
          floorZ,
          inputs.current.outfits,
          atlas,
          frameTick.current,
          missing
        );
        if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.55);
      } else if (mk.kind === 'waypoint') {
        const markerThing = inputs.current.items.get(inputs.current.waypointMarkerClientId);
        const flame = markerThing ? buildThingGhost(markerThing, d.x, d.y, atlas, frameTick.current, missing) : null;
        if (flame) renderer.drawGhost(flame, camX, camY, scale, 0.5);
      } else {
        const ctx = { items: inputs.current.items, tiles, atlas };
        const area = buildSpawnAreaGhost(ctx, d.x, d.y, floorZ, mk.radius, frameTick.current, missing);
        if (area) renderer.drawGhost(area, camX, camY, scale, 0.4);
        const markerThing = inputs.current.items.get(inputs.current.spawnMarkerClientId);
        const flame = markerThing ? buildThingGhost(markerThing, d.x, d.y, atlas, frameTick.current, missing) : null;
        if (flame) renderer.drawGhost(flame, camX, camY, scale, 0.5);
      }
    }

    const placing = inputs.current.placingWaypoint;
    const hover = scene.hoveredTile.current;
    if (placing && hover && hover.z === floorZ && inputs.current.waypointMarkerClientId) {
      const markerThing = inputs.current.items.get(inputs.current.waypointMarkerClientId);
      const ghost = markerThing ? buildThingGhost(markerThing, hover.x, hover.y, atlas, frameTick.current, missing) : null;
      if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    const previewTiles = scene.boxGhostTiles.current;
    if (previewTiles && previewTiles.length > 0 && selection.box.current) {
      const ghost = buildPreviewGhost(previewTiles, missing);
      if (ghost.length > 0) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    renderer.endFrame();
    lastChunksDrawn.current = drawn;

    updateGhost(camX, camY, zoom);
    updateSelectionBox(camX, camY, zoom);
    updateSpawnBox(camX, camY, zoom);
    updateHouseExits(camX, camY, zoom);

    flushTileRequests();
    atlas.loadMissing(sprPath, missing, transparency);

    atlas.evict(frameTick.current);
    tiles.evict(frameTick.current);
    meshes.evict(frameTick.current);
  }

  React.useEffect(() => {
    let raf = 0;
    const s = { frames: 0, lastUpdate: 0, lastFrame: 0, jsSum: 0, maxFrame: 0, stalls: 0, started: false };

    const frame = (now: number) => {
      if (!s.started) {
        s.started = true;
        s.lastFrame = now;
        s.lastUpdate = now;
      }
      const frameTime = now - s.lastFrame;
      s.lastFrame = now;

      const jsStart = performance.now();
      draw();
      const jsTime = performance.now() - jsStart;

      s.frames++;
      s.jsSum += jsTime;
      if (frameTime > s.maxFrame) s.maxFrame = frameTime;
      if (frameTime > 25) s.stalls++;

      if (now - s.lastUpdate >= 250) {
        const fps = (s.frames * 1000) / (now - s.lastUpdate);
        if (stats.fpsRef.current) stats.fpsRef.current.textContent = String(Math.round(fps));
        if (stats.stallRef.current) stats.stallRef.current.textContent = String(s.stalls);
        if (stats.maxRef.current) stats.maxRef.current.textContent = `${Math.round(s.maxFrame)}ms`;
        if (stats.jsRef.current) stats.jsRef.current.textContent = `~${(s.jsSum / Math.max(1, s.frames)).toFixed(1)}ms`;
        if (stats.chunkRef.current) stats.chunkRef.current.textContent = String(lastChunksDrawn.current);
        s.frames = 0;
        s.jsSum = 0;
        s.maxFrame = 0;
        s.stalls = 0;
        s.lastUpdate = now;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
}
