import React from 'react';

import { ZoneVisibility } from '~/domain/zones';

export interface EditorSettingsValue {
  automagic: boolean;
  showSpawns: boolean;
  showCreatures: boolean;
  showWaypoints: boolean;
  showHouses: boolean;
  spawnSize: number;
  spawnTime: number;
  autoCreateSpawn: boolean;
  copyPositionFormat: string;
  zoneVisibility: ZoneVisibility;
  reloadEditor: () => void;
  reloadGeneral: () => void;
  toggleSpawns: () => void;
  toggleAutomagic: () => void;
  toggleCreatures: () => void;
  toggleWaypoints: () => void;
  toggleHouses: () => void;
  toggleZone: (key: keyof ZoneVisibility) => void;
}

export interface EditorSettingsProviderProps {
  children: React.ReactNode;
}
