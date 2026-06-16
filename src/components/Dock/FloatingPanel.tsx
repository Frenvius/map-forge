import React from 'react';

import Resizer from '~/components/Dock/Resizer';
import { PanelId, PanelMeta, FloatRect, ResizeSide } from '~/domain/dock';
import DockablePanel, { DragHandleProps } from '~/components/Dock/DockablePanel';

interface FloatingPanelProps {
  id: PanelId;
  meta: PanelMeta;
  rect: FloatRect;
  guarded?: boolean;
  onResizeEnd?: () => void;
  onResizeStart?: () => void;
  onResize: (side: ResizeSide, dx: number, dy: number) => void;
  children: (handle: DragHandleProps) => React.ReactNode;
}

const SIDES: { side: ResizeSide; dir: 'x' | 'y' | 'xy' }[] = [
  { side: 'top', dir: 'y' },
  { side: 'left', dir: 'x' },
  { side: 'right', dir: 'x' },
  { side: 'bottom', dir: 'y' },
  { side: 'top-left', dir: 'xy' },
  { side: 'top-right', dir: 'xy' },
  { side: 'bottom-left', dir: 'xy' },
  { side: 'bottom-right', dir: 'xy' }
];

const FloatingPanel = ({ id, meta, rect, guarded, onResizeEnd, onResizeStart, onResize, children }: FloatingPanelProps) => {
  const style: React.CSSProperties = meta.resizable
    ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height }
    : { left: rect.x, top: rect.y };

  return (
    <div style={style} className="absolute z-20 rounded-lg shadow-[0_10px_40px_-5px_rgba(0,0,0,0.65)] ring-1 ring-black/40">
      <DockablePanel id={id} meta={meta} guarded={guarded} className="h-full">
        {children}
      </DockablePanel>
      {meta.resizable &&
        SIDES.map(({ side, dir }) => (
          <Resizer
            dir={dir}
            key={side}
            side={side}
            onResizeEnd={onResizeEnd}
            onResizeStart={onResizeStart}
            onResize={({ dx, dy }) => onResize(side, dx, dy)}
          />
        ))}
    </div>
  );
};

export default FloatingPanel;
