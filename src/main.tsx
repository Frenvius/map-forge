import React from 'react';
import { createRoot } from 'react-dom/client';
import { open } from '@tauri-apps/plugin-dialog';
import {
  useSensor,
  DndContext,
  useSensors,
  DragOverlay,
  DragEndEvent,
  DragMoveEvent,
  pointerWithin,
  PointerSensor,
  DragStartEvent
} from '@dnd-kit/core';

import { MapMeta } from '~/domain/map';
import { ToolId } from '~/domain/tools';
import Toolbar from '~/components/Toolbar';
import MapTabs from '~/components/MapTabs';
import StatusBar from '~/components/StatusBar';
import MapCanvas from '~/components/MapCanvas';
import Resizer from '~/components/Dock/Resizer';
import { loadPalette } from '~/adapter/palette';
import ToolsPanel from '~/components/ToolsPanel';
import DropSlot from '~/components/Dock/DropSlot';
import Preferences from '~/components/Preferences';
import PalettePanel from '~/components/PalettePanel';
import { newOtbm, openOtbm, closeMap } from '~/adapter/map';
import { getSetting, setSetting } from '~/adapter/settings';
import DockablePanel from '~/components/Dock/DockablePanel';
import { ActiveBrush, PaletteData } from '~/domain/palette';
import { MIN_ZOOM, MAX_ZOOM, snapZoom } from '~/usecase/zoom';
import { DragHandleProps } from '~/components/Dock/DockablePanel';
import { HoverInfo, HoverItem } from '~/components/MapCanvas/types';
import { loadAssets, LoadedAssets, DEFAULT_DATA_DIR } from '~/adapter/assets';
import { addRecentMap, loadRecentMaps, clearRecentMaps } from '~/adapter/recentMaps';
import { PANELS, PanelId, DockZone, FloatRect, DockLayout, DEFAULT_FLOAT_WIDTH, DEFAULT_FLOAT_HEIGHT } from '~/domain/dock';
import {
  zoneOf,
  dockAt,
  indexOf,
  widthOf,
  floatAt,
  resizeAt,
  isFloating,
  floatRectOf,
  loadDockLayout,
  saveDockLayout,
  defaultDockLayout
} from '~/usecase/dock';

import './styles/index.css';

const NEW_MAP_WIDTH = 1024;
const NEW_MAP_HEIGHT = 1024;

interface MapTab {
  id: string;
  title: string;
  map: MapMeta;
  floorZ: number;
  zoom: number;
}

let tabSeq = 0;

