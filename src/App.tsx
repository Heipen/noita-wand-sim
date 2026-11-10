import { useCallback, useEffect, useMemo, useState } from 'react';
import { CastResult } from './components/CastResult';
import { ImportPanel } from './components/ImportPanel';
import { SpellPicker } from './components/SpellPicker';
import { SpellTooltip } from './components/SpellTooltip';
import { WandEditor, type CustomPreset } from './components/WandEditor';
import { useSpellTooltip } from './hooks/useSpellTooltip';
import { loadBundledData } from './lib/bundledData';
import {
  buildGameData,
  importFromFiles,
  pickFromDirectory,
  supportsDirectoryPicker,
  type ImportStage,
  type RawGameImport,
} from './lib/gameData';
import { t } from './lib/i18n';
import { loadStoredImport, saveStoredImport } from './lib/idb';
import { configureEngineScripts, simulateWand } from './lib/simClient';
import { ENGINE_SCRIPT_PATHS } from './engine/sources';
import { wakText } from './lib/wak';
import {
  createDefaultWand,
  decodeWandFromQuery,
  encodeWandToQuery,
  firstEmptySlot,
  normalizeWand,
  placeSpell,
  shareUrlForWand,
  toEngineWand,
  type WandState,
} from './lib/wand';
import type { GameData, Lang } from './lib/types';

const LANG_KEY = 'noita-wand-sim.lang';
const PREFER_LOCAL_KEY = 'noita-wand-sim.preferLocal';
const PRESETS_KEY = 'noita-wand-sim.presets';

type Phase = 'boot' | 'empty' | 'loading' | 'ready';
type SimMode = 'single' | 'untilReload';

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    /* ignore */
  }
  return 'zh';
}

function readInitialWand(): WandState {
  if (typeof window !== 'undefined') {
    const fromUrl = decodeWandFromQuery(window.location.search);
    if (fromUrl) return fromUrl;
  }
  return createDefaultWand();
}

function readCustomPresets(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is CustomPreset =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as CustomPreset).id === 'string' &&
          typeof (item as CustomPreset).name === 'string' &&
          Boolean((item as CustomPreset).wand),
      )
      .map((item) => ({ ...item, wand: normalizeWand(item.wand) }));
  } catch {
    return [];
  }
}

function prefersLocalData(): boolean {  try {
    return localStorage.getItem(PREFER_LOCAL_KEY) === '1';
  } catch {
    return false;
  }
}

