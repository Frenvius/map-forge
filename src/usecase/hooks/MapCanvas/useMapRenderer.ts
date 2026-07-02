import React from 'react';

import { isZoneTool } from '~/domain/tools';
import { Point } from '~/lib/generator/hunt';
import { visibleZoneBits } from '~/domain/zones';
import { slotUV, GLRenderer } from '~/usecase/glRenderer';
import { MapCanvasInputs } from '~/components/MapCanvas/types';
import { floorShift, visibleFloorRange } from '~/usecase/floors';
import { SpawnArea, CreaturePlacement } from '~/domain/creature';
import { Position, ChunkTiles, PreviewTile } from '~/domain/map';
import { isCountStack, getSpriteIndex, stackSpriteIndex } from '~/domain/tibia';
import { packChunkKey, previewPaint, fetchMapChunks, fetchChunkTooltips } from '~/adapter/map';
import { TooltipBox, layoutTooltip, drawTooltipBox, buildTooltipFields, resolveTooltipTheme } from '~/usecase/tooltipOverlay';
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
import { ChunkTooltipsCache } from './useChunkTooltips';
import {
  spawnFactor,
  spawnTileKey,
  buildThingGhost,
  appendCreatures,
  buildCreatureGhost,
  buildSelectionGhost,
  buildClipboardGhost,
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
  overlayRef: React.RefObject<HTMLCanvasElement>;
  gl: React.MutableRefObject<GLRenderer | null>;
  camera: MapCamera;
  inputs: React.MutableRefObject<MapCanvasInputs>;
  atlas: SpriteAtlas;
  tiles: ChunkTilesCache;
  tooltips: ChunkTooltipsCache;
  meshes: ChunkMeshCache;
  selection: Selection;
  scene: MapScene;
  stats: StatRefs;
}

const TOOLTIP_MIN_ZOOM = 0.5;
const GOTO_HIGHLIGHT_MS = 1600;

