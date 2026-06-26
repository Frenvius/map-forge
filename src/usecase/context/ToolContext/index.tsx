import React from 'react';

import { BrushOption } from '~/adapter/biomes';
import { ToolId, EraserMode } from '~/domain/tools';
import { ResolvedBiome, GenerateOptions } from '~/domain/biome';
import { ActiveBrush, isRevealFriendly, PaletteCategoryId } from '~/domain/palette';
import { MountainOptions, ResolvedMountain } from '~/domain/mountain';

import { PaletteReveal, GenerateSignal, ToolContextValue, ToolProviderProps, PaletteCategorySignal } from './types';

const ToolContext = React.createContext({} as ToolContextValue);

export const ToolProvider = ({ children }: ToolProviderProps) => {
  const [activeTool, setActiveToolState] = React.useState<ToolId>('select');
  const [activeBrush, setActiveBrush] = React.useState<ActiveBrush | null>(null);
  const [penBrush, setPenBrush] = React.useState<BrushOption | null>(null);
  const [penWidth, setPenWidth] = React.useState(1);
  const [activeHouseId, setActiveHouse] = React.useState<number | null>(null);
  const [ctrlErase, setCtrlErase] = React.useState(false);
  const [eraserMode, setEraserMode] = React.useState<EraserMode>('items');
  const [reveal, setReveal] = React.useState<PaletteReveal | null>(null);
  const [paletteCategory, setPaletteCategoryState] = React.useState<PaletteCategorySignal | null>(null);
  const [generateSignal, setGenerateSignal] = React.useState<GenerateSignal | null>(null);
  const [generationProgress, setGenerationProgress] = React.useState<string | null>(null);

  React.useEffect(() => {
    const sync = (e: KeyboardEvent) => setCtrlErase(e.ctrlKey);
    const clear = () => setCtrlErase(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const setActiveTool = React.useCallback((tool: ToolId) => {
    setActiveToolState(tool);
    if (tool !== 'house' && tool !== 'house_exit') setActiveHouse(null);
  }, []);

  const selectBrush = React.useCallback((brush: ActiveBrush | null) => {
    setActiveBrush(brush);
    setActiveToolState(brush ? 'brush' : 'select');
    setActiveHouse(null);
  }, []);

  const revealInPalette = React.useCallback((category: PaletteCategoryId, serverId: number, name?: string) => {
    setReveal((r) => ({ category, serverId, name, nonce: (r?.nonce ?? 0) + 1 }));
  }, []);

  const paletteRegistry = React.useRef(new Map<string, PaletteCategoryId>());

  const registerPalette = React.useCallback((id: string, category: PaletteCategoryId) => {
    paletteRegistry.current.set(id, category);
  }, []);

  const unregisterPalette = React.useCallback((id: string) => {
    paletteRegistry.current.delete(id);
  }, []);

  const shouldHandleReveal = React.useCallback((id: string) => {
    const reg = paletteRegistry.current;
    const mine = reg.get(id);
    if (mine === undefined) return false;
    if (isRevealFriendly(mine)) return true;
    const friendly = [...reg.values()].some(isRevealFriendly);
    if (friendly) return false;
    const fallback = [...reg.keys()].sort()[0];
    return id === fallback;
  }, []);

  const setPaletteCategory = React.useCallback((category: PaletteCategoryId) => {
    setPaletteCategoryState((p) => ({ category, nonce: (p?.nonce ?? 0) + 1 }));
  }, []);

  const requestGenerate = React.useCallback(
    (
      biomes: ResolvedBiome[],
      opts: GenerateOptions,
      mountain: ResolvedMountain | null = null,
      mountainOpts: MountainOptions | null = null
    ) => {
      setGenerateSignal((s) => ({ biomes, opts, mountain, mountainOpts, nonce: (s?.nonce ?? 0) + 1 }));
    },
    []
  );

  const value = React.useMemo<ToolContextValue>(
    () => ({
      activeTool,
      activeBrush,
      penBrush,
      penWidth,
      activeHouseId,
      ctrlErase,
      eraserMode,
      reveal,
      paletteCategory,
      generateSignal,
      generationProgress,
      setGenerationProgress,
      requestGenerate,
      setActiveTool,
      selectBrush,
      setPenBrush,
      setPenWidth,
      setActiveHouse,
      setEraserMode,
      revealInPalette,
      setPaletteCategory,
      registerPalette,
      unregisterPalette,
      shouldHandleReveal
    }),
    [
      activeTool,
      activeBrush,
      penBrush,
      penWidth,
      activeHouseId,
      ctrlErase,
      eraserMode,
      reveal,
      paletteCategory,
      generateSignal,
      generationProgress,
      setGenerationProgress,
      requestGenerate,
      setActiveTool,
      selectBrush,
      setPenBrush,
      setPenWidth,
      setActiveHouse,
      setEraserMode,
      revealInPalette,
      setPaletteCategory,
      registerPalette,
      unregisterPalette,
      shouldHandleReveal
    ]
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
};

export const useTool = () => React.useContext(ToolContext);
