import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Save, Package, FilePlus, RefreshCw, FileInput, FolderOpen } from 'lucide-react';

import { openDataDir } from '~/adapter/assets';
import { openTilesetEditor } from '~/adapter/windows';
import { TOOLTIP_TYPE_GROUPS } from '~/domain/tooltips';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { PaletteCategoryId, PALETTE_CATEGORIES } from '~/domain/palette';
import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';
import { openProject, PROJECT_EXT, closeProject, RecentProject, recentProjects, clearRecentProjects } from '~/adapter/project';
import {
  Menubar,
  MenubarSub,
  MenubarMenu,
  MenubarItem,
  MenubarLabel,
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
  minimapOpen: boolean;
  propertiesOpen: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseMap: () => void;
  onEditTowns: () => void;
  onClearRecent: () => void;
  onNewPalette: () => void;
  onToggleMinimap: () => void;
  onMapProperties: () => void;
  onMapStatistics: () => void;
  onOpenScripts: () => void;
  onOpenPreferences: () => void;
  idMarkersOpen: boolean;
  onToggleIdMarkers: () => void;
  onToggleProperties: () => void;
  onOpenRecent: (path: string) => void;
  onSelectPaletteCategory: (category: PaletteCategoryId) => void;
  onCheckUpdates: () => void;
  onAbout: () => void;
  onRequestExit: () => void;
  onImportMap: () => void;
  onStripActionIds: () => void;
  onStripUniqueIds: () => void;
}

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

