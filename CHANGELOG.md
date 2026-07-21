# Changelog

All notable changes to Map Forge are documented here. Sections are generated from semantic commits at release time.

## [0.1.2] - 2026-07-21

### Added
- Import Map window with a numeric offset and house/spawn merge options, plus an optional manual (drag-to-place) mode.
- Editable item properties panel, including fluid recolor.
- Containers tab in the Map IDs panel, with sort and delete.
- Reveal a recent map in the file explorer.
- Strip all action or unique IDs from the map.
- Live box-selection size shown in the status bar.
- Edit map width and height.
- Scripted projects resolve asset paths from the .frg manifest before scripts run.
- Reload script files from the Lua dialog.
- Open the scripts folder from the Lua dialog.

### Fixed
- Asset and materials load failures are surfaced instead of failing silently.
- Border and wall client IDs stay valid for maps without an OTB.
- Ground brush rolls item variants by their declared chance.
- Project item DB takes priority, and non-OTB item DBs are discovered.
- Tooltips no longer clipped by panels.
- Renders the full declared map area and shades outside it.
- Assets-missing screen shows the scripted asset label.
- Lua scripts dialog header aligned with its close button.

### Performance
- Faster selection delete.
- Heavy map edits run off the main thread, keeping the UI responsive.
- Smoother, faster box-paint ghost.

### Changed
- Town editor is now a floating panel instead of a modal dialog.

## [0.1.1] - 2026-07-02

### Added
- Interactive map import with a sprite-LOD preview.
- Cross-map clipboard with a replace-on-paste option.
- Hunt generator with route editing and spawn scatter.
- Action and unique ID panel with teleport targets and tile highlighting.
- Borderize brush with mountain and gravel borders.
- Doodad brushes with randomized assembly.
- Virtualized, searchable tile and brush pickers with thumbnails.
- Optional border editing in the tileset editor, preserving border attributes.
- Ctrl+scroll to change floors on the map canvas.
- Configurable default floor (sea level) in editor preferences.
- Adjustable undo/redo history budget in preferences.
- Custom data-folder preference with an option to copy existing data.
- Confirmation prompt when closing with unsaved changes.
- Loaded client version shown in the assets-ready status.
- Redesigned preferences dialog with sidebar navigation and format examples.
- Versioned client data now bundled with the installer.

### Fixed
- Map import expands the map bounds and drops content at the cursor.
- Hangable item rotation.

### Changed
- DAT parsing now enforces OTFI extended and transparency flags.

## [0.1.0] - 2026-06-30

First public release of Map Forge.
