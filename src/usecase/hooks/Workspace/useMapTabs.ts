import React from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';

import { MapMeta } from '~/domain/map';
import { snapZoom } from '~/usecase/zoom';
import { activeProject } from '~/adapter/project';
import { getMapView, setMapView } from '~/adapter/mapViews';
import { loadEditorConfig, loadGeneralConfig } from '~/adapter/preferences';
import { addRecentMap, loadRecentMaps, clearRecentMaps } from '~/adapter/recentMaps';
import { registeredFormats, loadScriptedItemdb, itemNames as fetchItemNames } from '~/adapter/scripts';
import { newOtbm, openOtbm, closeMap, saveOtbm, backupMap, openScriptedMap, saveScriptedMap } from '~/adapter/map';
import {
  loadOtb,
  LoadedAssets,
  MapItemsPaths,
  defaultDataDir,
  resolveMapItems,
  peekOtbmVersion,
  loadItemNamesPath
} from '~/adapter/assets';

const NEW_MAP_WIDTH = 1024;
const NEW_MAP_HEIGHT = 1024;

let tabSeq = 0;

export interface MapTab {
  id: string;
  title: string;
  map: MapMeta;
  floorZ: number;
  zoom: number;
  center: { x: number; y: number };
  path?: string;
  otbPath: string;
  itemNames: Map<number, string>;
  version: number;
}

interface MapTabsActions {
  setStatus: (status: string) => void;
  setError: (error: string | null) => void;
  onAfterSave?: (mapId: number, path: string) => Promise<void>;
  version: number;
  switchVersion: (v: number) => Promise<void>;
  retryAssets: () => void;
}

export interface MapTabsApi {
  tabs: MapTab[];
  recent: string[];
  active: MapTab | null;
  activeId: string | null;
  itemNames: Map<number, string> | null;
  busy: boolean;
  progress: { value: number; label: string } | null;
  saving: { value: number; label: string } | null;
  setActiveId: (id: string | null) => void;
  closeTab: (id: string) => void;
  openPath: (path: string) => Promise<void>;
  handleOpen: () => Promise<void>;
  handleNew: () => Promise<void>;
  handleSave: () => Promise<void>;
  handleSaveAs: () => Promise<void>;
  clearRecent: () => void;
  setFloorZ: (z: number) => void;
  setZoom: (z: number) => void;
  setView: (cx: number, cy: number) => void;
  patchActiveMap: (patch: Partial<MapMeta>) => void;
}

