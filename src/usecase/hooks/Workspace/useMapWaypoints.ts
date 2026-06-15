import React from 'react';

import { getWaypoints } from '~/adapter/map';
import { loadWaypoints } from '~/adapter/waypoints';
import { MapWaypoints, buildMapWaypoints } from '~/domain/waypoint';

interface WaypointSource {
  id: string;
  path?: string;
  mapId: number;
}

export interface MapWaypointsApi {
  waypoints: MapWaypoints | null;
  setWaypoints: React.Dispatch<React.SetStateAction<MapWaypoints | null>>;
}

const dirOf = (path: string) => path.replace(/[^\\/]+$/, '');
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? '';

export const useMapWaypoints = (active: WaypointSource | null, onMigrated?: () => void): MapWaypointsApi => {
  const [waypoints, setWaypoints] = React.useState<MapWaypoints | null>(null);

  React.useEffect(() => {
    if (!active?.path) {
      setWaypoints(null);
      return;
    }
    const path = active.path;
    const mapId = active.mapId;
    let cancelled = false;
    void (async () => {
      const file = baseName(path).replace(/\.otbm$/i, '-waypoint.xml');
      const sidecar = await loadWaypoints(dirOf(path) + file);
      if (cancelled) return;
      if (sidecar.list.length > 0) {
        setWaypoints(sidecar);
        return;
      }
      const embedded = await getWaypoints(mapId).catch(() => []);
      if (cancelled) return;
      if (embedded.length > 0) {
        setWaypoints(buildMapWaypoints(embedded));
        onMigrated?.();
      } else {
        setWaypoints(sidecar);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.path, active?.mapId, onMigrated]);

  return { waypoints, setWaypoints };
};
