import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { cn } from '~/usecase/classNames';
import { Input } from '~/components/commons/ui/input';
import { Button } from '~/components/commons/ui/button';
import EditorTab from '~/components/Preferences/EditorTab';
import GeneralTab from '~/components/Preferences/GeneralTab';
import ClientVersionTab from '~/components/Preferences/ClientVersionTab';
import { uiConfig, UiConfig, loadScriptedAssets } from '~/adapter/scripts';
import { Dialog, DialogTitle, DialogHeader, DialogFooter, DialogContent } from '~/components/commons/ui/dialog';
import {
  ClientConfig,
  EditorConfig,
  GeneralConfig,
  loadClientConfig,
  loadEditorConfig,
  saveClientConfig,
  saveEditorConfig,
  loadGeneralConfig,
  saveGeneralConfig,
  loadAssetPath,
  saveAssetPath,
  defaultClientConfig,
  defaultEditorConfig,
  defaultGeneralConfig
} from '~/adapter/preferences';

type TabId = 'general' | 'editor' | 'client' | 'assets';

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
  const [assetPath, setAssetPath] = React.useState('');
  const [assetStatus, setAssetStatus] = React.useState('');

  React.useEffect(() => {
    if (!dialogOpen) return;
    setTab(initialTab);
    void uiConfig()
      .then((u) => {
        setUi(u);
        if (u.assets) void loadAssetPath(u.assets.setting).then(setAssetPath);
      })
      .catch(() => setUi(DEFAULT_UI));
    void loadClientConfig().then(setConfig);
    void loadGeneralConfig().then(setGeneral);
    void loadEditorConfig().then(setEditor);
  }, [dialogOpen, initialTab]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'editor', label: 'Editor' },
    ...(ui.clientVersions ? [{ id: 'client' as TabId, label: 'Client Version' }] : []),
    ...(ui.assets ? [{ id: 'assets' as TabId, label: ui.assets.label || 'Assets' }] : [])
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'general';

  const pickAssets = async () => {
    if (!ui.assets) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: ui.assets.label, extensions: [ui.assets.ext] }]
    });
    if (!selected || typeof selected !== 'string') return;
    setAssetPath(selected);
    setAssetStatus('Loading...');
    try {
      const count = await loadScriptedAssets(selected);
      await saveAssetPath(ui.assets.setting, selected);
      setAssetStatus(`Loaded ${count} sprites`);
    } catch (e) {
      setAssetStatus(`Error: ${e}`);
    }
  };

  const save = () => {
    void saveClientConfig(config);
    void saveGeneralConfig(general);
    void saveEditorConfig(editor);
    onSaved?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preferences</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-1 border-b border-border px-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px border-b-2 px-2 py-2 text-xs font-medium transition-colors',
                activeTab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {activeTab === 'general' && (
            <GeneralTab config={general} onChange={setGeneral} onResetLayout={() => onResetLayout?.()} />
          )}
          {activeTab === 'editor' && <EditorTab config={editor} onChange={setEditor} />}
          {activeTab === 'client' && <ClientVersionTab config={config} onChange={setConfig} />}
          {activeTab === 'assets' && ui.assets && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                {ui.assets.label} file
                <div className="flex gap-2">
                  <Input readOnly value={assetPath} placeholder={`Select a .${ui.assets.ext} file`} />
                  <Button size="sm" onClick={pickAssets}>
                    Browse...
                  </Button>
                </div>
              </label>
              {assetStatus && <span className="text-xs text-muted-foreground">{assetStatus}</span>}
            </div>
          )}
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
  );
};

export default Preferences;
