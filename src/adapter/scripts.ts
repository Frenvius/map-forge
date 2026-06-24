import { invoke } from '@tauri-apps/api/core';

export async function listScripts(): Promise<string[]> {
  return invoke<string[]>('list_scripts');
}

export async function readScript(name: string): Promise<string> {
  return invoke<string>('read_script', { name });
}

export async function writeScript(name: string, content: string): Promise<number> {
  return invoke<number>('write_script', { name, content });
}

export async function reloadScripts(): Promise<number> {
  return invoke<number>('reload_scripts');
}

export async function loadScriptedItemdb(path: string): Promise<number> {
  return invoke<number>('load_scripted_itemdb', { path });
}

export async function loadScriptedAssets(path: string): Promise<number> {
  return invoke<number>('load_scripted_assets', { path });
}

export async function itemSprite(itemId: number): Promise<number | null> {
  return invoke<number | null>('item_sprite', { itemId });
}

export interface ScriptedThing {
  id: number;
  width: number;
  height: number;
  layers: number;
  frames: number;
  patternX: number;
  patternY: number;
  patternZ: number;
  offsetX: number;
  offsetY: number;
  elevation: number;
  groundSpeed: number;
  exactSize: number;
  isGround: boolean;
  isGroundBorder: boolean;
  isOnBottom: boolean;
  isOnTop: boolean;
  hasOffset: boolean;
  hasElevation: boolean;
  spriteIndex: number[];
  attrs: Record<string, number | boolean | string>;
}

export async function scriptedThings(): Promise<ScriptedThing[]> {
  return invoke<ScriptedThing[]>('scripted_things');
}

export interface UiConfig {
  clientVersions: boolean;
  assets: { ext: string; label: string; setting: string; itemdb: string | null } | null;
}

export interface AppConfig {
  name: string | null;
  dataDir: string | null;
  floorOffset: number | null;
}

export async function appConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('app_config');
}

export async function uiConfig(): Promise<UiConfig> {
  return invoke<UiConfig>('ui_config');
}

export async function itemNames(): Promise<Map<number, string>> {
  const list = await invoke<[number, string][]>('item_names');
  return new Map(list);
}

export interface ScriptedFormat {
  ext: string;
  name: string;
  kind: string;
}

export async function registeredFormats(): Promise<ScriptedFormat[]> {
  const list = await invoke<[string, string, string][]>('registered_formats');
  return list.map(([ext, name, kind]) => ({ ext, name, kind }));
}
