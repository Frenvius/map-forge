import React from 'react';

import { cn } from '~/usecase/classNames';

interface ResizerProps {
  side: 'left' | 'right';
  onResize: (dx: number) => void;
}

const Resizer = ({ side, onResize }: ResizerProps) => {
  const last = React.useRef(0);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    last.current = e.clientX;
    const move = (ev: PointerEvent) => {
      onResize(ev.clientX - last.current);
      last.current = ev.clientX;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn('group absolute inset-y-0 z-10 w-3 cursor-col-resize', side === 'left' ? '-left-2' : '-right-2')}
    >
      <div
        style={{ background: 'linear-gradient(to bottom, transparent 0%, hsl(var(--primary)) 50%, transparent 100%)' }}
        className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      />
    </div>
  );
};

export default Resizer;
