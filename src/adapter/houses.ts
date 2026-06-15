import { invoke } from '@tauri-apps/api/core';

import { House, MapHouses, emptyMapHouses } from '~/domain/house';

const intAttr = (el: Element, name: string): number => Number(el.getAttribute(name) ?? 0);

const boolAttr = (el: Element, name: string): boolean => {
  const v = (el.getAttribute(name) ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
};

export async function loadHouses(path: string): Promise<MapHouses> {
  let content: string;
  try {
    content = await invoke<string>('read_file_text', { path });
  } catch {
    return emptyMapHouses();
  }

  const doc = new DOMParser().parseFromString(content, 'text/xml');
  const list: House[] = [];
  for (const el of Array.from(doc.getElementsByTagName('house'))) {
    const id = intAttr(el, 'houseid');
    if (!id) continue;
    list.push({
      id,
      name: el.getAttribute('name') ?? `House #${id}`,
      townId: intAttr(el, 'townid'),
      rent: intAttr(el, 'rent'),
      guildhall: boolAttr(el, 'guildhall'),
      entryX: intAttr(el, 'entryx'),
      entryY: intAttr(el, 'entryy'),
      entryZ: intAttr(el, 'entryz')
    });
  }
  return { list };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function serializeHouseXml(houses: MapHouses, sizes: Record<number, number>): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<houses>'];
  for (const h of houses.list) {
    const attrs = [
      `name="${esc(h.name)}"`,
      `houseid="${h.id}"`,
      `entryx="${h.entryX}"`,
      `entryy="${h.entryY}"`,
      `entryz="${h.entryZ}"`,
      `rent="${h.rent}"`,
      `townid="${h.townId}"`,
      `size="${sizes[h.id] ?? 0}"`
    ];
    if (h.guildhall) attrs.push('guildhall="1"');
    lines.push(`\t<house ${attrs.join(' ')}/>`);
  }
  lines.push('</houses>', '');
  return lines.join('\n');
}
