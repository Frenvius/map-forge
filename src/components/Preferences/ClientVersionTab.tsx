import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { CLIENT_VERSIONS } from '~/domain/tibia';
import { ClientConfig } from '~/adapter/preferences';
import { Label } from '~/components/commons/ui/label';
import ClientRow from '~/components/Preferences/ClientRow';
import { Checkbox } from '~/components/commons/ui/checkbox';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '~/components/commons/ui/select';

interface ClientVersionTabProps {
  config: ClientConfig;
  onChange: (config: ClientConfig) => void;
}

const VERSIONS = CLIENT_VERSIONS.filter((cv, i, arr) => arr.findIndex((o) => o.value === cv.value) === i);
const versionLabel = new Map(VERSIONS.map((cv) => [cv.value, cv.label]));
const labelOf = (version: number) => versionLabel.get(version) ?? String(version);

const ClientVersionTab = ({ config, onChange }: ClientVersionTabProps) => {
  const [addKey, setAddKey] = React.useState(0);

  const set = (patch: Partial<ClientConfig>) => onChange({ ...config, ...patch });

  const setPath = (version: number, path: string) => onChange({ ...config, paths: { ...config.paths, [version]: path } });

  const clearPath = (version: number) => {
    const paths = { ...config.paths };
    delete paths[version];
    onChange({ ...config, paths });
  };

  const pickFolder = async (version: number) => {
    const dir = await open({
      multiple: false,
      directory: true,
      defaultPath: config.paths[version] || undefined,
      title: `Select client folder for ${labelOf(version)}`
    });
    return typeof dir === 'string' ? dir : null;
  };

  const browse = async (version: number) => {
    const dir = await pickFolder(version);
    if (dir) setPath(version, dir);
  };

  const addVersion = async (version: number) => {
    const dir = await pickFolder(version);
    if (dir) setPath(version, dir);
    setAddKey((k) => k + 1);
  };

  const configured = React.useMemo(() => {
    const seen = new Set<number>(Object.keys(config.paths).map(Number));
    seen.add(config.defaultVersion);
    return [...seen].sort((a, b) => a - b);
  }, [config.paths, config.defaultVersion]);

  const available = VERSIONS.filter((cv) => !configured.includes(cv.value));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-x-5 whitespace-nowrap">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium">Default version</span>
          <Select value={String(config.defaultVersion)} onValueChange={(v) => set({ defaultVersion: Number(v) })}>
            <SelectTrigger className="h-7 w-20">
              <SelectValue>{labelOf(config.defaultVersion)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VERSIONS.map((cv) => (
                <SelectItem key={cv.value} value={String(cv.value)}>
                  {cv.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Label htmlFor="pref-sig" className="shrink-0 cursor-pointer">
          <Checkbox
            id="pref-sig"
            checked={config.checkSignatures}
            onCheckedChange={(v) => set({ checkSignatures: v === true })}
          />
          Check signatures
        </Label>
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Configured clients</span>
          <span className="text-[10px] text-muted-foreground">New maps use the default version</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {configured.map((version) => (
            <ClientRow
              key={version}
              label={labelOf(version)}
              path={config.paths[version]}
              onClear={() => clearPath(version)}
              onBrowse={() => void browse(version)}
              isDefault={version === config.defaultVersion}
            />
          ))}
        </div>
        {available.length > 0 && (
          <Select key={addKey} onValueChange={(v) => void addVersion(Number(v))}>
            <SelectTrigger className="h-7 w-48 text-muted-foreground">
              <SelectValue placeholder="+ Add another version" />
            </SelectTrigger>
            <SelectContent>
              {available.map((cv) => (
                <SelectItem key={cv.value} value={String(cv.value)}>
                  {cv.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
};

export default ClientVersionTab;
