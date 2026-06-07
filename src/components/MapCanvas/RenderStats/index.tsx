import React from 'react';

interface RenderStatsProps {
  fpsRef: React.RefObject<HTMLSpanElement>;
  stallRef: React.RefObject<HTMLSpanElement>;
  maxRef: React.RefObject<HTMLSpanElement>;
  jsRef: React.RefObject<HTMLSpanElement>;
  chunkRef: React.RefObject<HTMLSpanElement>;
}

const RenderStats = ({ fpsRef, stallRef, maxRef, jsRef, chunkRef }: RenderStatsProps) => (
  <div className="pointer-events-none absolute bottom-3 right-3 select-none rounded-md border border-emerald-500/30 bg-black/70 px-3 py-2 font-mono text-[11px] leading-tight text-emerald-400 shadow-island">
    <div className="mb-1 font-semibold tracking-wider text-emerald-300">RENDER STATS</div>
    <div>
      FPS: <span ref={fpsRef}>-</span>
    </div>
    <div>
      Stalls (&gt;25ms): <span ref={stallRef}>0</span>
    </div>
    <div>
      Max frame: <span ref={maxRef}>0ms</span> | JS: <span ref={jsRef}>0ms</span>
    </div>
    <div>
      Chunks drawn: <span ref={chunkRef}>0</span>
    </div>
  </div>
);

export default RenderStats;
