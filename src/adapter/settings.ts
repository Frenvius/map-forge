import { invoke } from '@tauri-apps/api/core';

type Settings = Record<string, unknown>;

let cache: Settings | null = null;

async function load(): Promise<Settings> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await invoke<string>('read_settings')) as Settings;
  } catch {
    cache = {};
  }
  return cache;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const settings = await load();
  return (settings[key] as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const settings = await load();
  settings[key] = value;
  try {
    await invoke('write_settings', { contents: JSON.stringify(settings) });
  } catch {
    void 0;
  }
}
