import React from 'react';

import { MapHouses } from '~/domain/house';
import { isZoneTool } from '~/domain/tools';
import { ZONE_TOOL_FLAG } from '~/domain/zones';
import { loadSprites } from '~/adapter/sprites';
import { mapClientIds } from '~/adapter/assets';
import { generateApply } from '~/adapter/biomes';
import { brushForItem } from '~/adapter/palette';
import { selectionFloorBoxes } from '~/usecase/floors';
import { readWalkableMask } from '~/usecase/hunt/mask';
import { buildItemPreview } from '~/usecase/itemPreview';
import { planGeneration } from '~/lib/generator/generate';
import { formatPosition } from '~/usecase/positionFormat';
import { Position, ChunkTiles, PreviewTile } from '~/domain/map';
import { MountainOptions, ResolvedMountain } from '~/domain/mountain';
import { GenPlan, ResolvedBiome, GenerateOptions } from '~/domain/biome';
import { MapSpawns, emptyMapSpawns, buildMapSpawns } from '~/domain/creature';
import { waypointAt, MapWaypoints, emptyMapWaypoints } from '~/domain/waypoint';
import { HuntMeta, HuntPreviewParams } from '~/usecase/context/ToolContext/types';
import { TILE, CHUNK, MOVE_THRESHOLD_SQ } from '~/components/MapCanvas/constants';
import { buildRoute, connectRoute, reachableFrom } from '~/lib/generator/huntRoute';
import { PEN_CURSOR, PEN_MOVE_CURSOR, PEN_CONVERT_CURSOR } from '~/usecase/penCursors';
import { PenHot, PenPoint, PenAnchor, pathTiles, sampleBezierPath } from '~/lib/pen/path';
import { planMountain, mountainMargin, mountainHeights } from '~/lib/generator/generateMountain';
import { coverageMask, spreadPoints, scatterPoints, nearestWalkable } from '~/lib/generator/hunt';
import { addWaypoint, moveWaypoint, removeWaypoint, renameWaypoint, nextWaypointName } from '~/usecase/waypointEdits';
import {
  HoverInfo,
  HoverItem,
  SpawnForm,
  SelectedItem,
  CreatureForm,
  WaypointForm,
  MapCanvasInputs,
  ContextMenuState
} from '~/components/MapCanvas/types';
import {
  moveSpawn,
  placeSpawn,
  updateSpawn,
  setSpawnSize,
  moveCreature,
  placeCreature,
  removeSpawnAt,
  updateCreature,
  removeCreatureAt
} from '~/usecase/spawnEdits';
import {
  undoEdit,
  redoEdit,
  setHouse,
  eraseArea,
  paintZone,
  EditResult,
  eraseBrush,
  deleteItem,
  paintTiles,
  PaintResult,
  previewPaint,
  packChunkKey,
  moveSelection,
  copySelection,
  borderizeBrush,
  fetchMapChunks,
  pasteSelection,
  pushUndoSidecar,
  deleteSelection,
  attachUndoSidecar
} from '~/adapter/map';

import { MapScene } from './useMapScene';
import { MapCamera } from './useMapCamera';
import { SpriteAtlas } from './useSpriteAtlas';
import { ChunkTilesCache } from './useChunkTiles';
import { ChunkMeshCache } from './useChunkMeshes';
import { ClipboardGhostTile, buildSelectionGhost } from './meshBuilder';
import { Selection, BoxSelection, SelectionSnapshot } from './useSelection';

interface Sidecar {
  sel?: SelectionSnapshot;
  spawns?: MapSpawns;
  waypoints?: MapWaypoints;
  houses?: MapHouses;
  pen?: PenAnchor[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const MOUNTAIN_SCATTER_MARGIN = 1;

export interface InteractionDeps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  camera: MapCamera;
  inputs: React.MutableRefObject<MapCanvasInputs>;
  atlas: SpriteAtlas;
  tiles: ChunkTilesCache;
  meshes: ChunkMeshCache;
  selection: Selection;
  scene: MapScene;
}

const sharedClipboardCount = { current: 0 };
const sharedClipboardGhost = { current: null as ClipboardGhostTile[] | null };

export function useMapInteraction(deps: InteractionDeps) {
  const { canvasRef, camera, inputs, atlas, tiles, meshes, selection, scene } = deps;

  const [moving, setMoving] = React.useState(false);
  const [boxing, setBoxing] = React.useState(false);
  const [spaceHeld, setSpaceHeld] = React.useState(false);
  const spaceRef = React.useRef(false);
  spaceRef.current = spaceHeld;
  const [menu, setMenu] = React.useState<ContextMenuState | null>(null);
  const [gotoForm, setGotoForm] = React.useState<Position | null>(null);
  const [spawnForm, setSpawnForm] = React.useState<SpawnForm | null>(null);
  const [creatureForm, setCreatureForm] = React.useState<CreatureForm | null>(null);
  const [waypointForm, setWaypointForm] = React.useState<WaypointForm | null>(null);
  const clipboardCount = sharedClipboardCount;
  const clipboardGhostSource = sharedClipboardGhost;
  const modalOpen = React.useRef(false);
  modalOpen.current = spawnForm !== null || creatureForm !== null || waypointForm !== null;

  function pushCompound(
    selBefore: SelectionSnapshot,
    opts: { hasItem?: boolean; spawnBefore?: MapSpawns | null; spawnAfter?: MapSpawns | null }
  ) {
    const before: Sidecar = { sel: selBefore };
    const after: Sidecar = { sel: selection.snapshot() };
    if (opts.spawnBefore) before.spawns = opts.spawnBefore;
    if (opts.spawnAfter) after.spawns = opts.spawnAfter;
    const b = JSON.stringify(before);
    const a = JSON.stringify(after);
    const mapId = inputs.current.map.id;
    if (opts.hasItem) void attachUndoSidecar(mapId, b, a);
    else void pushUndoSidecar(mapId, b, a);
  }

  function editSpawns(next: MapSpawns) {
    const before = inputs.current.spawns ?? emptyMapSpawns();
    inputs.current.onEditSpawns(next);
    void pushUndoSidecar(inputs.current.map.id, JSON.stringify({ spawns: before }), JSON.stringify({ spawns: next }));
  }

  function editWaypoints(next: MapWaypoints) {
    const before = inputs.current.waypoints ?? emptyMapWaypoints();
    inputs.current.onEditWaypoints(next);
    void pushUndoSidecar(inputs.current.map.id, JSON.stringify({ waypoints: before }), JSON.stringify({ waypoints: next }));
  }

  function applySidecar(json: string): boolean {
    if (!json) return false;
    let sc: Sidecar;
    try {
      sc = JSON.parse(json) as Sidecar;
    } catch {
      return false;
    }
    if (sc.spawns) inputs.current.onEditSpawns(sc.spawns);
    if (sc.waypoints) inputs.current.onEditWaypoints(sc.waypoints);
    if (sc.houses) inputs.current.onEditHouses(sc.houses);
    if (sc.sel) selection.restore(sc.sel);
    if (sc.pen !== undefined) {
      penDrag.current = null;
      if (sc.pen.length > 0) {
        penAnchors.current = clonePenAnchors(sc.pen);
        if (inputs.current.activeTool !== 'pen') inputs.current.onToolChange('pen');
        return true;
      }
      penAnchors.current = [];
    }
    return false;
  }

  const tileAt = (e: React.MouseEvent) => camera.tileUnderCursor(e, inputs.current.floorZ);
  const notifyEdit = (z: number) => inputs.current.onEdit?.(z);
  const emit = (message: string) => inputs.current.onStatus?.(message);

  const spawnCenterAt = (pos: Position): boolean => {
    const areas = inputs.current.spawns?.areasByZ.get(pos.z);
    return !!areas && areas.some((a) => a.x === pos.x && a.y === pos.y);
  };

  const creatureAt = (pos: Position): boolean => {
    const key = `${pos.z},${Math.floor(pos.x / CHUNK)},${Math.floor(pos.y / CHUNK)}`;
    const arr = inputs.current.spawns?.byChunk.get(key);
    return !!arr && arr.some((c) => c.x === pos.x && c.y === pos.y);
  };

  const creatureLookAt = (pos: Position): number => {
    const key = `${pos.z},${Math.floor(pos.x / CHUNK)},${Math.floor(pos.y / CHUNK)}`;
    const arr = inputs.current.spawns?.byChunk.get(key);
    return arr?.find((c) => c.x === pos.x && c.y === pos.y)?.lookType ?? 0;
  };

  const spawnRadiusAt = (pos: Position): number => {
    const areas = inputs.current.spawns?.areasByZ.get(pos.z);
    return areas?.find((a) => a.x === pos.x && a.y === pos.y)?.radius ?? 0;
  };

  const waypointHere = (pos: Position): boolean => {
    const wps = inputs.current.waypoints;
    return !!wps && inputs.current.showWaypoints && !!waypointAt(wps, pos.x, pos.y, pos.z);
  };

  function selectByPriority(pos: Position): boolean {
    if (spawnCenterAt(pos)) {
      selection.clear();
      selection.selectSpawn(pos);
      return true;
    }
    if (waypointHere(pos)) {
      selection.clear();
      selection.selectWaypoint(pos);
      return true;
    }
    if (creatureAt(pos)) {
      selection.clear();
      selection.selectCreature(pos);
      return true;
    }
    return false;
  }

  const creatureStroke = React.useRef<MapSpawns | null>(null);

  function applyCreatureAt(pos: Position) {
    const b = inputs.current.activeBrush;
    if (!b || b.kind !== 'creature' || !b.lookType) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    const base = inputs.current.spawns ?? emptyMapSpawns();
    const next = placeCreature(
      base,
      pos,
      {
        name: b.name,
        isNpc: !!b.isNpc,
        lookType: b.lookType,
        head: b.head ?? 0,
        body: b.body ?? 0,
        legs: b.legs ?? 0,
        feet: b.feet ?? 0
      },
      inputs.current.spawnTime,
      inputs.current.spawnRadius,
      inputs.current.autoCreateSpawn
    );
    if (next !== base) inputs.current.onEditSpawns(next);
  }

  function beginCreatureStroke(e: React.MouseEvent) {
    creatureStroke.current = inputs.current.spawns ?? emptyMapSpawns();
    scene.lastPaintKey.current = null;
    applyCreatureAt(tileAt(e));
  }

  function finishCreatureStroke() {
    const before = creatureStroke.current;
    creatureStroke.current = null;
    scene.lastPaintKey.current = null;
    if (!before) return;
    const after = inputs.current.spawns ?? emptyMapSpawns();
    if (before !== after) {
      void pushUndoSidecar(inputs.current.map.id, JSON.stringify({ spawns: before }), JSON.stringify({ spawns: after }));
    }
  }

  const markerEraseStroke = React.useRef<MapSpawns | null>(null);

  function applyMarkerEraseAt(pos: Position) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    const base = inputs.current.spawns ?? emptyMapSpawns();
    let next = base;
    if (inputs.current.eraseMonsters) next = removeCreatureAt(next, pos);
    if (inputs.current.eraseSpawns) next = removeSpawnAt(next, pos);
    if (next !== base) inputs.current.onEditSpawns(next);
  }