const App = () => {
  const [assets, setAssets] = React.useState<LoadedAssets | null>(null);
  const [palette, setPalette] = React.useState<PaletteData | null>(null);
  const [activeBrush, setActiveBrush] = React.useState<ActiveBrush | null>(null);
  const [activeTool, setActiveTool] = React.useState<ToolId>('select');
  const [automagic, setAutomagic] = React.useState(true);
  const [status, setStatus] = React.useState('Loading client assets...');
  const [error, setError] = React.useState<string | null>(null);
  const [tabs, setTabs] = React.useState<MapTab[]>([]);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [preferencesOpen, setPreferencesOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number; label: string } | null>(null);
  const [hover, setHover] = React.useState<HoverInfo | null>(null);
  const [selectedItem, setSelectedItem] = React.useState<HoverItem | null>(null);
  const [layout, setLayout] = React.useState<DockLayout>(defaultDockLayout);
  const [dragging, setDragging] = React.useState<PanelId | null>(null);
  const [dragSize, setDragSize] = React.useState<{ width: number; height: number } | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{ zone: DockZone; index: number } | null>(null);
  const [dragSettled, setDragSettled] = React.useState(false);

  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const dragOrigin = React.useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const active = tabs.find((t) => t.id === activeId) ?? null;

  const GAP = 6;

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as PanelId;
    const el = document.querySelector(`[data-panel-id="${id}"]`);
    const rect = el?.getBoundingClientRect();
    dragOrigin.current = { left: rect?.left ?? 0, top: rect?.top ?? 0 };
    setDragSize(rect ? { width: rect.width, height: rect.height } : null);
    setDragging(id);
    const zone = zoneOf(layout, id);
    setDropTarget(zone ? { zone, index: indexOf(layout, id) } : null);
  }

  function handleDragMove(event: DragMoveEvent) {
    setDropTarget(findDropTarget(layout, event.active.id as PanelId, event.delta));
  }

  function handleDragEnd(event: DragEndEvent) {
    const id = event.active.id as PanelId;
    const target = findDropTarget(layout, id, event.delta);
    setDragging(null);
    setDropTarget(null);
    setLayout((prev) => {
      const next = target ? dockAt(prev, id, target.zone, target.index) : floatAt(prev, id, dropRect(prev, id, event.delta));
      saveDockLayout(next);
      return next;
    });
  }

  function findDropTarget(lay: DockLayout, dragId: PanelId, delta: { x: number; y: number }) {
    const ws = workspaceRef.current?.getBoundingClientRect();
    if (!ws) return null;
    const dragW = dragSize?.width ?? DEFAULT_FLOAT_WIDTH;
    const center = dragOrigin.current.left + delta.x + dragW / 2;
    const SNAP = 110;

    const itemWidth = (id: PanelId) => {
      const r = document.querySelector(`[data-panel-id="${id}"]`)?.getBoundingClientRect();
      return r ? r.width : widthOf(lay, id);
    };

    const leftIds = lay.left.filter((id) => id !== dragId);
    const rightIds = lay.right.filter((id) => id !== dragId);
    const sumW = (ids: PanelId[]) => ids.reduce((s, id) => s + itemWidth(id), 0);
    const contentWidth = ws.width - GAP * 2;
    const nonMap = sumW(leftIds) + sumW(rightIds) + leftIds.length * GAP + rightIds.length * GAP;
    const mapW = Math.max(120, contentWidth - nonMap);

    type Slot = { zone: DockZone; index: number; x: number };
    const slots: Slot[] = [];
    let x = ws.left + GAP;
    for (let i = 0; i <= leftIds.length; i++) {
      const base = i === 0 ? 0 : GAP;
      slots.push({ zone: 'left', index: i, x: x + base / 2 });
      x += base;
      if (i < leftIds.length) x += itemWidth(leftIds[i]);
    }
    x += mapW;
    for (let i = 0; i <= rightIds.length; i++) {
      const base = i === rightIds.length ? 0 : GAP;
      slots.push({ zone: 'right', index: i, x: x + base / 2 });
      x += base;
      if (i < rightIds.length) x += itemWidth(rightIds[i]);
    }

    let best: Slot | null = null;
    let bestDist = SNAP;
    for (const slot of slots) {
      const d = Math.abs(center - slot.x);
      if (d < bestDist) {
        bestDist = d;
        best = slot;
      }
    }
    return best ? { zone: best.zone, index: best.index } : null;
  }

  function resizeDockPanel(id: PanelId, dx: number) {
    const dir = zoneOf(layout, id) === 'left' ? 1 : -1;
    setLayout((prev) => {
      const next = resizeAt(prev, id, widthOf(prev, id) + dir * dx);
      saveDockLayout(next);
      return next;
    });
  }

  function dropRect(layout: DockLayout, id: PanelId, delta: { x: number; y: number }): FloatRect {
    const ws = workspaceRef.current?.getBoundingClientRect();
    const prev = floatRectOf(layout, id);
    const width = dragSize?.width ?? DEFAULT_FLOAT_WIDTH;
    const height = prev ? (dragSize?.height ?? DEFAULT_FLOAT_HEIGHT) : DEFAULT_FLOAT_HEIGHT;
    const rawX = dragOrigin.current.left + delta.x - (ws?.left ?? 0);
    const rawY = dragOrigin.current.top + delta.y - (ws?.top ?? 0);
    const x = Math.max(0, Math.min(rawX, (ws?.width ?? width) - width));
    const y = Math.max(0, Math.min(rawY, (ws?.height ?? height) - height));
    return { x, y, width, height };
  }

  React.useEffect(() => {
    void loadDockLayout().then(setLayout);
  }, []);

  React.useEffect(() => {
    void getSetting('automagic', true).then(setAutomagic);
  }, []);

  React.useEffect(() => {
    void loadRecentMaps().then(setRecent);
  }, []);

  const clearRecent = () => {
    void clearRecentMaps().then(() => setRecent([]));
  };

  const toggleAutomagic = () =>
    setAutomagic((v) => {
      const next = !v;
      void setSetting('automagic', next);
      return next;
    });

  React.useEffect(() => {
    setSelectedItem(null);
  }, [activeId]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        void handleNew();
      } else if (key === 'o') {
        e.preventDefault();
        void handleOpen();
      } else if (key === 'w' && activeId) {
        e.preventDefault();
        closeTab(activeId);
      } else if (key === ',') {
        e.preventDefault();
        setPreferencesOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assets, busy, tabs, activeId]);

  React.useEffect(() => {
    if (!dragging) {
      setDragSettled(false);
      return;
    }
    const raf = requestAnimationFrame(() => setDragSettled(true));
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  const updateActive = (patch: Partial<MapTab>) =>
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, ...patch } : t)));

  const setFloorZ = (z: number) => updateActive({ floorZ: z });
  const setZoom = (z: number) => updateActive({ zoom: snapZoom(z) });

  function addTab(title: string, data: MapMeta) {
    const id = `tab-${++tabSeq}`;
    setTabs((prev) => [...prev, { id, title, map: data, floorZ: 7, zoom: 1 }]);
    setActiveId(id);
  }

  function closeTab(id: string) {
    const idx = tabs.findIndex((t) => t.id === id);
    const tab = tabs[idx];
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (tab) void closeMap(tab.map.id).catch(() => undefined);
    if (id === activeId) setActiveId(next[idx]?.id ?? next[idx - 1]?.id ?? null);
  }

  React.useEffect(() => {
    loadAssets()
      .then((a) => {
        setAssets(a);
        setStatus(`Assets ready - ${a.otbItemCount} items, ${a.spritesCount} sprites. Open a map to begin.`);
      })
      .catch((e) => {
        setError(`Failed to load assets: ${e}`);
        setStatus('Asset load failed');
      });
  }, []);

  React.useEffect(() => {
    if (!assets) return;
    loadPalette()
      .then(setPalette)
      .catch((e) => setError(`Failed to load palette: ${e}`));
  }, [assets]);

  async function openPath(path: string) {
    if (!assets) return;
    setBusy(true);
    setProgress({ value: 0, label: 'Reading map...' });
    setStatus('Reading map...');
    try {
      const data = await openOtbm(path, (_phase, value) => {
        setProgress({ value, label: 'Reading map...' });
      });
      const name = path.split(/[\\/]/).pop() ?? 'map.otbm';
      addTab(name, data);
      const dims = `${data.bounds.minX}..${data.bounds.maxX} x ${data.bounds.minY}..${data.bounds.maxY}`;
      setStatus(`${name} - ${data.tileCount} tiles - ${dims} - ${data.width}x${data.height}`);
      void addRecentMap(path).then(setRecent);
    } catch (e) {
      setError(`Failed to open map: ${e}`);
      setStatus('Map load failed');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleOpen() {
    if (!assets) return;
    const selected = await open({
      multiple: false,
      defaultPath: DEFAULT_DATA_DIR,
      title: 'Open OTBM map',
      filters: [{ name: 'OTBM Maps', extensions: ['otbm'] }]
    });
    if (!selected || typeof selected !== 'string') return;
    await openPath(selected);
  }

  async function handleNew() {
    if (!assets) return;
    setBusy(true);
    setStatus('Creating map...');
    try {
      const data = await newOtbm(NEW_MAP_WIDTH, NEW_MAP_HEIGHT);
      const used = new Set(tabs.map((t) => t.title));
      let n = 1;
      while (used.has(`untitled-${n}`)) n++;
      addTab(`untitled-${n}`, data);
      setError(null);
      setStatus(`New map - ${data.width}x${data.height}`);
    } catch (e) {
      setError(`Failed to create map: ${e}`);
      setStatus('Map create failed');
    } finally {
      setBusy(false);
    }
  }

  const isRenderable = (id: PanelId) => id !== dragging && (id === 'tools' || !!(assets && palette));
  const isStrip = (id: PanelId) => PANELS[id].variant === 'strip';
  const leftIds = layout.left.filter(isRenderable);
  const rightIds = layout.right.filter(isRenderable);
  const floating = (Object.keys(PANELS) as PanelId[]).filter((id) => isFloating(layout, id) && isRenderable(id));

  const dragW = dragSize?.width ?? 0;

  function selectBrush(brush: ActiveBrush | null) {
    setActiveBrush(brush);
    setActiveTool(brush ? 'brush' : 'select');
  }

  function renderPanel(id: PanelId, handle?: DragHandleProps) {
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
          dragHandle={handle}
          items={assets.items}
          outfits={assets.outfits}
          sprPath={assets.sprPath}
          onSelectBrush={selectBrush}
          transparency={assets.transparency}
        />
      );
    }
    return null;
  }

  function renderItem(zone: DockZone, id: PanelId) {
    if (isStrip(id)) {
      return (
        <DockablePanel key={id} meta={PANELS[id]} className="h-full flex-shrink-0">
          {(handle) => renderPanel(id, handle)}
        </DockablePanel>
      );
    }
    return (
      <div key={id} style={{ width: widthOf(layout, id) }} className="relative h-full min-h-0 flex-shrink-0">
        <DockablePanel meta={PANELS[id]} className="h-full">
          {(handle) => renderPanel(id, handle)}
        </DockablePanel>
        <Resizer side={zone === 'left' ? 'right' : 'left'} onResize={(dx) => resizeDockPanel(id, dx)} />
      </div>
    );
  }

  function renderSide(zone: DockZone) {
    const ids = zone === 'left' ? leftIds : rightIds;
    const cells: React.ReactNode[] = [];
    for (let i = 0; i <= ids.length; i++) {
      const edge = zone === 'left' ? i === 0 : i === ids.length;
      cells.push(
        <DropSlot
          width={dragW}
          base={edge ? 0 : GAP}
          key={`slot-${zone}-${i}`}
          animate={!!dragging && dragSettled}
          align={edge ? (zone === 'left' ? 'start' : 'end') : 'center'}
          active={!!dragging && dropTarget?.zone === zone && dropTarget.index === i}
        />
      );
      if (i < ids.length) cells.push(renderItem(zone, ids[i]));
    }
    return cells;
  }

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

      <Preferences open={preferencesOpen} onOpenChange={setPreferencesOpen} />

      <DndContext
        sensors={sensors}
        onDragEnd={handleDragEnd}
        onDragMove={handleDragMove}
        onDragStart={handleDragStart}
        collisionDetection={pointerWithin}
      >
        <div ref={workspaceRef} className="relative flex min-h-0 flex-1 overflow-hidden bg-toolbar-bg p-1.5">
          {renderSide('left')}

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-card shadow-island">
            <MapTabs
              tabs={tabs}
              onNew={handleNew}
              onClose={closeTab}
              activeId={activeId}
              onSelect={setActiveId}
              disabled={busy || !assets}
            />

            <div className="relative min-h-0 flex-1">
              {active && assets ? (
                <MapCanvas
                  key={active.id}
                  map={active.map}
                  zoom={active.zoom}
                  minZoom={MIN_ZOOM}
                  maxZoom={MAX_ZOOM}
                  onHover={setHover}
                  items={assets.items}
                  automagic={automagic}
                  floorZ={active.floorZ}
                  onZoomChange={setZoom}
                  activeTool={activeTool}
                  sprPath={assets.sprPath}
                  activeBrush={activeBrush}
                  onFloorChange={setFloorZ}
                  onSelect={setSelectedItem}
                  onSelectBrush={selectBrush}
                  onToolChange={setActiveTool}
                  itemNames={assets.itemNames}
                  transparency={assets.transparency}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                  {error ?? status}
                </div>
              )}

              {progress && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
                  <div className="text-sm text-muted-foreground">{progress.label}</div>
                  <div className="h-2 w-72 overflow-hidden rounded-full bg-secondary">
                    <div
                      style={{ width: `${Math.round(progress.value * 100)}%` }}
                      className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                    />
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">{Math.round(progress.value * 100)}%</div>
                </div>
              )}
            </div>
          </div>

          {renderSide('right')}

          {floating.map((id) => {
            const rect = floatRectOf(layout, id);
            if (!rect) return null;
            return (
              <div
                key={id}
                className="absolute z-20"
                style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
              >
                <DockablePanel meta={PANELS[id]} className="h-full">
                  {(handle) => renderPanel(id, handle)}
                </DockablePanel>
              </div>
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="cursor-grabbing" style={{ width: dragSize?.width, height: dragSize?.height }}>
              {renderPanel(dragging)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <StatusBar
        hover={hover}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoomChange={setZoom}
        zoom={active?.zoom ?? 1}
        status={error ?? status}
        onFloorChange={setFloorZ}
        selectedItem={selectedItem}
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
