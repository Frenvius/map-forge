import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Save, FilePlus, FolderOpen } from 'lucide-react';

import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';
import {
  Menubar,
  MenubarSub,
  MenubarMenu,
  MenubarItem,
  MenubarContent,
  MenubarTrigger,
  MenubarShortcut,
  MenubarSeparator,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarCheckboxItem
} from '~/components/commons/ui/menubar';

interface AppMenuProps {
  loading: boolean;
  hasActive: boolean;
  recent: string[];
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseMap: () => void;
  onEditTowns: () => void;
  onClearRecent: () => void;
  onMapProperties: () => void;
  onMapStatistics: () => void;
  onOpenPreferences: () => void;
  onOpenRecent: (path: string) => void;
  onAbout: () => void;
}

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

const AppMenu = ({
  loading,
  hasActive,
  recent,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onCloseMap,
  onEditTowns,
  onClearRecent,
  onOpenRecent,
  onMapProperties,
  onMapStatistics,
  onOpenPreferences,
  onAbout
}: AppMenuProps) => {
  const { zoneVisibility, toggleZone, setAllZones, showRenderStats, toggleRenderStats } = useEditorSettings();
  const anyZoneVisible = zoneVisibility.pz || zoneVisibility.nopvp || zoneVisibility.nologout || zoneVisibility.pvp;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <Menubar>
      <MenubarMenu value="file">
        <MenubarTrigger onMouseDown={stop}>File</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarItem onSelect={onNew} disabled={loading}>
            <FilePlus className="mr-2 h-3.5 w-3.5" />
            New Map
            <MenubarShortcut>Ctrl+N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={onOpen} disabled={loading}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            Open Map...
            <MenubarShortcut>Ctrl+O</MenubarShortcut>
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger disabled={loading}>Open Recent</MenubarSubTrigger>
            <MenubarSubContent>
              {recent.length === 0 ? (
                <MenubarItem disabled>No recent maps</MenubarItem>
              ) : (
                <>
                  {recent.map((path) => (
                    <MenubarItem key={path} title={path} onSelect={() => onOpenRecent(path)}>
                      {basename(path)}
                    </MenubarItem>
                  ))}
                  <MenubarSeparator />
                  <MenubarItem onSelect={onClearRecent}>Clear Recent</MenubarItem>
                </>
              )}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem onSelect={onSave} disabled={!hasActive}>
            <Save className="mr-2 h-3.5 w-3.5" />
            Save
            <MenubarShortcut>Ctrl+S</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={onSaveAs} disabled={!hasActive}>
            Save As...
            <MenubarShortcut>Ctrl+Shift+S</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!hasActive} onSelect={onCloseMap}>
            Close Map
            <MenubarShortcut>Ctrl+W</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => void getCurrentWindow().destroy()}>Exit</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="edit">
        <MenubarTrigger onMouseDown={stop}>Edit</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarItem onSelect={onOpenPreferences}>
            Preferences...
            <MenubarShortcut>Ctrl+,</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="map">
        <MenubarTrigger onMouseDown={stop}>Map</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarItem disabled={!hasActive} onSelect={onEditTowns}>
            Edit Towns
            <MenubarShortcut>Ctrl+T</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!hasActive} onSelect={onMapProperties}>
            Properties...
            <MenubarShortcut>Ctrl+P</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!hasActive} onSelect={onMapStatistics}>
            Statistics
            <MenubarShortcut>F8</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="view">
        <MenubarTrigger onMouseDown={stop}>View</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarCheckboxItem
            checked={zoneVisibility.pz}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('pz')}
          >
            Show protection zones
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={zoneVisibility.nopvp}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('nopvp')}
          >
            Show no-PVP zones
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={zoneVisibility.nologout}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('nologout')}
          >
            Show no-logout zones
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={zoneVisibility.pvp}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleZone('pvp')}
          >
            Show PVP zones
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem onSelect={(e) => e.preventDefault()} onClick={() => setAllZones(!anyZoneVisible)}>
            {anyZoneVisible ? 'Hide all zones' : 'Show all zones'}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="help">
        <MenubarTrigger onMouseDown={stop}>Help</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarCheckboxItem
            checked={showRenderStats}
            onCheckedChange={toggleRenderStats}
            onSelect={(e) => e.preventDefault()}
          >
            Show render stats
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem onSelect={onAbout}>About</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};

export default AppMenu;
