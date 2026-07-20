import { invoke } from '@tauri-apps/api/core';

type State = Record<string, unknown>;

let cache: State | null = null;

async function load(): Promise<State> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await invoke<string>('project_state_get')) as State;
  } catch {
    cache = {};
  }
  return cache;
}

export async function getProjectState<T>(key: string, fallback: T): Promise<T> {
  const state = await load();
  return (state[key] as T) ?? fallback;
}

export async function setProjectState(key: string, value: unknown): Promise<void> {
  const state = await load();
  state[key] = value;
  try {
    await invoke('project_state_set', { contents: JSON.stringify(state) });
  } catch {
    void 0;
  }
}

export function resetProjectStateCache(): void {
  cache = null;
}