const categoryLabel = (label: string) => label.replace(/ Palette$/, '');

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
  minimapOpen,
  onClearRecent,
  onNewPalette,
  onToggleMinimap,
  onOpenRecent,
  onMapProperties,
  onMapStatistics,
  propertiesOpen,
  onOpenScripts,
  onOpenPreferences,
  idMarkersOpen,
  onToggleIdMarkers,
  onToggleProperties,
  onSelectPaletteCategory,
  onCheckUpdates,
  onAbout,
  onRequestExit,
  onImportMap,
  onStripActionIds,
  onStripUniqueIds
}: AppMenuProps) => {
  const {
    zoneVisibility,
    toggleZone,
    setAllZones,
    showRenderStats,
    toggleRenderStats,
    showBlocking,
    toggleBlocking,
    showShade,
    toggleShade,
    showTooltips,
    toggleTooltips,
    showWaypoints,
    toggleWaypoints,
    tooltipTypes,
    toggleTooltipTypes,
    selectionMode,
    setSelectionMode,
    compensateSelection,
    toggleCompensateSelection
  } = useEditorSettings();
  const { dataDir, project } = useAssetsBundle();
  const anyZoneVisible = zoneVisibility.pz || zoneVisibility.nopvp || zoneVisibility.nologout || zoneVisibility.pvp;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const pickProject = async () => {
    const selected = await open({
      multiple: false,
      title: 'Open project',
      filters: [{ name: 'Forge Project', extensions: [PROJECT_EXT] }]
    });
    if (!selected || typeof selected !== 'string') return;
    await openProject(selected);
    window.location.reload();
  };

  const handleCloseProject = async () => {
    await closeProject();
    window.location.reload();
  };

  const openRecentProject = async (path: string) => {
    await openProject(path);
    window.location.reload();
  };

  const [recentProjectList, setRecentProjectList] = React.useState<RecentProject[]>([]);

  React.useEffect(() => {
    void recentProjects()
      .then(setRecentProjectList)
      .catch(() => setRecentProjectList([]));
  }, []);

  const clearProjectHistory = () => {
    void clearRecentProjects()
      .then(() => setRecentProjectList([]))
      .catch(() => undefined);
  };

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
          <MenubarItem onSelect={onImportMap} disabled={!hasActive || loading}>
            <FileInput className="mr-2 h-3.5 w-3.5" />
            Import Map...
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>
              <Package className="mr-2 h-3.5 w-3.5" />
              Project
            </MenubarSubTrigger>
            <MenubarSubContent>
              {project && (
                <>
                  <MenubarLabel className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5" />
                    <span className="truncate">{project.name}</span>
                  </MenubarLabel>
                  <MenubarSeparator />
                </>
              )}
              <MenubarItem onSelect={() => void pickProject()}>Open Project...</MenubarItem>
              <MenubarItem disabled={!project} onSelect={() => void handleCloseProject()}>
                Close Project
              </MenubarItem>
              {recentProjectList.length > 0 && (
                <>
                  <MenubarSeparator />
                  {recentProjectList.map((entry) => (
                    <MenubarItem key={entry.path} title={entry.path} onSelect={() => void openRecentProject(entry.path)}>
                      {entry.name ?? basename(entry.path)}
                    </MenubarItem>
                  ))}
                  <MenubarSeparator />
                  <MenubarItem onSelect={clearProjectHistory}>Clear Recent Projects</MenubarItem>
                </>
              )}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem disabled={!hasActive} onSelect={onCloseMap}>
            Close Map
            <MenubarShortcut>Ctrl+W</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={onRequestExit}>Exit</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="edit">
        <MenubarTrigger onMouseDown={stop}>Edit</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarSub>
            <MenubarSubTrigger>Selection Mode</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarCheckboxItem
                checked={compensateSelection}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={toggleCompensateSelection}
              >
                Compensate Selection
              </MenubarCheckboxItem>
              <MenubarSeparator />
              <MenubarCheckboxItem
                onSelect={(e) => e.preventDefault()}
                checked={selectionMode === 'current'}
                onCheckedChange={() => setSelectionMode('current')}
              >
                Current Floor
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                checked={selectionMode === 'lower'}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={() => setSelectionMode('lower')}
              >
                Lower Floors
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                onSelect={(e) => e.preventDefault()}
                checked={selectionMode === 'visible'}
                onCheckedChange={() => setSelectionMode('visible')}
              >
                Visible Floors
              </MenubarCheckboxItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger disabled={!hasActive}>Dangerous</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem onSelect={onStripActionIds}>Strip All Action IDs</MenubarItem>
              <MenubarItem onSelect={onStripUniqueIds}>Strip All Unique IDs</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem onSelect={onOpenScripts}>Lua Scripts...</MenubarItem>
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
          <MenubarSeparator />
          <MenubarCheckboxItem checked={showBlocking} onCheckedChange={toggleBlocking} onSelect={(e) => e.preventDefault()}>
            Show blocking
            <MenubarShortcut>O</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={showShade} onCheckedChange={toggleShade} onSelect={(e) => e.preventDefault()}>
            Shade lower floors
            <MenubarShortcut>Q</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={showWaypoints} onCheckedChange={toggleWaypoints} onSelect={(e) => e.preventDefault()}>
            Show waypoints
            <MenubarShortcut>Shift+W</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarCheckboxItem checked={showTooltips} onCheckedChange={toggleTooltips} onSelect={(e) => e.preventDefault()}>
            Show tooltips
            <MenubarShortcut>Y</MenubarShortcut>
          </MenubarCheckboxItem>
          {TOOLTIP_TYPE_GROUPS.map((t) => (
            <MenubarCheckboxItem
              key={t.keys.join('-')}
              disabled={!showTooltips}
              onSelect={(e) => e.preventDefault()}
              checked={t.keys.every((k) => tooltipTypes[k])}
              onCheckedChange={() => toggleTooltipTypes(t.keys)}
            >
              {t.label}
            </MenubarCheckboxItem>
          ))}
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="window">
        <MenubarTrigger onMouseDown={stop}>Window</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarCheckboxItem checked={minimapOpen} onCheckedChange={onToggleMinimap} onSelect={(e) => e.preventDefault()}>
            Minimap
            <MenubarShortcut>M</MenubarShortcut>
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={propertiesOpen} onCheckedChange={onToggleProperties} onSelect={(e) => e.preventDefault()}>
            Item Properties
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            disabled={!hasActive}
            checked={idMarkersOpen}
            onCheckedChange={onToggleIdMarkers}
            onSelect={(e) => e.preventDefault()}
          >
            Action / Unique IDs
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => void openTilesetEditor()}>Tileset Editor...</MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={loading} onSelect={onNewPalette}>
            New Palette
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger disabled={loading}>Palette</MenubarSubTrigger>
            <MenubarSubContent>
              {PALETTE_CATEGORIES.map((c) => (
                <MenubarItem key={c.id} onSelect={() => onSelectPaletteCategory(c.id)}>
                  {categoryLabel(c.label)}
                </MenubarItem>
              ))}
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu value="help">
        <MenubarTrigger onMouseDown={stop}>Help</MenubarTrigger>
        <MenubarContent onMouseDown={stop}>
          <MenubarCheckboxItem checked={showRenderStats} onCheckedChange={toggleRenderStats} onSelect={(e) => e.preventDefault()}>
            Show render stats
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem disabled={!dataDir} onSelect={() => void openDataDir(dataDir.replace(/[\\/][^\\/]+$/, ''))}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            Open Data Folder
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={onCheckUpdates}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Check for Updates
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={onAbout}>About</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
};

export default AppMenu;
