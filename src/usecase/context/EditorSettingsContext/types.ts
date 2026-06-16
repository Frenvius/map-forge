import React from 'react';

import { ZoneVisibility } from '~/domain/zones';

export interface EditorSettingsValue {
  automagic: boolean;
  showSpawns: boolean;
  showCreatures: boolean;
  showWaypoints: boolean;
  showHouses: boolean;
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
  toggleRenderStats: () => void;
  toggleZone: (key: keyof ZoneVisibility) => void;
  setAllZones: (visible: boolean) => void;
}

export interface EditorSettingsProviderProps {
  children: React.ReactNode;
}
