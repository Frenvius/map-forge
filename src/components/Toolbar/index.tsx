import { X, Minus, Square } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

import AppMenu from '~/components/Toolbar/AppMenu';

interface ToolbarProps {
  loading: boolean;
  hasActive: boolean;
  recent: string[];
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseMap: () => void;
  onEditTowns: () => void;
  onClearRecent: () => void;
  onMapProperties: () => void;
  onMapStatistics: () => void;
  onOpenPreferences: () => void;
  onOpenRecent: (path: string) => void;
  onAbout: () => void;
}

const Toolbar = ({
  loading,
  hasActive,
  recent,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onCloseMap,
  onEditTowns,
  onClearRecent,
  onOpenRecent,
  onMapProperties,
  onMapStatistics,
  onOpenPreferences,
  onAbout
}: ToolbarProps) => {
  const win = getCurrentWindow();
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const onDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, [role="menuitem"], input')) return;
    if (e.detail === 2) {
      void win.toggleMaximize();
      return;
    }

    const onMove = () => {
      cleanup();
      void win.startDragging();
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', cleanup);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
  };

  return (
    <div
      onMouseDown={onDragStart}
      className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-border/50 bg-toolbar-bg pl-1.5 pr-3"
    >
      <AppMenu
        onNew={onNew}
        recent={recent}
        onOpen={onOpen}
        onSave={onSave}
        loading={loading}
        onAbout={onAbout}
        onSaveAs={onSaveAs}
        hasActive={hasActive}
        onCloseMap={onCloseMap}
        onEditTowns={onEditTowns}
        onOpenRecent={onOpenRecent}
        onClearRecent={onClearRecent}
        onMapProperties={onMapProperties}
        onMapStatistics={onMapStatistics}
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
          onClick={() => void (loading ? win.close() : win.destroy())}
          className="flex h-8 w-9 items-center justify-center text-muted-foreground hover:bg-[#c42b1c] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
