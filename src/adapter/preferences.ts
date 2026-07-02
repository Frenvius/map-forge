import { DEFAULT_MAX_STACK } from '~/domain/dock';
import { getSetting, setSetting } from '~/adapter/settings';
import { DATA_DIR_KEY, DEFAULT_VERSION } from '~/adapter/assets';
import { DEFAULT_COPY_POSITION_FORMAT } from '~/usecase/positionFormat';

const KEY = 'clientConfig';
const GENERAL_KEY = 'generalConfig';
const EDITOR_KEY = 'editorConfig';
const HUNT_KEY = 'huntConfig';
export async function loadAssetPath(key: string): Promise<string> {
  return getSetting<string>(key, '');
}

export async function saveAssetPath(key: string, path: string): Promise<void> {
  await setSetting(key, path);
}

export async function loadDataDir(): Promise<string> {
  return getSetting<string>(DATA_DIR_KEY, '');
}

export async function saveDataDir(path: string): Promise<void> {
  await setSetting(DATA_DIR_KEY, path);
}

export interface ClientConfig {
  defaultVersion: number;
  checkSignatures: boolean;
  paths: Record<number, string>;
}

export const defaultClientConfig: ClientConfig = {
  checkSignatures: true,
  defaultVersion: DEFAULT_VERSION,
  paths: {}
};

export async function loadClientConfig(): Promise<ClientConfig> {
  const stored = await getSetting<Partial<ClientConfig>>(KEY, {});
  return {
    ...defaultClientConfig,
    ...stored,
    paths: { ...(stored.paths ?? {}) }
  };
}

export async function saveClientConfig(config: ClientConfig): Promise<void> {
  await setSetting(KEY, config);
}

export interface GeneralConfig {
  maxStack: number;
  copyPositionFormat: string;
  spawnSize: number;
  spawnTime: number;
  infiniteMouse: boolean;
  backupOnSave: boolean;
  backupCount: number;
}

export const defaultGeneralConfig: GeneralConfig = {
  maxStack: DEFAULT_MAX_STACK,
  copyPositionFormat: DEFAULT_COPY_POSITION_FORMAT,
  spawnSize: 3,
  spawnTime: 60,
  infiniteMouse: true,
  backupOnSave: true,
  backupCount: 5
};

export async function loadGeneralConfig(): Promise<GeneralConfig> {
  const stored = await getSetting<Partial<GeneralConfig>>(GENERAL_KEY, {});
  return { ...defaultGeneralConfig, ...stored };
}

export async function saveGeneralConfig(config: GeneralConfig): Promise<void> {
  await setSetting(GENERAL_KEY, config);
}

export interface EditorConfig {
  autoCreateSpawn: boolean;
  eraseMonsters: boolean;
  eraseSpawns: boolean;
  defaultFloor: number;
  undoSteps: number;
  undoMemoryMb: number;
  mergePaste: boolean;
}

export const defaultEditorConfig: EditorConfig = {
  autoCreateSpawn: true,
  eraseMonsters: true,
  eraseSpawns: true,
  defaultFloor: 7,
  undoSteps: 200,
  undoMemoryMb: 256,
  mergePaste: false
};

export async function loadEditorConfig(): Promise<EditorConfig> {
  const stored = await getSetting<Partial<EditorConfig>>(EDITOR_KEY, {});
  return { ...defaultEditorConfig, ...stored };
}

export async function saveEditorConfig(config: EditorConfig): Promise<void> {
  await setSetting(EDITOR_KEY, config);
}

export interface HuntConfig {
  viewWidth: number;
  viewHeight: number;
  aggroWidth: number;
  aggroHeight: number;
  boxSize: number;
  defaultSpawntime: number;
}

export const defaultHuntConfig: HuntConfig = {
  viewWidth: 15,
  viewHeight: 11,
  aggroWidth: 15,
  aggroHeight: 11,
  boxSize: 8,
  defaultSpawntime: 60
};

export async function loadHuntConfig(): Promise<HuntConfig> {
  const stored = await getSetting<Partial<HuntConfig>>(HUNT_KEY, {});
  return { ...defaultHuntConfig, ...stored };
}

export async function saveHuntConfig(config: HuntConfig): Promise<void> {
  await setSetting(HUNT_KEY, config);
}
