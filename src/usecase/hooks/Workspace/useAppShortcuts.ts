import React from 'react';

interface ShortcutActions {
  activeId: string | null;
  handleNew: () => void;
  handleOpen: () => void;
  handleSave: () => void;
  handleSaveAs: () => void;
  closeTab: (id: string) => void;
  openEditTowns: () => void;
  openPreferences: () => void;
  toggleMinimap: () => void;
  openMapProperties: () => void;
  openMapStatistics: () => void;
  refreshAssets: () => void;
  toggleShade: () => void;
}

export const useAppShortcuts = (actions: ShortcutActions) => {
  const ref = React.useRef(actions);
  ref.current = actions;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const a = ref.current;
      if (key === 's') {
        e.preventDefault();
        if (e.shiftKey) a.handleSaveAs();
        else a.handleSave();
        return;
      }
      if (e.shiftKey) return;
      if (key === 'n') {
        e.preventDefault();
        a.handleNew();
      } else if (key === 'o') {
        e.preventDefault();
        a.handleOpen();
      } else if (key === 'w' && a.activeId) {
        e.preventDefault();
        a.closeTab(a.activeId);
      } else if (key === 't') {
        e.preventDefault();
        a.openEditTowns();
      } else if (key === 'p') {
        e.preventDefault();
        a.openMapProperties();
      } else if (key === ',') {
        e.preventDefault();
        a.openPreferences();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        ref.current.toggleMinimap();
      } else if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        ref.current.toggleShade();
      } else if (e.key === 'F8') {
        e.preventDefault();
        ref.current.openMapStatistics();
      } else if (e.key === 'F5') {
        e.preventDefault();
        ref.current.refreshAssets();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
};
