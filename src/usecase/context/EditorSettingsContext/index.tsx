import React from 'react';

import { useSetting } from '~/usecase/hooks/useSetting';
import { ZoneVisibility, DEFAULT_ZONE_VISIBILITY } from '~/domain/zones';
import { loadEditorConfig, loadGeneralConfig, defaultEditorConfig, defaultGeneralConfig } from '~/adapter/preferences';

import { EditorSettingsValue, EditorSettingsProviderProps } from './types';

const EditorSettingsContext = React.createContext({} as EditorSettingsValue);

const reviveZones = (stored: ZoneVisibility): ZoneVisibility => ({ ...DEFAULT_ZONE_VISIBILITY, ...stored });

export const EditorSettingsProvider = ({ children }: EditorSettingsProviderProps) => {
  const [automagic, setAutomagic] = useSetting('automagic', true);
  const [showSpawns, setShowSpawns] = useSetting('showSpawns', true);
  const [showCreatures, setShowCreatures] = useSetting('showCreatures', true);
  const [showWaypoints, setShowWaypoints] = useSetting('showWaypoints', true);
  const [zoneVisibility, setZoneVisibility] = useSetting<ZoneVisibility>('zoneVisibility', DEFAULT_ZONE_VISIBILITY, {
    revive: reviveZones
  });

  const [spawnSize, setSpawnSize] = React.useState(defaultGeneralConfig.spawnSize);
  const [spawnTime, setSpawnTime] = React.useState(defaultGeneralConfig.spawnTime);
  const [autoCreateSpawn, setAutoCreateSpawn] = React.useState(defaultEditorConfig.autoCreateSpawn);
  const [copyPositionFormat, setCopyPositionFormat] = React.useState(defaultGeneralConfig.copyPositionFormat);

  const reloadGeneral = React.useCallback(() => {
    void loadGeneralConfig().then((g) => {
      setSpawnSize(g.spawnSize);
      setSpawnTime(g.spawnTime);
      setCopyPositionFormat(g.copyPositionFormat);
    });
  }, []);

  const reloadEditor = React.useCallback(() => {
    void loadEditorConfig().then((e) => setAutoCreateSpawn(e.autoCreateSpawn));
  }, []);

  React.useEffect(reloadGeneral, [reloadGeneral]);
  React.useEffect(reloadEditor, [reloadEditor]);

  const toggleAutomagic = React.useCallback(() => setAutomagic((v) => !v), [setAutomagic]);
  const toggleSpawns = React.useCallback(() => setShowSpawns((v) => !v), [setShowSpawns]);
  const toggleCreatures = React.useCallback(() => setShowCreatures((v) => !v), [setShowCreatures]);
  const toggleWaypoints = React.useCallback(() => setShowWaypoints((v) => !v), [setShowWaypoints]);
  const toggleZone = React.useCallback(
    (key: keyof ZoneVisibility) => setZoneVisibility((v) => ({ ...v, [key]: !v[key] })),
    [setZoneVisibility]
  );

  const value = React.useMemo<EditorSettingsValue>(
    () => ({
      automagic,
      showSpawns,
      showCreatures,
      showWaypoints,
      spawnSize,
      spawnTime,
      autoCreateSpawn,
      copyPositionFormat,
      zoneVisibility,
      reloadEditor,
      reloadGeneral,
      toggleSpawns,
      toggleAutomagic,
      toggleCreatures,
      toggleWaypoints,
      toggleZone
    }),
    [
      automagic,
      showSpawns,
      showCreatures,
      showWaypoints,
      spawnSize,
      spawnTime,
      autoCreateSpawn,
      copyPositionFormat,
      zoneVisibility,
      reloadEditor,
      reloadGeneral,
      toggleSpawns,
      toggleAutomagic,
      toggleCreatures,
      toggleWaypoints,
      toggleZone
    ]
  );

  return <EditorSettingsContext.Provider value={value}>{children}</EditorSettingsContext.Provider>;
};

export const useEditorSettings = () => React.useContext(EditorSettingsContext);
