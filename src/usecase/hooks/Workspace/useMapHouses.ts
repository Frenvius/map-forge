import React from 'react';

import { MapHouses } from '~/domain/house';
import { loadHouses } from '~/adapter/houses';
import { getMapProperties } from '~/adapter/map';

interface HouseSource {
  id: string;
  path?: string;
  mapId: number;
}

export interface MapHousesApi {
  houses: MapHouses | null;
  setHouses: React.Dispatch<React.SetStateAction<MapHouses | null>>;
}

const dirOf = (path: string) => path.replace(/[^\\/]+$/, '');
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? '';

export const useMapHouses = (active: HouseSource | null): MapHousesApi => {
  const [houses, setHouses] = React.useState<MapHouses | null>(null);

  React.useEffect(() => {
    if (!active?.path) {
      setHouses(null);
      return;
    }
    const path = active.path;
    let cancelled = false;
    void (async () => {
      const props = await getMapProperties(active.mapId).catch(() => null);
      const fallback = baseName(path).replace(/\.otbm$/i, '-house.xml');
      const file = props?.houseFile || fallback;
      const result = await loadHouses(dirOf(path) + file);
      if (!cancelled) setHouses(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.path, active?.mapId]);

  return { houses, setHouses };
};
