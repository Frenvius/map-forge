import { invoke } from '@tauri-apps/api/core';

import { Waypoint, MapWaypoints, buildMapWaypoints, emptyMapWaypoints } from '~/domain/waypoint';

const intAttr = (el: Element, name: string): number => Number(el.getAttribute(name) ?? 0);

export async function loadWaypoints(path: string): Promise<MapWaypoints> {
  let content: string;
  try {
    content = await invoke<string>('read_file_text', { path });
  } catch {
    return emptyMapWaypoints();
  }

  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const list: Waypoint[] = [];
  for (const el of Array.from(doc.getElementsByTagName('waypoint'))) {
    const name = el.getAttribute('name') ?? '';
    if (!name) continue;
    list.push({ name, x: intAttr(el, 'x'), y: intAttr(el, 'y'), z: intAttr(el, 'z') });
  }
  return buildMapWaypoints(list);
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function serializeWaypointXml(wps: MapWaypoints): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<waypoints>'];
  for (const w of wps.list) {
    lines.push(`\t<waypoint name="${esc(w.name)}" x="${w.x}" y="${w.y}" z="${w.z}"/>`);
  }
  lines.push('</waypoints>', '');
  return lines.join('\n');
}
