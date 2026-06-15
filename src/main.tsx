import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { House } from '~/domain/house';
import { cornerOf } from '~/usecase/dock';
import Toolbar from '~/components/Toolbar';
import MapTabs from '~/components/MapTabs';
import { MapHouses } from '~/domain/house';
import { houseSizes } from '~/adapter/map';
import { Town, MapView } from '~/domain/map';
import MapTowns from '~/components/MapTowns';
import { MapSpawns } from '~/domain/creature';
import MapCanvas from '~/components/MapCanvas';
import Workspace from '~/components/Workspace';
import { PANELS, PanelId } from '~/domain/dock';
import ToolsPanel from '~/components/ToolsPanel';
import Preferences from '~/components/Preferences';
import { MIN_ZOOM, MAX_ZOOM } from '~/usecase/zoom';
import PalettePanel from '~/components/PalettePanel';
import { serializeHouseXml } from '~/adapter/houses';
import MapProperties from '~/components/MapProperties';
import MapStatistics from '~/components/MapStatistics';
import { useSetting } from '~/usecase/hooks/useSetting';
import { serializeSpawnXml } from '~/usecase/spawnEdits';
import { formatPosition } from '~/usecase/positionFormat';
import { Waypoint, MapWaypoints } from '~/domain/waypoint';
import { serializeWaypointXml } from '~/adapter/waypoints';
import Minimap, { MinimapApi } from '~/components/Minimap';
import PanelDockMenu from '~/components/Dock/PanelDockMenu';
import { useDock } from '~/usecase/hooks/Workspace/useDock';
import { ToolProvider } from '~/usecase/context/ToolContext';
import SaveProgressModal from '~/components/SaveProgressModal';
import StatusBar, { StatusBarApi } from '~/components/StatusBar';
import { useMapTabs } from '~/usecase/hooks/Workspace/useMapTabs';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { HoverInfo, HoverItem } from '~/components/MapCanvas/types';
import { useMapSpawns } from '~/usecase/hooks/Workspace/useMapSpawns';
import { useMapHouses } from '~/usecase/hooks/Workspace/useMapHouses';
import { addWaypoint, nextWaypointName } from '~/usecase/waypointEdits';
import { useMapWaypoints } from '~/usecase/hooks/Workspace/useMapWaypoints';
import { useAppShortcuts } from '~/usecase/hooks/Workspace/useAppShortcuts';
import { getTowns, getMapProperties, setMapProperties } from '~/adapter/map';
import { AssetsProvider, useAssetsBundle } from '~/usecase/context/AssetsContext';
import { useEditorSettings, EditorSettingsProvider } from '~/usecase/context/EditorSettingsContext';

import './styles/index.css';

