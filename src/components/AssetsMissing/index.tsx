import { Settings, RefreshCw, FolderOpen } from 'lucide-react';

import { Button } from '~/components/commons/ui/button';

interface AssetsMissingProps {
  dataDir: string;
  version: number;
  error: string | null;
  clientConfigured: boolean;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

const AssetsMissing = ({ dataDir, version, error, clientConfigured, onOpenFolder, onOpenSettings, onRetry }: AssetsMissingProps) => (
  <div className="flex h-full items-center justify-center p-8">
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border/60 bg-card p-6 shadow-island">
      <div className="text-sm font-semibold text-foreground">
        Failed to load version {version}
      </div>
      {clientConfigured ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The data folder for version {version} is missing or incomplete. Place items.otb and materials into the folder below,
          or change the default version in Client settings.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          No client folder configured for version {version}. Set it in Preferences &rsaquo; Client Version, then reload.
        </p>
      )}
      {dataDir && (
        <div className="w-full break-all rounded bg-secondary/40 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
          {dataDir}
        </div>
      )}
      {error && (
        <div className="w-full break-all rounded bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onOpenSettings}>
          <Settings />
          Client settings
        </Button>
        <Button size="sm" variant="ghost" onClick={onRetry} className="ml-auto">
          <RefreshCw />
          Reload
        </Button>
        <Button size="sm" variant="secondary" disabled={!dataDir} onClick={onOpenFolder}>
          <FolderOpen />
          Open data folder
        </Button>
      </div>
    </div>
  </div>
);

export default AssetsMissing;
