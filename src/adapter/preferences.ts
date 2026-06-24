import { DEFAULT_MAX_STACK } from '~/domain/dock';
import { DEFAULT_VERSION } from '~/adapter/assets';
import { getSetting, setSetting } from '~/adapter/settings';
import { DEFAULT_COPY_POSITION_FORMAT } from '~/usecase/positionFormat';

const KEY = 'clientConfig';
const GENERAL_KEY = 'generalConfig';
const EDITOR_KEY = 'editorConfig';
export async function loadAssetPath(key: string): Promise<string> {
  return getSetting<string>(key, '');
}

export async function saveAssetPath(key: string, path: string): Promise<void> {
  await setSetting(key, path);
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
}

export const defaultGeneralConfig: GeneralConfig = {
  maxStack: DEFAULT_MAX_STACK,
  copyPositionFormat: DEFAULT_COPY_POSITION_FORMAT,
  spawnSize: 3,
  spawnTime: 60,
  infiniteMouse: true
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
}

export const defaultEditorConfig: EditorConfig = {
  autoCreateSpawn: true
};

export async function loadEditorConfig(): Promise<EditorConfig> {
  const stored = await getSetting<Partial<EditorConfig>>(EDITOR_KEY, {});
  return { ...defaultEditorConfig, ...stored };
}

export async function saveEditorConfig(config: EditorConfig): Promise<void> {
  await setSetting(EDITOR_KEY, config);
}
