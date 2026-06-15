import React from 'react';

import { Position } from '~/domain/map';
import { isZoneTool } from '~/domain/tools';
import { ZONE_TOOL_FLAG } from '~/domain/zones';
import { buildItemPreview } from '~/usecase/itemPreview';
import { formatPosition } from '~/usecase/positionFormat';
import { MapSpawns, emptyMapSpawns } from '~/domain/creature';
import { waypointAt, MapWaypoints, emptyMapWaypoints } from '~/domain/waypoint';
import { TILE, CHUNK, MOVE_THRESHOLD_SQ } from '~/components/MapCanvas/constants';
import { addWaypoint, moveWaypoint, removeWaypoint, renameWaypoint, nextWaypointName } from '~/usecase/waypointEdits';
import {
  HoverInfo,
  HoverItem,
  SpawnForm,
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
  moveItem,
  undoEdit,
  redoEdit,
  setHouse,
  eraseArea,
  paintZone,
  deleteItem,
  paintTiles,
  previewPaint,
  packChunkKey,
  copySelection,
  fetchMapChunks,
  pasteSelection,
  deleteSelection
} from '~/adapter/map';

import { MapScene } from './useMapScene';
import { MapCamera } from './useMapCamera';
import { SpriteAtlas } from './useSpriteAtlas';
import { buildTopItemMesh } from './meshBuilder';
import { ChunkTilesCache } from './useChunkTiles';
import { ChunkMeshCache } from './useChunkMeshes';
import { Selection, BoxSelection } from './useSelection';

type EditEntry =
  | { kind: 'item' }
  | { kind: 'spawn'; before: MapSpawns; after: MapSpawns }
  | { kind: 'waypoint'; before: MapWaypoints; after: MapWaypoints };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

