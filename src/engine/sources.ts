import type { WakArchive } from '../lib/types';
import { wakText } from '../lib/wak';
import type { ScriptSource } from './types';

/** Game scripts the rule engine needs (same set as the bundled data pack). */
export const ENGINE_SCRIPT_PATHS = [
  'data/scripts/gun/gun.lua',
  'data/scripts/gun/gun_enums.lua',
  'data/scripts/gun/gunaction_generated.lua',
  'data/scripts/gun/gun_generated.lua',
  'data/scripts/gun/gunshoteffects_generated.lua',
  'data/scripts/gun/gun_actions.lua',
  'data/scripts/gun/gun_extra_modifiers.lua',
  'data/scripts/gun/procedural/gun_action_utils.lua',
  'data/scripts/lib/utilities.lua',
];

/** Script source backed by an imported data.wak (browser or tests). */
export function wakScriptSource(wak: WakArchive): ScriptSource {
  return {
    read(path: string): string | undefined {
      return wakText(wak, path);
    },
  };
}

/** Script source backed by plain strings (tests). */
export function staticScriptSource(files: Map<string, string>): ScriptSource {
  return {
    read(path: string): string | undefined {
      return files.get(path);
    },
  };
}

/**
 * Script source backed by the bundled data pack in `public/data/game/...`.
 * In the browser this fetches each script once; a custom `fetchImpl` can be supplied in tests.
 */
export function bundledScriptSource(
  baseUrl = import.meta.env.BASE_URL,
  fetchImpl: typeof fetch = fetch,
): ScriptSource {
  const cache = new Map<string, Promise<string>>();
  const urlFor = (path: string): string => {
    const relative = path.startsWith('data/') ? `game/${path.slice('data/'.length)}` : `game/${path}`;
    return `${baseUrl}data/${relative}`.replace(/\/+/g, '/');
  };
  return {
    read(path: string): Promise<string> {
      const url = urlFor(path);
      let pending = cache.get(url);
      if (!pending) {
        pending = fetchImpl(url).then((response) => {
          if (!response.ok) throw new Error(`缺少脚本 ${url}（HTTP ${response.status}）`);
          return response.text();
        });
        cache.set(url, pending);
      }
      return pending;
    },
  };
}

/** Preload every engine script into a map so Lua's synchronous dofile can use it. */
export async function loadEngineScripts(source: ScriptSource): Promise<Map<string, string>> {
  const entries = await Promise.all(
    ENGINE_SCRIPT_PATHS.map(async (path) => {
      try {
        const text = await source.read(path);
        return [path, text] as const;
      } catch {
        return [path, undefined] as const;
      }
    }),
  );
  const map = new Map<string, string>();
  for (const [path, text] of entries) {
    if (typeof text === 'string') map.set(path, text);
  }
  return map;
}
