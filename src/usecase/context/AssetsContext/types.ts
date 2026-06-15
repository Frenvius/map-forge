import React from 'react';

import { AssetsState } from '~/usecase/hooks/Workspace/useAssets';

export type AssetsContextValue = AssetsState;

export interface AssetsProviderProps {
  children: React.ReactNode;
}
