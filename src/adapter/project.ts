import { invoke } from '@tauri-apps/api/core';

import { setSetting } from '~/adapter/settings';

export const PROJECT_EXT = 'frg';

const clearProjectScopedSelection = async (): Promise<void> => {
  await setSetting('activeTile', null);
  await setSetting('secondaryTile', null);
};

export interface ProjectInfo {
  id: string;
  name: string;
  root: string;
  path: string;
  dataRoot: string | null;
  assets: string | null;
  itemdb: string | null;
  maps: string | null;
  hasScripts: boolean;
  hasMapForge: boolean;
  missing: string[];
}

export interface RecentProject {
  path: string;
  name: string | null;
}

export async function activeProject(): Promise<ProjectInfo | null> {
  return invoke<ProjectInfo | null>('project_active');
}

export async function projectError(): Promise<string | null> {
  return invoke<string | null>('project_error');
}

export async function openProject(path: string): Promise<ProjectInfo> {
  const info = await invoke<ProjectInfo>('project_open', { path });
  await clearProjectScopedSelection();
  return info;
}

export async function closeProject(): Promise<void> {
  await invoke('project_close');
  await clearProjectScopedSelection();
}

export async function recentProjects(): Promise<RecentProject[]> {
  return invoke<RecentProject[]>('project_recent');
}

export async function clearRecentProjects(): Promise<void> {
  await invoke('project_recent_clear');
}
