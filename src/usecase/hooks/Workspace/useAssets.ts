import React from 'react';

import { PaletteData } from '~/domain/palette';
import { loadPalette } from '~/adapter/palette';
import { setMinimapPalette } from '~/adapter/minimap';
import { loadClientConfig } from '~/adapter/preferences';
import { loadAssets, initDataDir, LoadedAssets } from '~/adapter/assets';

export interface AssetsState {
  assets: LoadedAssets | null;
  palette: PaletteData | null;
  status: string;
  error: string | null;
  dataDir: string;
  version: number;
  clientConfigured: boolean;
  assetsMissing: boolean;
  retryAssets: () => void;
  minimapColors: number[] | null;
  minimapReady: boolean;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export const useAssets = (): AssetsState => {
  const [assets, setAssets] = React.useState<LoadedAssets | null>(null);
  const [palette, setPalette] = React.useState<PaletteData | null>(null);
  const [status, setStatus] = React.useState('Loading client assets...');
  const [error, setError] = React.useState<string | null>(null);
  const [dataDir, setDataDir] = React.useState('');
  const [version, setVersion] = React.useState(0);
  const [clientConfigured, setClientConfigured] = React.useState(true);
  const [assetsMissing, setAssetsMissing] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [minimapReady, setMinimapReady] = React.useState(false);

  const retryAssets = React.useCallback(() => setReloadKey((k) => k + 1), []);

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
      const config = await loadClientConfig();
      const v = config.defaultVersion;
      const resolvedDataDir = await initDataDir(v);
      if (cancelled) return;
      setDataDir(resolvedDataDir);
      setVersion(v);

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
        const pal = await loadPalette(resolvedDataDir).catch(() => null);
        setPalette(pal);
        const parts = [`${a.spritesCount} sprites`];
        if (a.otbItemCount > 0) parts.push(`${a.otbItemCount} items`);
        if (!pal) parts.push('no materials');
        setStatus(`Assets ready - ${parts.join(', ')}. Open a map to begin.`);
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
    clientConfigured,
    assetsMissing,
    retryAssets,
    minimapColors,
    minimapReady,
    setStatus,
    setError
  };
};
