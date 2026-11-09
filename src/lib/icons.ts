import type { WakArchive } from './types';
import { wakBytes } from './wak';

const iconCache = new Map<string, string>();

/** Turn a PNG inside the .wak archive into a blob: URL (cached per path). */
export function spellIconUrl(wak: WakArchive, sprite: string | null | undefined): string | undefined {
  if (!sprite) return undefined;
  const cached = iconCache.get(sprite);
  if (cached) return cached;

  const bytes = wakBytes(wak, sprite);
  if (!bytes) return undefined;

  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
  iconCache.set(sprite, url);
  return url;
}

export function clearIconCache(): void {
  for (const url of iconCache.values()) URL.revokeObjectURL(url);
  iconCache.clear();
}
