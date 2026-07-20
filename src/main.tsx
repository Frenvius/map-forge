import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { House } from '~/domain/house';
import { Thing } from '~/domain/thing';
import { cornerOf } from '~/usecase/dock';
import Toolbar from '~/components/Toolbar';
import MapTabs from '~/components/MapTabs';
import { MapHouses } from '~/domain/house';
import MapTowns from '~/components/MapTowns';
import { loadHouses } from '~/adapter/houses';
import IdMarkers from '~/components/IdMarkers';
import MapCanvas from '~/components/MapCanvas';
import Workspace from '~/components/Workspace';
import { openDataDir } from '~/adapter/assets';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { loadSpawns } from '~/adapter/creatures';
import ToolsPanel from '~/components/ToolsPanel';
import AboutDialog from '~/components/AboutDialog';
import { MIN_ZOOM, MAX_ZOOM } from '~/usecase/zoom';
import PalettePanel from '~/components/PalettePanel';
import { serializeHouseXml } from '~/adapter/houses';
import ScriptEditor from '~/components/ScriptEditor';
import { Town, MapView, Position } from '~/domain/map';
import MapProperties from '~/components/MapProperties';
import MapStatistics from '~/components/MapStatistics';
import AssetsMissing from '~/components/AssetsMissing';
import { Button } from '~/components/commons/ui/button';
import { useSetting } from '~/usecase/hooks/useSetting';
import { serializeSpawnXml } from '~/usecase/spawnEdits';
import { formatPosition } from '~/usecase/positionFormat';
import { Waypoint, MapWaypoints } from '~/domain/waypoint';
import { serializeWaypointXml } from '~/adapter/waypoints';
import Minimap, { MinimapApi } from '~/components/Minimap';
import PanelDockMenu from '~/components/Dock/PanelDockMenu';
import { useDock } from '~/usecase/hooks/Workspace/useDock';
import { SPRITE_SIZE, getSpriteIndex } from '~/domain/tibia';
import { PanelId, baseKind, panelMeta } from '~/domain/dock';
import Preferences, { TabId } from '~/components/Preferences';
import { MapSpawns, buildMapSpawns } from '~/domain/creature';
import SaveProgressModal from '~/components/SaveProgressModal';
import CreatureDataDialog from '~/components/CreatureDataDialog';
import StatusBar, { StatusBarApi } from '~/components/StatusBar';
import { useMapTabs } from '~/usecase/hooks/Workspace/useMapTabs';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { TooltipProvider } from '~/components/commons/ui/tooltip';
import ItemPropertiesPanel from '~/components/ItemPropertiesPanel';
import { useTool, ToolProvider } from '~/usecase/context/ToolContext';
import { useMapSpawns } from '~/usecase/hooks/Workspace/useMapSpawns';
import { useMapHouses } from '~/usecase/hooks/Workspace/useMapHouses';
import { HoverInfo, SelectedItem } from '~/components/MapCanvas/types';
import { addWaypoint, nextWaypointName } from '~/usecase/waypointEdits';
import { useMapCreatures } from '~/usecase/hooks/Workspace/useMapCreatures';
import { useMapWaypoints } from '~/usecase/hooks/Workspace/useMapWaypoints';
import { useAppShortcuts } from '~/usecase/hooks/Workspace/useAppShortcuts';
import { getTowns, getMapProperties, setMapProperties } from '~/adapter/map';
import { AssetsProvider, useAssetsBundle } from '~/usecase/context/AssetsContext';
import { useEditorSettings, EditorSettingsProvider } from '~/usecase/context/EditorSettingsContext';
import { houseSizes, importLoad, importCommit, importCancel, importPreview, ImportPreview } from '~/adapter/map';
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription
} from '~/components/commons/ui/dialog';

import './styles/index.css';

