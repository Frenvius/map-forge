import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Copy, Plus, Minus, Pencil, Search, Square, Trash2, TriangleAlert } from 'lucide-react';
import { useSensor, DndContext, useSensors, DragOverlay, DragEndEvent, PointerSensor, DragStartEvent } from '@dnd-kit/core';

import { cn } from '~/usecase/classNames';
import Resizer from '~/components/Dock/Resizer';
import { useSetting } from '~/usecase/hooks/useSetting';
import { FlagIndex, buildFlagIndex } from '~/adapter/thingFlags';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import BrushThumbnail from '~/components/PalettePanel/BrushThumbnail';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuShortcut,
  ContextMenuSeparator
} from '~/components/commons/ui/context-menu';
import {
  saveWall,
  BorderDef,
  WallBrush,
  loadWalls,
  BorderEdge,
  TilesetDef,
  saveGround,
  saveDoodad,
  createWall,
  deleteWall,
  renameWall,
  GroundBrush,
  loadBorders,
  loadGrounds,
  loadDoodads,
  saveBorders,
  DoodadBrush,
  saveTileset,
  createGround,
  deleteGround,
  renameGround,
  createDoodad,
  deleteDoodad,
  renameDoodad,
  loadTilesets,
  groundLookid,
  createTileset,
  deleteTileset,
  renameTileset,
  loadAllServerIds,
  readMaterialText,
  writeMaterialText,
  renameTilesetBrushRefs
} from '~/adapter/materials';

import WallEditor from './WallEditor';
import BorderEditor from './BorderEditor';
import GroundEditor from './GroundEditor';
import DoodadEditor from './DoodadEditor';
import ItemsPalette from './ItemsPalette';
import TilesetCategories from './TilesetCategories';
import { useItemSprites, ITEM_SPRITE_CACHE } from './sprites';

type EntityType = 'border' | 'ground' | 'wall' | 'doodad' | 'tileset';
interface Selection {
  type: EntityType;
  index: number;
}

const BORDERS_FILE = 'borders.xml';
const GROUNDS_FILE = 'grounds.xml';
const WALLS_FILE = 'walls.xml';
const DOODADS_FILE = 'doodads.xml';
const TILESETS_FILE = 'tilesets.xml';
const MATERIAL_FILES = [BORDERS_FILE, GROUNDS_FILE, WALLS_FILE, DOODADS_FILE, TILESETS_FILE];

interface FileSnap {
  file: string;
  text: string;
}
interface HistEntry {
  files: FileSnap[];
  sel: Selection | null;
}

