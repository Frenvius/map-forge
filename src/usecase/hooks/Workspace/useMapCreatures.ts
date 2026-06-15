import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

import { CreatureLook } from '~/domain/creature';
import { PaletteTileset } from '~/domain/palette';
import {
  CreatureDirs,
  scanCreatures,
  readMapDataDir,
  writeMapDataDir,
  resolveCreatureDirs,
  creatureDbFromEntries,
  creatureTilesetsFromEntries
} from '~/adapter/creatures';

interface CreatureSource {
  id: string;
  path?: string;
}

export interface MapCreaturesApi {
  creatureDb: Map<string, CreatureLook>;
  creatureTilesets: PaletteTileset[];
  dataDir: string | null;
  needsPicker: boolean;
  resolving: boolean;
  pickDir: () => Promise<void>;
  rescan: () => Promise<void>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function dirsFromBase(base: string): Promise<CreatureDirs | null> {
  const dirs = await invoke<{ data_dir: string; monster_dir: string | null; npc_dir: string | null } | null>('creature_dirs', {
    base
  });
  if (!dirs) return null;
  return { dataDir: dirs.data_dir, monsterDir: dirs.monster_dir, npcDir: dirs.npc_dir };
}

export const useMapCreatures = (
  active: CreatureSource | null,
  fallbackDb: Map<string, CreatureLook> | null,
  onStatus?: (message: string) => void
): MapCreaturesApi => {
  const [scannedDb, setScannedDb] = React.useState<Map<string, CreatureLook> | null>(null);
  const [creatureTilesets, setCreatureTilesets] = React.useState<PaletteTileset[]>([]);
  const [dataDir, setDataDir] = React.useState<string | null>(null);
  const [needsPicker, setNeedsPicker] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);

  const dirsRef = React.useRef<CreatureDirs | null>(null);
  const path = active?.path ?? null;

  const applyScan = React.useCallback(
    async (dirs: CreatureDirs, announce: boolean) => {
      const entries = await scanCreatures(dirs);
      setScannedDb(creatureDbFromEntries(entries));
      setCreatureTilesets(creatureTilesetsFromEntries(entries));
      await invoke('watch_creatures', { monsterDir: dirs.monsterDir, npcDir: dirs.npcDir }).catch(() => {});
      if (announce) {
        const monsters = entries.filter((e) => !e.isNpc).length;
        const npcs = entries.length - monsters;
        onStatus?.(`Loaded ${plural(monsters, 'monster')}, ${plural(npcs, 'NPC')}`);
      }
    },
    [onStatus]
  );

  React.useLayoutEffect(() => {
    dirsRef.current = null;
    setNeedsPicker(false);
    if (!path) {
      setScannedDb(null);
      setCreatureTilesets([]);
      setDataDir(null);
      setResolving(false);
      return;
    }
    setResolving(true);
    let cancelled = false;
    void (async () => {
      const stored = await readMapDataDir(path);
      const dirs = stored ? await dirsFromBase(stored) : await resolveCreatureDirs(path);
      if (cancelled) return;
      if (!dirs) {
        setScannedDb(null);
        setCreatureTilesets([]);
        setDataDir(null);
        setNeedsPicker(true);
        setResolving(false);
        return;
      }
      dirsRef.current = dirs;
      setDataDir(dirs.dataDir);
      setResolving(false);
      await applyScan(dirs, true);
    })();
    return () => {
      cancelled = true;
      void invoke('unwatch_creatures').catch(() => {});
    };
  }, [active?.id, path, applyScan]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = listen('creatures-changed', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const dirs = dirsRef.current;
        if (dirs) void applyScan(dirs, false);
      }, 300);
    });
    return () => {
      if (timer) clearTimeout(timer);
      void unlisten.then((off) => off());
    };
  }, [applyScan]);

  const pickDir = React.useCallback(async () => {
    if (!path) return;
    const picked = await open({ multiple: false, directory: true, title: 'Select server data folder' });
    if (typeof picked !== 'string') return;
    const dirs = await dirsFromBase(picked);
    if (!dirs) {
      onStatus?.('No monster/npc folders found there');
      return;
    }
    await writeMapDataDir(path, dirs.dataDir);
    dirsRef.current = dirs;
    setDataDir(dirs.dataDir);
    setNeedsPicker(false);
    await applyScan(dirs, true);
  }, [path, applyScan, onStatus]);

  const rescan = React.useCallback(async () => {
    const dirs = dirsRef.current;
    if (dirs) await applyScan(dirs, true);
  }, [applyScan]);

  const creatureDb = React.useMemo(() => {
    if (!scannedDb) return fallbackDb ?? new Map<string, CreatureLook>();
    if (!fallbackDb) return scannedDb;
    const merged = new Map(fallbackDb);
    for (const [k, v] of scannedDb) merged.set(k, v);
    return merged;
  }, [scannedDb, fallbackDb]);

  return { creatureDb, creatureTilesets, dataDir, needsPicker, resolving, pickDir, rescan };
};
