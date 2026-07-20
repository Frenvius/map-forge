import { getProjectState, setProjectState } from '~/adapter/projectState';

const KEY = 'recentMaps';
const MAX = 10;

export async function loadRecentMaps(): Promise<string[]> {
  return getProjectState<string[]>(KEY, []);
}

export async function addRecentMap(path: string): Promise<string[]> {
  const current = await loadRecentMaps();
  const next = [path, ...current.filter((p) => p !== path)].slice(0, MAX);
  await setProjectState(KEY, next);
  return next;
}

export async function clearRecentMaps(): Promise<void> {
  await setProjectState(KEY, []);
}
