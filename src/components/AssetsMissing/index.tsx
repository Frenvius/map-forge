import { Settings, RefreshCw, FolderOpen } from 'lucide-react';

import { Button } from '~/components/commons/ui/button';

interface AssetsMissingProps {
  dataDir: string;
  target: { label: string; scripted: boolean; project: string | null };
  error: string | null;
  clientConfigured: boolean;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

const AssetsMissing = ({
  dataDir,
  target,
  error,
  clientConfigured,
  onOpenFolder,
  onOpenSettings,
  onRetry
}: AssetsMissingProps) => (
  <div className="flex h-full items-center justify-center p-8">
    <div className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border/60 bg-card p-6 shadow-island">
      <div className="text-sm font-semibold text-foreground">Failed to load {target.label}</div>
      {clientConfigured ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {target.scripted ? (
            <>
              The data folder for {target.label} is missing or incomplete. Place the materials into the folder below, then reload.
            </>
          ) : (
            <>
              The data folder for {target.label} is missing or incomplete. Place items.otb and materials into the folder below, or
              change the default version in Client settings.
            </>
          )}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {target.scripted ? (
            target.project ? (
              <>
                {target.project} declares no {target.label} file. Add it to the project manifest, or open a different project in
                Preferences &rsaquo; General.
              </>
            ) : (
              <>No {target.label} file is configured. Open a project that provides one in Preferences &rsaquo; General.</>
            )
          ) : (
            <>No client folder selected. Set it in Preferences &rsaquo; Client Version, then reload.</>
          )}
        </p>
      )}
      {dataDir && (
        <div className="w-full break-all rounded bg-secondary/40 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
          {dataDir}
        </div>
      )}
      {error && (
        <div className="w-full break-all rounded bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">{error}</div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onOpenSettings}>
          <Settings />
          {target.scripted ? `${target.label} settings` : 'Client settings'}
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
