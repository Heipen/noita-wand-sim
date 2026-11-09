import type { GameData, SpellMeta } from './types';

interface BundledVersion {
  generatedAt?: string;
  signature?: string;
  build?: string;
  spellCount?: number;
}

interface BundledPack {
  spells: SpellMeta[];
}

/**
 * Load the data pack that is shipped with the site (generated from the game by
 * `npm run build:data`). This is what makes the app work with zero setup.
 * Returns null when the pack is absent (e.g. a fork that does not ship data).
 */
export async function loadBundledData(): Promise<GameData | null> {
  const base = import.meta.env.BASE_URL;
  try {
    const versionRes = await fetch(`${base}data/version.json`.replace(/\/+/g, '/'), { cache: 'no-cache' });
    if (!versionRes.ok) return null;
    const version = (await versionRes.json()) as BundledVersion;

    const packRes = await fetch(`${base}data/spells.json`.replace(/\/+/g, '/'), { cache: 'no-cache' });
    if (!packRes.ok) return null;
    const pack = (await packRes.json()) as BundledPack;
    if (!Array.isArray(pack.spells) || pack.spells.length === 0) return null;

    return {
      spells: pack.spells,
      signature: version.signature ?? '',
      importedAt: version.generatedAt ? Date.parse(version.generatedAt) : 0,
      sourceName: `内置 · ${version.build ?? 'bundled'}`,
      hasTranslations: true,
      origin: 'bundled',
    };
  } catch {
    return null;
  }
}
