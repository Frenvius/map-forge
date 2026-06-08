import { X, Minus, Square } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import AppMenu from '~/components/Toolbar/AppMenu';

interface ToolbarProps {
  loading: boolean;
  hasActive: boolean;
  recent: string[];
  onNew: () => void;
  onOpen: () => void;
  onCloseMap: () => void;
  onClearRecent: () => void;
  onOpenPreferences: () => void;
  onOpenRecent: (path: string) => void;
}

const Toolbar = ({
  loading,
  hasActive,
  recent,
  onNew,
  onOpen,
  onCloseMap,
  onClearRecent,
  onOpenRecent,
  onOpenPreferences
}: ToolbarProps) => {
  const win = getCurrentWindow();
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-border/50 bg-toolbar-bg pl-1.5 pr-3"
    >
      <AppMenu
        onNew={onNew}
        recent={recent}
        onOpen={onOpen}
        loading={loading}
        hasActive={hasActive}
        onCloseMap={onCloseMap}
        onOpenRecent={onOpenRecent}
        onClearRecent={onClearRecent}
        onOpenPreferences={onOpenPreferences}
      />

      <div className="-mr-3 ml-auto flex items-center">
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
          onClick={() => win.close()}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
