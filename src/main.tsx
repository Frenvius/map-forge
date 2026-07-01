import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { Button } from '~/components/commons/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '~/components/commons/ui/dialog';

import { House } from '~/domain/house';
import { cornerOf } from '~/usecase/dock';
import Toolbar from '~/components/Toolbar';
import MapTabs from '~/components/MapTabs';
import { MapHouses } from '~/domain/house';
import { houseSizes } from '~/adapter/map';
import { Town, MapView } from '~/domain/map';
import MapTowns from '~/components/MapTowns';
import { MapSpawns } from '~/domain/creature';
import IdMarkers from '~/components/IdMarkers';
import MapCanvas from '~/components/MapCanvas';
import Workspace from '~/components/Workspace';
import { openDataDir } from '~/adapter/assets';
import ToolsPanel from '~/components/ToolsPanel';
import Preferences from '~/components/Preferences';
import AboutDialog from '~/components/AboutDialog';
import { MIN_ZOOM, MAX_ZOOM } from '~/usecase/zoom';
import PalettePanel from '~/components/PalettePanel';
import { serializeHouseXml } from '~/adapter/houses';
import ScriptEditor from '~/components/ScriptEditor';
import MapProperties from '~/components/MapProperties';
import MapStatistics from '~/components/MapStatistics';
import AssetsMissing from '~/components/AssetsMissing';
import { useSetting } from '~/usecase/hooks/useSetting';
import { serializeSpawnXml } from '~/usecase/spawnEdits';
import { formatPosition } from '~/usecase/positionFormat';
import { Waypoint, MapWaypoints } from '~/domain/waypoint';
import { serializeWaypointXml } from '~/adapter/waypoints';
import Minimap, { MinimapApi } from '~/components/Minimap';
import PanelDockMenu from '~/components/Dock/PanelDockMenu';
import { useDock } from '~/usecase/hooks/Workspace/useDock';
import { PanelId, baseKind, panelMeta } from '~/domain/dock';
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

import './styles/index.css';

const dirOf = (path: string) => path.replace(/[^\\/]+$/, '');
const spawnFileFallback = (path: string) => (path.split(/[\\/]/).pop() ?? 'map.otbm').replace(/\.otbm$/i, '-spawn.xml');

const App = () => {
  const {
    assets,
    palette,
    status,
    error,
    dataDir,
    version,
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
  const [prefsTab, setPrefsTab] = React.useState<'general' | 'editor' | 'client'>('general');
  const openPreferences = React.useCallback((tab: 'general' | 'editor' | 'client' = 'general') => {
    setPrefsTab(tab);
    setPreferencesOpen(true);
  }, []);

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
    setView
  } = useMapTabs(assets, { setStatus, setError, onAfterSave: persistSidecars, version, switchVersion });

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
      onClose={(id) => {
        dirtyTabs.current.delete(id);
        closeTab(id);
      }}
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
        onStatus={handleStatus}
        loading={busy || !assets}
        minimapOpen={minimapOpen}
        onClearRecent={clearRecent}
        onEditTowns={openEditTowns}
        idMarkersOpen={idMarkersOpen}
        onNewPalette={dock.newPalette}
        onToggleMinimap={toggleMinimap}
        propertiesOpen={propertiesOpen}
        onSave={() => void handleSave()}
        onAbout={() => setAboutOpen(true)}
        onRequestExit={requestExit}
        onMapProperties={openMapProperties}
        onMapStatistics={openMapStatistics}
        onToggleIdMarkers={toggleIdMarkers}
        onSaveAs={() => void handleSaveAs()}
        onToggleProperties={toggleProperties}
        onOpenScripts={() => setScriptsOpen(true)}
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
            itemNames={itemNames}
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
            onItemProperties={openProperties}
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
            version={version}
            onRetry={retryAssets}
            clientConfigured={clientConfigured}
            onOpenSettings={() => openPreferences('client')}
            onOpenFolder={() => void openDataDir(dataDir.replace(/[\\/][^\\/]+$/, ''))}
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
