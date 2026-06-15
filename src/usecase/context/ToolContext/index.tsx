import React from 'react';

import { ToolId } from '~/domain/tools';
import { ActiveBrush, PaletteCategoryId } from '~/domain/palette';

import { PaletteReveal, ToolContextValue, ToolProviderProps } from './types';

const ToolContext = React.createContext({} as ToolContextValue);

export const ToolProvider = ({ children }: ToolProviderProps) => {
  const [activeTool, setActiveTool] = React.useState<ToolId>('select');
  const [activeBrush, setActiveBrush] = React.useState<ActiveBrush | null>(null);
  const [activeHouseId, setActiveHouse] = React.useState<number | null>(null);
  const [reveal, setReveal] = React.useState<PaletteReveal | null>(null);

  const selectBrush = React.useCallback((brush: ActiveBrush | null) => {
    setActiveBrush(brush);
    setActiveTool(brush ? 'brush' : 'select');
  }, []);

  const revealInPalette = React.useCallback((category: PaletteCategoryId, serverId: number, name?: string) => {
    setReveal((r) => ({ category, serverId, name, nonce: (r?.nonce ?? 0) + 1 }));
  }, []);

  const value = React.useMemo<ToolContextValue>(
    () => ({ activeTool, activeBrush, activeHouseId, reveal, setActiveTool, selectBrush, setActiveHouse, revealInPalette }),
    [activeTool, activeBrush, activeHouseId, reveal, selectBrush, revealInPalette]
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
};

export const useTool = () => React.useContext(ToolContext);
