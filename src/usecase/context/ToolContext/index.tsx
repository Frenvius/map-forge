import React from 'react';

import { ToolId } from '~/domain/tools';
import { ActiveBrush, PaletteCategoryId } from '~/domain/palette';

import { PaletteReveal, ToolContextValue, ToolProviderProps } from './types';

const ToolContext = React.createContext({} as ToolContextValue);

export const ToolProvider = ({ children }: ToolProviderProps) => {
  const [activeTool, setActiveToolState] = React.useState<ToolId>('select');
  const [activeBrush, setActiveBrush] = React.useState<ActiveBrush | null>(null);
  const [activeHouseId, setActiveHouse] = React.useState<number | null>(null);
  const [ctrlErase, setCtrlErase] = React.useState(false);
  const [reveal, setReveal] = React.useState<PaletteReveal | null>(null);

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

  const value = React.useMemo<ToolContextValue>(
    () => ({
      activeTool,
      activeBrush,
      activeHouseId,
      ctrlErase,
      reveal,
      setActiveTool,
      selectBrush,
      setActiveHouse,
      revealInPalette
    }),
    [activeTool, activeBrush, activeHouseId, ctrlErase, reveal, setActiveTool, selectBrush, revealInPalette]
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
};

export const useTool = () => React.useContext(ToolContext);
