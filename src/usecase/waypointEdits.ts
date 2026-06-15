import { Position } from '~/domain/map';
import { Waypoint, MapWaypoints, buildMapWaypoints } from '~/domain/waypoint';

const lower = (s: string) => s.trim().toLowerCase();

export function nameTaken(wps: MapWaypoints, name: string, exclude?: string): boolean {
  const n = lower(name);
  return wps.list.some((w) => lower(w.name) === n && (exclude == null || lower(w.name) !== lower(exclude)));
}

export function nextWaypointName(wps: MapWaypoints): string {
  let i = wps.list.length + 1;
  while (nameTaken(wps, `Waypoint ${i}`)) i++;
  return `Waypoint ${i}`;
}

export function addWaypoint(wps: MapWaypoints, name: string, pos: Position): MapWaypoints {
  if (!name.trim() || nameTaken(wps, name)) return wps;
  return buildMapWaypoints([...wps.list, { name: name.trim(), x: pos.x, y: pos.y, z: pos.z }]);
}

export function moveWaypoint(wps: MapWaypoints, name: string, pos: Position): MapWaypoints {
  const n = lower(name);
  return buildMapWaypoints(wps.list.map((w) => (lower(w.name) === n ? { ...w, x: pos.x, y: pos.y, z: pos.z } : w)));
}

export function removeWaypoint(wps: MapWaypoints, name: string): MapWaypoints {
  const n = lower(name);
  return buildMapWaypoints(wps.list.filter((w) => lower(w.name) !== n));
}

export function renameWaypoint(wps: MapWaypoints, oldName: string, newName: string): MapWaypoints {
  const trimmed = newName.trim();
  if (!trimmed || nameTaken(wps, trimmed, oldName)) return wps;
  const n = lower(oldName);
  return buildMapWaypoints(wps.list.map((w) => (lower(w.name) === n ? { ...w, name: trimmed } : w)));
}

export const sortWaypoints = (list: Waypoint[]): Waypoint[] => [...list].sort((a, b) => a.name.localeCompare(b.name));