export function useMapInteraction(deps: InteractionDeps) {
  const { canvasRef, camera, inputs, atlas, tiles, meshes, selection, scene } = deps;

  const [moving, setMoving] = React.useState(false);
  const [boxing, setBoxing] = React.useState(false);
  const [menu, setMenu] = React.useState<ContextMenuState | null>(null);
  const [gotoForm, setGotoForm] = React.useState<Position | null>(null);
  const [spawnForm, setSpawnForm] = React.useState<SpawnForm | null>(null);
  const [creatureForm, setCreatureForm] = React.useState<CreatureForm | null>(null);
  const [waypointForm, setWaypointForm] = React.useState<WaypointForm | null>(null);
  const clipboardCount = React.useRef(0);
  const modalOpen = React.useRef(false);
  modalOpen.current = spawnForm !== null || creatureForm !== null || waypointForm !== null;

  const undoTimeline = React.useRef<EditEntry[]>([]);
  const redoTimeline = React.useRef<EditEntry[]>([]);

  function recordItemEdit() {
    undoTimeline.current.push({ kind: 'item' });
    redoTimeline.current = [];
  }

  function editSpawns(next: MapSpawns) {
    undoTimeline.current.push({ kind: 'spawn', before: inputs.current.spawns ?? emptyMapSpawns(), after: next });
    redoTimeline.current = [];
    inputs.current.onEditSpawns(next);
  }

  function editWaypoints(next: MapWaypoints) {
    undoTimeline.current.push({ kind: 'waypoint', before: inputs.current.waypoints ?? emptyMapWaypoints(), after: next });
    redoTimeline.current = [];
    inputs.current.onEditWaypoints(next);
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
      undoTimeline.current.push({ kind: 'spawn', before, after });
      redoTimeline.current = [];
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
    const base = inputs.current.spawns ?? emptyMapSpawns();
    if (md.kind === 'creature') {
      editSpawns(moveCreature(base, md.from, dest));
      selection.selectCreature(dest);
    } else {
      editSpawns(moveSpawn(base, md.from, dest));
      selection.selectSpawn(dest);
    }
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

  function paintAt(pos: Position) {
    const brush = inputs.current.activeBrush;
    if (!brush || brush.serverId == null) return;
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    paintTiles(
      inputs.current.map.id,
      pos.z,
      [pos.x],
      [pos.y],
      brush.serverId,
      brush.isGround,
      brush.kind === 'doodad',
      inputs.current.automagic
    )
      .then((touched) => {
        if (touched.length === 0) tiles.queueRefetch(pos.x, pos.y, pos.z);
        for (const key of touched) tiles.queueRefetch((key >>> 16) * CHUNK, (key & 0xffff) * CHUNK, pos.z);
        notifyEdit(pos.z);
      })
      .catch((err) => console.error('Failed to paint tile', err));
  }

  function boxTiles(bs: BoxSelection) {
    const minX = Math.min(bs.startTile.x, bs.curTile.x);
    const maxX = Math.max(bs.startTile.x, bs.curTile.x);
    const minY = Math.min(bs.startTile.y, bs.curTile.y);
    const maxY = Math.max(bs.startTile.y, bs.curTile.y);
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
      inputs.current.automagic
    )
      .then((touched) => refetchKeysNow(touched, z))
      .catch((err) => console.error('Failed to paint box', err));
  }

  const zonePainting = React.useRef(false);
  const zoneMode = React.useRef<{ flag: number; set: boolean } | null>(null);

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
    emit('House exit set');
  }

  function eraseBox(bs: BoxSelection) {
    const z = bs.startTile.z;
    const x0 = Math.min(bs.startTile.x, bs.curTile.x);
    const y0 = Math.min(bs.startTile.y, bs.curTile.y);
    const x1 = Math.max(bs.startTile.x, bs.curTile.x);
    const y1 = Math.max(bs.startTile.y, bs.curTile.y);
    eraseArea(inputs.current.map.id, z, x0, y0, x1, y1, inputs.current.automagic)
      .then((touched) => refetchKeysNow(touched, z))
      .catch((err) => console.error('Failed to erase box', err));
  }

  function clearBoxPreview() {
    previewKey.current = null;
    scene.boxGhostTiles.current = null;
  }

  function updateBoxPreview() {
    const bs = selection.box.current;
    const brush = inputs.current.activeBrush;
    if (!bs || inputs.current.activeTool !== 'brush' || !brush || brush.serverId == null || !inputs.current.automagic) {
      clearBoxPreview();
      return;
    }
    const z = bs.startTile.z;
    const { xs, ys } = boxTiles(bs);
    const key = `${z},${brush.serverId},${xs[0]},${ys[0]},${xs[xs.length - 1]},${ys[ys.length - 1]}`;
    if (key === previewKey.current) return;
    previewKey.current = key;
    const seq = ++previewSeq.current;
    previewPaint(inputs.current.map.id, z, xs, ys, brush.serverId, brush.isGround, brush.kind === 'doodad')
      .then((tiles) => {
        if (seq === previewSeq.current) scene.boxGhostTiles.current = tiles;
      })
      .catch((err) => console.error('Failed to preview paint', err));
  }

  function eraseAt(pos: Position) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (key === scene.lastPaintKey.current) return;
    scene.lastPaintKey.current = key;
    deleteItem(inputs.current.map.id, pos.z, pos.x, pos.y, inputs.current.automagic)
      .then((touched) => {
        if (touched.length === 0) tiles.queueRefetch(pos.x, pos.y, pos.z);
        for (const key of touched) tiles.queueRefetch((key >>> 16) * CHUNK, (key & 0xffff) * CHUNK, pos.z);
        notifyEdit(pos.z);
      })
      .catch((err) => console.error('Failed to erase tile', err));
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

  async function refetchKeysNow(keys: number[], z: number) {
    if (keys.length === 0) return;
    const res = await fetchMapChunks(inputs.current.map.id, z, keys);
    for (const k of keys) {
      const cx = k >>> 16;
      const cy = k & 0xffff;
      tiles.store(`${z},${cx},${cy}`, res.get(`${cx},${cy}`) ?? null, scene.frameTick.current);
      meshes.forget(`${z},${cx},${cy}`);
    }
    notifyEdit(z);
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
        const thing = items.get(clientId);
        item = { serverId, clientId, name: itemNames.get(serverId) ?? thing?.marketName ?? '', count };
      }
    }
    return { x: pos.x, y: pos.y, z: pos.z, hasTile: found >= 0, item };
  }

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
    return { serverId, clientId, name: itemNames.get(serverId) ?? thing.marketName ?? '', count: 1 };
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
    const ctx = { items: inputs.current.items, tiles, atlas };
    scene.pendingMove.current = buildTopItemMesh(
      ctx,
      scene.frameTick.current,
      inputs.current.floorZ,
      from,
      dest.x - from.x,
      dest.y - from.y
    );
    recordItemEdit();
    moveItem(inputs.current.map.id, from.z, from.x, from.y, dest.x, dest.y, inputs.current.automagic)
      .then((touched) => refetchKeysNow(touched, from.z))
      .then(() => {
        selection.selectTile(dest, false);
        atlas.version.current++;
        inputs.current.onSelect(hoverAt(dest).item);
      })
      .catch((err) => console.error('Failed to move item', err))
      .finally(() => {
        scene.pendingMove.current = null;
      });
  }

  function deleteSelected(silent = false) {
    const base = inputs.current.spawns ?? emptyMapSpawns();
    if (selection.creature.current) {
      editSpawns(removeCreatureAt(base, selection.creature.current));
      selection.selectCreature(null);
      inputs.current.onSelect(null);
      if (!silent) emit('Creature deleted');
      return;
    }
    if (selection.spawn.current) {
      editSpawns(removeSpawnAt(base, selection.spawn.current));
      selection.selectSpawn(null);
      inputs.current.onSelect(null);
      if (!silent) emit('Spawn deleted');
      return;
    }
    if (selection.waypoint.current) {
      const wps = inputs.current.waypoints ?? emptyMapWaypoints();
      const wp = waypointAt(wps, selection.waypoint.current.x, selection.waypoint.current.y, selection.waypoint.current.z);
      if (wp) editWaypoints(removeWaypoint(wps, wp.name));
      selection.selectWaypoint(null);
      inputs.current.onSelect(null);
      if (wp && !silent) emit(`Waypoint "${wp.name}" deleted`);
      return;
    }
    const selTiles = [...selection.entries.current.values()];
    if (selTiles.length === 0) return;
    const z = selTiles[0].z;
    const xs = selTiles.map((t) => t.x);
    const ys = selTiles.map((t) => t.y);
    const all = selTiles.map((t) => t.all);
    const count = selTiles.length;
    recordItemEdit();
    deleteSelection(inputs.current.map.id, z, xs, ys, all, inputs.current.automagic)
      .then((touched) => {
        selection.clear();
        return refetchKeysNow(touched, z);
      })
      .then(() => {
        atlas.version.current++;
        inputs.current.onSelect(null);
        if (!silent) emit(`Deleted ${plural(count, 'tile')}`);
      })
      .catch((err) => {
        console.error('Failed to delete selection', err);
        emit('Delete failed');
      });
  }

  function selectionArrays() {
    const sel = [...selection.entries.current.values()];
    if (sel.length === 0) return null;
    return { z: sel[0].z, xs: sel.map((t) => t.x), ys: sel.map((t) => t.y), all: sel.map((t) => t.all) };
  }

  function copySelected(silent = false): Promise<number> {
    const s = selectionArrays();
    if (!s) {
      if (!silent) emit('Nothing to copy');
      return Promise.resolve(0);
    }
    return copySelection(inputs.current.map.id, s.z, s.xs, s.ys, s.all)
      .then((n) => {
        clipboardCount.current = n;
        if (!silent) emit(`Copied ${plural(n, 'tile')}`);
        return n;
      })
      .catch((err) => {
        console.error('Copy failed', err);
        emit('Copy failed');
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
    recordItemEdit();
    pasteSelection(inputs.current.map.id, pos.x, pos.y, pos.z)
      .then((touched) => refetchKeysNow(touched, pos.z))
      .then(() => {
        atlas.version.current++;
        emit(`Pasted ${plural(count, 'tile')}`);
      })
      .catch((err) => {
        console.error('Paste failed', err);
        emit('Paste failed');
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

  function selectGround(item: HoverItem) {
    const thing = inputs.current.items.get(item.clientId);
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

  function applyHistory(pairs: [number, number][]) {
    if (pairs.length === 0) return;
    Promise.all(pairs.map(([z, key]) => refetchChunkNow((key >>> 16) * CHUNK, (key & 0xffff) * CHUNK, z)))
      .then(() => {
        atlas.version.current++;
        const tile = scene.hoveredTile.current;
        if (tile) inputs.current.onSelect(hoverAt(tile).item);
      })
      .catch((err) => console.error('Failed to refresh after history', err));
  }

  async function undo() {
    while (undoTimeline.current.length > 0) {
      const e = undoTimeline.current.pop()!;
      if (e.kind === 'spawn') {
        redoTimeline.current.push(e);
        inputs.current.onEditSpawns(e.before);
        emit('Undo');
        return;
      }
      if (e.kind === 'waypoint') {
        redoTimeline.current.push(e);
        inputs.current.onEditWaypoints(e.before);
        emit('Undo');
        return;
      }
      try {
        const touched = await undoEdit(inputs.current.map.id);
        if (touched.length > 0) {
          redoTimeline.current.push(e);
          applyHistory(touched);
          emit('Undo');
          return;
        }
      } catch (err) {
        console.error('Undo failed', err);
        emit('Undo failed');
        return;
      }
    }
    emit('Nothing to undo');
  }

  async function redo() {
    while (redoTimeline.current.length > 0) {
      const e = redoTimeline.current.pop()!;
      if (e.kind === 'spawn') {
        undoTimeline.current.push(e);
        inputs.current.onEditSpawns(e.after);
        emit('Redo');
        return;
      }
      if (e.kind === 'waypoint') {
        undoTimeline.current.push(e);
        inputs.current.onEditWaypoints(e.after);
        emit('Redo');
        return;
      }
      try {
        const touched = await redoEdit(inputs.current.map.id);
        if (touched.length > 0) {
          undoTimeline.current.push(e);
          applyHistory(touched);
          emit('Redo');
          return;
        }
      } catch (err) {
        console.error('Redo failed', err);
        emit('Redo failed');
        return;
      }
    }
    emit('Nothing to redo');
  }

  function onMouseDown(e: React.MouseEvent) {
    if (modalOpen.current) return;
    if (e.button === 1) {
      e.preventDefault();
      camera.beginPan(e);
      return;
    }
    if (e.button !== 0) return;

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
    const brush = inputs.current.activeBrush;
    const canBrush = tool === 'brush' && brush != null && brush.serverId != null;
    const zoneTool = isZoneTool(tool);
    if (e.shiftKey && (tool === 'select' || tool === 'eraser' || zoneTool || canBrush || tool === 'house')) {
      const pos = tileAt(e);
      selection.box.current = { startTile: pos, curTile: pos, additive: e.ctrlKey };
      setBoxing(true);
      updateBoxPreview();
      return;
    }
    if (canBrush) {
      scene.painting.current = true;
      scene.lastPaintKey.current = null;
      recordItemEdit();
      paintAt(tileAt(e));
      return;
    }
    if (zoneTool) {
      zonePainting.current = true;
      zoneMode.current = { flag: ZONE_TOOL_FLAG[tool], set: !e.ctrlKey };
      scene.lastPaintKey.current = null;
      recordItemEdit();
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
      recordItemEdit();
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
      scene.erasing.current = true;
      scene.lastPaintKey.current = null;
      recordItemEdit();
      eraseAt(tileAt(e));
      return;
    }

    const pos = tileAt(e);
    if (selectByPriority(pos)) {
      beginMarkerDrag(e, pos);
    } else {
      selection.selectTile(pos, false);
      scene.moveDest.current = pos;
      scene.moveDrag.current = { from: pos, startX: e.clientX, startY: e.clientY, active: false };
    }
    inputs.current.onSelect(hoverAt(pos).item);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (modalOpen.current) return;
    if (creatureStroke.current) {
      applyCreatureAt(tileAt(e));
    } else if (scene.painting.current) {
      paintAt(tileAt(e));
    } else if (zonePainting.current) {
      paintZoneAt(tileAt(e));
    } else if (housePainting.current) {
      housePaintAt(tileAt(e));
    } else if (scene.erasing.current) {
      eraseAt(tileAt(e));
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
    const bs = selection.box.current;
    if (bs) {
      selection.box.current = null;
      setBoxing(false);
      clearBoxPreview();
      const tool = inputs.current.activeTool;
      if (tool === 'brush') {
        recordItemEdit();
        paintBox(bs);
      } else if (tool === 'eraser') {
        recordItemEdit();
        eraseBox(bs);
      } else if (isZoneTool(tool)) {
        recordItemEdit();
        paintZoneBox(bs, !bs.additive);
      } else if (tool === 'house') {
        recordItemEdit();
        housePaintBox(bs, !bs.additive);
      } else {
        selection.selectBox(bs.startTile.z, bs.startTile.x, bs.startTile.y, bs.curTile.x, bs.curTile.y, bs.additive);
        inputs.current.onSelect(hoverAt(bs.curTile).item);
      }
    }
    finishMove();
    finishCreatureStroke();
    camera.endPan();
    scene.painting.current = false;
    scene.erasing.current = false;
    zonePainting.current = false;
    housePainting.current = false;
    scene.lastPaintKey.current = null;
  }

  function onMouseLeave() {
    if (menu) return;
    if (camera.panning) return;
    selection.box.current = null;
    setBoxing(false);
    clearBoxPreview();
    finishMove();
    finishCreatureStroke();
    scene.painting.current = false;
    scene.erasing.current = false;
    zonePainting.current = false;
    housePainting.current = false;
    scene.lastPaintKey.current = null;
    scene.lastHoverKey.current = null;
    scene.hoveredTile.current = null;
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
    if (inputs.current.activeBrush) inputs.current.onSelectBrush(null);
    if (inputs.current.activeTool !== 'select') inputs.current.onToolChange('select');
    const tile = tileAt(e);
    const info = hoverAt(tile);
    if (!selectByPriority(tile)) selection.selectTile(tile, false);
    inputs.current.onSelect(info.item);
    inputs.current.onHover(info);
    const dest = inputs.current.map.teleports.get(`${tile.x},${tile.y},${tile.z}`) ?? null;
    const spawnSel = selection.spawn.current;
    const creatureSel = selection.creature.current;
    const waypointSel = selection.waypoint.current;
    const onMarker = !!spawnSel || !!creatureSel || !!waypointSel;
    setMenu({
      clientX: e.clientX,
      clientY: e.clientY,
      tile,
      dest,
      item: onMarker ? null : info.item,
      ground: onMarker ? null : groundAt(tile),
      spawn: spawnSel ? { x: spawnSel.x, y: spawnSel.y, z: spawnSel.z } : null,
      creature: creatureSel ? { x: creatureSel.x, y: creatureSel.y, z: creatureSel.z } : null,
      waypoint: waypointSel ? { x: waypointSel.x, y: waypointSel.y, z: waypointSel.z } : null,
      hasSelection:
        selection.entries.current.size > 0 ||
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
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape' && inputs.current.placingWaypoint) {
        inputs.current.onPlaceWaypoint();
        return;
      }
      if (modalOpen.current) return;
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
        const t = scene.hoveredTile.current;
        if (t) pasteAt(t);
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
    handlers: { onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onContextMenu },
    moving,
    boxing,
    menu,
    gotoForm,
    spawnForm,
    creatureForm,
    beginSpawnResize,
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
    closeGoto: () => setGotoForm(null)
  };
}
