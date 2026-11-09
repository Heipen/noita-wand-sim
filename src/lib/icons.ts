import type { GameData, SpellMeta } from './types';
import { wakBytes } from './wak';

const iconCache = new Map<string, string>();

/**
 * Resolve a spell icon URL.
 * - bundled data: plain static file (`data/sprites/<id>.png`)
 * - locally imported data: PNG extracted from the user's data.wak into a blob URL
 */
export function spellIconUrl(data: GameData, spell: SpellMeta): string | undefined {
  if (spell.icon) {
    return `${import.meta.env.BASE_URL}${spell.icon}`.replace(/\/+/g, '/');
  }
  if (data.wak && spell.sprite) {
    const cached = iconCache.get(spell.sprite);
    if (cached) return cached;
    const bytes = wakBytes(data.wak, spell.sprite);
    if (!bytes) return undefined;
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    iconCache.set(spell.sprite, url);
    return url;
  }
  return undefined;
}

export function clearIconCache(): void {
  for (const url of iconCache.values()) URL.revokeObjectURL(url);
  iconCache.clear();
}
