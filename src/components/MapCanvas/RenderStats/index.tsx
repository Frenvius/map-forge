import React from 'react';
import { X } from 'lucide-react';

import { useEditorSettings } from '~/usecase/context/EditorSettingsContext';

interface RenderStatsProps {
  fpsRef: React.RefObject<HTMLSpanElement>;
  stallRef: React.RefObject<HTMLSpanElement>;
  maxRef: React.RefObject<HTMLSpanElement>;
  jsRef: React.RefObject<HTMLSpanElement>;
  chunkRef: React.RefObject<HTMLSpanElement>;
}

const RenderStats = ({ fpsRef, stallRef, maxRef, jsRef, chunkRef }: RenderStatsProps) => {
  const { toggleRenderStats } = useEditorSettings();
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 select-none rounded-md border border-emerald-500/30 bg-black/70 px-3 py-2 font-mono text-[11px] leading-tight text-emerald-400 shadow-island">
      <div className="mb-1 flex items-center gap-2 font-semibold tracking-wider text-emerald-300">
        RENDER STATS
        <button
          type="button"
          title="Hide render stats"
          onClick={toggleRenderStats}
          className="pointer-events-auto ml-auto flex h-4 w-4 items-center justify-center rounded text-emerald-400/70 hover:bg-emerald-500/20 hover:text-emerald-200"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
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
};

export default RenderStats;
