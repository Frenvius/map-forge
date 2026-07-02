import React from 'react';

import { ZoneVisibility } from '~/domain/zones';
import { SelectionMode } from '~/usecase/floors';
import { TooltipTypes, TooltipTypeKey } from '~/domain/tooltips';

export interface EditorSettingsValue {
  automagic: boolean;
  showSpawns: boolean;
  showCreatures: boolean;
  showWaypoints: boolean;
  showHouses: boolean;
  showBlocking: boolean;
  showShade: boolean;
  showTooltips: boolean;
  tooltipTypes: TooltipTypes;
  showRenderStats: boolean;
  selectionMode: SelectionMode;
  compensateSelection: boolean;
  spawnSize: number;
  spawnTime: number;
  autoCreateSpawn: boolean;
  eraseMonsters: boolean;
  eraseSpawns: boolean;
  defaultFloor: number;
  undoSteps: number;
  undoMemoryMb: number;
  mergePaste: boolean;
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
  toggleBlocking: () => void;
  toggleShade: () => void;
  toggleTooltips: () => void;
  toggleTooltipType: (key: TooltipTypeKey) => void;
  toggleTooltipTypes: (keys: TooltipTypeKey[]) => void;
  toggleRenderStats: () => void;
  setSelectionMode: (mode: SelectionMode) => void;
  toggleCompensateSelection: () => void;
  toggleZone: (key: keyof ZoneVisibility) => void;
  setAllZones: (visible: boolean) => void;
}

export interface EditorSettingsProviderProps {
  children: React.ReactNode;
}