export function useMapRenderer(deps: RendererDeps) {
  const { canvasRef, overlayRef, gl, camera, inputs, atlas, tiles, tooltips, meshes, selection, scene, stats } = deps;
  const { frameTick, lastChunksDrawn } = scene;
  const prevPreviewKeys = React.useRef<string[]>([]);
  const prevSprPath = React.useRef('');
  const overlayHasContent = React.useRef(false);
  const doodadGhost = React.useRef<PreviewTile[] | null>(null);
  const doodadGhostKey = React.useRef<string | null>(null);
  const doodadGhostSeq = React.useRef(0);
  const prevHlKey = React.useRef<string | null>(null);

  function updateDoodadGhost(hover: Position | null, floorZ: number) {
    const brush = inputs.current.activeBrush;
    const active =
      inputs.current.activeTool === 'brush' &&
      brush?.kind === 'doodad' &&
      brush.serverId != null &&
      !scene.ctrlDown.current &&
      !selection.box.current &&
      hover != null &&
      hover.z === floorZ;
    if (!active || !brush || brush.serverId == null || !hover) {
      doodadGhost.current = null;
      doodadGhostKey.current = null;
      return;
    }
    const key = `${floorZ},${brush.name},${hover.x},${hover.y}`;
    if (key === doodadGhostKey.current) return;
    doodadGhostKey.current = key;
    const seq = ++doodadGhostSeq.current;
    previewPaint(inputs.current.map.id, floorZ, [hover.x], [hover.y], brush.serverId, false, true, brush.name, true)
      .then((tiles) => {
        if (seq === doodadGhostSeq.current) doodadGhost.current = tiles;
      })
      .catch(() => void 0);
  }

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

  function flushTooltipRequests() {
    if (inputs.current.paused) return;
    if (tooltips.pending.current.size === 0) return;
    const byZ = new Map<number, number[]>();
    for (const k of tooltips.pending.current) {
      const [z, cx, cy] = k.split(',').map(Number);
      let arr = byZ.get(z);
      if (!arr) {
        arr = [];
        byZ.set(z, arr);
      }
      arr.push(packChunkKey(cx, cy));
    }
    tooltips.pending.current.clear();
    for (const [z, keys] of byZ) {
      fetchChunkTooltips(inputs.current.map.id, z, keys)
        .then((res) => {
          for (const packed of keys) {
            const cx = packed >>> 16;
            const cy = packed & 0xffff;
            tooltips.store(`${z},${cx},${cy}`, res.get(`${cx},${cy}`) ?? [], frameTick.current);
          }
        })
        .catch((err) => console.error('Failed to fetch tooltips', err));
    }
  }

  function drawTooltips(camX: number, camY: number, zoom: number, vw: number, vh: number) {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    const enabled = inputs.current.showTooltips && zoom > TOOLTIP_MIN_ZOOM;
    if (!enabled) {
      if (overlayHasContent.current) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        overlayHasContent.current = false;
      }
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(vw * dpr);
    const bh = Math.round(vh * dpr);
    if (overlay.width !== bw || overlay.height !== bh) {
      overlay.width = bw;
      overlay.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    overlayHasContent.current = true;

    const z = inputs.current.floorZ;
    const types = inputs.current.tooltipTypes;
    const theme = resolveTooltipTheme();
    const { minX, minY, maxX, maxY } = inputs.current.map.bounds;
    const minCx = Math.floor(minX / CHUNK);
    const minCy = Math.floor(minY / CHUNK);
    const maxCx = Math.floor(maxX / CHUNK);
    const maxCy = Math.floor(maxY / CHUNK);
    const startCx = Math.max(minCx, Math.floor(camX / CHUNK_WORLD));
    const endCx = Math.min(maxCx, Math.floor((camX + vw / zoom) / CHUNK_WORLD));
    const startCy = Math.max(minCy, Math.floor(camY / CHUNK_WORLD));
    const endCy = Math.min(maxCy, Math.floor((camY + vh / zoom) / CHUNK_WORLD));

    const hover = scene.hoveredTile.current;
    const mouse = scene.mouseScreen.current;
    const boxes: { box: TooltipBox; tx: number; ty: number }[] = [];

    for (let cy = startCy; cy <= endCy; cy++) {
      for (let cx = startCx; cx <= endCx; cx++) {
        const tt = tooltips.get(cx, cy, z, frameTick.current);
        if (tt === undefined) {
          tooltips.request(cx, cy, z);
          continue;
        }
        if (tt === null || tt.length === 0) continue;
        for (const t of tt) {
          const sx = (t.x * TILE + TILE / 2 - camX) * zoom;
          const sy = (t.y * TILE - camY) * zoom;
          if (sx < -300 || sx > vw + 300 || sy < -300 || sy > vh + 300) continue;
          const fields = buildTooltipFields(t, types);
          const box = layoutTooltip(ctx, sx - (TILE / 2) * zoom, sy, fields);
          if (box) boxes.push({ box, tx: t.x, ty: t.y });
        }
      }
    }

    const inBox = (b: TooltipBox) =>
      mouse != null && mouse.x >= b.x && mouse.x <= b.x + b.width && mouse.y >= b.y && mouse.y <= b.y + b.height;

    let activeIndex = -1;
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (inBox(boxes[i].box)) {
        activeIndex = i;
        break;
      }
    }
    if (activeIndex < 0 && hover) {
      activeIndex = boxes.findIndex((e) => e.tx === hover.x && e.ty === hover.y);
    }

    boxes.forEach((e, i) => {
      if (i !== activeIndex) drawTooltipBox(ctx, e.box, theme);
    });
    if (activeIndex >= 0) drawTooltipBox(ctx, boxes[activeIndex].box, theme);
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

  function drawHuntPreview(camX: number, camY: number, zoom: number, vw: number, vh: number) {
    const canvas = scene.huntCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(vw * dpr);
    const bh = Math.round(vh * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    const floorZ = inputs.current.floorZ;

    const imp = scene.importGhost.current;
    const hoverImp = scene.hoveredTile.current;
    if (imp && hoverImp) {
      const rx = (hoverImp.x * TILE - camX) * zoom;
      const ry = (hoverImp.y * TILE - camY) * zoom;
      const rw = imp.width * TILE * zoom;
      const rh = imp.height * TILE * zoom;
      ctx.save();
      if (imp.preview) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.6;
        ctx.drawImage(imp.preview, rx, ry, rw, rh);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.setLineDash([8, 4]);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    const drag = scene.huntAreaDrag.current;
    const area = drag
      ? {
          minX: Math.min(drag.start.x, drag.cur.x),
          minY: Math.min(drag.start.y, drag.cur.y),
          maxX: Math.max(drag.start.x, drag.cur.x),
          maxY: Math.max(drag.start.y, drag.cur.y),
          z: drag.start.z
        }
      : scene.huntArea.current;
    if (area && area.z === floorZ) {
      const rx = (area.minX * TILE - camX) * zoom;
      const ry = (area.minY * TILE - camY) * zoom;
      const rw = (area.maxX - area.minX + 1) * TILE * zoom;
      const rh = (area.maxY - area.minY + 1) * TILE * zoom;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    const route = scene.huntRoute.current;
    if (!route || route.nodes.length === 0 || scene.huntRouteZ.current !== floorZ) return;

    const sx = (p: Point) => (p.x * TILE + TILE / 2 - camX) * zoom;
    const sy = (p: Point) => (p.y * TILE + TILE / 2 - camY) * zoom;

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const path of route.paths) {
      if (path.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(sx(path[0]), sy(path[0]));
      for (let i = 1; i < path.length; i++) ctx.lineTo(sx(path[i]), sy(path[i]));
      ctx.stroke();
    }

    const r = Math.max(4, Math.min(10, TILE * zoom * 0.28));
    const selected = scene.huntSelected.current;
    const view = inputs.current.huntView;
    if (view.show && selected != null && selected < route.nodes.length && view.w > 0 && view.h > 0) {
      const node = route.nodes[selected];
      const vx = (node.x - Math.floor(view.w / 2)) * TILE;
      const vy = (node.y - Math.floor(view.h / 2)) * TILE;
      ctx.save();
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect((vx - camX) * zoom, (vy - camY) * zoom, view.w * TILE * zoom, view.h * TILE * zoom);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.06)';
      ctx.fillRect((vx - camX) * zoom, (vy - camY) * zoom, view.w * TILE * zoom, view.h * TILE * zoom);
      ctx.restore();
    }
    ctx.font = `${Math.round(r * 1.2)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < route.nodes.length; i++) {
      const px = sx(route.nodes[i]);
      const py = sy(route.nodes[i]);
      const isSel = i === selected;
      if (isSel) {
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? 'rgba(250, 204, 21, 0.95)' : 'rgba(14, 165, 233, 0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = isSel ? '#1c1917' : '#f0f9ff';
      ctx.fillText(String(i + 1), px, py);
    }
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
    const { items, outfits, spawns, showSpawns, showCreatures, showHouses, showBlocking, zoneVisibility } = inputs.current;
    const selHouse = inputs.current.activeHouseId;
    let exitMap: Map<number, number> | null = null;
    if (showHouses) {
      exitMap = new Map<number, number>();
      for (const h of inputs.current.houses?.list ?? []) {
        if (h.entryZ === z && (h.entryX !== 0 || h.entryY !== 0)) {
          exitMap.set(h.entryX * 65536 + h.entryY, h.id);
        }
      }
    }
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
        const houseBit = showHouses && ct.houseIds[i] ? (ct.houseIds[i] === selHouse ? 1024 : 256) : 0;
        const exitHouse = exitMap?.get(tx * 65536 + ty);
        const exitBit = exitHouse != null ? (exitHouse === selHouse ? 1024 : 512) : 0;
        let blockBit = 0;
        if (showBlocking) {
          for (let ii = ct.itemOffset[i]; ii < end; ii++) {
            const t = items.get(ct.clientIds[ii]);
            if (t && t.isUnpassable) {
              blockBit = 2048;
              break;
            }
          }
        }
        const hl = scene.gotoHighlight.current;
        const hlBit = hl && hl.z === z && hl.x === tx && hl.y === ty ? 4096 : 0;
        const zoneBits = (ct.flags[i] ? visibleZoneBits(ct.flags[i], zoneVisibility) : 0) | houseBit | exitBit | blockBit | hlBit;
        let drawElevation = 0;
        for (let ii = ct.itemOffset[i]; ii < end; ii++) {
          const thing = items.get(ct.clientIds[ii]);
          if (!thing || thing.spriteIndex.length === 0) continue;
          const px = thing.hangable ? 0 : thing.patternX > 0 ? tx % thing.patternX : 0;
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
            const cSel =
              (!!sc && sc.z === z && sc.x === tx && sc.y === ty) || selection.creatures.current.has(`${z},${tx},${ty}`);
            if (!appendCreatures(inst, here, outfits, atlas, frameTick.current, missing, cSel)) complete = false;
          }
        }

        if (markerThing && spawnCenters.has(spawnTileKey(tx, ty))) {
          const selSpawn = selection.spawn.current;
          const markerTint =
            (selSpawn && selSpawn.z === z && selSpawn.x === tx && selSpawn.y === ty) ||
            selection.spawns.current.has(`${z},${tx},${ty}`)
              ? 1
              : 0;
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
      const cSel =
        (!!sc && arr.length > 0 && sc.z === z && sc.x === arr[0].x && sc.y === arr[0].y) ||
        (arr.length > 0 && selection.creatures.current.has(`${z},${arr[0].x},${arr[0].y}`));
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
        const px = thing.hangable ? 0 : thing.patternX > 0 ? tx % thing.patternX : 0;
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
    const ctrlErase = scene.ctrlDown.current;
    const showBrush = tool === 'brush' && brush != null && brush.serverId != null && !ctrlErase;
    const showEraser = tool === 'eraser' || (tool === 'brush' && brush != null && brush.serverId != null && ctrlErase);
    const showZone = isZoneTool(tool);
    const showHouse = tool === 'house' && inputs.current.activeHouseId != null;
    const showBorderize = tool === 'borderize';
    const borderizeRemove = showBorderize && ctrlErase;

    if (selection.box.current || !tile || (!showBrush && !showEraser && !showZone && !showHouse && !showBorderize)) {
      ghost.style.display = 'none';
      outline.style.display = 'none';
      return;
    }

    if (showBrush && brush?.kind === 'doodad') {
      ghost.style.display = 'none';
      outline.style.display = 'none';
      return;
    }

    if (showEraser || showZone || showHouse || showBorderize) {
      const s = TILE * zoom;
      ghost.style.display = 'none';
      outline.style.display = 'block';
      outline.style.width = `${s}px`;
      outline.style.height = `${s}px`;
      outline.style.transform = `translate(${(tile.x * TILE - camX) * zoom}px, ${(tile.y * TILE - camY) * zoom}px)`;
      if (showBorderize) {
        outline.style.borderColor = borderizeRemove ? 'rgb(248, 113, 113)' : 'rgb(52, 211, 153)';
        outline.style.backgroundColor = borderizeRemove ? 'rgba(239, 68, 68, 0.18)' : 'rgba(16, 185, 129, 0.18)';
        return;
      }
      outline.style.borderColor = showEraser ? 'rgb(248, 113, 113)' : showHouse ? 'rgb(96, 165, 250)' : 'rgb(125, 211, 252)';
      outline.style.backgroundColor = showEraser
        ? 'rgba(239, 68, 68, 0.18)'
        : showHouse
          ? 'rgba(59, 130, 246, 0.22)'
          : 'rgba(56, 189, 248, 0.14)';
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

  function updateHuntAreaBox(camX: number, camY: number, zoom: number) {
    const el = scene.huntAreaBoxRef.current;
    if (!el) return;
    const area = scene.huntArea.current;
    const active = inputs.current.huntEditing && !inputs.current.huntAreaSelecting && !scene.huntAreaDrag.current;
    if (!area || !active || area.z !== inputs.current.floorZ) {
      el.style.display = 'none';
      return;
    }
    const x0 = area.minX * TILE;
    const y0 = area.minY * TILE;
    el.style.display = 'block';
    el.style.width = `${(area.maxX - area.minX + 1) * TILE * zoom}px`;
    el.style.height = `${(area.maxY - area.minY + 1) * TILE * zoom}px`;
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
    } else if (tool === 'borderize') {
      ghost.style.display = 'block';
      ghost.style.transform = transform;
      ghost.style.width = `${w}px`;
      ghost.style.height = `${h}px`;
      ghost.style.opacity = '1';
      ghost.style.backgroundImage = 'none';
      ghost.style.backgroundColor = bs.additive ? 'rgba(239, 68, 68, 0.28)' : 'rgba(16, 185, 129, 0.26)';
    } else {
      ghost.style.display = 'none';
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    const renderer = gl.current;
    if (!canvas || !renderer) return;

    const { sprPath, transparency, floorZ } = inputs.current;
    if (sprPath !== prevSprPath.current) {
      if (prevSprPath.current) {
        atlas.clear();
        meshes.clear();
      }
      prevSprPath.current = sprPath;
    }
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

    const gh = scene.gotoHighlight.current;
    if (gh && performance.now() - gh.start > GOTO_HIGHLIGHT_MS) scene.gotoHighlight.current = null;
    const hlNow = scene.gotoHighlight.current;
    const hlKey = hlNow ? `${hlNow.z},${hlNow.x},${hlNow.y}` : null;
    if (hlKey !== prevHlKey.current) {
      for (const k of [prevHlKey.current, hlKey]) {
        if (!k) continue;
        const [hz, hx, hy] = k.split(',').map(Number);
        meshes.forget(`${hz},${Math.floor(hx / CHUNK)},${Math.floor(hy / CHUNK)}`);
      }
      prevHlKey.current = hlKey;
    }
    if (hlNow && hlNow.z === floorZ) {
      const t = (performance.now() - hlNow.start) / GOTO_HIGHLIGHT_MS;
      renderer.setHighlight(0.35 + 0.45 * Math.abs(Math.cos(t * Math.PI * 3)) * (1 - t));
    }

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
      if (dimLowerFloors && inputs.current.showShade && z === endZ) renderer.dimViewport(LOWER_FLOOR_DIM);

      const shift = (z - endZ) * TILE * floorShift();
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
    const selEntries = selection.entries.current;
    if (selEntries.size > 0) {
      const voidTiles: number[] = [];
      for (const t of selEntries.values()) {
        if (t.z !== floorZ) continue;
        const cx = Math.floor(t.x / CHUNK);
        const cy = Math.floor(t.y / CHUNK);
        const ct = tiles.data.current.get(`${floorZ},${cx},${cy}`) as ChunkTiles | null | undefined;
        let occupied = false;
        if (ct) {
          for (let i = 0; i < ct.tileX.length; i++) {
            if (ct.tileX[i] === t.x && ct.tileY[i] === t.y) {
              occupied = ct.itemOffset[i + 1] > ct.itemOffset[i];
              break;
            }
          }
        }
        if (!occupied) voidTiles.push(t.x * TILE, t.y * TILE);
      }
      if (voidTiles.length > 0) {
        renderer.drawSelectionTiles(new Float32Array(voidTiles), camX, camY, scale, [0.231, 0.51, 0.965, 0.33]);
      }
    }

    const md = scene.moveDrag.current;
    if (md && md.active && scene.moveDest.current) {
      const ctx = { items: inputs.current.items, tiles, atlas };
      const ghost = buildSelectionGhost(
        ctx,
        frameTick.current,
        floorZ,
        selection.entries.current.values(),
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

    const hover = scene.hoveredTile.current;
    const pasteSrc = scene.pasteGhost.current;
    if (pasteSrc && hover) {
      const ctx = { items: inputs.current.items, tiles, atlas };
      const ghost = buildClipboardGhost(ctx, frameTick.current, floorZ, pasteSrc, hover.x, hover.y, hover.z, missing);
      if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    const placing = inputs.current.placingWaypoint;
    if (placing && hover && hover.z === floorZ && inputs.current.waypointMarkerClientId) {
      const markerThing = inputs.current.items.get(inputs.current.waypointMarkerClientId);
      const ghost = markerThing ? buildThingGhost(markerThing, hover.x, hover.y, atlas, frameTick.current, missing) : null;
      if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    const placingBrush = inputs.current.activeBrush;
    if (
      inputs.current.activeTool === 'brush' &&
      placingBrush?.kind === 'creature' &&
      placingBrush.lookType != null &&
      !scene.ctrlDown.current &&
      !selection.box.current &&
      hover &&
      hover.z === floorZ
    ) {
      const ghost = buildCreatureGhost(
        placingBrush.lookType,
        hover.x,
        hover.y,
        floorZ,
        inputs.current.outfits,
        atlas,
        frameTick.current,
        missing,
        {
          head: placingBrush.head ?? 0,
          body: placingBrush.body ?? 0,
          legs: placingBrush.legs ?? 0,
          feet: placingBrush.feet ?? 0
        }
      );
      if (ghost) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    const previewTiles = scene.boxGhostTiles.current;
    if (previewTiles && previewTiles.length > 0 && selection.box.current) {
      const ghost = buildPreviewGhost(previewTiles, missing);
      if (ghost.length > 0) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    updateDoodadGhost(hover, floorZ);
    if (doodadGhost.current && doodadGhost.current.length > 0) {
      const ghost = buildPreviewGhost(doodadGhost.current, missing);
      if (ghost.length > 0) renderer.drawGhost(ghost, camX, camY, scale, 0.6);
    }

    const hSession = scene.huntSession.current;
    const hMonsters = inputs.current.huntMonsters;
    if (inputs.current.huntEditing && hSession && hMonsters.length > 0 && scene.huntRouteZ.current === floorZ) {
      const placements: CreaturePlacement[] = hSession.monsterTiles.map((t, i) => {
        const m = hMonsters[i % hMonsters.length];
        return {
          x: t.x + hSession.minX,
          y: t.y + hSession.minY,
          z: floorZ,
          name: m.name,
          isNpc: false,
          lookType: m.lookType,
          head: m.head,
          body: m.body,
          legs: m.legs,
          feet: m.feet,
          spawntime: 0,
          direction: 2
        };
      });
      const inst: number[] = [];
      appendCreatures(inst, placements, inputs.current.outfits, atlas, frameTick.current, missing);
      if (inst.length > 0) renderer.drawGhost(new Float32Array(inst), camX, camY, scale, 0.55);
    }

    renderer.endFrame();
    lastChunksDrawn.current = drawn;

    updateGhost(camX, camY, zoom);
    updateSelectionBox(camX, camY, zoom);
    updateSpawnBox(camX, camY, zoom);
    updateHuntAreaBox(camX, camY, zoom);
    updateHouseExits(camX, camY, zoom);
    drawTooltips(camX, camY, zoom, vw, vh);
    drawHuntPreview(camX, camY, zoom, vw, vh);

    flushTileRequests();
    flushTooltipRequests();
    atlas.loadMissing(sprPath, missing, transparency);

    atlas.evict(frameTick.current);
    tiles.evict(frameTick.current);
    tooltips.evict(frameTick.current);
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
