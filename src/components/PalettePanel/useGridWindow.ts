import React from 'react';

interface GridWindowOpts {
  minCell: number;
  gap: number;
  pad: number;
  overscan?: number;
}

export interface GridWindow {
  cols: number;
  rowH: number;
  startRow: number;
  start: number;
  end: number;
  totalH: number;
  scrollToIndex: (i: number) => void;
}

export function useGridWindow(scrollRef: React.RefObject<HTMLElement>, total: number, opts: GridWindowOpts): GridWindow {
  const { minCell, gap, pad, overscan = 2 } = opts;
  const [w, setW] = React.useState({ cols: 1, rowH: minCell + gap, startRow: 0, visRows: 0 });

  const recompute = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const inner = Math.max(0, el.clientWidth - pad * 2);
    const cols = Math.max(1, Math.floor((inner + gap) / (minCell + gap)));
    const cellW = (inner - (cols - 1) * gap) / cols;
    const rowH = cellW + gap;
    const startRow = Math.max(0, Math.floor(el.scrollTop / rowH) - overscan);
    const visRows = Math.ceil(el.clientHeight / rowH) + overscan * 2;
    setW((p) =>
      p.cols === cols && p.rowH === rowH && p.startRow === startRow && p.visRows === visRows
        ? p
        : { cols, rowH, startRow, visRows }
    );
  }, [scrollRef, total, minCell, gap, pad, overscan]);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    recompute();
    el.addEventListener('scroll', recompute, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', recompute);
      ro.disconnect();
    };
  }, [recompute]);

  const rows = Math.ceil(total / w.cols);
  const start = w.startRow * w.cols;
  const end = Math.min(total, (w.startRow + w.visRows) * w.cols);

  const scrollToIndex = React.useCallback(
    (i: number) => {
      const el = scrollRef.current;
      if (!el || i < 0) return;
      el.scrollTop = Math.floor(i / w.cols) * w.rowH;
    },
    [scrollRef, w.cols, w.rowH]
  );

  return { cols: w.cols, rowH: w.rowH, startRow: w.startRow, start, end, totalH: rows * w.rowH, scrollToIndex };
}
