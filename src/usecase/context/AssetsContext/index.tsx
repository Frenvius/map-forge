import React from 'react';

import { useAssets } from '~/usecase/hooks/Workspace/useAssets';

import { AssetsContextValue, AssetsProviderProps } from './types';

const AssetsContext = React.createContext({} as AssetsContextValue);

export const AssetsProvider = ({ children }: AssetsProviderProps) => {
  const value = useAssets();
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
};

export const useAssetsBundle = () => React.useContext(AssetsContext);
