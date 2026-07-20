import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { cn } from '~/usecase/classNames';
import { Input } from '~/components/commons/ui/input';
import HuntTab from '~/components/Preferences/HuntTab';
import { uiConfig, UiConfig } from '~/adapter/scripts';
import { Button } from '~/components/commons/ui/button';
import EditorTab from '~/components/Preferences/EditorTab';
import GeneralTab from '~/components/Preferences/GeneralTab';
import { ProjectInfo, activeProject } from '~/adapter/project';
import { copyDataDir, defaultDataRoot } from '~/adapter/assets';
import ClientVersionTab from '~/components/Preferences/ClientVersionTab';
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogContent,
  DialogDescription
} from '~/components/commons/ui/dialog';
import {
  HuntConfig,
  loadDataDir,
  saveDataDir,
  ClientConfig,
  EditorConfig,
  GeneralConfig,
  loadHuntConfig,
  saveHuntConfig,
  loadClientConfig,
  loadEditorConfig,
  saveClientConfig,
  saveEditorConfig,
  loadGeneralConfig,
  saveGeneralConfig,
  defaultHuntConfig,
  defaultClientConfig,
  defaultEditorConfig,
  defaultGeneralConfig
} from '~/adapter/preferences';

export type TabId = 'general' | 'editor' | 'hunt' | 'client' | 'assets';

interface PreferencesProps {
  open: boolean;
  initialTab?: TabId;
  onSaved?: () => void;
  onResetLayout?: () => void;
  onOpenChange: (open: boolean) => void;
}

const DEFAULT_UI: UiConfig = { clientVersions: true, assets: null };

const Preferences = ({ open: dialogOpen, initialTab = 'general', onSaved, onResetLayout, onOpenChange }: PreferencesProps) => {
  const [tab, setTab] = React.useState<TabId>(initialTab);
  const [ui, setUi] = React.useState<UiConfig>(DEFAULT_UI);
  const [config, setConfig] = React.useState<ClientConfig>(defaultClientConfig);
  const [general, setGeneral] = React.useState<GeneralConfig>(defaultGeneralConfig);
  const [editor, setEditor] = React.useState<EditorConfig>(defaultEditorConfig);
  const [hunt, setHunt] = React.useState<HuntConfig>(defaultHuntConfig);
  const [project, setProject] = React.useState<ProjectInfo | null>(null);
  const [dataDir, setDataDir] = React.useState('');
  const [pendingDataDir, setPendingDataDir] = React.useState<string | null>(null);
  const [dataError, setDataError] = React.useState('');
  const [moving, setMoving] = React.useState(false);

  React.useEffect(() => {
    if (!dialogOpen) return;
    setTab(initialTab);
    void uiConfig()
      .then(setUi)
      .catch(() => setUi(DEFAULT_UI));
    void activeProject()
      .then(setProject)
      .catch(() => setProject(null));
    void loadClientConfig().then(setConfig);
    void loadGeneralConfig().then(setGeneral);
    void loadEditorConfig().then(setEditor);
    void loadHuntConfig().then(setHunt);
    void loadDataDir().then(setDataDir);
  }, [dialogOpen, initialTab]);

  const pickDataDir = async () => {
    const selected = await open({ multiple: false, directory: true, title: 'Select data folder' });
    if (!selected || typeof selected !== 'string' || selected === dataDir) return;
    setDataError('');
    setPendingDataDir(selected);
  };

  const applyDataDir = async (copy: boolean) => {
    const target = pendingDataDir;
    if (!target) return;
    setMoving(true);
    setDataError('');
    try {
      if (copy) {
        const from = dataDir.trim() || (await defaultDataRoot());
        await copyDataDir(from, target);
      }
      await saveDataDir(target);
      setDataDir(target);
      setPendingDataDir(null);
      onSaved?.();
    } catch (e) {
      setDataError(`${e}`);
    } finally {
      setMoving(false);
    }
  };

  const resetDataDir = () => {
    void saveDataDir('').then(() => {
      setDataDir('');
      onSaved?.();
    });
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'editor', label: 'Editor' },
    { id: 'hunt', label: 'Hunt' },
    ...(ui.clientVersions ? [{ id: 'client' as TabId, label: 'Client Version' }] : []),
    ...(ui.assets ? [{ id: 'assets' as TabId, label: ui.assets.label || 'Assets' }] : [])
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'general';

  const save = () => {
    void saveClientConfig(config);
    void saveGeneralConfig(general);
    void saveEditorConfig(editor);
    void saveHuntConfig(hunt);
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
        <DialogContent className="h-[560px] max-h-[85vh] max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preferences</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1">
            <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'rounded px-3 py-1.5 text-left text-xs font-medium transition-colors',
                    activeTab === t.id
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto p-4">
              {activeTab === 'general' && (
                <>
                  <GeneralTab
                    config={general}
                    onChange={setGeneral}
                    onResetLayout={() => onResetLayout?.()}
                    data={{ dir: dataDir, onPick: () => void pickDataDir(), onReset: resetDataDir }}
                  />
                </>
              )}
              {activeTab === 'editor' && <EditorTab config={editor} onChange={setEditor} />}
              {activeTab === 'hunt' && <HuntTab config={hunt} onChange={setHunt} />}
              {activeTab === 'client' && <ClientVersionTab config={config} onChange={setConfig} />}
              {activeTab === 'assets' && ui.assets && (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                    {ui.assets.label} file
                    <Input readOnly value={project?.assets ?? ''} placeholder={`Declared by the project (.${ui.assets.ext})`} />
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {project?.assets
                      ? 'Set by the project manifest. Open a different project to change it.'
                      : `No ${ui.assets.label} file configured.`}
                  </span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDataDir !== null} onOpenChange={(o) => !o && !moving && setPendingDataDir(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Copy data folder?</DialogTitle>
            <DialogDescription>
              Copy the current data folder into <span className="break-all text-foreground">{pendingDataDir}</span>? The bundled
              files stay in place. Choose Don't copy to point at it without copying (it must already contain the version folders).
            </DialogDescription>
          </DialogHeader>
          {dataError && <span className="break-all text-xs text-destructive">{dataError}</span>}
          <DialogFooter>
            <Button size="sm" variant="ghost" disabled={moving} onClick={() => setPendingDataDir(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="outline" disabled={moving} onClick={() => void applyDataDir(false)}>
              Don't copy
            </Button>
            <Button size="sm" disabled={moving} onClick={() => void applyDataDir(true)}>
              {moving ? 'Copying...' : 'Copy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Preferences;
