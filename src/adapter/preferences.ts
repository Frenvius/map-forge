import { getSetting, setSetting } from '~/adapter/settings';
import { DEFAULT_VERSION, DEFAULT_DATA_DIR } from '~/adapter/assets';

const KEY = 'clientConfig';

export interface ClientConfig {
  defaultVersion: number;
  checkSignatures: boolean;
  paths: Record<number, string>;
}

export const defaultClientConfig: ClientConfig = {
  checkSignatures: true,
  defaultVersion: DEFAULT_VERSION,
  paths: { [DEFAULT_VERSION]: DEFAULT_DATA_DIR }
};

export async function loadClientConfig(): Promise<ClientConfig> {
  const stored = await getSetting<Partial<ClientConfig>>(KEY, {});
  return {
    ...defaultClientConfig,
    ...stored,
    paths: { ...defaultClientConfig.paths, ...(stored.paths ?? {}) }
  };
}

export async function saveClientConfig(config: ClientConfig): Promise<void> {
  await setSetting(KEY, config);
}
