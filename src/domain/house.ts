export interface House {
  id: number;
  name: string;
  townId: number;
  rent: number;
  guildhall: boolean;
  entryX: number;
  entryY: number;
  entryZ: number;
}

export interface MapHouses {
  list: House[];
}

export const emptyMapHouses = (): MapHouses => ({ list: [] });

export function sortHouses(list: House[]): House[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export function nextHouseId(houses: MapHouses): number {
  return houses.list.reduce((max, h) => Math.max(max, h.id), 0) + 1;
}

export function houseById(houses: MapHouses, id: number): House | undefined {
  return houses.list.find((h) => h.id === id);
}
