import React from 'react';
import { createRoot } from 'react-dom/client';

import { MapView } from '~/domain/map';
import { ToolId } from '~/domain/tools';
import { cornerOf } from '~/usecase/dock';
import Toolbar from '~/components/Toolbar';
import MapTabs from '~/components/MapTabs';
import MapCanvas from '~/components/MapCanvas';
import Workspace from '~/components/Workspace';
import { PANELS, PanelId } from '~/domain/dock';
import ToolsPanel from '~/components/ToolsPanel';
import Preferences from '~/components/Preferences';
import { MIN_ZOOM, MAX_ZOOM } from '~/usecase/zoom';
import PalettePanel from '~/components/PalettePanel';
import Minimap, { MinimapApi } from '~/components/Minimap';
import { getSetting, setSetting } from '~/adapter/settings';
import PanelDockMenu from '~/components/Dock/PanelDockMenu';
import { useDock } from '~/usecase/hooks/Workspace/useDock';
import { useAssets } from '~/usecase/hooks/Workspace/useAssets';
import StatusBar, { StatusBarApi } from '~/components/StatusBar';
import { ActiveBrush, PaletteCategoryId } from '~/domain/palette';
import { useMapTabs } from '~/usecase/hooks/Workspace/useMapTabs';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { HoverInfo, HoverItem } from '~/components/MapCanvas/types';
import { useAppShortcuts } from '~/usecase/hooks/Workspace/useAppShortcuts';
import { loadGeneralConfig, defaultGeneralConfig } from '~/adapter/preferences';

import './styles/index.css';

const App = () => {
  const [activeBrush, setActiveBrush] = React.useState<ActiveBrush | null>(null);
  const [reveal, setReveal] = React.useState<{ category: PaletteCategoryId; serverId: number; nonce: number } | null>(null);
  const [activeTool, setActiveTool] = React.useState<ToolId>('select');
  const [automagic, setAutomagic] = React.useState(true);
  const [minimapOpen, setMinimapOpen] = React.useState(false);
  const [preferencesOpen, setPreferencesOpen] = React.useState(false);
  const [copyPositionFormat, setCopyPositionFormat] = React.useState(defaultGeneralConfig.copyPositionFormat);

  const mapViewRef = React.useRef<MapView | null>(null);
  const statusApiRef = React.useRef<StatusBarApi | null>(null);
  const minimapApiRef = React.useRef<MinimapApi | null>(null);
  const mapCenterRef = React.useRef<((x: number, y: number) => void) | null>(null);

  const handleHover = React.useCallback((info: HoverInfo | null) => statusApiRef.current?.setHover(info), []);
  const handleSelect = React.useCallback((item: HoverItem | null) => statusApiRef.current?.setSelectedItem(item), []);

  const { assets, palette, status, error, minimapColors, setStatus, setError } = useAssets();
  const {
    tabs,
    recent,
    active,
    activeId,
    busy,
    progress,
    setActiveId,
    closeTab,
    openPath,
    handleOpen,
    handleNew,
    clearRecent,
    setFloorZ,
    setZoom
  } = useMapTabs(assets, { setStatus, setError });

  const isContentReady = (id: PanelId) => {
    if (id === 'minimap') return minimapOpen && !!assets && !!active && !!minimapColors;
    return id === 'tools' || !!(assets && palette);
  };

  const dock = useDock(isContentReady);

  const toggleAutomagic = () =>
    setAutomagic((v) => {
      const next = !v;
      void setSetting('automagic', next);
      return next;
    });

  const toggleMinimap = () =>
    setMinimapOpen((v) => {
      const next = !v;
      void setSetting('minimapOpen', next);
      return next;
    });

  const closeMinimap = () => {
    setMinimapOpen(false);
    void setSetting('minimapOpen', false);
  };

  const selectBrush = (brush: ActiveBrush | null) => {
    setActiveBrush(brush);
    setActiveTool(brush ? 'brush' : 'select');
  };

  const revealInPalette = (category: PaletteCategoryId, serverId: number) => {
    setReveal((r) => ({ category, serverId, nonce: (r?.nonce ?? 0) + 1 }));
  };

  useAppShortcuts({
    activeId,
    handleNew,
    handleOpen,
    closeTab,
    toggleMinimap,
    openPreferences: () => setPreferencesOpen(true)
  });

  React.useEffect(() => {
    void getSetting('automagic', true).then(setAutomagic);
  }, []);

  React.useEffect(() => {
    void getSetting('minimapOpen', false).then(setMinimapOpen);
  }, []);

  const reloadGeneral = React.useCallback(() => {
    void loadGeneralConfig().then((g) => setCopyPositionFormat(g.copyPositionFormat));
  }, []);

  React.useEffect(reloadGeneral, [reloadGeneral]);

  React.useEffect(() => {
    statusApiRef.current?.setSelectedItem(null);
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
      return (
        <ToolsPanel
          dragHandle={handle}
          automagic={automagic}
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onToggleAutomagic={toggleAutomagic}
        />
      );
    }
    if (id === 'palette' && assets && palette) {
      return (
        <PalettePanel
          data={palette}
          reveal={reveal}
          dragHandle={handle}
          items={assets.items}
          outfits={assets.outfits}
          sprPath={assets.sprPath}
          onSelectBrush={selectBrush}
          transparency={assets.transparency}
        />
      );
    }
    if (id === 'minimap' && assets && active && minimapColors) {
      return (
        <Minimap
          key={active.id}
          dragHandle={handle}
          viewRef={mapViewRef}
          mapId={active.map.id}
          floorZ={active.floorZ}
          colors={minimapColors}
          apiRef={minimapApiRef}
          onClose={closeMinimap}
          centerRef={mapCenterRef}
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
        }}
      />

      <Workspace dock={dock} tabs={mapTabs} progress={progress} renderPanel={renderPanel}>
        {active && assets ? (
          <MapCanvas
            key={active.id}
            map={active.map}
            zoom={active.zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            items={assets.items}
            viewRef={mapViewRef}
            onHover={handleHover}
            automagic={automagic}
            floorZ={active.floorZ}
            onZoomChange={setZoom}
            activeTool={activeTool}
            onSelect={handleSelect}
            sprPath={assets.sprPath}
            centerRef={mapCenterRef}
            activeBrush={activeBrush}
            onFloorChange={setFloorZ}
            onSelectBrush={selectBrush}
            onToolChange={setActiveTool}
            itemNames={assets.itemNames}
            onRevealBrush={revealInPalette}
            transparency={assets.transparency}
            copyPositionFormat={copyPositionFormat}
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
    </div>
  );
};

if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(<App />);