const TitleBar = ({ title }: { title: string }) => {
  const win = getCurrentWindow();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    if (e.detail === 2) {
      void win.toggleMaximize();
      return;
    }
    void win.startDragging();
  };
  return (
    <div
      onMouseDown={onDragStart}
      className="flex h-8 flex-shrink-0 items-center border-b border-border/50 bg-toolbar-bg pl-3 pr-0"
    >
      <span className="text-xs font-semibold text-foreground">{title}</span>
      <div className="ml-auto flex items-center">
        <button
          onMouseDown={stop}
          onClick={() => win.minimize()}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onMouseDown={stop}
          onClick={() => win.toggleMaximize()}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
        <button
          onMouseDown={stop}
          onClick={() => void win.destroy()}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

const DragGhost = ({ serverId }: { serverId: number }) => {
  const { layouts, version } = useItemSprites([serverId]);
  return (
    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-primary bg-card shadow-island">
      <BrushThumbnail size={40} version={version} cache={ITEM_SPRITE_CACHE} layout={layouts.get(serverId) ?? null} />
    </div>
  );
};

const TilesetEditor = () => {
  const { assets, dataDir } = useAssetsBundle();
  const [borders, setBorders] = React.useState<BorderDef[]>([]);
  const [grounds, setGrounds] = React.useState<GroundBrush[]>([]);
  const [walls, setWalls] = React.useState<WallBrush[]>([]);
  const [doodads, setDoodads] = React.useState<DoodadBrush[]>([]);
  const [tilesets, setTilesets] = React.useState<TilesetDef[]>([]);
  const [sel, setSel] = React.useState<Selection | null>(null);
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<EntityType>('border');
  const [leftW, setLeftW] = useSetting('tilesetEditor.leftW', 288);
  const [rightW, setRightW] = useSetting('tilesetEditor.rightW', 256);
  const [renamingIdx, setRenamingIdx] = React.useState<number | null>(null);
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState('');
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const groundSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const doodadSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wallSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tilesetSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRef = React.useRef<HistEntry[]>([]);
  const redoRef = React.useRef<HistEntry[]>([]);
  const lastText = React.useRef<Map<string, string>>(new Map());

  const [flagIndex, setFlagIndex] = React.useState<FlagIndex>(new Map());

  React.useEffect(() => setRenamingIdx(null), [category]);
  React.useEffect(() => setEditingName(false), [sel?.type, sel?.index]);

  React.useEffect(() => {
    const items = assets?.items;
    if (!items) return;
    let cancelled = false;
    loadAllServerIds()
      .then((ids) => buildFlagIndex(ids, items))
      .then((idx) => !cancelled && setFlagIndex(idx))
      .catch((err) => console.error('Failed to build flag index', err));
    return () => {
      cancelled = true;
    };
  }, [assets]);

  const clampW = (n: number) => Math.max(200, Math.min(560, n));

  React.useEffect(() => {
    if (!dataDir) return;
    Promise.all([loadBorders(dataDir), loadGrounds(dataDir), loadWalls(dataDir), loadDoodads(dataDir), loadTilesets(dataDir)])
      .then(([b, g, w, d, t]) => {
        setBorders(b);
        setGrounds(g);
        setWalls(w);
        setDoodads(d);
        setTilesets(t);
        undoRef.current = [];
        redoRef.current = [];
        Promise.all(MATERIAL_FILES.map((f) => readMaterialText(dataDir, f).catch(() => ''))).then((texts) =>
          MATERIAL_FILES.forEach((f, i) => lastText.current.set(f, texts[i]))
        );
        if (b[0]) setSel({ type: 'border', index: 0 });
      })
      .catch((err) => console.error('Failed to load materials', err));
  }, [dataDir]);

  const q = query.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);

  const borderRep = (b: BorderDef) =>
    b.items.n ?? b.items.s ?? b.items.e ?? b.items.w ?? Object.values(b.items).find(Boolean) ?? 0;

  const brushLookid = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const g of grounds) {
      const l = groundLookid(g);
      if (l) m.set(g.name, l);
    }
    for (const d of doodads) if (d.serverLookid) m.set(d.name, d.serverLookid);
    for (const w of walls) if (w.serverLookid) m.set(w.name, w.serverLookid);
    return m;
  }, [grounds, doodads, walls]);

  const borderIdSet = React.useMemo(() => new Set(borders.map((b) => b.id)), [borders]);
  const nameSet = React.useMemo(
    () => new Set([...grounds.map((g) => g.name), ...doodads.map((d) => d.name), ...walls.map((w) => w.name)]),
    [grounds, doodads, walls]
  );

  const groundIssues = (g: GroundBrush): string[] => {
    const out: string[] = [];
    for (const b of g.borders) {
      if (b.id != null && !borderIdSet.has(b.id)) out.push(`border #${b.id} not found`);
      if (b.to && b.to !== 'none' && !nameSet.has(b.to)) out.push(`neighbor "${b.to}" not found`);
    }
    for (const f of g.friends) if (!nameSet.has(f)) out.push(`friend "${f}" not found`);
    return out;
  };

  const tilesetIssues = (t: TilesetDef): string[] => {
    const out: string[] = [];
    for (const c of t.categories) for (const b of c.brushes) if (!nameSet.has(b)) out.push(`brush "${b}" not found`);
    return out;
  };

  const issuesFor = (type: EntityType, index: number): string[] =>
    type === 'ground'
      ? grounds[index]
        ? groundIssues(grounds[index])
        : []
      : type === 'tileset'
        ? tilesets[index]
          ? tilesetIssues(tilesets[index])
          : []
        : [];

  const tilesetRep = (t: TilesetDef) => {
    for (const c of t.categories) {
      if (c.items[0]) return c.items[0].fromId;
      if (c.brushes[0]) return brushLookid.get(c.brushes[0]) ?? 0;
    }
    return 0;
  };

  const sections: {
    type: EntityType;
    title: string;
    rows: { idx: number; label: string; serverId: number; issues: string[] }[];
  }[] = [
    {
      type: 'border',
      title: 'Borders',
      rows: borders.map((b, i) => ({
        idx: i,
        label: b.name ?? `Border ${b.id}${b.group != null ? ` (g${b.group})` : ''}`,
        serverId: borderRep(b),
        issues: []
      }))
    },
    {
      type: 'ground',
      title: 'Grounds',
      rows: grounds.map((g, i) => ({
        idx: i,
        label: g.name,
        serverId: g.serverLookid ?? g.items[0]?.id ?? 0,
        issues: groundIssues(g)
      }))
    },
    {
      type: 'wall',
      title: 'Walls',
      rows: walls.map((w, i) => ({ idx: i, label: w.name, serverId: w.serverLookid ?? 0, issues: [] }))
    },
    {
      type: 'doodad',
      title: 'Doodads',
      rows: doodads.map((d, i) => ({ idx: i, label: d.name, serverId: d.serverLookid ?? 0, issues: [] }))
    },
    {
      type: 'tileset',
      title: 'Tilesets',
      rows: tilesets.map((t, i) => ({ idx: i, label: t.name, serverId: tilesetRep(t), issues: tilesetIssues(t) }))
    }
  ];

  const { layouts, version } = useItemSprites(sections.flatMap((s) => s.rows.map((r) => r.serverId)));

  const currentRows = (sections.find((s) => s.type === category)?.rows ?? []).filter((r) => match(r.label));

  const selectedBorder = sel?.type === 'border' ? (borders[sel.index] ?? null) : null;
  const selectedGround = sel?.type === 'ground' ? (grounds[sel.index] ?? null) : null;
  const selectedDoodad = sel?.type === 'doodad' ? (doodads[sel.index] ?? null) : null;
  const selectedWall = sel?.type === 'wall' ? (walls[sel.index] ?? null) : null;
  const selectedTileset = sel?.type === 'tileset' ? (tilesets[sel.index] ?? null) : null;

  const brushNames = React.useMemo(
    () => [...grounds.map((g) => g.name), ...doodads.map((d) => d.name), ...walls.map((w) => w.name)].sort(),
    [grounds, doodads, walls]
  );

  const reloadFile = async (file: string) => {
    if (file === BORDERS_FILE) setBorders(await loadBorders(dataDir));
    else if (file === GROUNDS_FILE) setGrounds(await loadGrounds(dataDir));
    else if (file === WALLS_FILE) setWalls(await loadWalls(dataDir));
    else if (file === DOODADS_FILE) setDoodads(await loadDoodads(dataDir));
    else if (file === TILESETS_FILE) setTilesets(await loadTilesets(dataDir));
  };

  const tx = (files: string[], selBefore: Selection | null, op: () => Promise<void>) => {
    const before = files.map((f) => ({ file: f, text: lastText.current.get(f) ?? '' }));
    op()
      .then(async () => {
        for (const f of files) lastText.current.set(f, await readMaterialText(dataDir, f));
        undoRef.current.push({ files: before, sel: selBefore });
        redoRef.current = [];
      })
      .catch((err) => console.error('Save failed', err));
  };

  const renameBrushRefInTilesets = (arr: TilesetDef[], oldName: string, newName: string): TilesetDef[] =>
    arr.map((t) => ({
      ...t,
      categories: t.categories.map((c) => ({ ...c, brushes: c.brushes.map((b) => (b === oldName ? newName : b)) }))
    }));

  const persist = (arr: BorderDef[], selBefore: Selection | null) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => tx([BORDERS_FILE], selBefore, () => saveBorders(arr, dataDir)), 400);
  };

  const commitBorders = (arr: BorderDef[], nextSel?: Selection | null) => {
    const selBefore = sel;
    setBorders(arr);
    persist(arr, selBefore);
    if (nextSel !== undefined) setSel(nextSel);
  };

  const updateBorder = (next: BorderDef) => commitBorders(borders.map((b) => (b.id === next.id ? next : b)));

  const updateGround = (next: GroundBrush) => {
    const synced = { ...next, serverLookid: groundLookid(next) };
    const selBefore = sel;
    setGrounds((arr) => arr.map((g) => (g.name === synced.name ? synced : g)));
    if (groundSaveTimer.current) clearTimeout(groundSaveTimer.current);
    groundSaveTimer.current = setTimeout(() => tx([GROUNDS_FILE], selBefore, () => saveGround(synced, dataDir)), 400);
  };

  const updateDoodad = (next: DoodadBrush) => {
    const selBefore = sel;
    setDoodads((arr) => arr.map((d) => (d.name === next.name ? next : d)));
    if (doodadSaveTimer.current) clearTimeout(doodadSaveTimer.current);
    doodadSaveTimer.current = setTimeout(() => tx([DOODADS_FILE], selBefore, () => saveDoodad(next, dataDir)), 400);
  };

  const uniqueName = (list: { name: string }[], base: string) => {
    if (!list.some((x) => x.name === base)) return base;
    let n = 2;
    while (list.some((x) => x.name === `${base} ${n}`)) n++;
    return `${base} ${n}`;
  };

  const createDoodadEntry = () => {
    const name = uniqueName(doodads, 'new doodad');
    const nd: DoodadBrush = {
      name,
      serverLookid: null,
      draggable: true,
      onBlocking: false,
      thickness: null,
      items: [],
      compositeCount: 0
    };
    const selBefore = sel;
    setDoodads((arr) => [...arr, nd]);
    setCategory('doodad');
    setSel({ type: 'doodad', index: doodads.length });
    tx([DOODADS_FILE], selBefore, () => createDoodad(nd, dataDir));
  };

  const duplicateDoodadAt = (index: number) => {
    const src = doodads[index];
    if (!src) return;
    const copy: DoodadBrush = { ...src, name: uniqueName(doodads, `${src.name} copy`), items: src.items.map((i) => ({ ...i })) };
    const selBefore = sel;
    setDoodads((arr) => [...arr, copy]);
    setSel({ type: 'doodad', index: doodads.length });
    tx([DOODADS_FILE], selBefore, () => createDoodad(copy, dataDir));
  };

  const deleteDoodadAt = (index: number) => {
    const d = doodads[index];
    if (!d) return;
    const selBefore = sel;
    const arr = doodads.filter((_, i) => i !== index);
    setDoodads(arr);
    if (sel?.type === 'doodad') {
      if (sel.index === index) setSel(arr.length ? { type: 'doodad', index: Math.min(index, arr.length - 1) } : null);
      else if (sel.index > index) setSel({ type: 'doodad', index: sel.index - 1 });
    }
    tx([DOODADS_FILE], selBefore, () => deleteDoodad(d.name, dataDir));
  };

  const renameDoodadAt = (index: number, raw: string) => {
    const d = doodads[index];
    if (!d) return;
    const name = raw.trim();
    if (!name || name === d.name) return;
    if (doodads.some((x, i) => i !== index && x.name === name)) return;
    const old = d.name;
    const selBefore = sel;
    setDoodads((arr) => arr.map((x, i) => (i === index ? { ...x, name } : x)));
    setTilesets((arr) => renameBrushRefInTilesets(arr, old, name));
    tx([DOODADS_FILE, TILESETS_FILE], selBefore, async () => {
      await renameDoodad(old, name, dataDir);
      await renameTilesetBrushRefs(old, name, dataDir);
    });
  };

  const updateWall = (next: WallBrush) => {
    const selBefore = sel;
    setWalls((arr) => arr.map((w) => (w.name === next.name ? next : w)));
    if (wallSaveTimer.current) clearTimeout(wallSaveTimer.current);
    wallSaveTimer.current = setTimeout(() => tx([WALLS_FILE], selBefore, () => saveWall(next, dataDir)), 400);
  };

  const createWallEntry = () => {
    const name = uniqueName(walls, 'new wall');
    const segs = ['horizontal', 'vertical', 'corner', 'pole'].map((type) => ({ type, items: [], doorCount: 0 }));
    const nw: WallBrush = {
      name,
      serverLookid: null,
      draggable: false,
      onBlocking: true,
      thickness: null,
      segments: segs,
      extraCount: 0
    };
    const selBefore = sel;
    setWalls((arr) => [...arr, nw]);
    setCategory('wall');
    setSel({ type: 'wall', index: walls.length });
    tx([WALLS_FILE], selBefore, () => createWall(nw, dataDir));
  };

  const duplicateWallAt = (index: number) => {
    const src = walls[index];
    if (!src) return;
    const copy: WallBrush = {
      ...src,
      name: uniqueName(walls, `${src.name} copy`),
      segments: src.segments.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }))
    };
    const selBefore = sel;
    setWalls((arr) => [...arr, copy]);
    setSel({ type: 'wall', index: walls.length });
    tx([WALLS_FILE], selBefore, () => createWall(copy, dataDir));
  };

  const deleteWallAt = (index: number) => {
    const w = walls[index];
    if (!w) return;
    const selBefore = sel;
    const arr = walls.filter((_, i) => i !== index);
    setWalls(arr);
    if (sel?.type === 'wall') {
      if (sel.index === index) setSel(arr.length ? { type: 'wall', index: Math.min(index, arr.length - 1) } : null);
      else if (sel.index > index) setSel({ type: 'wall', index: sel.index - 1 });
    }
    tx([WALLS_FILE], selBefore, () => deleteWall(w.name, dataDir));
  };

  const renameWallAt = (index: number, raw: string) => {
    const w = walls[index];
    if (!w) return;
    const name = raw.trim();
    if (!name || name === w.name) return;
    if (walls.some((x, i) => i !== index && x.name === name)) return;
    const old = w.name;
    const selBefore = sel;
    setWalls((arr) => arr.map((x, i) => (i === index ? { ...x, name } : x)));
    setTilesets((arr) => renameBrushRefInTilesets(arr, old, name));
    tx([WALLS_FILE, TILESETS_FILE], selBefore, async () => {
      await renameWall(old, name, dataDir);
      await renameTilesetBrushRefs(old, name, dataDir);
    });
  };

  const updateTileset = (next: TilesetDef) => {
    const selBefore = sel;
    setTilesets((arr) => arr.map((t) => (t.name === next.name ? next : t)));
    if (tilesetSaveTimer.current) clearTimeout(tilesetSaveTimer.current);
    tilesetSaveTimer.current = setTimeout(() => tx([TILESETS_FILE], selBefore, () => saveTileset(next, dataDir)), 400);
  };

  const createTilesetEntry = () => {
    const name = uniqueName(tilesets, 'New Tileset');
    const nt: TilesetDef = { name, categories: [{ kind: 'raw', items: [], brushes: [], flags: [] }] };
    const selBefore = sel;
    setTilesets((arr) => [...arr, nt]);
    setCategory('tileset');
    setSel({ type: 'tileset', index: tilesets.length });
    tx([TILESETS_FILE], selBefore, () => createTileset(nt, dataDir));
  };

  const duplicateTilesetAt = (index: number) => {
    const src = tilesets[index];
    if (!src) return;
    const copy: TilesetDef = {
      name: uniqueName(tilesets, `${src.name} copy`),
      categories: src.categories.map((c) => ({
        ...c,
        items: c.items.map((e) => ({ ...e })),
        brushes: [...c.brushes],
        flags: [...c.flags]
      }))
    };
    const selBefore = sel;
    setTilesets((arr) => [...arr, copy]);
    setSel({ type: 'tileset', index: tilesets.length });
    tx([TILESETS_FILE], selBefore, () => createTileset(copy, dataDir));
  };

  const deleteTilesetAt = (index: number) => {
    const t = tilesets[index];
    if (!t) return;
    const selBefore = sel;
    const arr = tilesets.filter((_, i) => i !== index);
    setTilesets(arr);
    if (sel?.type === 'tileset') {
      if (sel.index === index) setSel(arr.length ? { type: 'tileset', index: Math.min(index, arr.length - 1) } : null);
      else if (sel.index > index) setSel({ type: 'tileset', index: sel.index - 1 });
    }
    tx([TILESETS_FILE], selBefore, () => deleteTileset(t.name, dataDir));
  };

  const renameTilesetAt = (index: number, raw: string) => {
    const t = tilesets[index];
    if (!t) return;
    const name = raw.trim();
    if (!name || name === t.name) return;
    if (tilesets.some((x, i) => i !== index && x.name === name)) return;
    const old = t.name;
    const selBefore = sel;
    setTilesets((arr) => arr.map((x, i) => (i === index ? { ...x, name } : x)));
    tx([TILESETS_FILE], selBefore, () => renameTileset(old, name, dataDir));
  };

  const uniqueGroundName = (base: string) => {
    if (!grounds.some((g) => g.name === base)) return base;
    let n = 2;
    while (grounds.some((g) => g.name === `${base} ${n}`)) n++;
    return `${base} ${n}`;
  };

  const createGroundEntry = () => {
    const name = uniqueGroundName('new ground');
    const ng: GroundBrush = { name, serverLookid: null, zOrder: null, items: [], borders: [], friends: [] };
    const selBefore = sel;
    setGrounds((arr) => [...arr, ng]);
    setCategory('ground');
    setSel({ type: 'ground', index: grounds.length });
    tx([GROUNDS_FILE], selBefore, () => createGround(ng, dataDir));
  };

  const duplicateGroundAt = (index: number) => {
    const src = grounds[index];
    if (!src) return;
    const copy: GroundBrush = {
      ...src,
      name: uniqueGroundName(`${src.name} copy`),
      items: src.items.map((i) => ({ ...i })),
      borders: src.borders.map((b) => ({ ...b })),
      friends: [...src.friends]
    };
    const selBefore = sel;
    setGrounds((arr) => [...arr, copy]);
    setSel({ type: 'ground', index: grounds.length });
    tx([GROUNDS_FILE], selBefore, () => createGround(copy, dataDir));
  };

  const deleteGroundAt = (index: number) => {
    const g = grounds[index];
    if (!g) return;
    const selBefore = sel;
    const arr = grounds.filter((_, i) => i !== index);
    setGrounds(arr);
    if (sel?.type === 'ground') {
      if (sel.index === index) setSel(arr.length ? { type: 'ground', index: Math.min(index, arr.length - 1) } : null);
      else if (sel.index > index) setSel({ type: 'ground', index: sel.index - 1 });
    }
    tx([GROUNDS_FILE], selBefore, () => deleteGround(g.name, dataDir));
  };

  const renameGroundAt = (index: number, raw: string) => {
    const g = grounds[index];
    if (!g) return;
    const name = raw.trim();
    if (!name || name === g.name) return;
    if (grounds.some((x, i) => i !== index && x.name === name)) return;
    const old = g.name;
    const selBefore = sel;
    setGrounds((arr) =>
      arr.map((x) => ({
        ...x,
        name: x.name === old ? name : x.name,
        friends: x.friends.map((f) => (f === old ? name : f)),
        borders: x.borders.map((b) => (b.to === old ? { ...b, to: name } : b))
      }))
    );
    setTilesets((arr) => renameBrushRefInTilesets(arr, old, name));
    tx([GROUNDS_FILE, TILESETS_FILE], selBefore, async () => {
      await renameGround(old, name, dataDir);
      await renameTilesetBrushRefs(old, name, dataDir);
    });
  };

  const applyRename = (type: EntityType, index: number, raw: string) => {
    if (type === 'border') {
      const b = borders[index];
      if (b) updateBorder({ ...b, name: raw.trim() || null });
    } else if (type === 'ground') {
      renameGroundAt(index, raw);
    } else if (type === 'doodad') {
      renameDoodadAt(index, raw);
    } else if (type === 'wall') {
      renameWallAt(index, raw);
    } else if (type === 'tileset') {
      renameTilesetAt(index, raw);
    }
  };

  const entityName = (type: EntityType, index: number): string =>
    type === 'border'
      ? (borders[index]?.name ?? '')
      : type === 'ground'
        ? (grounds[index]?.name ?? '')
        : type === 'doodad'
          ? (doodads[index]?.name ?? '')
          : type === 'wall'
            ? (walls[index]?.name ?? '')
            : type === 'tileset'
              ? (tilesets[index]?.name ?? '')
              : '';

  const isCrud = (type?: EntityType) =>
    type === 'border' || type === 'ground' || type === 'doodad' || type === 'wall' || type === 'tileset';

  const dispatch = <T,>(type: EntityType, map: Partial<Record<EntityType, () => T>>) => map[type]?.();

  const createEntity = (type: EntityType) =>
    dispatch(type, {
      border: createBorder,
      ground: createGroundEntry,
      doodad: createDoodadEntry,
      wall: createWallEntry,
      tileset: createTilesetEntry
    });
  const duplicateEntity = (type: EntityType, i: number) =>
    dispatch(type, {
      border: () => duplicateBorder(i),
      ground: () => duplicateGroundAt(i),
      doodad: () => duplicateDoodadAt(i),
      wall: () => duplicateWallAt(i),
      tileset: () => duplicateTilesetAt(i)
    });
  const deleteEntity = (type: EntityType, i: number) =>
    dispatch(type, {
      border: () => deleteBorder(i),
      ground: () => deleteGroundAt(i),
      doodad: () => deleteDoodadAt(i),
      wall: () => deleteWallAt(i),
      tileset: () => deleteTilesetAt(i)
    });

  const nextBorderId = () => borders.reduce((m, b) => Math.max(m, b.id), 0) + 1;

  const createBorder = () => {
    const nb: BorderDef = { id: nextBorderId(), group: null, name: null, items: {} };
    setCategory('border');
    commitBorders([...borders, nb], { type: 'border', index: borders.length });
  };

  const duplicateBorder = (index: number) => {
    const src = borders[index];
    if (!src) return;
    const copy: BorderDef = {
      ...src,
      id: nextBorderId(),
      name: src.name ? `${src.name} copy` : null,
      items: { ...src.items }
    };
    commitBorders([...borders, copy], { type: 'border', index: borders.length });
  };

  const deleteBorder = (index: number) => {
    const arr = borders.filter((_, i) => i !== index);
    let nextSel: Selection | null = sel;
    if (sel?.type === 'border') {
      if (sel.index === index) nextSel = arr.length ? { type: 'border', index: Math.min(index, arr.length - 1) } : null;
      else if (sel.index > index) nextSel = { type: 'border', index: sel.index - 1 };
    }
    commitBorders(arr, nextSel);
  };

  const startRename = (type: EntityType, index: number) => {
    setNameDraft(entityName(type, index));
    setRenamingIdx(index);
  };

  const commitRename = () => {
    if (renamingIdx != null) applyRename(category, renamingIdx, nameDraft);
    setRenamingIdx(null);
  };

  const startHeaderRename = () => {
    if (!sel) return;
    setNameDraft(entityName(sel.type, sel.index));
    setEditingName(true);
  };

  const commitHeaderRename = () => {
    if (sel) applyRename(sel.type, sel.index, nameDraft);
    setEditingName(false);
  };

  const applyHistory = (entry: HistEntry) => {
    void (async () => {
      for (const x of entry.files) {
        await writeMaterialText(dataDir, x.file, x.text);
        lastText.current.set(x.file, x.text);
        await reloadFile(x.file);
      }
      setSel(entry.sel);
    })().catch((err) => console.error('History restore failed', err));
  };

  const undo = () => {
    const entry = undoRef.current.pop();
    if (!entry) return;
    redoRef.current.push({ files: entry.files.map((x) => ({ file: x.file, text: lastText.current.get(x.file) ?? '' })), sel });
    applyHistory(entry);
  };

  const redo = () => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    undoRef.current.push({ files: entry.files.map((x) => ({ file: x.file, text: lastText.current.get(x.file) ?? '' })), sel });
    applyHistory(entry);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (isCrud(sel?.type) && sel && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'Delete') {
          e.preventDefault();
          deleteEntity(sel.type, sel.index);
        } else if (e.key === 'F2') {
          e.preventDefault();
          startHeaderRename();
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [borders, grounds, doodads, walls, tilesets, sel]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [dragId, setDragId] = React.useState<number | null>(null);

  const onDragStart = (e: DragStartEvent) => setDragId((e.active.data.current?.serverId as number) ?? null);

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const serverId = e.active.data.current?.serverId as number | undefined;
    const overId = e.over ? String(e.over.id) : '';
    if (!serverId) return;
    if (overId === 'ground-items' && selectedGround) {
      if (selectedGround.items.some((it) => it.id === serverId)) return;
      updateGround({ ...selectedGround, items: [...selectedGround.items, { id: serverId, chance: 100 }] });
      return;
    }
    if (overId === 'doodad-items' && selectedDoodad) {
      if (selectedDoodad.items.some((it) => it.id === serverId)) return;
      updateDoodad({ ...selectedDoodad, items: [...selectedDoodad.items, { id: serverId, chance: 10 }] });
      return;
    }
    if (overId === 'doodad-lookid' && selectedDoodad) {
      updateDoodad({ ...selectedDoodad, serverLookid: serverId });
      return;
    }
    if (overId.startsWith('wall-seg-') && selectedWall) {
      const segType = overId.slice('wall-seg-'.length);
      const seg = selectedWall.segments.find((s) => s.type === segType);
      if (!seg || seg.items.some((it) => it.id === serverId)) return;
      updateWall({
        ...selectedWall,
        segments: selectedWall.segments.map((s) =>
          s.type === segType ? { ...s, items: [...s.items, { id: serverId, chance: 100 }] } : s
        )
      });
      return;
    }
    if (overId.startsWith('tileset-cat-') && selectedTileset) {
      const ci = Number(overId.slice('tileset-cat-'.length));
      const cat = selectedTileset.categories[ci];
      if (!cat || cat.items.some((e) => e.fromId === serverId)) return;
      updateTileset({
        ...selectedTileset,
        categories: selectedTileset.categories.map((c, i) =>
          i === ci ? { ...c, items: [...c.items, { fromId: serverId, toId: null }] } : c
        )
      });
      return;
    }
    if (overId.startsWith('edge-') && selectedBorder) {
      const edge = overId.slice(5) as BorderEdge;
      updateBorder({ ...selectedBorder, items: { ...selectedBorder.items, [edge]: serverId } });
    }
  };

  const selectedLabel = sel ? (sections.find((s) => s.type === sel.type)?.rows[sel.index]?.label ?? '') : '';
  const title = !sel
    ? 'Tileset Editor'
    : isCrud(sel.type)
      ? selectedLabel
      : `${sel.type.charAt(0).toUpperCase()}${sel.type.slice(1)}: ${selectedLabel}`;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar title="Tileset Editor" />
      <DndContext sensors={sensors} onDragEnd={onDragEnd} onDragStart={onDragStart}>
        <div className="flex min-h-0 flex-1 gap-1.5 bg-toolbar-bg p-1.5">
          <div style={{ width: leftW }} className="relative flex-shrink-0">
            <aside className="flex h-full flex-col overflow-hidden rounded-lg bg-card shadow-island">
              <div className="flex h-8 flex-shrink-0 items-center border-b border-border/50 bg-secondary/60 pl-3 pr-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">Tilesets</h2>
                {isCrud(category) && (
                  <button
                    title={`New ${category}`}
                    onClick={() => createEntity(category)}
                    className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2 border-b border-border/60 p-2">
                <Select value={category} onValueChange={(v) => setCategory(v as EntityType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.type} value={s.type}>
                        {s.title} ({s.rows.length})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-input px-2 py-1.5">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={query}
                    placeholder="Search..."
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {currentRows.length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here.</div>
                ) : (
                  currentRows.map((r) => {
                    const thumb = (
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-border/50 bg-background">
                        {r.serverId > 0 && (
                          <BrushThumbnail
                            size={40}
                            version={version}
                            cache={ITEM_SPRITE_CACHE}
                            layout={layouts.get(r.serverId) ?? null}
                          />
                        )}
                      </span>
                    );
                    if (isCrud(category) && renamingIdx === r.idx) {
                      return (
                        <div
                          key={`${category}-${r.idx}`}
                          className="flex w-full items-center gap-2 rounded bg-primary/15 px-2 py-1.5"
                        >
                          {thumb}
                          <input
                            autoFocus
                            value={nameDraft}
                            onBlur={commitRename}
                            placeholder={r.label}
                            onChange={(e) => setNameDraft(e.target.value)}
                            className="h-7 w-full rounded border border-border bg-input px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') setRenamingIdx(null);
                            }}
                          />
                        </div>
                      );
                    }
                    return (
                      <ContextMenu key={`${category}-${r.idx}`}>
                        <ContextMenuTrigger asChild>
                          <button
                            onClick={() => setSel({ type: category, index: r.idx })}
                            className={cn(
                              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-item-hover',
                              sel?.type === category && sel.index === r.idx
                                ? 'bg-primary/15 text-foreground'
                                : 'text-muted-foreground'
                            )}
                          >
                            {thumb}
                            <span className="truncate">{r.label}</span>
                            {r.issues.length > 0 && (
                              <TriangleAlert
                                title={r.issues.join('\n')}
                                className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-[#f0a23b]"
                              />
                            )}
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuLabel>{r.label}</ContextMenuLabel>
                          <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(r.label)}>
                            Copy name
                          </ContextMenuItem>
                          {r.serverId > 0 && (
                            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(String(r.serverId))}>
                              Copy id <ContextMenuShortcut>{r.serverId}</ContextMenuShortcut>
                            </ContextMenuItem>
                          )}
                          {isCrud(category) && (
                            <>
                              <ContextMenuSeparator />
                              <ContextMenuItem onSelect={() => startRename(category, r.idx)}>
                                Rename <ContextMenuShortcut>F2</ContextMenuShortcut>
                              </ContextMenuItem>
                              <ContextMenuItem onSelect={() => duplicateEntity(category, r.idx)}>Duplicate</ContextMenuItem>
                              <ContextMenuItem destructive onSelect={() => deleteEntity(category, r.idx)}>
                                Delete <ContextMenuShortcut>Del</ContextMenuShortcut>
                              </ContextMenuItem>
                            </>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })
                )}
              </div>
            </aside>
            <Resizer gap dir="x" side="right" onResize={({ dx }) => setLeftW((w) => clampW(w + dx))} />
          </div>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-card shadow-island">
            <header className="flex h-8 flex-shrink-0 items-center justify-between border-b border-border/50 bg-secondary/60 px-3">
              {isCrud(sel?.type) && editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onBlur={commitHeaderRename}
                  placeholder={selectedLabel}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="h-6 w-56 rounded border border-border bg-input px-2 text-xs font-semibold uppercase tracking-wide text-foreground outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitHeaderRename();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                />
              ) : (
                <button
                  disabled={!isCrud(sel?.type)}
                  onClick={() => isCrud(sel?.type) && startHeaderRename()}
                  className="group flex items-center gap-1.5 disabled:cursor-default"
                >
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</h2>
                  {isCrud(sel?.type) && (
                    <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </button>
              )}
              {isCrud(sel?.type) && sel && (
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-[10px] text-muted-foreground">Auto-saved</span>
                  <button
                    title={`Duplicate ${sel.type}`}
                    onClick={() => duplicateEntity(sel.type, sel.index)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title={`Delete ${sel.type}`}
                    onClick={() => deleteEntity(sel.type, sel.index)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {sel && issuesFor(sel.type, sel.index).length > 0 && (
                <div className="mb-4 flex flex-col gap-1 rounded-md border border-[#f0a23b]/40 bg-[#f0a23b]/10 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#f0a23b]">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    Broken references
                  </div>
                  {issuesFor(sel.type, sel.index).map((msg, i) => (
                    <span key={i} className="text-[11px] text-muted-foreground">
                      {msg}
                    </span>
                  ))}
                </div>
              )}
              {!assets ? (
                <div className="text-sm text-muted-foreground">Loading assets...</div>
              ) : selectedBorder ? (
                <BorderEditor border={selectedBorder} onChange={updateBorder} />
              ) : selectedGround ? (
                <GroundEditor borders={borders} grounds={grounds} brush={selectedGround} onChange={updateGround} />
              ) : selectedDoodad ? (
                <DoodadEditor brush={selectedDoodad} onChange={updateDoodad} />
              ) : selectedWall ? (
                <WallEditor brush={selectedWall} onChange={updateWall} />
              ) : selectedTileset ? (
                <TilesetCategories
                  def={selectedTileset}
                  flagIndex={flagIndex}
                  brushNames={brushNames}
                  onChange={updateTileset}
                  brushLookid={brushLookid}
                />
              ) : sel ? (
                <p className="text-sm text-muted-foreground">Select an entry on the left.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Select an entry on the left.</p>
              )}
            </div>
          </main>

          <div style={{ width: rightW }} className="relative flex-shrink-0">
            <Resizer gap dir="x" side="left" onResize={({ dx }) => setRightW((w) => clampW(w - dx))} />
            <ItemsPalette flagIndex={flagIndex} />
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{dragId ? <DragGhost serverId={dragId} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
};

export default TilesetEditor;