const dirOf = (path: string) => path.replace(/[^\\/]+$/, '');
const spawnFileFallback = (path: string) => (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-spawn.xml');

const spriteBlockFor = (
  clientId: number,
  items: Map<number, Thing>,
  sprites: Map<number, LoadedSprite>,
  cellPx: number,
  cache: Map<number, Uint8ClampedArray | null>
): Uint8ClampedArray | null => {
  if (clientId === 0) return null;
  const hit = cache.get(clientId);
  if (hit !== undefined) return hit;
  const thing = items.get(clientId);
  const spriteId = thing ? thing.spriteIndex[getSpriteIndex(thing, 0, 0, 0, 0, 0, 0, 0)] : 0;
  const spr = spriteId ? sprites.get(spriteId) : undefined;
  if (!spr || spr.empty) {
    cache.set(clientId, null);
    return null;
  }
  const block = new Uint8ClampedArray(cellPx * cellPx * 4);
  for (let by = 0; by < cellPx; by++) {
    const sy = ((by * SPRITE_SIZE) / cellPx) | 0;
    for (let bx = 0; bx < cellPx; bx++) {
      const sx = ((bx * SPRITE_SIZE) / cellPx) | 0;
      const so = (sy * SPRITE_SIZE + sx) * 4;
      const bo = (by * cellPx + bx) * 4;
      block[bo] = spr.rgba[so];
      block[bo + 1] = spr.rgba[so + 1];
      block[bo + 2] = spr.rgba[so + 2];
      block[bo + 3] = spr.rgba[so + 3];
    }
  }
  cache.set(clientId, block);
  return block;
};

const buildImportSpriteThumbnail = async (
  preview: ImportPreview,
  items: Map<number, Thing>,
  sprPath: string,
  transparency: boolean
): Promise<HTMLCanvasElement | null> => {
  const { width, height, ground, top } = preview;
  if (width === 0 || height === 0) return null;

  const spriteIds: number[] = [];
  const seen = new Set<number>();
  for (const cid of [...ground, ...top]) {
    if (cid === 0 || seen.has(cid)) continue;
    seen.add(cid);
    const thing = items.get(cid);
    if (!thing) continue;
    const sid = thing.spriteIndex[getSpriteIndex(thing, 0, 0, 0, 0, 0, 0, 0)];
    if (sid) spriteIds.push(sid);
  }

  const sprites = new Map<number, LoadedSprite>();
  await loadSprites(sprPath, spriteIds, transparency, sprites).catch(() => undefined);

  const cellPx = Math.max(2, Math.min(8, Math.floor(2048 / Math.max(width, height))));
  const rowStride = cellPx * 4;
  const bW = width * cellPx;
  const bH = height * cellPx;
  const buf = new Uint8ClampedArray(bW * bH * 4);
  const cache = new Map<number, Uint8ClampedArray | null>();
  let drew = false;

  for (let i = 0; i < ground.length; i++) {
    const g = ground[i];
    const t = top[i];
    if (g === 0 && t === 0) continue;
    const cellX = (i % width) * cellPx;
    const cellY = Math.floor(i / width) * cellPx;

    const gb = spriteBlockFor(g, items, sprites, cellPx, cache);
    if (gb) {
      for (let by = 0; by < cellPx; by++) {
        const dst = ((cellY + by) * bW + cellX) * 4;
        buf.set(gb.subarray(by * rowStride, by * rowStride + rowStride), dst);
      }
      drew = true;
    }
    if (t !== 0 && t !== g) {
      const tb = spriteBlockFor(t, items, sprites, cellPx, cache);
      if (tb) {
        for (let p = 0; p < cellPx * cellPx; p++) {
          if (tb[p * 4 + 3] === 0) continue;
          const by = (p / cellPx) | 0;
          const bx = p % cellPx;
          const dst = ((cellY + by) * bW + cellX + bx) * 4;
          buf[dst] = tb[p * 4];
          buf[dst + 1] = tb[p * 4 + 1];
          buf[dst + 2] = tb[p * 4 + 2];
          buf[dst + 3] = tb[p * 4 + 3];
        }
        drew = true;
      }
    }
  }
  if (!drew) return null;

  const canvas = document.createElement('canvas');
  canvas.width = bW;
  canvas.height = bH;
  canvas.getContext('2d')?.putImageData(new ImageData(buf, bW, bH), 0, 0);
  return canvas;
};

const App = () => {
  const {
    assets,
    palette,
    status,
    error,
    dataDir,
    version,
    project,
    assetLabel,
    clientConfigured,
    assetsMissing,
    retryAssets,
    minimapReady,
    switchVersion,
    setStatus,
    setError
  } = useAssetsBundle();
  const {
    copyPositionFormat,
    reloadGeneral,
    reloadEditor,
    toggleShade,
    toggleAutomagic,
    toggleCreatures,
    toggleTooltips,
    toggleBlocking,
    toggleHouses,
    toggleWaypoints,
    toggleSpawns
  } = useEditorSettings();
  const { setPaletteCategory } = useTool();

  const [minimapOpen, setMinimapOpen] = useSetting('minimapOpen', false);
  const [propertiesOpen, setPropertiesOpen] = useSetting('propertiesOpen', false);
  const [idMarkersOpen, setIdMarkersOpen] = useSetting('idMarkersOpen', false);
  const [selectedItem, setSelectedItem] = React.useState<SelectedItem | null>(null);
  const [placingWaypoint, setPlacingWaypoint] = React.useState<string | null>(null);
  const [townsOpen, setTownsOpen] = React.useState(false);
  const [mapPropsOpen, setMapPropsOpen] = React.useState(false);
  const [statsOpen, setStatsOpen] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);
  const [scriptsOpen, setScriptsOpen] = React.useState(false);
  const [preferencesOpen, setPreferencesOpen] = React.useState(false);
  const [prefsTab, setPrefsTab] = React.useState<TabId>('general');
  const openPreferences = React.useCallback((tab: TabId = 'general') => {
    setPrefsTab(tab);
    setPreferencesOpen(true);
  }, []);

  const savingRef = React.useRef(false);
  const mapViewRef = React.useRef<MapView | null>(null);
  const statusApiRef = React.useRef<StatusBarApi | null>(null);
  const minimapApiRef = React.useRef<MinimapApi | null>(null);
  const mapCenterRef = React.useRef<((x: number, y: number) => void) | null>(null);
  const mapHighlightRef = React.useRef<((x: number, y: number, z: number) => void) | null>(null);
  const mapRefetchRef = React.useRef<((tagged: [number, number][]) => void) | null>(null);
  const [importGhost, setImportGhost] = React.useState<{
    width: number;
    height: number;
    minZ: number;
    maxZ: number;
    preview: HTMLCanvasElement | null;
  } | null>(null);
  const importCtx = React.useRef<{
    mapId: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    sourceHouses: House[];
    sourceSpawns: MapSpawns | null;
  } | null>(null);
  const [importBusy, setImportBusy] = React.useState<{ value: number; label: string } | null>(null);
  const spawnsRef = React.useRef<MapSpawns | null>(null);
  const spawnsDirty = React.useRef(false);
  const waypointsRef = React.useRef<MapWaypoints | null>(null);
  const waypointsDirty = React.useRef(false);
  const waypointEditRef = React.useRef<((next: MapWaypoints) => void) | null>(null);
  const housesRef = React.useRef<MapHouses | null>(null);
  const housesDirty = React.useRef(false);
  const activeIdRef = React.useRef<string | null>(null);
  const dirtyTabs = React.useRef<Set<string>>(new Set());
  const markActiveDirty = React.useCallback(() => {
    if (activeIdRef.current) dirtyTabs.current.add(activeIdRef.current);
  }, []);

  const handleHover = React.useCallback((info: HoverInfo | null) => statusApiRef.current?.setHover(info), []);
  const handleSelect = React.useCallback((item: SelectedItem | null) => {
    setSelectedItem(item);
    statusApiRef.current?.setSelectedItem(item);
  }, []);
  const handleStatus = React.useCallback((message: string) => statusApiRef.current?.flash(message), []);

  const persistSpawns = React.useCallback(async (mapId: number, path: string) => {
    if (!spawnsDirty.current || !spawnsRef.current) return;
    const props = await getMapProperties(mapId).catch(() => null);
    let file = props?.spawnFile ?? '';
    if (!file) {
      file = spawnFileFallback(path);
      if (props) {
        await setMapProperties(mapId, {
          width: props.width,
          height: props.height,
          description: props.description,
          spawnFile: file,
          houseFile: props.houseFile,
          otbmVersion: props.otbmVersion,
          itemsMinor: props.itemsMinor
        }).catch(() => undefined);
      }
    }
    await invoke('write_file_text', { path: dirOf(path) + file, contents: serializeSpawnXml(spawnsRef.current) });
    spawnsDirty.current = false;
  }, []);

  const persistWaypoints = React.useCallback(async (path: string) => {
    if (!waypointsDirty.current || !waypointsRef.current) return;
    const file = (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-waypoint.xml');
    await invoke('write_file_text', { path: dirOf(path) + file, contents: serializeWaypointXml(waypointsRef.current) });
    waypointsDirty.current = false;
  }, []);

  const persistHouses = React.useCallback(async (mapId: number, path: string) => {
    if (!housesDirty.current || !housesRef.current) return;
    const props = await getMapProperties(mapId).catch(() => null);
    let file = props?.houseFile ?? '';
    if (!file) {
      file = (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-house.xml');
      if (props) {
        await setMapProperties(mapId, {
          width: props.width,
          height: props.height,
          description: props.description,
          spawnFile: props.spawnFile,
          houseFile: file,
          otbmVersion: props.otbmVersion,
          itemsMinor: props.itemsMinor
        }).catch(() => undefined);
      }
    }
    const sizes = await houseSizes(mapId).catch(() => ({}));
    await invoke('write_file_text', { path: dirOf(path) + file, contents: serializeHouseXml(housesRef.current, sizes) });
    housesDirty.current = false;
  }, []);

  const persistSidecars = React.useCallback(
    async (mapId: number, path: string) => {
      await persistSpawns(mapId, path);
      await persistWaypoints(path);
      await persistHouses(mapId, path);
      if (activeIdRef.current) dirtyTabs.current.delete(activeIdRef.current);
    },
    [persistSpawns, persistWaypoints, persistHouses]
  );

  const {
    tabs,
    recent,
    active,
    activeId,
    itemNames,
    busy,
    progress,
    saving,
    setActiveId,
    closeTab,
    openPath,
    handleOpen,
    handleNew,
    handleSave,
    handleSaveAs,
    clearRecent,
    setFloorZ,
    setZoom,
    setView,
    patchActiveMap
  } = useMapTabs(assets, { setStatus, setError, onAfterSave: persistSidecars, version, switchVersion, retryAssets });

  activeIdRef.current = activeId;

  const {
    creatureDb,
    creatureTilesets,
    needsPicker: creatureNeedsPicker,
    resolving: creatureResolving,
    pickDir: pickCreatureDir
  } = useMapCreatures(active ? { id: active.id, path: active.path } : null, assets?.creatures ?? null, handleStatus);
  const [creatureDirSkipped, setCreatureDirSkipped] = React.useState<Set<string>>(new Set());
  const showCreatureDirDialog = creatureNeedsPicker && !creatureResolving && active != null && !creatureDirSkipped.has(active.id);
  const skipCreatureDir = React.useCallback(() => {
    setCreatureDirSkipped((prev) => (active ? new Set(prev).add(active.id) : prev));
  }, [active]);

  const { spawns, setSpawns } = useMapSpawns(
    active ? { id: active.id, path: active.path, mapId: active.map.id } : null,
    creatureDb
  );
  spawnsRef.current = spawns;

  const handleEditSpawns = React.useCallback(
    (next: MapSpawns) => {
      setSpawns(next);
      spawnsDirty.current = true;
      markActiveDirty();
    },
    [setSpawns, markActiveDirty]
  );

  const markWaypointsMigrated = React.useCallback(() => {
    waypointsDirty.current = true;
  }, []);

  const { waypoints, setWaypoints } = useMapWaypoints(
    active ? { id: active.id, path: active.path, mapId: active.map.id } : null,
    markWaypointsMigrated
  );
  waypointsRef.current = waypoints;

  const handleEditWaypoints = React.useCallback(
    (next: MapWaypoints) => {
      setWaypoints(next);
      waypointsDirty.current = true;
      markActiveDirty();
    },
    [setWaypoints, markActiveDirty]
  );

  const { houses, setHouses } = useMapHouses(active ? { id: active.id, path: active.path, mapId: active.map.id } : null);
  housesRef.current = houses;

  const [towns, setTownList] = React.useState<Town[]>([]);
  const activeMapId = active?.map.id ?? null;
  React.useEffect(() => {
    if (activeMapId === null) {
      setTownList([]);
      return;
    }
    let cancelled = false;
    void getTowns(activeMapId)
      .then((list) => {
        if (!cancelled) setTownList(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeMapId, townsOpen]);

  const gotoHouse = (h: House) => gotoPosition(h.entryX, h.entryY, h.entryZ);

  const handleEditHouses = React.useCallback(
    (next: MapHouses) => {
      setHouses(next);
      housesDirty.current = true;
      markActiveDirty();
    },
    [setHouses, markActiveDirty]
  );

  const markHousesDirty = React.useCallback(() => {
    housesDirty.current = true;
    markActiveDirty();
  }, [markActiveDirty]);

  const handleImportMap = React.useCallback(async () => {
    if (!active) return;
    const activeMapIdSnapshot = active.map.id;
    const selected = await open({
      multiple: false,
      title: 'Import map...',
      filters: [{ name: 'OTBM Maps', extensions: ['otbm'] }]
    });
    if (!selected || typeof selected !== 'string') return;
    setImportBusy({ value: 0, label: 'Reading map file...' });
    const unlisten = await listen<number>('import_load_progress', (e) =>
      setImportBusy({ value: e.payload, label: 'Reading map file...' })
    );
    try {
      const info = await importLoad(selected);
      const dir = dirOf(selected);
      const base = (selected.split(/[\\/]/).pop() ?? '').replace(/\.otbm$/i, '');
      const [sourceHouses, sourceSpawnsRaw] = await Promise.all([
        loadHouses(`${dir}${base}-house.xml`).catch(() => ({ list: [] })),
        creatureDb ? loadSpawns(`${dir}${base}-spawn.xml`, creatureDb).catch(() => null) : Promise.resolve(null)
      ]);
      importCtx.current = {
        mapId: activeMapIdSnapshot,
        minX: info.minX,
        minY: info.minY,
        maxX: info.maxX,
        maxY: info.maxY,
        sourceHouses: sourceHouses.list,
        sourceSpawns: sourceSpawnsRaw
      };
      const width = Math.max(1, info.maxX - info.minX + 1);
      const height = Math.max(1, info.maxY - info.minY + 1);
      const minZ = info.floors[0] ?? 7;
      const maxZ = info.floors[info.floors.length - 1] ?? minZ;
      setImportBusy({ value: 1, label: 'Building preview...' });
      const preview = assets
        ? await importPreview(active.floorZ)
            .then((p) => buildImportSpriteThumbnail(p, assets.items, assets.sprPath, assets.transparency))
            .catch(() => null)
        : null;
      setImportGhost({ width, height, minZ, maxZ, preview });
      handleStatus(
        `Import: ${info.tileCount} tiles, ${info.townCount} towns, ${info.waypointCount} waypoints - click to drop, Esc to cancel`
      );
    } catch (e) {
      handleStatus(`Import failed: ${e}`);
    } finally {
      unlisten();
      setImportBusy(null);
    }
  }, [active, assets, creatureDb, handleStatus]);

  const handleImportDrop = React.useCallback(
    async (pos: Position) => {
      const ctx = importCtx.current;
      if (!ctx) return;
      importCtx.current = null;
      setImportGhost(null);
      const w = ctx.maxX - ctx.minX + 1;
      const h = ctx.maxY - ctx.minY + 1;
      const ax = Math.max(0, Math.min(pos.x, 65536 - w));
      const ay = Math.max(0, Math.min(pos.y, 65536 - h));
      const dx = ax - ctx.minX;
      const dy = ay - ctx.minY;
      const dz = 0;

      const existing = housesRef.current ?? { list: [] };
      const existingIds = new Set(existing.list.map((h) => h.id));
      const houseIdMap: Record<number, number> = {};
      let nextHouseId = existing.list.reduce((max, h) => Math.max(max, h.id), 0);
      for (const h of ctx.sourceHouses) {
        if (existingIds.has(h.id)) {
          nextHouseId += 1;
          houseIdMap[h.id] = nextHouseId;
        } else {
          houseIdMap[h.id] = h.id;
        }
      }

      handleStatus('Importing map...');
      setImportBusy({ value: 0, label: 'Injecting tiles...' });
      const unlisten = await listen<number>('import_progress', (e) =>
        setImportBusy({ value: e.payload, label: 'Injecting tiles...' })
      );
      try {
        const result = await importCommit({
          mapId: ctx.mapId,
          dx,
          dy,
          dz,
          houseIdMap,
          importTowns: true,
          importWaypoints: true,
          importHouses: true
        });
        patchActiveMap({
          bounds: { minX: result.bounds[0], minY: result.bounds[1], maxX: result.bounds[2], maxY: result.bounds[3] },
          floors: result.floors
        });
        mapRefetchRef.current?.(result.touched);

        if (ctx.sourceHouses.length > 0) {
          const remappedHouses: House[] = ctx.sourceHouses.map((h) => ({
            ...h,
            id: houseIdMap[h.id] ?? h.id,
            townId: result.townIdMap[h.townId] ?? h.townId,
            entryX: h.entryX + dx,
            entryY: h.entryY + dy,
            entryZ: h.entryZ + dz
          }));
          setHouses({ list: [...existing.list, ...remappedHouses] });
          housesDirty.current = true;
        }

        if (ctx.sourceSpawns) {
          const cur = spawnsRef.current;
          const areas = (cur?.areas ?? []).concat(
            ctx.sourceSpawns.areas.map((a) => ({ x: a.x + dx, y: a.y + dy, z: a.z + dz, radius: a.radius }))
          );
          const placements = (cur?.placements ?? []).concat(
            ctx.sourceSpawns.placements.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy, z: p.z + dz }))
          );
          setSpawns(buildMapSpawns(areas, placements));
          spawnsDirty.current = true;
        }

        if (result.townsMerged > 0 || result.waypointsMerged > 0) {
          waypointsDirty.current = true;
          if (activeMapId != null) {
            void getTowns(activeMapId)
              .then(setTownList)
              .catch(() => undefined);
          }
        }

        markActiveDirty();
        handleStatus(
          `Imported ${result.tilesImported} tiles, ${result.townsMerged} towns, ${result.waypointsMerged} waypoints` +
            (result.tilesDiscarded > 0 ? ` (${result.tilesDiscarded} out of bounds)` : '')
        );
      } catch (e) {
        handleStatus(`Import commit failed: ${e}`);
      } finally {
        unlisten();
        setImportBusy(null);
      }
    },
    [activeMapId, handleStatus, markActiveDirty, patchActiveMap, setHouses, setSpawns]
  );

  const handleImportCancel = React.useCallback(() => {
    void importCancel().catch(() => undefined);
    importCtx.current = null;
    setImportGhost(null);
  }, []);

  const importFloor = active?.floorZ;
  React.useEffect(() => {
    if (!importCtx.current || importFloor == null || !assets) return;
    let cancelled = false;
    void importPreview(importFloor)
      .then((p) => buildImportSpriteThumbnail(p, assets.items, assets.sprPath, assets.transparency))
      .then((preview) => {
        if (cancelled) return;
        setImportGhost((prev) => (prev ? { ...prev, preview } : prev));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [importFloor, assets]);

  const isContentReady = (id: PanelId) => {
    const kind = baseKind(id);
    if (kind === 'minimap') return minimapOpen && !!assets && !!active && minimapReady;
    if (kind === 'properties') return propertiesOpen && !!assets && !!active;
    if (kind === 'idmarkers') return idMarkersOpen && !!assets && !!active;
    return kind === 'tools' || !!(assets && palette);
  };

  const dock = useDock(isContentReady);

  const toggleMinimap = () => {
    if (!minimapOpen) dock.ensureMinimapOnScreen();
    setMinimapOpen((v) => !v);
  };
  const closeMinimap = () => setMinimapOpen(false);

  const ensurePropertiesPlaced = React.useCallback(() => {
    const placed = [...dock.layout.left.flat(), ...dock.layout.right.flat(), ...Object.keys(dock.layout.float)];
    if (!placed.includes('properties')) dock.floatPanel('properties');
  }, [dock]);

  const toggleProperties = React.useCallback(() => {
    setPropertiesOpen((prev) => {
      if (!prev) ensurePropertiesPlaced();
      return !prev;
    });
  }, [ensurePropertiesPlaced]);

  const openProperties = React.useCallback(() => {
    ensurePropertiesPlaced();
    setPropertiesOpen(true);
  }, [ensurePropertiesPlaced]);

  const ensureIdMarkersPlaced = React.useCallback(() => {
    const placed = [...dock.layout.left.flat(), ...dock.layout.right.flat(), ...Object.keys(dock.layout.float)];
    if (!placed.includes('idmarkers')) dock.floatPanel('idmarkers');
  }, [dock]);

  const toggleIdMarkers = React.useCallback(() => {
    setIdMarkersOpen((prev) => {
      if (!prev) ensureIdMarkersPlaced();
      return !prev;
    });
  }, [ensureIdMarkersPlaced, setIdMarkersOpen]);

  const editWaypoints = (next: MapWaypoints) => (waypointEditRef.current ?? handleEditWaypoints)(next);

  const gotoWaypoint = (wp: Waypoint) => gotoPosition(wp.x, wp.y, wp.z);

  const copyWaypointPosition = (wp: Waypoint) =>
    navigator.clipboard?.writeText(formatPosition(copyPositionFormat, { x: wp.x, y: wp.y, z: wp.z })).catch(() => undefined);

  const addWaypointAtCenter = () => {
    if (!active) return;
    const v = mapViewRef.current;
    const pos = v
      ? {
          x: Math.floor((v.camX + v.vw / (2 * v.zoom)) / 32),
          y: Math.floor((v.camY + v.vh / (2 * v.zoom)) / 32),
          z: active.floorZ
        }
      : { x: active.center.x, y: active.center.y, z: active.floorZ };
    const wps = waypointsRef.current ?? { list: [], byChunk: new Map() };
    const name = nextWaypointName(wps);
    editWaypoints(addWaypoint(wps, name, pos));
    setPlacingWaypoint(name);
  };

  const openEditTowns = () => {
    if (active) setTownsOpen(true);
  };

  const openMapProperties = () => {
    if (active) setMapPropsOpen(true);
  };

  const openMapStatistics = () => {
    if (active) setStatsOpen(true);
  };

  const gotoPosition = (x: number, y: number, z: number) => {
    setFloorZ(z);
    mapCenterRef.current?.(x, y);
    mapHighlightRef.current?.(x, y, z);
  };

  useAppShortcuts({
    activeId,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    closeTab,
    toggleMinimap,
    openEditTowns,
    openMapProperties,
    openMapStatistics,
    openPreferences: () => openPreferences(),
    refreshAssets: retryAssets,
    toggleShade,
    toggleAutomagic,
    toggleCreatures,
    toggleTooltips,
    toggleBlocking,
    toggleHouses,
    toggleWaypoints,
    toggleSpawns
  });

  savingRef.current = !!saving;

  const requestExit = React.useCallback(() => {
    if (savingRef.current) return;
    if (dirtyTabs.current.size > 0) setCloseConfirmOpen(true);
    else void getCurrentWindow().destroy();
  }, []);

  React.useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (savingRef.current) {
        event.preventDefault();
        return;
      }
      if (dirtyTabs.current.size === 0) return;
      event.preventDefault();
      setCloseConfirmOpen(true);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  React.useEffect(() => {
    setSelectedItem(null);
    statusApiRef.current?.setSelectedItem(null);
    spawnsDirty.current = false;
    waypointsDirty.current = false;
    housesDirty.current = false;
    setPlacingWaypoint(null);
  }, [activeId]);

  const panelMenu = (id: PanelId) => {
    if (!panelMeta(id).cornerDockable) return null;
    return (
      <PanelDockMenu
        corner={cornerOf(dock.layout, id)}
        onFloat={() => dock.floatPanel(id)}
        onPick={(c) => dock.dockToCorner(id, c)}
      />
    );
  };

  const renderPanel = (id: PanelId, handle?: DragHandleProps) => {
    const kind = baseKind(id);
    if (kind === 'tools') {
      return <ToolsPanel dragHandle={handle} />;
    }
    if (kind === 'palette' && assets && palette) {
      const isPrimary = id === 'palette';
      return (
        <PalettePanel
          panelId={id}
          towns={towns}
          houses={houses}
          primary={isPrimary}
          dragHandle={handle}
          waypoints={waypoints}
          onGotoHouse={gotoHouse}
          onGotoWaypoint={gotoWaypoint}
          onEditWaypoints={editWaypoints}
          onEditHouses={handleEditHouses}
          onAddWaypoint={addWaypointAtCenter}
          creatureTilesets={creatureTilesets}
          onPickCreatureDir={pickCreatureDir}
          creatureNeedsPicker={creatureNeedsPicker}
          onCopyWaypointPosition={copyWaypointPosition}
          onClose={isPrimary ? undefined : () => dock.closePanel(id)}
        />
      );
    }
    if (kind === 'properties' && assets && active && propertiesOpen) {
      return (
        <ItemPropertiesPanel
          item={selectedItem}
          dragHandle={handle}
          mapId={active.map.id}
          itemNames={itemNames}
          items={assets.items ?? null}
          onClose={() => setPropertiesOpen(false)}
        />
      );
    }
    if (kind === 'idmarkers' && assets && active && idMarkersOpen) {
      return (
        <IdMarkers dragHandle={handle} mapId={active.map.id} onGoto={gotoPosition} onClose={() => setIdMarkersOpen(false)} />
      );
    }
    if (kind === 'minimap' && assets && active && minimapReady) {
      return (
        <Minimap
          key={active.id}
          dragHandle={handle}
          viewRef={mapViewRef}
          mapId={active.map.id}
          floorZ={active.floorZ}
          apiRef={minimapApiRef}
          onClose={closeMinimap}
          centerRef={mapCenterRef}
          paletteReady={minimapReady}
          headerMenu={panelMenu('minimap')}
        />
      );
    }
    return null;
  };

  const mapTabs = (
    <MapTabs
      tabs={tabs}
      onNew={handleNew}
      activeId={activeId}
      onSelect={setActiveId}
      disabled={busy || !assets}
      onClose={(id) => {
        dirtyTabs.current.delete(id);
        closeTab(id);
      }}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar
        recent={recent}
        onNew={handleNew}
        onOpen={handleOpen}
        hasActive={!!active}
        onStatus={handleStatus}
        loading={busy || !assets}
        minimapOpen={minimapOpen}
        onClearRecent={clearRecent}
        onEditTowns={openEditTowns}
        onRequestExit={requestExit}
        idMarkersOpen={idMarkersOpen}
        onNewPalette={dock.newPalette}
        onToggleMinimap={toggleMinimap}
        propertiesOpen={propertiesOpen}
        onSave={() => void handleSave()}
        onAbout={() => setAboutOpen(true)}
        onMapProperties={openMapProperties}
        onMapStatistics={openMapStatistics}
        onToggleIdMarkers={toggleIdMarkers}
        onSaveAs={() => void handleSaveAs()}
        onToggleProperties={toggleProperties}
        onOpenScripts={() => setScriptsOpen(true)}
        onImportMap={() => void handleImportMap()}
        onOpenPreferences={() => openPreferences()}
        onOpenRecent={(path) => void openPath(path)}
        onSelectPaletteCategory={setPaletteCategory}
        onCloseMap={() => activeId && closeTab(activeId)}
      />

      <Preferences
        initialTab={prefsTab}
        open={preferencesOpen}
        onResetLayout={dock.resetLayout}
        onOpenChange={setPreferencesOpen}
        onSaved={() => {
          dock.reloadConfig();
          reloadGeneral();
          reloadEditor();
        }}
      />

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>You have unsaved changes. Close without saving?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCloseConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void getCurrentWindow().destroy()}>
              Close without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScriptEditor open={scriptsOpen} onOpenChange={setScriptsOpen} />

      <MapTowns open={townsOpen} onGoto={gotoPosition} onOpenChange={setTownsOpen} mapId={active?.map.id ?? null} />

      <MapProperties
        open={mapPropsOpen}
        mapId={active?.map.id ?? null}
        onOpenChange={setMapPropsOpen}
        onSaved={() => {
          if (activeMapId === null) return;
          void getMapProperties(activeMapId).then((p) => patchActiveMap({ width: p.width, height: p.height }));
        }}
      />

      <MapStatistics
        spawns={spawns}
        open={statsOpen}
        waypoints={waypoints}
        onOpenChange={setStatsOpen}
        mapId={active?.map.id ?? null}
      />

      <Workspace dock={dock} tabs={mapTabs} progress={progress} renderPanel={renderPanel}>
        {active && assets ? (
          <MapCanvas
            key={active.id}
            spawns={spawns}
            houses={houses}
            map={active.map}
            paused={!!saving}
            zoom={active.zoom}
            viewRef={mapViewRef}
            itemNames={itemNames}
            onHover={handleHover}
            waypoints={waypoints}
            floorZ={active.floorZ}
            onZoomChange={setZoom}
            onViewChange={setView}
            onStatus={handleStatus}
            onSelect={handleSelect}
            centerRef={mapCenterRef}
            importGhost={importGhost}
            onFloorChange={setFloorZ}
            refetchRef={mapRefetchRef}
            initialCenter={active.center}
            highlightRef={mapHighlightRef}
            onImportDrop={handleImportDrop}
            onEditSpawns={handleEditSpawns}
            onEditHouses={handleEditHouses}
            onHousesDirty={markHousesDirty}
            waypointEditRef={waypointEditRef}
            placingWaypoint={placingWaypoint}
            onItemProperties={openProperties}
            onImportCancel={handleImportCancel}
            onEditWaypoints={handleEditWaypoints}
            onPlaceWaypoint={() => setPlacingWaypoint(null)}
            onEdit={(z) => {
              minimapApiRef.current?.markDirty(z);
              markActiveDirty();
            }}
          />
        ) : assetsMissing ? (
          <AssetsMissing
            error={error}
            dataDir={dataDir}
            onRetry={retryAssets}
            clientConfigured={clientConfigured}
            onOpenSettings={() => openPreferences(assetLabel ? 'assets' : 'client')}
            onOpenFolder={() => void openDataDir(dataDir.replace(/[\\/][^\\/]+$/, ''))}
            target={{ label: assetLabel ?? `version ${version}`, scripted: assetLabel !== null, project: project?.name ?? null }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {error ?? status}
          </div>
        )}
      </Workspace>

      <StatusBar
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        apiRef={statusApiRef}
        onZoomChange={setZoom}
        zoom={active?.zoom ?? 1}
        status={error ?? status}
        onFloorChange={setFloorZ}
        floorZ={active?.floorZ ?? 7}
      />

      {saving && <SaveProgressModal value={saving.value} label={saving.label} />}
      {importBusy && (
        <SaveProgressModal
          title="Importing map"
          value={importBusy.value}
          label={importBusy.label}
          note="Merging the imported map into the current one."
        />
      )}

      <CreatureDataDialog
        onClose={skipCreatureDir}
        onSelect={pickCreatureDir}
        open={showCreatureDirDialog}
        mapName={active?.path?.split(/[\\/]/).pop() ?? 'this map'}
      />
    </div>
  );
};

const Root = () => (
  <AssetsProvider>
    <EditorSettingsProvider>
      <ToolProvider>
        <TooltipProvider delayDuration={300} skipDelayDuration={150}>
          <App />
        </TooltipProvider>
      </ToolProvider>
    </EditorSettingsProvider>
  </AssetsProvider>
);

if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(<Root />);
