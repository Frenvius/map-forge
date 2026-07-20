import React from 'react';
import { invoke } from '@tauri-apps/api/core';

import { PaletteData } from '~/domain/palette';
import { loadPalette } from '~/adapter/palette';
import { setFloorShift } from '~/usecase/floors';
import { setMinimapPalette } from '~/adapter/minimap';
import { loadClientConfig } from '~/adapter/preferences';
import { buildScriptedAssets } from '~/usecase/scriptedAssets';
import { loadAssets, initDataDir, LoadedAssets } from '~/adapter/assets';
import { ProjectInfo, projectError, activeProject } from '~/adapter/project';
import { uiConfig, appConfig, loadScriptedAssets, loadScriptedItemdb } from '~/adapter/scripts';

export interface AssetsState {
  assets: LoadedAssets | null;
  palette: PaletteData | null;
  status: string;
  error: string | null;
  dataDir: string;
  version: number;
  assetLabel: string | null;
  project: ProjectInfo | null;
  clientConfigured: boolean;
  assetsMissing: boolean;
  retryAssets: () => void;
  minimapColors: number[] | null;
  minimapReady: boolean;
  switchVersion: (v: number) => Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setAssets: React.Dispatch<React.SetStateAction<LoadedAssets | null>>;
}

export const useAssets = (): AssetsState => {
  const [assets, setAssets] = React.useState<LoadedAssets | null>(null);
  const [palette, setPalette] = React.useState<PaletteData | null>(null);
  const [status, setStatus] = React.useState('Loading client assets...');
  const [error, setError] = React.useState<string | null>(null);
  const [dataDir, setDataDir] = React.useState('');
  const [version, setVersion] = React.useState(0);
  const [clientConfigured, setClientConfigured] = React.useState(true);
  const [assetLabel, setAssetLabel] = React.useState<string | null>(null);
  const [project, setProject] = React.useState<ProjectInfo | null>(null);
  const [assetsMissing, setAssetsMissing] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [minimapReady, setMinimapReady] = React.useState(false);
  const loadedVersionRef = React.useRef(0);

  const retryAssets = React.useCallback(() => setReloadKey((k) => k + 1), []);

  const switchVersion = React.useCallback(async (v: number) => {
    if (v === loadedVersionRef.current) return;
    const config = await loadClientConfig();
    const clientDir = (config.paths[v] ?? '').trim();
    if (!clientDir) throw new Error(`No client folder configured for version ${v}`);

    const resolvedDataDir = await initDataDir(v);
    const a = await loadAssets(resolvedDataDir, clientDir, v);

    setAssets(a);
    setDataDir(resolvedDataDir);
    setVersion(v);
    loadedVersionRef.current = v;

    const pal = await loadPalette(resolvedDataDir, a.items).catch((e) => {
      console.error(`loadPalette failed for ${resolvedDataDir}:`, e);
      return null;
    });
    setPalette(pal);
  }, []);

  const minimapColors = React.useMemo(() => {
    if (!assets) return null;
    let max = 0;
    for (const id of assets.items.keys()) if (id > max) max = id;
    const arr = new Array<number>(max + 1).fill(0);
    for (const [id, thing] of assets.items) if (thing.miniMap && thing.miniMapColor) arr[id] = thing.miniMapColor & 0xff;
    return arr;
  }, [assets]);

  React.useEffect(() => {
    if (!minimapColors) return;
    let cancelled = false;
    setMinimapReady(false);
    void setMinimapPalette(minimapColors).then(() => {
      if (!cancelled) setMinimapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [minimapColors]);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    setAssetsMissing(false);
    setStatus('Loading client assets...');
    void (async () => {
      const active = await activeProject().catch(() => null);
      if (cancelled) return;
      setProject(active);
      const failure = await projectError().catch(() => null);
      if (cancelled) return;
      if (failure) setError(failure);

      const app = await appConfig().catch(() => null);
      setFloorShift(app?.floorOffset ?? 1);
      const config = await loadClientConfig();
      const v = config.defaultVersion;
      const resolvedDataDir = await initDataDir(v);
      if (cancelled) return;
      setDataDir(resolvedDataDir);
      setVersion(v);
      loadedVersionRef.current = v;

      const ui = await uiConfig().catch(() => null);
      setAssetLabel(ui?.assets && !ui.clientVersions ? ui.assets.label || 'Assets' : null);
      if (ui?.assets && !ui.clientVersions) {
        const saved = active?.assets ?? '';
        if (!saved) {
          setClientConfigured(false);
          setAssetsMissing(true);
          setStatus(active ? `${active.name} declares no ${ui.assets.label} file` : `No ${ui.assets.label} file configured`);
          return;
        }
        setClientConfigured(true);
        try {
          if (active?.itemdb) {
            await loadScriptedItemdb(active.itemdb).catch((e) => {
              console.error(`loadScriptedItemdb failed for ${active.itemdb}:`, e);
              return 0;
            });
          }
          await loadScriptedAssets(saved);
          const scripted = await buildScriptedAssets(saved);
          if (cancelled) return;
          setAssets(scripted);
          const materialsError = await invoke('load_materials', { dataDir: resolvedDataDir }).then(
            () => null,
            (e) => {
              console.error(`load_materials failed for ${resolvedDataDir}:`, e);
              return String(e);
            }
          );
          const pal = await loadPalette(resolvedDataDir, scripted.items).catch((e) => {
            console.error(`loadPalette failed for ${resolvedDataDir}:`, e);
            return null;
          });
          setPalette(pal);
          if (materialsError) setError(`Automagic is off - materials failed to load from ${resolvedDataDir}: ${materialsError}`);
          setStatus(`${ui.assets.label} ready - ${scripted.items.size} items${pal ? '' : ', no materials'}.`);
        } catch (e) {
          if (cancelled) return;
          setAssetsMissing(true);
          setError(`Failed to load ${ui.assets.label}: ${e}`);
          setStatus('Asset load failed');
        }
        return;
      }

      const clientDir = (config.paths[v] ?? '').trim();
      if (!clientDir) {
        setClientConfigured(false);
        setAssetsMissing(true);
        setStatus('Client folder not set');
        return;
      }
      setClientConfigured(true);
      try {
        const a = await loadAssets(resolvedDataDir, clientDir, v);
        if (cancelled) return;
        setAssets(a);
        const pal = await loadPalette(resolvedDataDir, a.items).catch((e) => {
          console.error(`loadPalette failed for ${resolvedDataDir}:`, e);
          return null;
        });
        setPalette(pal);
        const parts = [`${a.spritesCount} sprites`];
        if (a.otbItemCount > 0) parts.push(`${a.otbItemCount} items`);
        if (!pal) parts.push('no materials');
        setStatus(`Assets ready (${v}) - ${parts.join(', ')}. Open a map to begin.`);
      } catch (e) {
        if (cancelled) return;
        setAssetsMissing(true);
        setError(`Failed to load assets: ${e}`);
        setStatus('Asset load failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return {
    assets,
    palette,
    status,
    error,
    dataDir,
    version,
    assetLabel,
    project,
    clientConfigured,
    assetsMissing,
    retryAssets,
    minimapColors,
    minimapReady,
    switchVersion,
    setStatus,
    setError,
    setAssets
  };
};