export const useMapTabs = (
  assets: LoadedAssets | null,
  { setStatus, setError, onAfterSave, version, switchVersion, retryAssets }: MapTabsActions
): MapTabsApi => {
  const [tabs, setTabs] = React.useState<MapTab[]>([]);
  const [recent, setRecent] = React.useState<string[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ value: number; label: string } | null>(null);
  const [saving, setSaving] = React.useState<{ value: number; label: string } | null>(null);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const persistTimer = React.useRef(0);
  const [itemNames, setItemNames] = React.useState<Map<number, string> | null>(null);
  const loadedOtbPath = React.useRef<string | null>(null);
  const loadedItemdbPath = React.useRef<string | null>(null);

  const applyDiscoveredItemdb = async (found: MapItemsPaths) => {
    const loaded = loadedItemdbPath.current;
    if (loaded === found.path) return;
    if (loaded) {
      setStatus(
        `Opened using the item db already loaded from ${loaded}, not ${found.path} - item names and ids come from the other map's item db. Declare mapForge.itemdb in the project manifest to pin one for the whole project.`
      );
      return;
    }
    await loadScriptedItemdb(found.path);
    loadedItemdbPath.current = found.path;
    retryAssets();
  };

  const prepareItems = async (
    path?: string,
    scripted = false
  ): Promise<{ otbPath: string; names: Map<number, string>; version: number }> => {
    const declaredItemdb = (await activeProject().catch(() => null))?.itemdb ?? null;
    const discovered = !declaredItemdb && path ? await resolveMapItems(path).catch(() => null) : null;
    if (discovered?.format) await applyDiscoveredItemdb(discovered);

    if (scripted || declaredItemdb || discovered?.format) {
      return { otbPath: '', names: new Map<number, string>(), version };
    }

    let detectedVersion = version;
    let peekedDataDir: string | null = null;
    let stampedMinor: number | null = null;

    if (path) {
      const peeked = await peekOtbmVersion(path).catch(() => null);
      if (peeked?.version) detectedVersion = peeked.version;
      if (peeked?.data_dir) peekedDataDir = peeked.data_dir;
      if (peeked) stampedMinor = peeked.items_minor;
    }

    if (detectedVersion !== version) {
      try {
        await switchVersion(detectedVersion);
      } catch {
        setStatus(
          `Map stamps items v${stampedMinor ?? '?'} (client ${detectedVersion}); no assets configured. Opened with ${version} - pair a client folder in Preferences or change version in Map > Properties.`
        );
        detectedVersion = version;
      }
    }

    let otbPath: string | null = discovered?.path ?? null;

    if (!otbPath && peekedDataDir) {
      otbPath = `${peekedDataDir}/items.otb`;
    }

    if (!otbPath) otbPath = `${defaultDataDir()}/items.otb`;

    if (otbPath !== loadedOtbPath.current) {
      await loadOtb(otbPath);
      loadedOtbPath.current = otbPath;
    }

    const names = discovered
      ? discovered.names
        ? await loadItemNamesPath(discovered.names)
        : new Map<number, string>()
      : await loadItemNamesPath(`${defaultDataDir()}/items.xml`).catch(() => new Map<number, string>());

    return { otbPath, names, version: detectedVersion };
  };

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      if (active.version !== version) {
        await switchVersion(active.version).catch((e) => {
          console.error(`switchVersion to ${active.version} failed:`, e);
          setError(`Failed to switch to client version ${active.version}: ${e}`);
        });
      }
      if (cancelled) return;
      if (active.otbPath && active.otbPath !== loadedOtbPath.current) {
        loadedOtbPath.current = active.otbPath;
        await loadOtb(active.otbPath).catch((e) => {
          console.error(`load_otb failed for ${active.otbPath}:`, e);
          setError(`Failed to load ${active.otbPath}: ${e}`);
        });
      }
    })();
    setItemNames(active.itemNames);
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  React.useEffect(() => {
    void loadRecentMaps().then(setRecent);
  }, []);

  const clearRecent = () => {
    void clearRecentMaps().then(() => setRecent([]));
  };

  const persist = (t: MapTab) => {
    if (!t.path) return;
    const path = t.path;
    const payload = { cx: t.center.x, cy: t.center.y, zoom: t.zoom, floor: t.floorZ };
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => void setMapView(path, payload), 400);
  };

  const updateActive = (patch: Partial<MapTab>) =>
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId) return t;
        const next = { ...t, ...patch };
        persist(next);
        return next;
      })
    );

  const patchActiveMap = (patch: Partial<MapMeta>) =>
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, map: { ...t.map, ...patch } } : t)));

  const setFloorZ = (z: number) => updateActive({ floorZ: z });
  const setZoom = (z: number) => updateActive({ zoom: snapZoom(z) });
  const setView = (cx: number, cy: number) => updateActive({ center: { x: cx, y: cy } });

  interface InitialView {
    center: { x: number; y: number };
    zoom: number;
    floor: number;
  }

  const addTab = (
    title: string,
    data: MapMeta,
    items: { otbPath: string; names: Map<number, string>; version: number },
    path?: string,
    initial?: InitialView
  ) => {
    const id = `tab-${++tabSeq}`;
    const center = initial?.center ?? { x: data.center.x, y: data.center.y };
    const floorZ = initial?.floor ?? data.center.floor;
    const zoom = initial?.zoom ?? 1;
    setTabs((prev) => [
      ...prev,
      {
        id,
        title,
        map: data,
        floorZ,
        zoom,
        center,
        path,
        otbPath: items.otbPath,
        itemNames: items.names,
        version: items.version
      }
    ]);
    setItemNames(items.names);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const tab = tabs[idx];
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (tab) void closeMap(tab.map.id).catch(() => undefined);
    if (id === activeId) setActiveId(next[idx]?.id ?? next[idx - 1]?.id ?? null);
  };

  const openPath = async (path: string) => {
    if (!assets) return;
    setBusy(true);
    setProgress({ value: 0, label: 'Reading map...' });
    setStatus('Reading map...');
    try {
      const isOtbm = path.toLowerCase().endsWith('.otbm');
      const items = await prepareItems(path, !isOtbm);
      let tabItems = items;
      let data: MapMeta;
      if (isOtbm) {
        data = await openOtbm(path, (_phase, value) => {
          setProgress({ value, label: 'Reading map...' });
        });
      } else {
        const names = await fetchItemNames().catch(() => new Map<number, string>());
        if (names.size > 0) tabItems = { ...items, names };
        data = await openScriptedMap(path);
      }
      const name = path.split(/[\\/]/).pop() ?? 'map';
      const saved = await getMapView(path);
      const defFloor = (await loadEditorConfig()).defaultFloor;
      const initial = saved
        ? { center: { x: saved.cx, y: saved.cy }, zoom: saved.zoom, floor: saved.floor }
        : { center: { x: data.center.x, y: data.center.y }, zoom: 1, floor: defFloor };
      addTab(name, data, tabItems, path, initial);
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
  };

  const handleOpen = async () => {
    if (!assets) return;
    const scripted = await registeredFormats().catch(() => []);
    const extensions = ['otbm', ...scripted.filter((f) => f.kind === 'map').map((f) => f.ext)];
    const selected = await open({
      multiple: false,
      defaultPath: (await activeProject().catch(() => null))?.maps ?? defaultDataDir(),
      title: 'Open map',
      filters: [{ name: 'Maps', extensions }]
    });
    if (!selected || typeof selected !== 'string') return;
    await openPath(selected);
  };

  const handleNew = async () => {
    if (!assets) return;
    setBusy(true);
    setStatus('Creating map...');
    try {
      const items = await prepareItems();
      const data = await newOtbm(NEW_MAP_WIDTH, NEW_MAP_HEIGHT);
      const used = new Set(tabs.map((t) => t.title));
      let n = 1;
      while (used.has(`untitled-${n}`)) n++;
      const defFloor = (await loadEditorConfig()).defaultFloor;
      addTab(`untitled-${n}`, data, items, undefined, {
        center: { x: data.center.x, y: data.center.y },
        zoom: 1,
        floor: defFloor
      });
      setError(null);
      setStatus(`New map - ${data.width}x${data.height}`);
    } catch (e) {
      setError(`Failed to create map: ${e}`);
      setStatus('Map create failed');
    } finally {
      setBusy(false);
    }
  };

  const saveToPath = async (tab: MapTab, path: string) => {
    setBusy(true);
    setSaving({ value: 0, label: 'Preparing...' });
    setStatus('Saving map...');
    try {
      if (path.toLowerCase().endsWith('.otbm')) {
        await saveOtbm(tab.map.id, path, (value, label) => setSaving({ value, label }));
      } else {
        setSaving({ value: 0.5, label: 'Writing...' });
        await saveScriptedMap(tab.map.id, path);
      }
      await onAfterSave?.(tab.map.id, path);
      void loadGeneralConfig()
        .then((cfg) => {
          if (cfg.backupOnSave) return backupMap(path, Math.min(5, Math.max(1, cfg.backupCount)));
        })
        .catch((e) => console.error('Backup failed', e));
      const name = path.split(/[\\/]/).pop() ?? tab.title;
      updateActive({ path, title: name });
      setStatus(`Saved ${name}`);
      void addRecentMap(path).then(setRecent);
    } catch (e) {
      setError(`Failed to save map: ${e}`);
      setStatus('Map save failed');
    } finally {
      setBusy(false);
      setSaving(null);
    }
  };

  const handleSaveAs = async () => {
    if (!active) return;
    const scripted = await registeredFormats().catch(() => []);
    const mapExts = scripted.filter((f) => f.kind === 'map').map((f) => f.ext);
    const currentExt = active.path?.split('.').pop()?.toLowerCase();
    const extensions =
      currentExt && mapExts.includes(currentExt)
        ? [currentExt, ...mapExts.filter((e) => e !== currentExt), 'otbm']
        : [...mapExts, 'otbm'];
    const selected = await save({
      defaultPath: active.path ?? `${active.title.replace(/\.[^.]+$/i, '')}.${extensions[0] ?? 'otbm'}`,
      title: 'Save map',
      filters: [{ name: 'Maps', extensions }]
    });
    if (!selected) return;
    await saveToPath(active, selected);
  };

  const handleSave = async () => {
    if (!active) return;
    if (active.path) await saveToPath(active, active.path);
    else await handleSaveAs();
  };

  return {
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
  };
};
