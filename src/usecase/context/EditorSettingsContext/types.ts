import React from 'react';

import { ZoneVisibility } from '~/domain/zones';
import { TooltipTypes, TooltipTypeKey } from '~/domain/tooltips';

export interface EditorSettingsValue {
  automagic: boolean;
  showSpawns: boolean;
  showCreatures: boolean;
  showWaypoints: boolean;
  showHouses: boolean;
  showTooltips: boolean;
  tooltipTypes: TooltipTypes;
  showRenderStats: boolean;
  spawnSize: number;
  spawnTime: number;
  autoCreateSpawn: boolean;
  copyPositionFormat: string;
  infiniteMouse: boolean;
  zoneVisibility: ZoneVisibility;
  reloadEditor: () => void;
  reloadGeneral: () => void;
  toggleSpawns: () => void;
  toggleAutomagic: () => void;
  toggleCreatures: () => void;
  toggleWaypoints: () => void;
  toggleHouses: () => void;
  toggleTooltips: () => void;
  toggleTooltipType: (key: TooltipTypeKey) => void;
  toggleTooltipTypes: (keys: TooltipTypeKey[]) => void;
  toggleRenderStats: () => void;
  toggleZone: (key: keyof ZoneVisibility) => void;
  setAllZones: (visible: boolean) => void;
}

export interface EditorSettingsProviderProps {
  children: React.ReactNode;
}
