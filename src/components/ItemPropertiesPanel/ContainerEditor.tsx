import React from 'react';
import { X, Plus, Trash2, Loader2, FolderOpen, ChevronRight } from 'lucide-react';

import { Thing } from '~/domain/thing';
import { cn } from '~/usecase/classNames';
import { LoadedSprite } from '~/domain/sprite';
import { loadSprites } from '~/adapter/sprites';
import { brushSpriteLayout } from '~/usecase/brushSprite';
import { useAssetsBundle } from '~/usecase/context/AssetsContext';
import { getContainer, ContainerLoc, ContainerItem, containerAddItem, containerRemoveItem } from '~/adapter/map';

import ItemSprite from './ItemSprite';

interface ContainerPos {
  z: number;
  x: number;
  y: number;
  stackIdx: number;
}

interface ContainerEditorProps {
  mapId: number;
  pos: ContainerPos;
  onChanged: () => void;
  items: Map<number, Thing> | null;
  itemNames: Map<number, string> | null;
}

const ContainerEditor = ({ mapId, pos, items, itemNames, onChanged }: ContainerEditorProps) => {
  const { assets } = useAssetsBundle();
  const [contents, setContents] = React.useState<ContainerItem[]>([]);
  const [path, setPath] = React.useState<number[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [spriteVer, setSpriteVer] = React.useState(0);
  const spriteCache = React.useRef<Map<number, LoadedSprite>>(new Map());
  const busy = React.useRef(false);

  const loc: ContainerLoc = React.useMemo(
    () => ({ mapId, z: pos.z, x: pos.x, y: pos.y, stackIdx: pos.stackIdx, path }),
    [mapId, pos.z, pos.x, pos.y, pos.stackIdx, path]
  );

  React.useEffect(() => {
    setPath([]);
  }, [mapId, pos.z, pos.x, pos.y, pos.stackIdx]);

  const refresh = React.useCallback(() => {
    setLoading(true);
    getContainer(loc)
      .then((list) => setContents(list))
      .catch(() => setContents([]))
      .finally(() => setLoading(false));
  }, [loc]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!items || !assets) return;
    const needed: number[] = [];
    for (const entry of contents) {
      const thing = items.get(entry.clientId);
      if (!thing) continue;
      for (const cell of brushSpriteLayout(thing, false).cells) {
        if (cell.spriteId > 0 && !spriteCache.current.has(cell.spriteId)) needed.push(cell.spriteId);
      }
    }
    if (needed.length === 0) return;
    loadSprites(assets.sprPath, needed, assets.transparency, spriteCache.current).then(() => setSpriteVer((v) => v + 1));
  }, [contents, items, assets]);

  const mutate = async (fn: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
      onChanged();
      refresh();
    } finally {
      busy.current = false;
    }
  };

  const addItem = (serverId: number) => {
    setQuery('');
    mutate(() => containerAddItem(loc, serverId));
  };

  const removeItem = (idx: number) => {
    mutate(() => containerRemoveItem(loc, idx));
  };

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !itemNames) return [];
    const asId = Number(q);
    const out: Array<[number, string]> = [];
    for (const [id, name] of itemNames) {
      if ((Number.isFinite(asId) && id === asId) || name.toLowerCase().includes(q)) {
        out.push([id, name]);
        if (out.length >= 20) break;
      }
    }
    return out;
  }, [query, itemNames]);

  const nameOf = (serverId: number) => itemNames?.get(serverId) ?? 'item';

  return (
    <div className="flex flex-col gap-1.5">
      {path.length > 0 && (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <button onClick={() => setPath([])} className="rounded px-1 hover:bg-accent/50 hover:text-foreground">
            root
          </button>
          {path.map((_, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="h-3 w-3" />
              <button
                onClick={() => setPath(path.slice(0, i + 1))}
                className="rounded px-1 hover:bg-accent/50 hover:text-foreground"
              >
                bag
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {loading ? (
        <Loader2 className="mx-auto my-2 h-4 w-4 animate-spin text-muted-foreground" />
      ) : contents.length === 0 ? (
        <div className="py-1 text-muted-foreground">Empty container</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {contents.map((entry, i) => (
            <div key={i} className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/50">
              {items && <ItemSprite items={items} version={spriteVer} clientId={entry.clientId} cache={spriteCache.current} />}
              <span className="min-w-0 flex-1 truncate">
                {entry.serverId} - {nameOf(entry.serverId)}
              </span>
              {entry.hasContents && (
                <button
                  title="Open container"
                  onClick={() => setPath([...path, i])}
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-colors hover:bg-item-hover hover:text-foreground group-hover:opacity-100"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => removeItem(i)}
                className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-colors hover:bg-item-hover hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="flex items-center gap-1.5 rounded border border-input bg-input px-2">
          <Plus className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={query}
            placeholder="Add item by id or name..."
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-item-hover hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded border border-border bg-popover shadow-island">
            {results.map(([id, name]) => (
              <button
                key={id}
                onClick={() => addItem(id)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <span className="w-12 flex-shrink-0 font-mono text-muted-foreground">{id}</span>
                <span className="min-w-0 truncate">{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ContainerEditor;