function setPreferLocalData(value: boolean): void {
  try {
    if (value) localStorage.setItem(PREFER_LOCAL_KEY, '1');
    else localStorage.removeItem(PREFER_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

async function restoreLocalImport(): Promise<GameData | null> {
  try {
    const stored = await loadStoredImport();
    if (!stored) return null;
    return await buildGameData({
      wakBuffer: stored.wak,
      csvText: stored.csv,
      sourceName: stored.sourceName,
    });
  } catch {
    return null;
  }
}

export default function App() {
  const [lang, setLang] = useState<Lang>(readInitialLang);
  const [phase, setPhase] = useState<Phase>('boot');
  const [stage, setStage] = useState<ImportStage | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GameData | null>(null);
  const [bundled, setBundled] = useState<GameData | null>(null);
  const [wand, setWand] = useState<WandState>(readInitialWand);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(readCustomPresets);
  const [mode, setMode] = useState<SimMode>('single');
  const [result, setResult] = useState<Awaited<ReturnType<typeof simulateWand>> | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const supportsDirectory = useMemo(() => supportsDirectoryPicker(), []);
  const { tooltip, show: showTooltip, hide: hideTooltip } = useSpellTooltip();

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    } catch {
      /* ignore */
    }
  }, [lang]);

  // Boot: bundled data first (zero setup), local import only when the user asked for it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (prefersLocalData()) {
        setPhase('loading');
        setStage('parsing');
        const local = await restoreLocalImport();
        if (!cancelled && local) {
          setData(local);
          setBundled(await loadBundledData());
          setPhase('ready');
          setStage(undefined);
          return;
        }
      }

      const bundledData = await loadBundledData();
      if (cancelled) return;
      setBundled(bundledData);
      if (bundledData) {
        setData(bundledData);
        setPhase('ready');
        setStage(undefined);
        return;
      }

      setPhase('loading');
      const local = await restoreLocalImport();
      if (cancelled) return;
      setStage(undefined);
      if (local) {
        setData(local);
        setPhase('ready');
      } else {
        setPhase('empty');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Give the engine worker the scripts of the active data source.
  useEffect(() => {
    if (!data) return;
    if (data.origin === 'local' && data.wak) {
      const scripts: Record<string, string> = {};
      for (const path of ENGINE_SCRIPT_PATHS) {
        const text = wakText(data.wak, path);
        if (text) scripts[path] = text;
      }
      configureEngineScripts(scripts);
    } else {
      configureEngineScripts(undefined);
    }
  }, [data]);

  useEffect(() => {
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(customPresets));
    } catch {
      /* ignore */
    }
  }, [customPresets]);

  const savePreset = useCallback(
    (name: string, presetWand: WandState) => {
      const finalName = name.trim() || t(lang, 'editor.defaultPresetName');
      const preset: CustomPreset = {
        id: `custom-${Date.now()}`,
        name: finalName,
        wand: normalizeWand({ ...presetWand, name: finalName }),
      };
      setCustomPresets((presets) => [preset, ...presets.filter((item) => item.name !== finalName)]);
      setWand(preset.wand);
    },
    [lang],
  );

  const deletePreset = useCallback((id: string) => {
    setCustomPresets((presets) => presets.filter((preset) => preset.id !== id));
  }, []);

  // Debounced simulation whenever the wand or mode changes.
  useEffect(() => {
    if (phase !== 'ready' || !data) return;
    const slots = wand.spells.slice(0, wand.capacity);
    const hasSpells = slots.some(Boolean) || wand.alwaysCast.some(Boolean);
    if (!hasSpells) {
      setResult(null);
      setSimError(null);
      setSimulating(false);
      return;
    }
    let cancelled = false;
    setSimulating(true);
    setSimError(null);
    const handle = window.setTimeout(() => {
      const engineWand = toEngineWand(wand);
      simulateWand(engineWand, {
        clicks: 1,
        untilReload: mode === 'untilReload',
        maxShots: 50,
        mana: wand.manaMax,
        frame: 0,
        worldSeed: 0,
      })
        .then((simulation) => {
          if (!cancelled) setResult(simulation);
        })
        .catch((reason: unknown) => {
          if (!cancelled) setSimError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (!cancelled) setSimulating(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [phase, data, wand, mode]);

  // Keep the URL shareable at all times.
  useEffect(() => {
    if (phase !== 'ready') return;
    try {
      const query = encodeWandToQuery(wand);
      window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
    } catch {
      /* ignore */
    }
  }, [phase, wand]);

  const handleImport = useCallback(async (loader: () => Promise<RawGameImport>) => {
    setError(null);
    setPhase('loading');
    setStage('reading');
    try {
      const raw = await loader();
      const game = await buildGameData(raw, setStage);
      setStage('saving');
      await saveStoredImport({
        signature: game.signature,
        importedAt: game.importedAt,
        sourceName: game.sourceName,
        spellCount: game.spells.length,
        wak: raw.wakBuffer,
        csv: raw.csvText,
      });
      setPreferLocalData(true);
      setData(game);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('empty');
    } finally {
      setStage(undefined);
    }
  }, []);

  const useBundled = useCallback(async () => {
    const bundledData = bundled ?? (await loadBundledData());
    setBundled(bundledData);
    setPreferLocalData(false);
    setError(null);
    if (bundledData) {
      setData(bundledData);
      setPhase('ready');
    }
  }, [bundled]);

  const addSpell = useCallback(
    (spellId: string) => {
      const slot = firstEmptySlot(wand);
      if (slot >= 0 && slot < wand.capacity) {
        setWand(placeSpell(wand, slot, spellId));
      }
    },
    [wand],
  );

  const share = useCallback(async () => {
    const url = shareUrlForWand(wand);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt(t(lang, 'share.copy'), url);
    }
  }, [wand, lang]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>{t(lang, 'app.title')}</h1>
          <p className="subtitle">{t(lang, 'app.subtitle')}</p>
        </div>
        <button className="lang-switch" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
          {t(lang, 'app.langSwitch')}
        </button>
      </header>

      <main>
        {phase === 'boot' && <div className="boot">{t(lang, 'common.loading')}</div>}

        {phase === 'loading' && (
          <ImportPanel
            lang={lang}
            supportsDirectory={supportsDirectory}
            stage={stage ?? 'reading'}
            onPickDirectory={() => {}}
            onPickFiles={() => {}}
          />
        )}

        {phase === 'empty' && (
          <>
            <ImportPanel
              lang={lang}
              supportsDirectory={supportsDirectory}
              stage={stage}
              error={error}
              onPickDirectory={() => void handleImport(() => pickFromDirectory(setStage))}
              onPickFiles={(files) => void handleImport(() => importFromFiles(files))}
            />
            {bundled && (
              <div className="back-to-bundled">
                <button className="secondary" onClick={() => void useBundled()}>
                  {t(lang, 'import.backToBundled')}
                </button>
              </div>
            )}
          </>
        )}

        {phase === 'ready' && data && (
          <div className="sim-layout">
              <WandEditor
                data={data}
                lang={lang}
                wand={wand}
                hover={{ show: showTooltip, hide: hideTooltip }}
                customPresets={customPresets}
                onChange={setWand}
                onShare={() => void share()}
                onSavePreset={savePreset}
                onDeletePreset={deletePreset}
                copied={copied}
              />
              <SpellPicker
                data={data}
                lang={lang}
                hover={{ show: showTooltip, hide: hideTooltip }}
                onAdd={addSpell}
              />
              <CastResult
                result={result}
                data={data}
                lang={lang}
                mode={mode}
                onModeChange={setMode}
                simulating={simulating}
                error={simError}
                wandSpells={wand.spells.slice(0, wand.capacity)}
              />
            </div>
        )}
      </main>

      {data && <SpellTooltip tooltip={tooltip} data={data} lang={lang} />}
      <footer className="app-footer">
        <p className="footer-note">{t(lang, 'footer.note')}</p>
        {phase === 'ready' && data && (
          <p className="footer-data-actions">
            {data.origin === 'local' ? (
              <button type="button" className="link-button use-bundled" onClick={() => void useBundled()}>
                {t(lang, 'stats.useBundled')}
              </button>
            ) : (
              <button
                type="button"
                className="link-button use-local"
                onClick={() => {
                  setError(null);
                  setPhase('empty');
                }}
              >
                {t(lang, 'stats.useLocal')}
              </button>
            )}
            <span className="footer-sep">·</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setError(null);
                setPhase('empty');
              }}
            >
              {t(lang, 'stats.reimport')}
            </button>
          </p>
        )}
        <p className="footer-meta">
          <span>{t(lang, 'footer.madeWith')}</span>
          <span className="footer-sep">·</span>
          <a href="https://github.com/Heipen/noita-wand-sim" target="_blank" rel="noreferrer noopener">
            {t(lang, 'footer.repo')}
          </a>
          <span className="footer-sep">·</span>
          <span className="footer-star">{t(lang, 'footer.star')}</span>
        </p>
      </footer>
    </div>
  );
}
