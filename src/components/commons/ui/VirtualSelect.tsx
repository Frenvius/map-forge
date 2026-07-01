import React from 'react';
import { Search, ChevronDown } from 'lucide-react';

import { cn } from '~/usecase/classNames';

const ROW_H = 32;
const VIEW_H = 240;
const OVERSCAN = 4;

export interface VirtualSelectRow {
  key: string;
  label: string;
  sublabel?: string;
}

interface VirtualSelectProps {
  value: string;
  onChange: (key: string) => void;
  rows: VirtualSelectRow[];
  renderThumb: (key: string) => React.ReactNode;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  onVisibleKeys?: (keys: string[]) => void;
}

const VirtualSelect = ({
  value,
  onChange,
  rows,
  renderThumb,
  placeholder,
  allowNone,
  noneLabel = 'none',
  className,
  onVisibleKeys
}: VirtualSelectProps) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [scrollTop, setScrollTop] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selected = React.useMemo(() => rows.find((r) => r.key === value) ?? null, [rows, value]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
  }, [query, rows]);

  const items = React.useMemo<(VirtualSelectRow | null)[]>(
    () => (allowNone ? [null, ...filtered] : filtered),
    [allowNone, filtered]
  );

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(items.length, Math.ceil((scrollTop + VIEW_H) / ROW_H) + OVERSCAN);
  const visible = items.slice(start, end);

  React.useEffect(() => {
    if (!onVisibleKeys) return;
    const keys = open ? visible.filter((r): r is VirtualSelectRow => r != null).map((r) => r.key) : [];
    onVisibleKeys(keys);
  }, [open, start, end, filtered]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  React.useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query, open]);

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-input px-1.5 text-xs text-foreground hover:bg-item-hover"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
          {selected && renderThumb(selected.key)}
        </span>
        <span className={cn('flex-1 truncate text-left', !selected && 'text-muted-foreground')}>
          {selected?.label || placeholder || 'Select...'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-island">
          <div className="flex items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              placeholder="Search..."
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} className="max-h-60 overflow-y-auto p-1" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            {items.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">No matches</div>
            ) : (
              <div style={{ height: items.length * ROW_H, position: 'relative' }}>
                {visible.map((r, i) => {
                  const top = (start + i) * ROW_H;
                  if (r === null) {
                    return (
                      <button
                        type="button"
                        key="__none__"
                        onClick={() => pick('')}
                        style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_H }}
                        className="flex items-center gap-2 rounded px-1.5 text-left text-xs text-muted-foreground hover:bg-item-hover"
                      >
                        <span className="h-6 w-6 shrink-0" />
                        {noneLabel}
                      </button>
                    );
                  }
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => pick(r.key)}
                      style={{ position: 'absolute', top, left: 0, right: 0, height: ROW_H }}
                      className={cn(
                        'flex items-center gap-2 rounded px-1.5 text-left text-xs hover:bg-item-hover',
                        r.key === value ? 'bg-primary/15 text-foreground' : 'text-foreground'
                      )}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
                        {renderThumb(r.key)}
                      </span>
                      <span className="flex-1 truncate">{r.label}</span>
                      {r.sublabel && <span className="text-[9px] uppercase text-muted-foreground">{r.sublabel}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VirtualSelect;