  function beginMarkerEraseStroke(e: React.MouseEvent) {
    markerEraseStroke.current = inputs.current.spawns ?? emptyMapSpawns();
    scene.lastPaintKey.current = null;
    applyMarkerEraseAt(tileAt(e));
  }

  function finishMarkerEraseStroke() {
    const before = markerEraseStroke.current;
    markerEraseStroke.current = null;
    scene.lastPaintKey.current = null;
    if (!before) return;
    const after = inputs.current.spawns ?? emptyMapSpawns();
    if (before !== after) {
      void pushUndoSidecar(inputs.current.map.id, JSON.stringify({ spawns: before }), JSON.stringify({ spawns: after }));
    }
  }

  function beginMarkerDrag(e: React.MouseEvent, pos: Position) {
    const kind = selection.spawn.current ? 'spawn' : selection.waypoint.current ? 'waypoint' : 'creature';
    const lookType = kind === 'creature' ? creatureLookAt(pos) : 0;
    const radius = kind === 'spawn' ? spawnRadiusAt(pos) : 0;
    scene.markerDrag.current = { kind, from: pos, lookType, radius, startX: e.clientX, startY: e.clientY, active: false };
    scene.markerDest.current = pos;
    const move = (ev: MouseEvent) => {
      const md = scene.markerDrag.current;
      if (!md) return;
      if (!md.active) {
        const dx = ev.clientX - md.startX;
        const dy = ev.clientY - md.startY;
        if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
          md.active = true;
          setMoving(true);
        }
      }
      if (md.active) scene.markerDest.current = tileFromClient(ev.clientX, ev.clientY);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      finishMarkerMove();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function finishMarkerMove() {
    const md = scene.markerDrag.current;
    const dest = scene.markerDest.current;
    scene.markerDrag.current = null;
    scene.markerDest.current = null;
    if (!md) return;
    setMoving(false);
    if (!md.active || !dest || (dest.x === md.from.x && dest.y === md.from.y)) return;
    if (md.kind === 'waypoint') {
      const wps = inputs.current.waypoints ?? emptyMapWaypoints();
      const wp = waypointAt(wps, md.from.x, md.from.y, md.from.z);
      if (wp) {
        editWaypoints(moveWaypoint(wps, wp.name, dest));
        selection.selectWaypoint(dest);
      }
      return;
    }
    const selBefore = selection.snapshot();
    const base = inputs.current.spawns ?? emptyMapSpawns();
    const model = md.kind === 'creature' ? moveCreature(base, md.from, dest) : moveSpawn(base, md.from, dest);
    inputs.current.onEditSpawns(model);
    if (md.kind === 'creature') selection.selectCreature(dest);
    else selection.selectSpawn(dest);
    pushCompound(selBefore, { hasItem: false, spawnBefore: base, spawnAfter: model });
  }

  function tileFromClient(clientX: number, clientY: number): Position {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const z = camera.zoomRef.current;
    const wx = camera.ref.current.x + (clientX - rect.left) / z;
    const wy = camera.ref.current.y + (clientY - rect.top) / z;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE), z: inputs.current.floorZ };
  }

  function beginSpawnResize(e: React.MouseEvent, handle: string) {
    e.preventDefault();
    e.stopPropagation();
    if (modalOpen.current) return;
    const center0 = selection.spawn.current;
    if (!center0) return;
    setMoving(true);
    const r0 = spawnRadiusAt(center0);
    const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
    const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
    const ax = sx > 0 ? center0.x - r0 : sx < 0 ? center0.x + r0 : center0.x;
    const ay = sy > 0 ? center0.y - r0 : sy < 0 ? center0.y + r0 : center0.y;
    scene.spawnResize.current = { center: center0, radius: r0 };

    const move = (ev: MouseEvent) => {
      const t = tileFromClient(ev.clientX, ev.clientY);
      const dx = sx !== 0 ? Math.abs(t.x - ax) : 0;
      const dy = sy !== 0 ? Math.abs(t.y - ay) : 0;
      const r = Math.max(1, Math.round(Math.max(dx, dy) / 2));
      const cx = sx > 0 ? ax + r : sx < 0 ? ax - r : center0.x;
      const cy = sy > 0 ? ay + r : sy < 0 ? ay - r : center0.y;
      scene.spawnResize.current = { center: { x: cx, y: cy, z: center0.z }, radius: r };
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const final = scene.spawnResize.current;
      scene.spawnResize.current = null;
      setMoving(false);
      if (!final) return;
      const moved = final.center.x !== center0.x || final.center.y !== center0.y;
      if (!moved && final.radius === r0) return;
      let base = inputs.current.spawns ?? emptyMapSpawns();
      if (moved) base = moveSpawn(base, center0, final.center);
      base = setSpawnSize(base, final.center, final.radius);
      editSpawns(base);
      selection.selectSpawn(final.center);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function beginHuntAreaResize(e: React.MouseEvent, handle: string) {
    e.preventDefault();
    e.stopPropagation();
    if (modalOpen.current) return;
    const area0 = scene.huntArea.current;
    if (!area0) return;
    const hasW = handle.includes('w');
    const hasE = handle.includes('e');
    const hasN = handle.includes('n');
    const hasS = handle.includes('s');
    const move = (ev: MouseEvent) => {
      const t = tileFromClient(ev.clientX, ev.clientY);
      scene.huntArea.current = {
        minX: hasW ? Math.min(t.x, area0.maxX) : area0.minX,
        maxX: hasE ? Math.max(t.x, area0.minX) : area0.maxX,
        minY: hasN ? Math.min(t.y, area0.maxY) : area0.minY,
        maxY: hasS ? Math.max(t.y, area0.minY) : area0.maxY,
        z: area0.z
      };
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const final = scene.huntArea.current;
      if (!final) return;
      inputs.current.onHuntArea(final);
      const changed =
        final.minX !== area0.minX || final.minY !== area0.minY || final.maxX !== area0.maxX || final.maxY !== area0.maxY;
      if (changed) {
        scene.huntRoute.current = null;
        scene.huntSession.current = null;
        inputs.current.onHuntMeta(null);
        emit(`Hunt area: ${final.maxX - final.minX + 1} x ${final.maxY - final.minY + 1}`);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function openSpawnProperties(center: Position) {
    const base = inputs.current.spawns;
    const area = base?.areasByZ.get(center.z)?.find((a) => a.x === center.x && a.y === center.y);
    if (!area) return;
    const member = base?.placements.find(
      (p) => p.z === center.z && Math.max(Math.abs(p.x - center.x), Math.abs(p.y - center.y)) <= area.radius
    );
    setSpawnForm({ x: center.x, y: center.y, z: center.z, radius: area.radius, spawntime: member?.spawntime ?? 60 });
    setMenu(null);
  }

  function submitSpawnForm(form: SpawnForm) {
    const base = inputs.current.spawns ?? emptyMapSpawns();
    editSpawns(updateSpawn(base, { x: form.x, y: form.y, z: form.z }, form.radius, form.spawntime));
    emit('Spawn updated');
    setSpawnForm(null);
  }

  function openCreatureProperties(pos: Position) {
    const key = `${pos.z},${Math.floor(pos.x / CHUNK)},${Math.floor(pos.y / CHUNK)}`;
    const c = inputs.current.spawns?.byChunk.get(key)?.find((p) => p.x === pos.x && p.y === pos.y);
    if (!c) return;
    setCreatureForm({ x: pos.x, y: pos.y, z: pos.z, name: c.name, spawntime: c.spawntime, direction: c.direction });
    setMenu(null);
  }

  function submitCreatureForm(form: CreatureForm) {
    const base = inputs.current.spawns ?? emptyMapSpawns();
    editSpawns(updateCreature(base, { x: form.x, y: form.y, z: form.z }, form.spawntime, form.direction));
    emit('Creature updated');
    setCreatureForm(null);
  }

  function openWaypointProperties(pos: Position) {
    const wp = inputs.current.waypoints ? waypointAt(inputs.current.waypoints, pos.x, pos.y, pos.z) : undefined;
    if (!wp) return;
    setWaypointForm({ x: pos.x, y: pos.y, z: pos.z, name: wp.name });
    setMenu(null);
  }

  function submitWaypointForm(form: WaypointForm) {
    const wps = inputs.current.waypoints ?? emptyMapWaypoints();
    const wp = waypointAt(wps, form.x, form.y, form.z);
    if (wp && form.name.trim() && form.name.trim() !== wp.name) {
      editWaypoints(renameWaypoint(wps, wp.name, form.name));
      emit(`Waypoint renamed to "${form.name.trim()}"`);
    }
    setWaypointForm(null);
  }

  function addWaypointHere(pos: Position) {
    const wps = inputs.current.waypoints ?? emptyMapWaypoints();
    const name = nextWaypointName(wps);
    editWaypoints(addWaypoint(wps, name, pos));
    selection.clear();
    selection.selectWaypoint(pos);
    emit(`Waypoint "${name}" added`);
    setMenu(null);
  }

  const previewKey = React.useRef<string | null>(null);
  const previewSeq = React.useRef(0);
  const previewBusy = React.useRef(false);
  const previewClientIds = React.useRef(new Map<number, number>());
  const PREVIEW_MARGIN = 4;
  const COARSE_PREVIEW_ZOOM = 0.25;

  function brushFootprint(cx: number, cy: number, penWidth: number): { xs: number[]; ys: number[] } {
    const reach = Math.max(0, Math.round(penWidth) - 1);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx, dy) <= reach + 0.001) {
          xs.push(cx + dx);
          ys.push(cy + dy);
        }
      }
    }
    return { xs, ys };
  }

  function paintAt(pos: Position) {
    const brush = inputs.current.activeBrush;
    if (!brush || brush.serverId == null) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    const { xs, ys } = brush.isGround ? brushFootprint(pos.x, pos.y, inputs.current.penWidth) : { xs: [pos.x], ys: [pos.y] };
    paintTiles(
      inputs.current.map.id,
      pos.z,
      xs,
      ys,
      brush.serverId,
      brush.isGround,
      brush.kind === 'doodad',
      inputs.current.automagic,
      brush.kind === 'doodad' || brush.kind === 'ground' ? brush.name : ''
    )
      .then((result) => {
        if (result.touched.length === 0) for (let i = 0; i < xs.length; i++) tiles.queueRefetch(xs[i], ys[i], pos.z);
        else applyPaintResult(result, pos.z);
      })
      .catch((err) => console.error('Failed to paint tile', err));
  }

  function visibleTileRect(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const z = camera.zoomRef.current;
    const cam = camera.ref.current;
    return {
      minX: Math.floor(cam.x / TILE) - PREVIEW_MARGIN,
      minY: Math.floor(cam.y / TILE) - PREVIEW_MARGIN,
      maxX: Math.ceil((cam.x + canvas.clientWidth / z) / TILE) + PREVIEW_MARGIN,
      maxY: Math.ceil((cam.y + canvas.clientHeight / z) / TILE) + PREVIEW_MARGIN
    };
  }

  function boxTiles(bs: BoxSelection, clipToView = false) {
    let minX = Math.min(bs.startTile.x, bs.curTile.x);
    let maxX = Math.max(bs.startTile.x, bs.curTile.x);
    let minY = Math.min(bs.startTile.y, bs.curTile.y);
    let maxY = Math.max(bs.startTile.y, bs.curTile.y);
    const view = clipToView ? visibleTileRect() : null;
    if (view) {
      minX = Math.max(minX, view.minX);
      minY = Math.max(minY, view.minY);
      maxX = Math.min(maxX, view.maxX);
      maxY = Math.min(maxY, view.maxY);
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        xs.push(x);
        ys.push(y);
      }
    }
    return { xs, ys };
  }

  function paintBox(bs: BoxSelection) {
    const brush = inputs.current.activeBrush;
    if (!brush || brush.serverId == null) return;
    const z = bs.startTile.z;
    const { xs, ys } = boxTiles(bs);
    paintTiles(
      inputs.current.map.id,
      z,
      xs,
      ys,
      brush.serverId,
      brush.isGround,
      brush.kind === 'doodad',
      inputs.current.automagic,
      brush.kind === 'doodad' || brush.kind === 'ground' ? brush.name : ''
    )
      .then((result) => applyPaintResult(result, z))
      .catch((err) => {
        clearBoxPreview();
        console.error('Failed to paint box', err);
      });
  }

  type PenDrag =
    | { kind: 'new' | 'move'; index: number }
    | { kind: 'handle'; index: number; handle: 'in' | 'out' }
    | { kind: 'convert'; index: number; moved: boolean };

  const penAnchors = React.useRef<PenAnchor[]>([]);
  const penDrag = React.useRef<PenDrag | null>(null);
  const penHover = React.useRef<PenPoint | null>(null);
  const penHot = React.useRef<PenHot | null>(null);
  const [penCursor, setPenCursor] = React.useState(PEN_CURSOR);
  const penCursorVal = React.useRef(PEN_CURSOR);
  const setPenCursorIfChanged = (c: string) => {
    if (penCursorVal.current === c) return;
    penCursorVal.current = c;
    setPenCursor(c);
  };

  const clonePenAnchors = (a: PenAnchor[]): PenAnchor[] =>
    a.map((an) => ({ p: { ...an.p }, hIn: { ...an.hIn }, hOut: { ...an.hOut } }));

  const PEN_HIT_PX = 9;

  function penCursorFor(ctrl: boolean, alt: boolean): string {
    if (ctrl) return PEN_MOVE_CURSOR;
    if (alt) return PEN_CONVERT_CURSOR;
    return PEN_CURSOR;
  }

  function penHotFor(ctrl: boolean, alt: boolean): PenHot | null {
    const w = penHover.current;
    if (!w || (!ctrl && !alt)) return null;
    const h = penHitTest(w, ctrl && !alt);
    if (!h) return null;
    if (h.kind === 'handle') return { type: 'handle', index: h.index, handle: h.handle };
    return { type: 'anchor', index: h.index };
  }

  function penHitTest(w: PenPoint, anchorsOnly: boolean): PenDrag | null {
    const tol = PEN_HIT_PX / camera.zoomRef.current;
    const near = (ax: number, ay: number) => Math.hypot(w.x - ax, w.y - ay) <= tol;
    const anchors = penAnchors.current;
    if (!anchorsOnly) {
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        if ((a.hOut.x !== 0 || a.hOut.y !== 0) && near(a.p.x + a.hOut.x, a.p.y + a.hOut.y))
          return { kind: 'handle', index: i, handle: 'out' };
        if ((a.hIn.x !== 0 || a.hIn.y !== 0) && near(a.p.x + a.hIn.x, a.p.y + a.hIn.y))
          return { kind: 'handle', index: i, handle: 'in' };
      }
    }
    for (let i = 0; i < anchors.length; i++) {
      if (near(anchors[i].p.x, anchors[i].p.y))
        return anchorsOnly ? { kind: 'move', index: i } : { kind: 'convert', index: i, moved: false };
    }
    return null;
  }

  function penDown(e: React.MouseEvent) {
    const w = camera.worldUnderCursor(e);
    if (e.ctrlKey || e.metaKey) {
      penDrag.current = penHitTest(w, true);
      return;
    }
    if (e.altKey) {
      penDrag.current = penHitTest(w, false);
      return;
    }
    penAnchors.current.push({ p: { x: w.x, y: w.y }, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 } });
    penDrag.current = { kind: 'new', index: penAnchors.current.length - 1 };
  }

  function penMove(e: React.MouseEvent) {
    const w = camera.worldUnderCursor(e);
    penHover.current = { x: w.x, y: w.y };
    const drag = penDrag.current;
    if (!drag) {
      const ctrl = e.ctrlKey || e.metaKey;
      setPenCursorIfChanged(penCursorFor(ctrl, e.altKey));
      penHot.current = penHotFor(ctrl, e.altKey);
      return;
    }
    penHot.current = null;
    setPenCursorIfChanged(drag.kind === 'new' ? PEN_CURSOR : drag.kind === 'convert' ? PEN_CONVERT_CURSOR : PEN_MOVE_CURSOR);
    const a = penAnchors.current[drag.index];
    if (!a) return;
    if (drag.kind === 'new') {
      a.hOut = { x: w.x - a.p.x, y: w.y - a.p.y };
      a.hIn = { x: a.p.x - w.x, y: a.p.y - w.y };
    } else if (drag.kind === 'move') {
      a.p = { x: w.x, y: w.y };
    } else if (drag.kind === 'handle') {
      if (drag.handle === 'out') a.hOut = { x: w.x - a.p.x, y: w.y - a.p.y };
      else a.hIn = { x: w.x - a.p.x, y: w.y - a.p.y };
    } else {
      drag.moved = true;
      a.hOut = { x: w.x - a.p.x, y: w.y - a.p.y };
    }
  }

  function penUp() {
    const drag = penDrag.current;
    if (drag?.kind === 'convert' && !drag.moved) {
      const a = penAnchors.current[drag.index];
      if (a) {
        a.hIn = { x: 0, y: 0 };
        a.hOut = { x: 0, y: 0 };
      }
    }
    penDrag.current = null;
  }

  function penCancel() {
    if (penAnchors.current.length === 0) return;
    penAnchors.current = [];
    penDrag.current = null;
    setPenCursorIfChanged(PEN_CURSOR);
    emit('Pen cancelled');
  }

  function penFinish() {
    const anchors = penAnchors.current;
    if (anchors.length < 2) {
      penAnchors.current = [];
      penDrag.current = null;
      return;
    }
    const brush = inputs.current.activeTile;
    if (!brush) {
      emit('Pick a tile first');
      return;
    }
    const seed = Math.floor(Math.abs(anchors[0].p.x) * 0.13 + Math.abs(anchors[0].p.y) * 0.17) + anchors.length;
    const { xs, ys } = pathTiles(sampleBezierPath(anchors), inputs.current.penWidth, { seed });
    if (xs.length === 0) {
      penAnchors.current = [];
      penDrag.current = null;
      return;
    }
    const saved = clonePenAnchors(anchors);
    penAnchors.current = [];
    penDrag.current = null;
    setPenCursorIfChanged(PEN_CURSOR);
    const z = inputs.current.floorZ;
    paintTiles(inputs.current.map.id, z, xs, ys, brush.paintId, true, false, inputs.current.automagic, brush.name)
      .then((result) => {
        applyPaintResult(result, z);
        void attachUndoSidecar(
          inputs.current.map.id,
          JSON.stringify({ pen: saved } satisfies Sidecar),
          JSON.stringify({ pen: [] } satisfies Sidecar)
        );
        emit(`Pen painted ${plural(xs.length, 'tile')}`);
      })
      .catch((err) => console.error('Failed to paint pen path', err));
  }

  const zonePainting = React.useRef(false);
  const zoneMode = React.useRef<{ flag: number; set: boolean } | null>(null);
  const borderizing = React.useRef(false);
  const borderizeRemove = React.useRef(false);

  function paintZoneAt(pos: Position) {
    const mode = zoneMode.current;
    if (!mode) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    paintZone(inputs.current.map.id, pos.z, [pos.x], [pos.y], mode.flag, mode.set)
      .then((touched) => {
        if (touched.length === 0) tiles.queueRefetch(pos.x, pos.y, pos.z);
        for (const k of touched) tiles.queueRefetch((k >>> 16) * CHUNK, (k & 0xffff) * CHUNK, pos.z);
        notifyEdit(pos.z);
      })
      .catch((err) => console.error('Failed to paint zone', err));
  }

  function paintZoneBox(bs: BoxSelection, set: boolean) {
    const tool = inputs.current.activeTool;
    if (!isZoneTool(tool)) return;
    const z = bs.startTile.z;
    const { xs, ys } = boxTiles(bs);
    paintZone(inputs.current.map.id, z, xs, ys, ZONE_TOOL_FLAG[tool], set)
      .then((touched) => refetchKeysNow(touched, z))
      .catch((err) => console.error('Failed to paint zone box', err));
  }

  const housePainting = React.useRef(false);
  const houseMode = React.useRef<{ houseId: number; set: boolean } | null>(null);

  function housePaintAt(pos: Position) {
    const mode = houseMode.current;
    if (!mode) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    setHouse(inputs.current.map.id, pos.z, [pos.x], [pos.y], mode.houseId, mode.set)
      .then((touched) => {
        if (touched.length === 0) tiles.queueRefetch(pos.x, pos.y, pos.z);
        for (const k of touched) tiles.queueRefetch((k >>> 16) * CHUNK, (k & 0xffff) * CHUNK, pos.z);
        if (touched.length) inputs.current.onHousesDirty();
        notifyEdit(pos.z);
      })
      .catch((err) => console.error('Failed to paint house', err));
  }

  function housePaintBox(bs: BoxSelection, set: boolean) {
    const houseId = inputs.current.activeHouseId;
    if (houseId == null) return;
    const z = bs.startTile.z;
    const { xs, ys } = boxTiles(bs);
    setHouse(inputs.current.map.id, z, xs, ys, houseId, set)
      .then((touched) => {
        refetchKeysNow(touched, z);
        if (touched.length) inputs.current.onHousesDirty();
      })
      .catch((err) => console.error('Failed to paint house box', err));
  }

  function setHouseExit(pos: Position) {
    const houseId = inputs.current.activeHouseId;
    const houses = inputs.current.houses;
    if (houseId == null || !houses) {
      emit('Select a house first');
      return;
    }
    const ct = tiles.get(Math.floor(pos.x / CHUNK), Math.floor(pos.y / CHUNK), pos.z, scene.frameTick.current);
    const hasGround =
      !!ct &&
      (() => {
        for (let i = 0; i < ct.tileX.length; i++) {
          if (ct.tileX[i] === pos.x && ct.tileY[i] === pos.y) return ct.itemOffset[i + 1] > ct.itemOffset[i];
        }
        return false;
      })();
    if (!hasGround) {
      emit('Exit must be on a ground tile');
      return;
    }
    const next = {
      list: houses.list.map((h) => (h.id === houseId ? { ...h, entryX: pos.x, entryY: pos.y, entryZ: pos.z } : h))
    };
    inputs.current.onEditHouses(next);
    void pushUndoSidecar(inputs.current.map.id, JSON.stringify({ houses }), JSON.stringify({ houses: next }));
    emit('House exit set');
  }

  function eraseBox(bs: BoxSelection) {
    const z = bs.startTile.z;
    const x0 = Math.min(bs.startTile.x, bs.curTile.x);
    const y0 = Math.min(bs.startTile.y, bs.curTile.y);
    const x1 = Math.max(bs.startTile.x, bs.curTile.x);
    const y1 = Math.max(bs.startTile.y, bs.curTile.y);
    if (inputs.current.eraserMode === 'creatures') {
      const base = inputs.current.spawns ?? emptyMapSpawns();
      const inBox = (p: { x: number; y: number; z: number }) => p.z === z && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      const placements = inputs.current.eraseMonsters ? base.placements.filter((p) => !inBox(p)) : base.placements;
      const areas = inputs.current.eraseSpawns ? base.areas.filter((a) => !inBox(a)) : base.areas;
      if (placements.length !== base.placements.length || areas.length !== base.areas.length) {
        editSpawns(buildMapSpawns(areas, placements));
      }
      return;
    }
    eraseArea(inputs.current.map.id, z, x0, y0, x1, y1, inputs.current.automagic, inputs.current.eraserMode === 'ground')
      .then((touched) => refetchKeysNow(touched, z))
      .catch((err) => console.error('Failed to erase box', err));
  }

  function clearBoxPreview() {
    previewKey.current = null;
    scene.boxGhostTiles.current = null;
  }

  function coarseGhost(xs: number[], ys: number[], serverId: number): PreviewTile[] | null {
    const clientId = previewClientIds.current.get(serverId);
    if (clientId == null) {
      mapClientIds([serverId])
        .then(([cid]) => {
          previewClientIds.current.set(serverId, cid ?? 0);
          previewKey.current = null;
          updateBoxPreview();
        })
        .catch(() => void 0);
      return null;
    }
    if (clientId === 0) return null;
    const ids = new Uint16Array([clientId]);
    const tiles: PreviewTile[] = new Array(xs.length);
    for (let i = 0; i < xs.length; i++) tiles[i] = { x: xs[i], y: ys[i], clientIds: ids };
    return tiles;
  }

  function updateBoxPreview() {
    const bs = selection.box.current;
    const brush = inputs.current.activeBrush;
    if (!bs || inputs.current.activeTool !== 'brush' || !brush || brush.serverId == null || !inputs.current.automagic) {
      clearBoxPreview();
      return;
    }
    const z = bs.startTile.z;
    const { xs, ys } = boxTiles(bs, true);
    if (xs.length === 0) {
      clearBoxPreview();
      return;
    }
    const key = `${z},${brush.serverId},${xs[0]},${ys[0]},${xs[xs.length - 1]},${ys[ys.length - 1]}`;
    if (key === previewKey.current) return;
    previewKey.current = key;
    if (camera.zoomRef.current < COARSE_PREVIEW_ZOOM) {
      scene.boxGhostTiles.current = coarseGhost(xs, ys, brush.serverId);
      return;
    }
    if (previewBusy.current) return;
    previewBusy.current = true;
    const seq = ++previewSeq.current;
    previewPaint(
      inputs.current.map.id,
      z,
      xs,
      ys,
      brush.serverId,
      brush.isGround,
      brush.kind === 'doodad',
      brush.kind === 'doodad' || brush.kind === 'ground' ? brush.name : ''
    )
      .then((tiles) => {
        if (seq === previewSeq.current) scene.boxGhostTiles.current = tiles;
      })
      .catch((err) => console.error('Failed to preview paint', err))
      .finally(() => {
        previewBusy.current = false;
        if (key !== previewKey.current) {
          previewKey.current = null;
          updateBoxPreview();
        }
      });
  }

  function eraseAt(pos: Position) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    deleteItem(inputs.current.map.id, pos.z, pos.x, pos.y, inputs.current.automagic, inputs.current.eraserMode === 'ground')
      .then((touched) => {
        if (touched.length === 0) tiles.queueRefetch(pos.x, pos.y, pos.z);
        for (const key of touched) tiles.queueRefetch((key >>> 16) * CHUNK, (key & 0xffff) * CHUNK, pos.z);
        notifyEdit(pos.z);
      })
      .catch((err) => console.error('Failed to erase tile', err));
  }

  function eraseBrushAt(pos: Position, serverId: number) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    eraseBrush(inputs.current.map.id, pos.z, pos.x, pos.y, serverId, inputs.current.automagic)
      .then((touched) => {
        if (touched.length === 0) tiles.queueRefetch(pos.x, pos.y, pos.z);
        for (const k of touched) tiles.queueRefetch((k >>> 16) * CHUNK, (k & 0xffff) * CHUNK, pos.z);
        notifyEdit(pos.z);
      })
      .catch((err) => console.error('Failed to erase brush', err));
  }

  function borderizeAt(pos: Position, remove: boolean) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    borderizeBrush(inputs.current.map.id, pos.z, [pos.x], [pos.y], remove)
      .then((touched) => {
        if (touched.length === 0) tiles.queueRefetch(pos.x, pos.y, pos.z);
        for (const k of touched) tiles.queueRefetch((k >>> 16) * CHUNK, (k & 0xffff) * CHUNK, pos.z);
        notifyEdit(pos.z);
      })
      .catch((err) => console.error('Failed to borderize', err));
  }

  function borderizeBox(bs: BoxSelection, remove: boolean) {
    const z = bs.startTile.z;
    const { xs, ys } = boxTiles(bs);
    borderizeBrush(inputs.current.map.id, z, xs, ys, remove)
      .then((touched) => {
        refetchKeysNow(touched, z);
        emit(`${remove ? 'Cleared borders on' : 'Borderized'} ${plural(xs.length, 'tile')}`);
      })
      .catch((err) => console.error('Failed to borderize box', err));
  }

  async function refetchChunkNow(x: number, y: number, z: number) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const key = `${z},${cx},${cy}`;
    const res = await fetchMapChunks(inputs.current.map.id, z, [packChunkKey(cx, cy)]);
    tiles.store(key, res.get(`${cx},${cy}`) ?? null, scene.frameTick.current);
    meshes.forget(key);
    notifyEdit(z);
  }

  function applyPaintResult(result: PaintResult, z: number) {
    storeChunks(result.touched, result.chunks, z);
    scene.boxGhostTiles.current = null;
    previewKey.current = null;
  }

  function storeChunks(keys: number[], res: Map<string, ChunkTiles>, z: number) {
    for (const k of keys) {
      const cx = k >>> 16;
      const cy = k & 0xffff;
      tiles.store(`${z},${cx},${cy}`, res.get(`${cx},${cy}`) ?? null, scene.frameTick.current);
      meshes.forget(`${z},${cx},${cy}`);
    }
    notifyEdit(z);
  }

  async function refetchKeysNow(keys: number[], z: number) {
    if (keys.length === 0) return;
    storeChunks(keys, await fetchMapChunks(inputs.current.map.id, z, keys), z);
  }

  function invalidateTagged(tagged: [number, number][]) {
    const zs = new Set<number>();
    for (const [z, key] of tagged) {
      const cx = key >>> 16;
      const cy = key & 0xffff;
      const k = `${z},${cx},${cy}`;
      tiles.data.current.delete(k);
      tiles.requested.current.delete(k);
      tiles.pending.current.delete(k);
      tiles.lastUsed.current.delete(k);
      meshes.forget(k);
      zs.add(z);
    }
    for (const z of zs) notifyEdit(z);
  }

  async function refetchTagged(tagged: [number, number][]) {
    const byZ = new Map<number, number[]>();
    for (const [z, key] of tagged) {
      const arr = byZ.get(z);
      if (arr) arr.push(key);
      else byZ.set(z, [key]);
    }
    for (const [z, keys] of byZ) await refetchKeysNow(keys, z);
  }

  function hoverAt(pos: Position): HoverInfo {
    const { items, itemNames } = inputs.current;
    const ct = tiles.get(Math.floor(pos.x / CHUNK), Math.floor(pos.y / CHUNK), pos.z, scene.frameTick.current);
    if (ct === undefined) tiles.request(Math.floor(pos.x / CHUNK), Math.floor(pos.y / CHUNK), pos.z);
    let found = -1;
    if (ct) {
      for (let i = 0; i < ct.tileX.length; i++) {
        if (ct.tileX[i] === pos.x && ct.tileY[i] === pos.y) {
          found = i;
          break;
        }
      }
    }
    let item: HoverItem | null = null;
    if (ct && found >= 0) {
      const start = ct.itemOffset[found];
      const end = ct.itemOffset[found + 1];
      const count = end - start;
      if (count > 0) {
        const top = end - 1;
        const clientId = ct.clientIds[top];
        const serverId = ct.serverIds[top];
        item = { serverId, clientId, name: itemNames.get(serverId) ?? '', count };
      }
    }
    const bs = selection.box.current;
    const box = bs ? { w: Math.abs(pos.x - bs.startTile.x) + 1, h: Math.abs(pos.y - bs.startTile.y) + 1 } : null;
    return { x: pos.x, y: pos.y, z: pos.z, hasTile: found >= 0, item, box };
  }

  const toSelected = (info: HoverInfo): SelectedItem | null =>
    info.item ? { ...info.item, x: info.x, y: info.y, z: info.z } : null;

  function groundAt(pos: Position): HoverItem | null {
    const { items, itemNames } = inputs.current;
    const ct = tiles.get(Math.floor(pos.x / CHUNK), Math.floor(pos.y / CHUNK), pos.z, scene.frameTick.current);
    if (!ct) return null;
    let found = -1;
    for (let i = 0; i < ct.tileX.length; i++) {
      if (ct.tileX[i] === pos.x && ct.tileY[i] === pos.y) {
        found = i;
        break;
      }
    }
    if (found < 0 || ct.itemOffset[found + 1] <= ct.itemOffset[found]) return null;
    const slot = ct.itemOffset[found];
    const clientId = ct.clientIds[slot];
    const serverId = ct.serverIds[slot];
    const thing = items.get(clientId);
    if (!thing?.isGround) return null;
    return { serverId, clientId, name: itemNames.get(serverId) ?? '', count: 1 };
  }

  function finishMove() {
    const md = scene.moveDrag.current;
    scene.moveDrag.current = null;
    if (!md) return;
    setMoving(false);
    const dest = scene.moveDest.current;
    scene.moveDest.current = null;
    if (!md.active || !dest || (dest.x === md.from.x && dest.y === md.from.y)) return;

    const from = md.from;
    const dx = dest.x - from.x;
    const dy = dest.y - from.y;
    const s = selectionArrays();
    const { creatures, spawns } = selectedMarkers();
    if (!s && creatures.length === 0 && spawns.length === 0) return;

    const selBefore = selection.snapshot();
    const spawnBase = inputs.current.spawns ?? emptyMapSpawns();
    let spawnModel: MapSpawns | null = null;
    if (creatures.length > 0 || spawns.length > 0) {
      let model = spawnBase;
      for (const c of creatures) model = moveCreature(model, c, { x: c.x + dx, y: c.y + dy, z: c.z });
      for (const sp of spawns) model = moveSpawn(model, sp, { x: sp.x + dx, y: sp.y + dy, z: sp.z });
      spawnModel = model;
      inputs.current.onEditSpawns(model);
      selection.selectCreature(null);
      selection.selectSpawn(null);
      selection.creatures.current.clear();
      selection.spawns.current.clear();
      for (const c of creatures) if (c.x + dx >= 0 && c.y + dy >= 0) selection.addCreature({ x: c.x + dx, y: c.y + dy, z: c.z });
      for (const sp of spawns) if (sp.x + dx >= 0 && sp.y + dy >= 0) selection.addSpawn({ x: sp.x + dx, y: sp.y + dy, z: sp.z });
    }

    if (!s) {
      pushCompound(selBefore, { hasItem: false, spawnBefore: spawnBase, spawnAfter: spawnModel });
      inputs.current.onSelect(null);
      return;
    }

    const ctx = { items: inputs.current.items, tiles, atlas };
    scene.pendingMove.current = buildSelectionGhost(
      ctx,
      scene.frameTick.current,
      inputs.current.floorZ,
      selection.entries.current.values(),
      dx,
      dy
    );
    moveSelection(inputs.current.map.id, s.zs, s.xs, s.ys, s.all, dx, dy, inputs.current.automagic)
      .then((touched) => refetchTagged(touched))
      .then(() => {
        selection.setTiles(
          s.xs.map((x, i) => ({ x: x + dx, y: s.ys[i] + dy, z: s.zs[i], all: s.all[i] })).filter((t) => t.x >= 0 && t.y >= 0)
        );
        pushCompound(selBefore, { hasItem: true, spawnBefore: spawnModel ? spawnBase : null, spawnAfter: spawnModel });
        atlas.version.current++;
        inputs.current.onSelect(toSelected(hoverAt(dest)));
      })
      .catch((err) => console.error('Failed to move selection', err))
      .finally(() => {
        scene.pendingMove.current = null;
      });
  }

  function deleteSelected(silent = false) {
    if (selection.waypoint.current) {
      const wps = inputs.current.waypoints ?? emptyMapWaypoints();
      const wp = waypointAt(wps, selection.waypoint.current.x, selection.waypoint.current.y, selection.waypoint.current.z);
      if (wp) editWaypoints(removeWaypoint(wps, wp.name));
      selection.selectWaypoint(null);
      inputs.current.onSelect(null);
      if (wp && !silent) emit(`Waypoint "${wp.name}" deleted`);
      return;
    }

    const selBefore = selection.snapshot();
    const { creatures, spawns } = selectedMarkers();
    const markerCount = creatures.length + spawns.length;
    const spawnBase = inputs.current.spawns ?? emptyMapSpawns();
    let spawnModel: MapSpawns | null = null;
    if (markerCount > 0) {
      let model = spawnBase;
      for (const c of creatures) model = removeCreatureAt(model, c);
      for (const sp of spawns) model = removeSpawnAt(model, sp);
      spawnModel = model;
      inputs.current.onEditSpawns(model);
      selection.selectCreature(null);
      selection.selectSpawn(null);
      selection.creatures.current.clear();
      selection.spawns.current.clear();
    }

    const s = selectionArrays();
    if (s) {
      let count = 0;
      deleteSelection(inputs.current.map.id, s.zs, s.xs, s.ys, s.all, inputs.current.automagic)
        .then((res) => {
          count = res.removed;
          selection.clear();
          return refetchTagged(res.touched);
        })
        .then(() => {
          pushCompound(selBefore, { hasItem: true, spawnBefore: spawnModel ? spawnBase : null, spawnAfter: spawnModel });
          atlas.version.current++;
          inputs.current.onSelect(null);
          const total = count + markerCount;
          if (!silent) emit(total > 0 ? `Deleted ${plural(total, 'object')}` : 'Nothing to delete');
        })
        .catch((err) => {
          console.error('Failed to delete selection', err);
          emit('Delete failed');
        });
      return;
    }

    if (markerCount > 0) {
      selection.clear();
      pushCompound(selBefore, { hasItem: false, spawnBefore: spawnBase, spawnAfter: spawnModel });
      inputs.current.onSelect(null);
      if (!silent) emit(`Deleted ${plural(markerCount, 'object')}`);
    }
  }

  function fillSelection() {
    const tile = inputs.current.activeTile;
    if (!tile) {
      emit('Pick an active tile first');
      return;
    }
    const sel = [...selection.entries.current.values()];
    if (sel.length === 0) {
      emit('Select an area first');
      return;
    }
    const byZ = new Map<number, { xs: number[]; ys: number[] }>();
    for (const t of sel) {
      let g = byZ.get(t.z);
      if (!g) {
        g = { xs: [], ys: [] };
        byZ.set(t.z, g);
      }
      g.xs.push(t.x);
      g.ys.push(t.y);
    }
    let total = 0;
    const tasks: Promise<void>[] = [];
    for (const [z, g] of byZ) {
      total += g.xs.length;
      tasks.push(
        paintTiles(inputs.current.map.id, z, g.xs, g.ys, tile.paintId, true, false, inputs.current.automagic, tile.name).then(
          (result) => applyPaintResult(result, z)
        )
      );
    }
    Promise.all(tasks)
      .then(() => {
        atlas.version.current++;
        emit(`Filled ${plural(total, 'tile')}`);
      })
      .catch((err) => {
        console.error('Failed to fill selection', err);
        emit('Fill failed');
      });
  }

  function selectedCells(z: number): { x: number; y: number }[] {
    const cells: { x: number; y: number }[] = [];
    for (const t of selection.entries.current.values()) if (t.z === z) cells.push({ x: t.x, y: t.y });
    return cells;
  }

  async function applyPlan(plan: GenPlan, count: number, report: (label: string) => void) {
    if (plan.layers.length === 0) {
      report('Nothing to generate');
      return;
    }
    report(`Painting ${plural(count, 'tile')}...`);
    try {
      const touched = await generateApply(inputs.current.map.id, plan.layers, inputs.current.automagic);
      report('Refreshing...');
      refetchTagged(touched);
      atlas.version.current++;
      report(`Generated ${plural(count, 'tile')}`);
    } catch (err) {
      console.error('Generate failed', err);
      report('Generate failed');
    }
  }

  async function generate(
    biomes: ResolvedBiome[],
    opts: GenerateOptions,
    mountain?: ResolvedMountain | null,
    mountainOpts?: MountainOptions | null,
    onProgress?: (label: string) => void
  ) {
    const report = (label: string) => {
      emit(label);
      onProgress?.(label);
    };
    const z = inputs.current.floorZ;
    const cells = selectedCells(z);
    if (cells.length === 0) {
      report('Select an area first');
      return;
    }
    const exclude =
      mountain && mountainOpts ? mountainMargin(mountainHeights(cells, mountainOpts), MOUNTAIN_SCATTER_MARGIN) : undefined;
    report(`Planning ${plural(cells.length, 'tile')}...`);
    const plan = await planGeneration(
      cells,
      biomes,
      opts,
      z,
      (d, t) => report(`Planning... ${Math.round((d / t) * 100)}%`),
      exclude
    );
    await applyPlan(plan, cells.length, report);
    if (mountain && mountainOpts) {
      report('Planning mountains...');
      await applyPlan(planMountain(cells, mountain, mountainOpts, z), cells.length, report);
    }
  }

  function rebuildHuntRoute(): HuntMeta | null {
    const s = scene.huntSession.current;
    if (!s) return null;
    const route = connectRoute(s.mask, s.nodes);
    const toWorld = (p: { x: number; y: number }) => ({ x: p.x + s.minX, y: p.y + s.minY });
    scene.huntRoute.current = { nodes: route.nodes.map(toWorld), paths: route.edges.map((e) => e.path.map(toWorld)) };
    const meta: HuntMeta = { points: route.nodes.length, steps: route.totalSteps };
    inputs.current.onHuntMeta(meta);
    return meta;
  }

  async function huntPreview(params: HuntPreviewParams): Promise<HuntMeta | null> {
    const { minX, minY, maxX, maxY, z } = params.area;
    if (maxX < minX || maxY < minY) {
      emit('Select a hunt area first');
      return null;
    }
    const grid = await readWalkableMask(inputs.current.map.id, z, minX, minY, maxX, maxY, inputs.current.items);
    const seeded = buildRoute(grid.mask, spreadPoints(grid.mask, params.viewW, params.viewH));
    const mask = seeded.nodes.length > 0 ? reachableFrom(grid.mask, seeded.nodes[0]) : grid.mask;
    scene.huntSession.current = {
      mask,
      minX: grid.minX,
      minY: grid.minY,
      spawntime: params.spawntime,
      boxSize: params.boxSize,
      viewW: params.viewW,
      viewH: params.viewH,
      nodes: seeded.nodes,
      monsterTiles: []
    };
    scene.huntRouteZ.current = z;
    const meta = rebuildHuntRoute();
    rescatterHunt();
    if (!meta || meta.points === 0) emit('No walkable tiles in the selected area');
    else emit(`Hunt route: ${meta.points} box${meta.points === 1 ? '' : 'es'}`);
    return meta;
  }

  function rescatterHunt(boxSize?: number, viewW?: number, viewH?: number) {
    const s = scene.huntSession.current;
    const route = scene.huntRoute.current;
    if (!s || !route) return;
    s.boxSize = boxSize ?? s.boxSize;
    s.viewW = viewW ?? s.viewW;
    s.viewH = viewH ?? s.viewH;
    const cover: { x: number; y: number }[] = [];
    for (const n of route.nodes) cover.push({ x: n.x - s.minX, y: n.y - s.minY });
    for (const path of route.paths) for (const p of path) cover.push({ x: p.x - s.minX, y: p.y - s.minY });
    const eligible = coverageMask(s.mask, cover, Math.floor(s.viewW / 2), Math.floor(s.viewH / 2));
    let walkableCount = 0;
    for (const row of eligible) for (const cell of row) if (cell) walkableCount++;
    const monsterCount = Math.round((walkableCount * s.boxSize) / (s.viewW * s.viewH));
    s.monsterTiles = scatterPoints(eligible, monsterCount, Math.random);
  }

  function generateHunt() {
    const s = scene.huntSession.current;
    const monsters = inputs.current.huntMonsters;
    if (!s) {
      emit('Preview a hunt first');
      return;
    }
    if (monsters.length === 0) {
      emit('Select at least one monster');
      return;
    }
    if (s.monsterTiles.length === 0) {
      emit('Nothing to generate');
      return;
    }
    const z = scene.huntRouteZ.current;
    const base = inputs.current.spawns ?? emptyMapSpawns();
    const areas = [...base.areas];
    const placements = [...base.placements];
    const occupied = new Set(base.placements.map((p) => `${p.x},${p.y},${p.z}`));
    let added = 0;
    s.monsterTiles.forEach((t, i) => {
      const x = t.x + s.minX;
      const y = t.y + s.minY;
      if (occupied.has(`${x},${y},${z}`)) return;
      occupied.add(`${x},${y},${z}`);
      const m = monsters[i % monsters.length];
      areas.push({ x, y, z, radius: 1 });
      placements.push({
        x,
        y,
        z,
        name: m.name,
        isNpc: false,
        lookType: m.lookType,
        head: m.head,
        body: m.body,
        legs: m.legs,
        feet: m.feet,
        spawntime: m.spawntime,
        direction: 2
      });
      added++;
    });
    editSpawns(buildMapSpawns(areas, placements));
    clearHuntPreview();
    scene.huntArea.current = null;
    inputs.current.onHuntArea(null);
    inputs.current.onHuntMeta(null);
    emit(`Generated ${added} spawn${added === 1 ? '' : 's'}`);
  }

  function clearHuntPreview() {
    scene.huntRoute.current = null;
    scene.huntSession.current = null;
    scene.huntSelected.current = null;
  }

  function clearHunt() {
    clearHuntPreview();
    scene.huntArea.current = null;
    scene.huntAreaDrag.current = null;
    inputs.current.onHuntArea(null);
    inputs.current.onHuntMeta(null);
  }

  function huntNodeAt(pos: Position): number {
    const nodes = scene.huntRoute.current?.nodes;
    if (!nodes) return -1;
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.max(Math.abs(nodes[i].x - pos.x), Math.abs(nodes[i].y - pos.y));
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi >= 0 && bd <= 1 ? bi : -1;
  }

  function huntEdgeAt(pos: Position): boolean {
    const paths = scene.huntRoute.current?.paths;
    if (!paths) return false;
    for (const path of paths) {
      for (const p of path) {
        if (Math.abs(p.x - pos.x) <= 1 && Math.abs(p.y - pos.y) <= 1) return true;
      }
    }
    return false;
  }

  function huntEditingActive(): boolean {
    return (
      inputs.current.huntEditing &&
      scene.huntSession.current != null &&
      scene.huntRoute.current != null &&
      scene.huntRouteZ.current === inputs.current.floorZ
    );
  }

  function selectionArrays() {
    const sel = [...selection.entries.current.values()];
    if (sel.length === 0) return null;
    return { zs: sel.map((t) => t.z), xs: sel.map((t) => t.x), ys: sel.map((t) => t.y), all: sel.map((t) => t.all) };
  }

  function selectMarkersInBox(z: number, ax: number, ay: number, bx: number, by: number) {
    const data = inputs.current.spawns;
    if (!data) return;
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    const areas = data.areasByZ.get(z);
    if (areas) {
      for (const a of areas) {
        if (a.x >= minX && a.x <= maxX && a.y >= minY && a.y <= maxY) selection.addSpawn({ x: a.x, y: a.y, z });
      }
    }
    const minCx = Math.floor(minX / CHUNK);
    const maxCx = Math.floor(maxX / CHUNK);
    const minCy = Math.floor(minY / CHUNK);
    const maxCy = Math.floor(maxY / CHUNK);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const arr = data.byChunk.get(`${z},${cx},${cy}`);
        if (!arr) continue;
        for (const c of arr) {
          if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) selection.addCreature({ x: c.x, y: c.y, z });
        }
      }
    }
  }

  function selectedMarkers() {
    const creatures = [...selection.creatures.current.values()];
    if (selection.creature.current) creatures.push(selection.creature.current);
    const spawns = [...selection.spawns.current.values()];
    if (selection.spawn.current) spawns.push(selection.spawn.current);
    return { creatures, spawns };
  }

  function captureClipboardGhost(): ClipboardGhostTile[] | null {
    const sel = [...selection.entries.current.values()];
    if (sel.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    for (const t of sel) {
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.z < minZ) minZ = t.z;
    }
    const out: ClipboardGhostTile[] = [];
    for (const t of sel) {
      const ct = tiles.get(Math.floor(t.x / CHUNK), Math.floor(t.y / CHUNK), t.z, scene.frameTick.current);
      if (!ct) continue;
      let found = -1;
      for (let i = 0; i < ct.tileX.length; i++) {
        if (ct.tileX[i] === t.x && ct.tileY[i] === t.y) {
          found = i;
          break;
        }
      }
      if (found < 0) continue;
      const start = ct.itemOffset[found];
      const end = ct.itemOffset[found + 1];
      if (end <= start) continue;
      const from = t.all ? start : end - 1;
      const items: { clientId: number; count: number }[] = [];
      for (let ii = from; ii < end; ii++) items.push({ clientId: ct.clientIds[ii], count: ct.counts[ii] });
      out.push({ dx: t.x - minX, dy: t.y - minY, dz: t.z - minZ, items });
    }
    return out.length > 0 ? out : null;
  }

  function copySelected(silent = false): Promise<number> {
    const s = selectionArrays();
    if (!s) {
      if (!silent) emit('Nothing to copy');
      return Promise.resolve(0);
    }
    try {
      clipboardGhostSource.current = captureClipboardGhost();
    } catch (err) {
      console.error('Clipboard ghost capture failed', err);
      clipboardGhostSource.current = null;
    }
    return copySelection(inputs.current.map.id, s.zs, s.xs, s.ys, s.all)
      .then((n) => {
        clipboardCount.current = n;
        if (!silent) emit(`Copied ${plural(n, 'tile')}`);
        return n;
      })
      .catch((err) => {
        console.error('Copy failed', err);
        emit(`Copy failed: ${err}`);
        return 0;
      });
  }

  function cutSelected() {
    void copySelected(true).then((n) => {
      if (n === 0) {
        emit('Nothing to cut');
        return;
      }
      deleteSelected(true);
      emit(`Cut ${plural(n, 'tile')}`);
    });
  }

  function pasteAt(pos: Position) {
    if (clipboardCount.current === 0) {
      emit('Clipboard empty');
      return;
    }
    const count = clipboardCount.current;
    pasteSelection(inputs.current.map.id, pos.x, pos.y, pos.z, inputs.current.mergePaste)
      .then((touched) => refetchTagged(touched))
      .then(() => {
        atlas.version.current++;
        emit(`Pasted ${plural(count, 'tile')}`);
      })
      .catch((err) => {
        console.error('Paste failed', err);
        emit(`Paste failed: ${err}`);
      });
  }

  function copyText(text: string) {
    navigator.clipboard?.writeText(text).catch((err) => console.error('Clipboard write failed', err));
  }

  function copyPosition(pos: Position) {
    const text = formatPosition(inputs.current.copyPositionFormat, pos);
    copyText(text);
    emit(`Copied ${text}`);
  }

  async function groundPreview(
    paint: number,
    clickedClientId: number
  ): Promise<{ preview: string | undefined; cols: number; rows: number }> {
    try {
      const [clientId] = await mapClientIds([paint]);
      const thing = clientId ? inputs.current.items.get(clientId) : undefined;
      if (thing) {
        await loadSprites(inputs.current.sprPath, thing.spriteIndex, inputs.current.transparency, atlas.data.current);
        const preview = buildItemPreview(thing, atlas.data.current);
        if (preview) return { preview, cols: thing.width ?? 1, rows: thing.height ?? 1 };
      }
    } catch (err) {
      console.error('Ground preview failed', err);
    }
    const fallback = inputs.current.items.get(clickedClientId);
    return { preview: buildItemPreview(fallback, atlas.data.current), cols: fallback?.width ?? 1, rows: fallback?.height ?? 1 };
  }

  async function selectGround(item: HoverItem) {
    const thing = inputs.current.items.get(item.clientId);
    const ref = brushForItem(item.serverId);
    if (ref?.kind === 'ground') {
      const paint = ref.paint ?? item.serverId;
      const { preview, cols, rows } = await groundPreview(paint, item.clientId);
      inputs.current.onSelectBrush({
        key: `ground-${paint}`,
        name: ref.name,
        kind: 'ground',
        serverId: paint,
        isGround: true,
        cols,
        rows,
        preview
      });
      inputs.current.onRevealBrush?.('terrain', ref.look ?? paint, ref.name);
      emit(`Selected "${ref.name}"`);
      setMenu(null);
      return;
    }
    inputs.current.onSelectBrush({
      key: `ground-${item.serverId}`,
      name: item.name || `Item ${item.serverId}`,
      kind: 'ground',
      serverId: item.serverId,
      isGround: true,
      cols: thing?.width ?? 1,
      rows: thing?.height ?? 1,
      preview: buildItemPreview(thing, atlas.data.current)
    });
    inputs.current.onRevealBrush?.('terrain', item.serverId);
    emit(`Selected "${item.name || `Item ${item.serverId}`}"`);
    setMenu(null);
  }

  function selectDoodad(item: HoverItem) {
    const thing = inputs.current.items.get(item.clientId);
    const ref = brushForItem(item.serverId);
    const name = ref?.name || item.name || `Item ${item.serverId}`;
    inputs.current.onSelectBrush({
      key: `doodad-${item.serverId}`,
      name,
      kind: 'doodad',
      serverId: item.serverId,
      isGround: false,
      cols: thing?.width ?? 1,
      rows: thing?.height ?? 1,
      preview: buildItemPreview(thing, atlas.data.current)
    });
    inputs.current.onRevealBrush?.('doodad', item.serverId, ref?.name);
    emit(`Selected "${name}"`);
    setMenu(null);
  }

  function applyHistory(pairs: [number, number][]) {
    if (pairs.length === 0) return;
    Promise.all(pairs.map(([z, key]) => refetchChunkNow((key >>> 16) * CHUNK, (key & 0xffff) * CHUNK, z)))
      .then(() => {
        atlas.version.current++;
        const tile = scene.hoveredTile.current;
        if (tile) inputs.current.onSelect(toSelected(hoverAt(tile)));
      })
      .catch((err) => console.error('Failed to refresh after history', err));
  }

  async function undo() {
    let r: EditResult;
    try {
      r = await undoEdit(inputs.current.map.id);
    } catch (err) {
      console.error('Undo failed', err);
      emit('Undo failed');
      return;
    }
    if (!r.applied) {
      emit('Nothing to undo');
      return;
    }
    const penRestored = applySidecar(r.sidecar);
    if (r.touched.length > 0) applyHistory(r.touched);
    emit(penRestored ? 'Undo - pen path back to edit' : 'Undo');
  }

  async function redo() {
    let r: EditResult;
    try {
      r = await redoEdit(inputs.current.map.id);
    } catch (err) {
      console.error('Redo failed', err);
      emit('Redo failed');
      return;
    }
    if (!r.applied) {
      emit('Nothing to redo');
      return;
    }
    applySidecar(r.sidecar);
    if (r.touched.length > 0) applyHistory(r.touched);
    emit('Redo');
  }

  function onMouseDown(e: React.MouseEvent) {
    if (modalOpen.current) return;
    if (e.button === 1) {
      e.preventDefault();
      camera.beginPan(e);
      return;
    }
    if (e.button !== 0) return;

    if (spaceRef.current) {
      e.preventDefault();
      camera.beginPan(e);
      return;
    }

    if (inputs.current.huntAreaSelecting) {
      const pos = tileAt(e);
      scene.huntAreaDrag.current = { start: pos, cur: pos };
      return;
    }

    if (huntEditingActive()) {
      const pos = tileAt(e);
      const ni = huntNodeAt(pos);
      if (ni >= 0) {
        scene.huntDrag.current = { index: ni, moved: false };
        scene.huntSelected.current = ni;
        return;
      }
      const s = scene.huntSession.current!;
      if (huntEdgeAt(pos)) {
        const snap = nearestWalkable(s.mask, pos.x - s.minX, pos.y - s.minY, 3);
        if (snap) {
          s.nodes.push(snap);
          const idx = s.nodes.length - 1;
          scene.huntSelected.current = idx;
          scene.huntDrag.current = { index: idx, moved: false };
          rebuildHuntRoute();
          rescatterHunt();
        }
        return;
      }
    }

    if (scene.importGhost.current) {
      const pos = tileAt(e);
      inputs.current.onImportDrop?.(pos);
      return;
    }

    if (scene.pasteGhost.current) {
      const pos = tileAt(e);
      scene.pasteGhost.current = null;
      pasteAt(pos);
      return;
    }

    if (inputs.current.placingWaypoint) {
      const pos = tileAt(e);
      const wps = inputs.current.waypoints ?? emptyMapWaypoints();
      editWaypoints(moveWaypoint(wps, inputs.current.placingWaypoint, pos));
      selection.clear();
      selection.selectWaypoint(pos);
      inputs.current.onPlaceWaypoint();
      return;
    }

    const tool = inputs.current.activeTool;
    if (tool === 'pen') {
      penDown(e);
      return;
    }
    const brush = inputs.current.activeBrush;
    const canBrush = tool === 'brush' && brush != null && brush.serverId != null;
    const zoneTool = isZoneTool(tool);
    if (
      e.shiftKey &&
      (tool === 'select' || tool === 'eraser' || tool === 'borderize' || zoneTool || canBrush || tool === 'house')
    ) {
      const pos = tileAt(e);
      selection.box.current = { startTile: pos, curTile: pos, additive: e.ctrlKey };
      setBoxing(true);
      updateBoxPreview();
      return;
    }
    if (canBrush) {
      if (e.ctrlKey) {
        scene.erasing.current = true;
        scene.eraseBrushId.current = brush!.serverId!;
        scene.lastPaintKey.current = null;
        eraseBrushAt(tileAt(e), brush!.serverId!);
        return;
      }
      scene.painting.current = true;
      scene.lastPaintKey.current = null;
      paintAt(tileAt(e));
      return;
    }
    if (zoneTool) {
      zonePainting.current = true;
      zoneMode.current = { flag: ZONE_TOOL_FLAG[tool], set: !e.ctrlKey };
      scene.lastPaintKey.current = null;
      paintZoneAt(tileAt(e));
      return;
    }
    if (tool === 'house') {
      const houseId = inputs.current.activeHouseId;
      if (houseId == null) {
        emit('Select a house first');
        return;
      }
      housePainting.current = true;
      houseMode.current = { houseId, set: !e.ctrlKey };
      scene.lastPaintKey.current = null;
      housePaintAt(tileAt(e));
      return;
    }
    if (tool === 'house_exit') {
      setHouseExit(tileAt(e));
      return;
    }
    if (tool === 'brush' && brush && brush.kind === 'creature') {
      beginCreatureStroke(e);
      return;
    }
    if (tool === 'spawn') {
      const pos = tileAt(e);
      const base = inputs.current.spawns ?? emptyMapSpawns();
      editSpawns(placeSpawn(base, pos, inputs.current.spawnRadius));
      selection.clear();
      selection.selectSpawn(pos);
      emit('Spawn placed');
      return;
    }
    if (tool === 'eraser') {
      if (inputs.current.eraserMode === 'creatures') {
        beginMarkerEraseStroke(e);
        return;
      }
      scene.erasing.current = true;
      scene.lastPaintKey.current = null;
      eraseAt(tileAt(e));
      return;
    }
    if (tool === 'borderize') {
      borderizing.current = true;
      borderizeRemove.current = e.ctrlKey;
      scene.lastPaintKey.current = null;
      borderizeAt(tileAt(e), e.ctrlKey);
      return;
    }

    const pos = tileAt(e);
    if (selectByPriority(pos)) {
      beginMarkerDrag(e, pos);
    } else {
      const onSel = selection.entries.current.has(`${pos.z},${pos.x},${pos.y}`);
      if (!onSel && !hoverAt(pos).hasTile) {
        selection.clear();
        inputs.current.onSelect(null);
        return;
      }
      if (!onSel) selection.selectTile(pos, false);
      scene.moveDest.current = pos;
      scene.moveDrag.current = { from: pos, startX: e.clientX, startY: e.clientY, active: false };
    }
    inputs.current.onSelect(toSelected(hoverAt(pos)));
  }

  function onMouseMove(e: React.MouseEvent) {
    if (modalOpen.current) return;
    scene.ctrlDown.current = e.ctrlKey;
    const canvasEl = canvasRef.current;
    if (canvasEl) {
      const r = canvasEl.getBoundingClientRect();
      scene.mouseScreen.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    if (scene.huntAreaDrag.current) {
      scene.huntAreaDrag.current.cur = tileAt(e);
      return;
    }
    if (scene.huntDrag.current && scene.huntSession.current) {
      const s = scene.huntSession.current;
      const idx = scene.huntDrag.current.index;
      const pos = tileAt(e);
      const snap = nearestWalkable(s.mask, pos.x - s.minX, pos.y - s.minY, 3);
      if (snap) {
        const cur = s.nodes[idx];
        if (cur.x !== snap.x || cur.y !== snap.y) {
          s.nodes[idx] = snap;
          scene.huntDrag.current.moved = true;
          rebuildHuntRoute();
        }
      }
      return;
    }
    if (inputs.current.activeTool === 'pen') penMove(e);
    if (markerEraseStroke.current) {
      applyMarkerEraseAt(tileAt(e));
    } else if (creatureStroke.current) {
      applyCreatureAt(tileAt(e));
    } else if (scene.painting.current) {
      paintAt(tileAt(e));
    } else if (zonePainting.current) {
      paintZoneAt(tileAt(e));
    } else if (housePainting.current) {
      housePaintAt(tileAt(e));
    } else if (scene.erasing.current) {
      if (scene.eraseBrushId.current != null) eraseBrushAt(tileAt(e), scene.eraseBrushId.current);
      else eraseAt(tileAt(e));
    } else if (borderizing.current) {
      borderizeAt(tileAt(e), borderizeRemove.current);
    } else if (camera.panMove(e)) {
      // panned
    } else if (selection.box.current) {
      selection.box.current.curTile = tileAt(e);
      updateBoxPreview();
    } else if (scene.moveDrag.current) {
      const md = scene.moveDrag.current;
      if (!md.active) {
        const dx = e.clientX - md.startX;
        const dy = e.clientY - md.startY;
        if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
          md.active = true;
          setMoving(true);
        }
      }
      if (md.active) scene.moveDest.current = tileAt(e);
    }
    if (menu) return;
    const pos = tileAt(e);
    scene.hoveredTile.current = pos;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key !== scene.lastHoverKey.current) {
      scene.lastHoverKey.current = key;
      inputs.current.onHover(hoverAt(pos));
    }
  }

  function onMouseUp() {
    penUp();
    if (scene.huntDrag.current) {
      const moved = scene.huntDrag.current.moved;
      scene.huntDrag.current = null;
      if (moved) rescatterHunt();
      return;
    }
    if (scene.huntAreaDrag.current) {
      const d = scene.huntAreaDrag.current;
      scene.huntAreaDrag.current = null;
      const area = {
        minX: Math.min(d.start.x, d.cur.x),
        minY: Math.min(d.start.y, d.cur.y),
        maxX: Math.max(d.start.x, d.cur.x),
        maxY: Math.max(d.start.y, d.cur.y),
        z: d.start.z
      };
      scene.huntArea.current = area;
      inputs.current.onHuntArea(area);
      inputs.current.onHuntAreaSelecting(false);
      emit(`Hunt area: ${area.maxX - area.minX + 1} x ${area.maxY - area.minY + 1}`);
      return;
    }
    const bs = selection.box.current;
    if (bs) {
      selection.box.current = null;
      setBoxing(false);
      const tool = inputs.current.activeTool;
      const holdGhost = tool === 'brush' && !bs.additive;
      if (!holdGhost) clearBoxPreview();
      if (tool === 'brush') {
        if (bs.additive) eraseBox(bs);
        else paintBox(bs);
      } else if (tool === 'eraser') {
        eraseBox(bs);
      } else if (tool === 'borderize') {
        borderizeBox(bs, bs.additive);
      } else if (isZoneTool(tool)) {
        paintZoneBox(bs, !bs.additive);
      } else if (tool === 'house') {
        housePaintBox(bs, !bs.additive);
      } else {
        const boxes = selectionFloorBoxes(
          bs.startTile.z,
          inputs.current.selectionMode,
          inputs.current.compensateSelection,
          bs.startTile.x,
          bs.startTile.y,
          bs.curTile.x,
          bs.curTile.y
        );
        boxes.forEach((b, i) => selection.selectBox(b.z, b.ax, b.ay, b.bx, b.by, bs.additive || i > 0));
        for (const b of boxes) selectMarkersInBox(b.z, b.ax, b.ay, b.bx, b.by);
        inputs.current.onSelect(toSelected(hoverAt(bs.curTile)));
        emit(`Selected ${plural(selection.entries.current.size, 'tile')}`);
      }
    }
    finishMove();
    finishCreatureStroke();
    finishMarkerEraseStroke();
    camera.endPan();
    scene.painting.current = false;
    scene.erasing.current = false;
    scene.eraseBrushId.current = null;
    zonePainting.current = false;
    housePainting.current = false;
    borderizing.current = false;
    scene.lastPaintKey.current = null;
  }

  function onDoubleClick() {
    if (inputs.current.activeTool === 'pen') penFinish();
  }

  function onMouseLeave() {
    if (menu) return;
    if (camera.panning) return;
    selection.box.current = null;
    setBoxing(false);
    clearBoxPreview();
    finishMove();
    finishCreatureStroke();
    finishMarkerEraseStroke();
    scene.painting.current = false;
    scene.erasing.current = false;
    scene.eraseBrushId.current = null;
    zonePainting.current = false;
    housePainting.current = false;
    borderizing.current = false;
    scene.lastPaintKey.current = null;
    scene.lastHoverKey.current = null;
    scene.hoveredTile.current = null;
    scene.mouseScreen.current = null;
    inputs.current.onHover(null);
  }

  function goTo(pos: Position) {
    camera.centerOn(pos);
    inputs.current.onFloorChange(pos.z);
    setMenu(null);
    setGotoForm(null);
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    if (modalOpen.current || !canvasRef.current) return;
    if (huntEditingActive()) {
      const ni = huntNodeAt(tileAt(e));
      if (ni >= 0) {
        const s = scene.huntSession.current!;
        s.nodes.splice(ni, 1);
        scene.huntSelected.current = null;
        scene.huntDrag.current = null;
        rebuildHuntRoute();
        rescatterHunt();
        emit(`Removed box - ${s.nodes.length} left`);
        return;
      }
    }
    if (inputs.current.activeTool === 'pen') {
      penCancel();
      return;
    }
    if (scene.importGhost.current) {
      inputs.current.onImportCancel?.();
      emit('Import cancelled');
      return;
    }
    if (scene.pasteGhost.current) {
      scene.pasteGhost.current = null;
      emit('Paste cancelled');
      return;
    }
    if (inputs.current.activeBrush) inputs.current.onSelectBrush(null);
    if (inputs.current.activeTool !== 'select') inputs.current.onToolChange('select');
    const tile = tileAt(e);
    const info = hoverAt(tile);
    if (!selectByPriority(tile)) selection.selectTile(tile, false);
    inputs.current.onSelect(toSelected(info));
    inputs.current.onHover(info);
    const dest = inputs.current.map.teleports.get(`${tile.x},${tile.y},${tile.z}`) ?? null;
    const spawnSel = selection.spawn.current;
    const creatureSel = selection.creature.current;
    const waypointSel = selection.waypoint.current;
    const onMarker = !!spawnSel || !!creatureSel || !!waypointSel;
    const ct = tiles.get(Math.floor(tile.x / CHUNK), Math.floor(tile.y / CHUNK), tile.z, scene.frameTick.current);
    let houseId: number | null = null;
    if (ct) {
      for (let i = 0; i < ct.tileX.length; i++) {
        if (ct.tileX[i] === tile.x && ct.tileY[i] === tile.y) {
          houseId = ct.houseIds[i] || null;
          break;
        }
      }
    }
    const top = onMarker ? null : info.item;
    const topRef = top ? brushForItem(top.serverId) : null;
    const groundHover = onMarker ? null : topRef?.kind === 'ground' ? top : groundAt(tile);
    const groundName = groundHover
      ? topRef?.kind === 'ground'
        ? topRef.name
        : (brushForItem(groundHover.serverId)?.name ?? null)
      : null;
    const doodadHover = topRef?.kind === 'doodad' ? top : null;
    setMenu({
      clientX: e.clientX,
      clientY: e.clientY,
      tile,
      dest,
      item: top,
      ground: groundHover,
      groundName,
      doodad: doodadHover,
      doodadName: doodadHover ? topRef!.name : null,
      spawn: spawnSel ? { x: spawnSel.x, y: spawnSel.y, z: spawnSel.z } : null,
      creature: creatureSel ? { x: creatureSel.x, y: creatureSel.y, z: creatureSel.z } : null,
      waypoint: waypointSel ? { x: waypointSel.x, y: waypointSel.y, z: waypointSel.z } : null,
      houseId,
      hasSelection:
        selection.entries.current.size > 0 ||
        selection.spawns.current.size > 0 ||
        selection.creatures.current.size > 0 ||
        !!selection.spawn.current ||
        !!selection.creature.current ||
        !!selection.waypoint.current,
      canPaste: clipboardCount.current > 0
    });
  }

  function selectRaw(item: HoverItem) {
    const thing = inputs.current.items.get(item.clientId);
    inputs.current.onSelectBrush({
      key: `raw-${item.serverId}`,
      name: item.name || `Item ${item.serverId}`,
      kind: 'rawItem',
      serverId: item.serverId,
      isGround: thing?.isGround ?? false,
      cols: thing?.width ?? 1,
      rows: thing?.height ?? 1,
      preview: buildItemPreview(thing, atlas.data.current)
    });
    inputs.current.onRevealBrush?.('raw', item.serverId);
    setMenu(null);
  }

  function selectHouse(houseId: number) {
    inputs.current.onSelectHouse(houseId);
    setMenu(null);
  }

  function selectCreatureBrush(pos: Position) {
    const key = `${pos.z},${Math.floor(pos.x / CHUNK)},${Math.floor(pos.y / CHUNK)}`;
    const c = inputs.current.spawns?.byChunk.get(key)?.find((p) => p.x === pos.x && p.y === pos.y);
    if (!c) return;
    inputs.current.onSelectBrush({
      key: `creature:${c.name}`,
      name: c.name,
      kind: 'creature',
      isGround: false,
      lookType: c.lookType,
      isNpc: c.isNpc,
      head: c.head,
      body: c.body,
      legs: c.legs,
      feet: c.feet
    });
    inputs.current.onRevealBrush?.('creature', 0, c.name);
    setMenu(null);
  }

  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  React.useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      scene.ctrlDown.current = e.ctrlKey;
      if (inputs.current.activeTool === 'pen' && !penDrag.current) {
        const ctrl = e.ctrlKey || e.metaKey;
        setPenCursorIfChanged(penCursorFor(ctrl, e.altKey));
        penHot.current = penHotFor(ctrl, e.altKey);
      }
    };
    const clear = () => {
      scene.ctrlDown.current = false;
    };
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (inputs.current.activeTool === 'pen') {
        if (e.key === 'Enter') {
          e.preventDefault();
          penFinish();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          penCancel();
          return;
        }
      }
      if (e.key === 'Escape' && inputs.current.placingWaypoint) {
        inputs.current.onPlaceWaypoint();
        return;
      }
      if (e.key === 'Escape' && scene.pasteGhost.current) {
        scene.pasteGhost.current = null;
        emit('Paste cancelled');
        return;
      }
      if (modalOpen.current) return;
      if (e.altKey && e.code === 'Backspace') {
        e.preventDefault();
        fillSelection();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && key === 'c') {
        e.preventDefault();
        copySelected();
        return;
      }
      if (mod && key === 'x') {
        e.preventDefault();
        cutSelected();
        return;
      }
      if (mod && key === 'v') {
        e.preventDefault();
        if (clipboardCount.current === 0) {
          emit('Clipboard empty');
          return;
        }
        scene.pasteGhost.current = clipboardGhostSource.current ?? [];
        emit('Click to paste, Esc to cancel');
        return;
      }
      if (
        e.key === 'Delete' &&
        (selection.entries.current.size > 0 ||
          selection.spawn.current ||
          selection.creature.current ||
          selection.waypoint.current)
      ) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
    handlers: { onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onContextMenu, onDoubleClick },
    pen: { anchorsRef: penAnchors, hoverRef: penHover, hotRef: penHot },
    penCursor,
    moving,
    boxing,
    spaceHeld,
    menu,
    gotoForm,
    spawnForm,
    creatureForm,
    beginSpawnResize,
    beginHuntAreaResize,
    submitSpawnForm,
    closeSpawnForm: () => setSpawnForm(null),
    spawnProperties: openSpawnProperties,
    submitCreatureForm,
    closeCreatureForm: () => setCreatureForm(null),
    creatureProperties: openCreatureProperties,
    selectCreature: selectCreatureBrush,
    waypointForm,
    submitWaypointForm,
    closeWaypointForm: () => setWaypointForm(null),
    waypointProperties: openWaypointProperties,
    addWaypointHere,
    editWaypoints,
    selectRaw,
    selectGround,
    selectDoodad,
    selectHouse,
    generate,
    huntPreview,
    rescatterHunt,
    generateHunt,
    clearHunt,
    clearHuntPreview,
    goTo,
    cut: () => {
      cutSelected();
      setMenu(null);
    },
    copy: () => {
      copySelected();
      setMenu(null);
    },
    paste: (pos: Position) => {
      pasteAt(pos);
      setMenu(null);
    },
    deleteSelected: () => {
      deleteSelected();
      setMenu(null);
    },
    copyPosition: (pos: Position) => {
      copyPosition(pos);
      setMenu(null);
    },
    copyText: (text: string) => {
      copyText(text);
      emit('Copied to clipboard');
      setMenu(null);
    },
    openGoto: (tile: Position) => {
      setGotoForm(tile);
      setMenu(null);
    },
    closeGoto: () => setGotoForm(null),
    refetchTagged,
    invalidateTagged
  };
}
