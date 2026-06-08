import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Menu, FilePlus, FolderOpen } from 'lucide-react';

import { Button } from '~/components/commons/ui/button';
import {
  Menubar,
  MenubarSub,
  MenubarMenu,
  MenubarItem,
  MenubarContent,
  MenubarTrigger,
  MenubarShortcut,
  MenubarSeparator,
  MenubarSubContent,
  MenubarSubTrigger
} from '~/components/commons/ui/menubar';

interface AppMenuProps {
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

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

const AppMenu = ({
  loading,
  hasActive,
  recent,
  onNew,
  onOpen,
  onCloseMap,
  onClearRecent,
  onOpenRecent,
  onOpenPreferences
}: AppMenuProps) => {
  const [value, setValue] = React.useState('');
  const [revealed, setRevealed] = React.useState(false);
  const hamburgerRef = React.useRef<HTMLButtonElement>(null);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  function handleValueChange(next: string) {
    setValue(next);
    if (!next) setRevealed(false);
  }

  const keepOpenOnHamburger = (e: Event) => {
    const target = (e as CustomEvent<{ originalEvent: Event }>).detail.originalEvent.target as Node | null;
    if (target && hamburgerRef.current?.contains(target)) e.preventDefault();
  };

  function toggle() {
    if (revealed) {
      setRevealed(false);
      setValue('');
    } else {
      setRevealed(true);
      setValue('file');
    }
  }

  return (
    <Menubar value={value} onValueChange={handleValueChange}>
      <button
        onClick={toggle}
        ref={hamburgerRef}
        onMouseDown={stop}
        aria-label="Main menu"
        data-active={revealed}
        className="flex h-6 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
      >
        <Menu className="h-4 w-4" />
      </button>

      {!revealed && (
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={onNew}
            disabled={loading}
            onMouseDown={stop}
            className="h-6 px-2 text-xs font-medium"
          >
            <FilePlus className="mr-1.5 h-3.5 w-3.5" />
            New Map
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpen}
            disabled={loading}
            onMouseDown={stop}
            className="h-6 px-2 text-xs font-medium"
          >
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            Open Map
          </Button>
        </>
      )}

      {revealed && (
        <>
          <MenubarMenu value="file">
            <MenubarTrigger onMouseDown={stop}>File</MenubarTrigger>
            <MenubarContent onMouseDown={stop} onInteractOutside={keepOpenOnHamburger}>
              <MenubarItem onSelect={onNew} disabled={loading}>
                <FilePlus className="mr-2 h-3.5 w-3.5" />
                New Map
                <MenubarShortcut>Ctrl+N</MenubarShortcut>
              </MenubarItem>
              <MenubarItem onSelect={onOpen} disabled={loading}>
                <FolderOpen className="mr-2 h-3.5 w-3.5" />
                Open Map...
                <MenubarShortcut>Ctrl+O</MenubarShortcut>
              </MenubarItem>
              <MenubarSub>
                <MenubarSubTrigger disabled={loading}>Open Recent</MenubarSubTrigger>
                <MenubarSubContent>
                  {recent.length === 0 ? (
                    <MenubarItem disabled>No recent maps</MenubarItem>
                  ) : (
                    <>
                      {recent.map((path) => (
                        <MenubarItem key={path} title={path} onSelect={() => onOpenRecent(path)}>
                          {basename(path)}
                        </MenubarItem>
                      ))}
                      <MenubarSeparator />
                      <MenubarItem onSelect={onClearRecent}>Clear Recent</MenubarItem>
                    </>
                  )}
                </MenubarSubContent>
              </MenubarSub>
              <MenubarSeparator />
              <MenubarItem disabled={!hasActive} onSelect={onCloseMap}>
                Close Map
                <MenubarShortcut>Ctrl+W</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={() => void getCurrentWindow().close()}>Exit</MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu value="edit">
            <MenubarTrigger onMouseDown={stop}>Edit</MenubarTrigger>
            <MenubarContent onMouseDown={stop} onInteractOutside={keepOpenOnHamburger}>
              <MenubarItem onSelect={onOpenPreferences}>
                Preferences...
                <MenubarShortcut>Ctrl+,</MenubarShortcut>
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </>
      )}
    </Menubar>
  );
};

export default AppMenu;