const dirOf = (path: string) => path.replace(/[^\\/]+$/, '');
const spawnFileFallback = (path: string) => (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-spawn.xml');

const App = () => {
  const { assets, palette, status, error, minimapReady, setStatus, setError } = useAssetsBundle();
  const { copyPositionFormat, reloadGeneral, reloadEditor } = useEditorSettings();

  const [minimapOpen, setMinimapOpen] = useSetting('minimapOpen', false);
  const [placingWaypoint, setPlacingWaypoint] = React.useState<string | null>(null);
  const [townsOpen, setTownsOpen] = React.useState(false);
  const [mapPropsOpen, setMapPropsOpen] = React.useState(false);
  const [statsOpen, setStatsOpen] = React.useState(false);
  const [preferencesOpen, setPreferencesOpen] = React.useState(false);

  const savingRef = React.useRef(false);
  const mapViewRef = React.useRef<MapView | null>(null);
  const statusApiRef = React.useRef<StatusBarApi | null>(null);
  const minimapApiRef = React.useRef<MinimapApi | null>(null);
  const mapCenterRef = React.useRef<((x: number, y: number) => void) | null>(null);
  const spawnsRef = React.useRef<MapSpawns | null>(null);
  const spawnsDirty = React.useRef(false);
  const waypointsRef = React.useRef<MapWaypoints | null>(null);
  const waypointsDirty = React.useRef(false);
  const waypointEditRef = React.useRef<((next: MapWaypoints) => void) | null>(null);
  const housesRef = React.useRef<MapHouses | null>(null);
  const housesDirty = React.useRef(false);

  const handleHover = React.useCallback((info: HoverInfo | null) => statusApiRef.current?.setHover(info), []);
  const handleSelect = React.useCallback((item: HoverItem | null) => statusApiRef.current?.setSelectedItem(item), []);
  const handleStatus = React.useCallback((message: string) => statusApiRef.current?.flash(message), []);

  const persistSpawns = React.useCallback(async (mapId: number, path: string) => {
    if (!spawnsDirty.current || !spawnsRef.current) return;
    const props = await getMapProperties(mapId).catch(() => null);
    let file = props?.spawnFile ?? '';
    if (!file) {
      file = spawnFileFallback(path);
      if (props) {
        await setMapProperties(mapId, {
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
    },
    [persistSpawns, persistWaypoints, persistHouses]
  );

  const {
    tabs,
    recent,
    active,
    activeId,
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
    setView
  } = useMapTabs(assets, { setStatus, setError, onAfterSave: persistSidecars });

  const { spawns, setSpawns } = useMapSpawns(
    active ? { id: active.id, path: active.path, mapId: active.map.id } : null,
    assets?.creatures ?? null
  );
  spawnsRef.current = spawns;

  const handleEditSpawns = React.useCallback(
    (next: MapSpawns) => {
      setSpawns(next);
      spawnsDirty.current = true;
    },
    [setSpawns]
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
    },
    [setWaypoints]
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
    },
    [setHouses]
  );

  const markHousesDirty = React.useCallback(() => {
    housesDirty.current = true;
  }, []);

  const isContentReady = (id: PanelId) => {
    if (id === 'minimap') return minimapOpen && !!assets && !!active && minimapReady;
    return id === 'tools' || !!(assets && palette);
  };

  const dock = useDock(isContentReady);

  const toggleMinimap = () => setMinimapOpen((v) => !v);
  const closeMinimap = () => setMinimapOpen(false);

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
    openPreferences: () => setPreferencesOpen(true)
  });

  savingRef.current = !!saving;

  React.useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      if (savingRef.current) event.preventDefault();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  React.useEffect(() => {
    statusApiRef.current?.setSelectedItem(null);
    spawnsDirty.current = false;
    waypointsDirty.current = false;
    housesDirty.current = false;
    setPlacingWaypoint(null);
  }, [activeId]);

  const panelMenu = (id: PanelId) => {
    if (!PANELS[id].cornerDockable) return null;
    return (
      <PanelDockMenu
        corner={cornerOf(dock.layout, id)}
        onFloat={() => dock.floatPanel(id)}
        onPick={(c) => dock.dockToCorner(id, c)}
      />
    );
  };

  const renderPanel = (id: PanelId, handle?: DragHandleProps) => {
    if (id === 'tools') {
      return <ToolsPanel dragHandle={handle} />;
    }
    if (id === 'palette' && assets && palette) {
      return (
        <PalettePanel
          towns={towns}
          houses={houses}
          dragHandle={handle}
          waypoints={waypoints}
          onGotoHouse={gotoHouse}
          onGotoWaypoint={gotoWaypoint}
          onEditWaypoints={editWaypoints}
          onEditHouses={handleEditHouses}
          onAddWaypoint={addWaypointAtCenter}
          onCopyWaypointPosition={copyWaypointPosition}
        />
      );
    }
    if (id === 'minimap' && assets && active && minimapReady) {
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
      onClose={closeTab}
      activeId={activeId}
      onSelect={setActiveId}
      disabled={busy || !assets}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar
        recent={recent}
        onNew={handleNew}
        onOpen={handleOpen}
        hasActive={!!active}
        loading={busy || !assets}
        onClearRecent={clearRecent}
        onEditTowns={openEditTowns}
        onSave={() => void handleSave()}
        onMapProperties={openMapProperties}
        onMapStatistics={openMapStatistics}
        onSaveAs={() => void handleSaveAs()}
        onOpenRecent={(path) => void openPath(path)}
        onCloseMap={() => activeId && closeTab(activeId)}
        onOpenPreferences={() => setPreferencesOpen(true)}
      />

      <Preferences
        open={preferencesOpen}
        onResetLayout={dock.resetLayout}
        onOpenChange={setPreferencesOpen}
        onSaved={() => {
          dock.reloadConfig();
          reloadGeneral();
          reloadEditor();
        }}
      />

      <MapTowns open={townsOpen} onGoto={gotoPosition} onOpenChange={setTownsOpen} mapId={active?.map.id ?? null} />

      <MapProperties open={mapPropsOpen} mapId={active?.map.id ?? null} onOpenChange={setMapPropsOpen} />

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
            onHover={handleHover}
            waypoints={waypoints}
            floorZ={active.floorZ}
            onZoomChange={setZoom}
            onViewChange={setView}
            onStatus={handleStatus}
            onSelect={handleSelect}
            centerRef={mapCenterRef}
            onFloorChange={setFloorZ}
            initialCenter={active.center}
            onEditSpawns={handleEditSpawns}
            onEditHouses={handleEditHouses}
            onHousesDirty={markHousesDirty}
            waypointEditRef={waypointEditRef}
            placingWaypoint={placingWaypoint}
            onEditWaypoints={handleEditWaypoints}
            onPlaceWaypoint={() => setPlacingWaypoint(null)}
            onEdit={(z) => minimapApiRef.current?.markDirty(z)}
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
    </div>
  );
};

const Root = () => (
  <AssetsProvider>
    <EditorSettingsProvider>
      <ToolProvider>
        <App />
      </ToolProvider>
    </EditorSettingsProvider>
  </AssetsProvider>
);

if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(<Root />);
