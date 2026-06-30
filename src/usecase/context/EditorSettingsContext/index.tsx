import React from 'react';

import { SelectionMode } from '~/usecase/floors';
import { useSetting } from '~/usecase/hooks/useSetting';
import { ZoneVisibility, DEFAULT_ZONE_VISIBILITY } from '~/domain/zones';
import { TooltipTypes, TooltipTypeKey, DEFAULT_TOOLTIP_TYPES } from '~/domain/tooltips';
import { loadEditorConfig, loadGeneralConfig, defaultEditorConfig, defaultGeneralConfig } from '~/adapter/preferences';

import { EditorSettingsValue, EditorSettingsProviderProps } from './types';

const EditorSettingsContext = React.createContext({} as EditorSettingsValue);

const reviveZones = (stored: ZoneVisibility): ZoneVisibility => ({ ...DEFAULT_ZONE_VISIBILITY, ...stored });

const reviveTooltipTypes = (stored: TooltipTypes): TooltipTypes => ({ ...DEFAULT_TOOLTIP_TYPES, ...stored });

export const EditorSettingsProvider = ({ children }: EditorSettingsProviderProps) => {
  const [automagic, setAutomagic] = useSetting('automagic', true);
  const [showSpawns, setShowSpawns] = useSetting('showSpawns', true);
  const [showCreatures, setShowCreatures] = useSetting('showCreatures', true);
  const [showWaypoints, setShowWaypoints] = useSetting('showWaypoints', true);
  const [showHouses, setShowHouses] = useSetting('showHouses', true);
  const [showBlocking, setShowBlocking] = useSetting('showBlocking', false);
  const [showShade, setShowShade] = useSetting('showShade', true);
  const [showTooltips, setShowTooltips] = useSetting('showTooltips', true);
  const [tooltipTypes, setTooltipTypes] = useSetting<TooltipTypes>('tooltipTypes', DEFAULT_TOOLTIP_TYPES, {
    revive: reviveTooltipTypes
  });
  const [showRenderStats, setShowRenderStats] = useSetting('showRenderStats', true);
  const [selectionMode, setSelectionMode] = useSetting<SelectionMode>('selectionMode', 'current');
  const [compensateSelection, setCompensateSelection] = useSetting('compensateSelection', true);
  const [zoneVisibility, setZoneVisibility] = useSetting<ZoneVisibility>('zoneVisibility', DEFAULT_ZONE_VISIBILITY, {
    revive: reviveZones
  });

  const [spawnSize, setSpawnSize] = React.useState(defaultGeneralConfig.spawnSize);
  const [spawnTime, setSpawnTime] = React.useState(defaultGeneralConfig.spawnTime);
  const [autoCreateSpawn, setAutoCreateSpawn] = React.useState(defaultEditorConfig.autoCreateSpawn);
  const [eraseMonsters, setEraseMonsters] = React.useState(defaultEditorConfig.eraseMonsters);
  const [eraseSpawns, setEraseSpawns] = React.useState(defaultEditorConfig.eraseSpawns);
  const [copyPositionFormat, setCopyPositionFormat] = React.useState(defaultGeneralConfig.copyPositionFormat);
  const [infiniteMouse, setInfiniteMouse] = React.useState(defaultGeneralConfig.infiniteMouse);

  const reloadGeneral = React.useCallback(() => {
    void loadGeneralConfig().then((g) => {
      setSpawnSize(g.spawnSize);
      setSpawnTime(g.spawnTime);
      setCopyPositionFormat(g.copyPositionFormat);
      setInfiniteMouse(g.infiniteMouse);
    });
  }, []);

  const reloadEditor = React.useCallback(() => {
    void loadEditorConfig().then((e) => {
      setAutoCreateSpawn(e.autoCreateSpawn);
      setEraseMonsters(e.eraseMonsters);
      setEraseSpawns(e.eraseSpawns);
    });
  }, []);

  React.useEffect(reloadGeneral, [reloadGeneral]);
  React.useEffect(reloadEditor, [reloadEditor]);

  const toggleAutomagic = React.useCallback(() => setAutomagic((v) => !v), [setAutomagic]);
  const toggleSpawns = React.useCallback(() => setShowSpawns((v) => !v), [setShowSpawns]);
  const toggleCreatures = React.useCallback(() => setShowCreatures((v) => !v), [setShowCreatures]);
  const toggleWaypoints = React.useCallback(() => setShowWaypoints((v) => !v), [setShowWaypoints]);
  const toggleHouses = React.useCallback(() => setShowHouses((v) => !v), [setShowHouses]);
  const toggleBlocking = React.useCallback(() => setShowBlocking((v) => !v), [setShowBlocking]);
  const toggleShade = React.useCallback(() => setShowShade((v) => !v), [setShowShade]);
  const toggleTooltips = React.useCallback(() => setShowTooltips((v) => !v), [setShowTooltips]);
  const toggleTooltipType = React.useCallback(
    (key: TooltipTypeKey) => setTooltipTypes((v) => ({ ...v, [key]: !v[key] })),
    [setTooltipTypes]
  );
  const toggleTooltipTypes = React.useCallback(
    (keys: TooltipTypeKey[]) =>
      setTooltipTypes((v) => {
        const next = !keys.every((k) => v[k]);
        const updated = { ...v };
        for (const k of keys) updated[k] = next;
        return updated;
      }),
    [setTooltipTypes]
  );
  const toggleRenderStats = React.useCallback(() => setShowRenderStats((v) => !v), [setShowRenderStats]);
  const toggleCompensateSelection = React.useCallback(() => setCompensateSelection((v) => !v), [setCompensateSelection]);
  const toggleZone = React.useCallback(
    (key: keyof ZoneVisibility) => setZoneVisibility((v) => ({ ...v, [key]: !v[key] })),
    [setZoneVisibility]
  );
  const setAllZones = React.useCallback(
    (visible: boolean) => setZoneVisibility({ pz: visible, nopvp: visible, nologout: visible, pvp: visible }),
    [setZoneVisibility]
  );

  const value = React.useMemo<EditorSettingsValue>(
    () => ({
      automagic,
      showSpawns,
      showCreatures,
      showWaypoints,
      showHouses,
      showBlocking,
      showShade,
      showTooltips,
      tooltipTypes,
      showRenderStats,
      selectionMode,
      compensateSelection,
      spawnSize,
      spawnTime,
      autoCreateSpawn,
      eraseMonsters,
      eraseSpawns,
      copyPositionFormat,
      infiniteMouse,
      zoneVisibility,
      reloadEditor,
      reloadGeneral,
      toggleSpawns,
      toggleAutomagic,
      toggleCreatures,
      toggleWaypoints,
      toggleHouses,
      toggleBlocking,
      toggleShade,
      toggleTooltips,
      toggleTooltipType,
      toggleTooltipTypes,
      toggleRenderStats,
      setSelectionMode,
      toggleCompensateSelection,
      toggleZone,
      setAllZones
    }),
    [
      automagic,
      showSpawns,
      showCreatures,
      showWaypoints,
      showHouses,
      showBlocking,
      showShade,
      showTooltips,
      tooltipTypes,
      showRenderStats,
      selectionMode,
      compensateSelection,
      spawnSize,
      spawnTime,
      autoCreateSpawn,
      eraseMonsters,
      eraseSpawns,
      copyPositionFormat,
      infiniteMouse,
      zoneVisibility,
      reloadEditor,
      reloadGeneral,
      toggleSpawns,
      toggleAutomagic,
      toggleCreatures,
      toggleWaypoints,
      toggleHouses,
      toggleBlocking,
      toggleShade,
      toggleTooltips,
      toggleTooltipType,
      toggleTooltipTypes,
      toggleRenderStats,
      setSelectionMode,
      toggleCompensateSelection,
      toggleZone,
      setAllZones
    ]
  );

  return <EditorSettingsContext.Provider value={value}>{children}</EditorSettingsContext.Provider>;
};

export const useEditorSettings = () => React.useContext(EditorSettingsContext);
