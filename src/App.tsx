import { useCallback, useEffect, useMemo, useState } from 'react';
import { CastResult } from './components/CastResult';
import { ImportPanel } from './components/ImportPanel';
import { SpellPicker } from './components/SpellPicker';
import { SpellTooltip } from './components/SpellTooltip';
import { WandEditor, type CustomPreset, type SpellTarget } from './components/WandEditor';
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
  setAlwaysCast,
  shareUrlForWand,
  toEngineWand,
  type WandState,
} from './lib/wand';
import type { GameData, Lang } from './lib/types';

const LANG_KEY = 'noita-wand-sim.lang';
const PREFER_LOCAL_KEY = 'noita-wand-sim.preferLocal';
const PRESETS_KEY = 'noita-wand-sim.presets';
const ALWAYS_CAST_KEY = 'noita-wand-sim.alwaysCast';
const WAND_STICKY_KEY = 'noita-wand-sim.wandSticky';
const ZERO_USES_KEY = 'noita-wand-sim.zeroUses';

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

function readAlwaysCastEnabled(): boolean {
  try {
    return localStorage.getItem(ALWAYS_CAST_KEY) === '1';
  } catch {
    return false;
  }
}

function readWandStickyEnabled(): boolean {
  try {
    return localStorage.getItem(WAND_STICKY_KEY) !== '0';
  } catch {
    return true;
  }
}

function readZeroUsesEnabled(): boolean {
  try {
    return localStorage.getItem(ZERO_USES_KEY) === '1';
  } catch {
    return false;
  }
}

function visitorBadgeUrl(path: string, label: string): string {
  return `https://api.visitorbadge.io/api/visitors?path=${encodeURIComponent(path)}&label=${encodeURIComponent(label)}&labelColor=%23555&countColor=%23263759`;
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
  const [alwaysCastEnabled, setAlwaysCastEnabled] = useState(readAlwaysCastEnabled);
  const [wandStickyEnabled, setWandStickyEnabled] = useState(readWandStickyEnabled);
  const [zeroUsesEnabled, setZeroUsesEnabled] = useState(readZeroUsesEnabled);
  const [requirements, setRequirements] = useState({
    enemies: false,
    projectiles: false,
    hp: false,
    halfInitial: false,
  });
  const [spellTarget, setSpellTarget] = useState<SpellTarget | null>(null);
  const [isMobile] = useState(
    () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent),
  );
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

  useEffect(() => {
    try {
      localStorage.setItem(ALWAYS_CAST_KEY, alwaysCastEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [alwaysCastEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(WAND_STICKY_KEY, wandStickyEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [wandStickyEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(ZERO_USES_KEY, zeroUsesEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [zeroUsesEnabled]);

  const limitedSpellIds = useMemo(
    () =>
      (data?.spells ?? [])
        .filter((spell) => spell.maxUses !== null && spell.maxUses > 0 && spell.neverUnlimited)
        .map((spell) => spell.id),
    [data],
  );

  // Keep the sticky pile panel below the sticky wand bar.
  useEffect(() => {
    const sticky = document.querySelector<HTMLElement>('.wand-sticky');
    if (!sticky) return;
    const update = () => {
      const offset = isMobile && !wandStickyEnabled ? 0 : Math.ceil(sticky.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--wand-sticky-height', `${offset}px`);
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(sticky);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [phase, alwaysCastEnabled, wandStickyEnabled, isMobile]);

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
      // the saved name belongs to the preset; start a fresh unnamed wand afterwards
      setWand(normalizeWand({ ...preset.wand, name: '' }));
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
    const hasSpells = slots.some(Boolean) || (alwaysCastEnabled && wand.alwaysCast.some(Boolean));
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
      if (!alwaysCastEnabled) engineWand.always_cast = [];
      simulateWand(engineWand, {
        clicks: 1,
        untilReload: mode === 'untilReload',
        maxShots: 50,
        mana: wand.manaMax,
        frame: 0,
        worldSeed: 0,
        zeroUses: zeroUsesEnabled ? limitedSpellIds : undefined,
        requirements,
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
  }, [phase, data, wand, mode, alwaysCastEnabled, zeroUsesEnabled, limitedSpellIds, requirements]);

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
      if (spellTarget !== null) {
        setWand(
          spellTarget.kind === 'always'
            ? setAlwaysCast(wand, spellTarget.index, spellId)
            : placeSpell(wand, spellTarget.index, spellId),
        );
        setSpellTarget(null);
        return;
      }
      const slot = firstEmptySlot(wand);
      if (slot >= 0 && slot < wand.capacity) {
        setWand(placeSpell(wand, slot, spellId));
      }
    },
    [wand, spellTarget],
  );

  const chooseSpellTarget = useCallback(
    (kind: SpellTarget['kind'], index: number) => {
      const same = spellTarget?.kind === kind && spellTarget.index === index;
      setSpellTarget(same ? null : { kind, index });
      if (same) return;
      // bring the search field into view below the sticky wand bar; its height changes with
      // capacity, so use the live measured height instead of a fixed offset
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('.toolbar .search');
        const sticky = document.querySelector<HTMLElement>('.wand-sticky');
        if (!input) return;
        // do not focus the input: on phones that would pop up the keyboard; only reveal it
        const offset = (sticky?.getBoundingClientRect().height ?? 0) + 12;
        const rect = input.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + rect.top - offset, behavior: 'smooth' });
      }, 50);
    },
    [spellTarget],
  );

  useEffect(() => {
    if (spellTarget === null) return;
    const cancelOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // clicking a slot switches/toggles the target; clicking the spell picker selects a spell.
      // Anywhere else means the user moved on, so silently drop the target.
      if (target?.closest('.wand-slot, .spell-picker')) return;
      setSpellTarget(null);
    };
    window.addEventListener('pointerdown', cancelOutside, true);
    return () => window.removeEventListener('pointerdown', cancelOutside, true);
  }, [spellTarget]);

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

  const now = new Date();
  const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const visitorSite = 'heipen.github.io/noita-wand-sim';

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>{t(lang, 'app.title')}</h1>
          <p className="subtitle">{t(lang, 'app.subtitle')}</p>
        </div>
        <div className="app-header-actions">
          <a className="header-feedback" href="mailto:heipen111@foxmail.com">
            {t(lang, 'header.feedback')}
          </a>
          <button className="lang-switch" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
            {t(lang, 'app.langSwitch')}
          </button>
        </div>
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
                alwaysCastEnabled={alwaysCastEnabled}
                onAlwaysCastToggle={setAlwaysCastEnabled}
                wandStickyEnabled={wandStickyEnabled}
                onWandStickyToggle={setWandStickyEnabled}
                zeroUsesEnabled={zeroUsesEnabled}
                onZeroUsesToggle={setZeroUsesEnabled}
                isMobile={isMobile}
                spellTarget={spellTarget}
                onSlotTarget={isMobile ? chooseSpellTarget : undefined}
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
                requirements={requirements}
                onRequirementsChange={(patch) => setRequirements((previous) => ({ ...previous, ...patch }))}
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
        <p className="footer-meta">
          <span>{t(lang, 'footer.madeWith')}</span>
          <span className="footer-sep">·</span>
          <a href="https://github.com/Heipen/noita-wand-sim" target="_blank" rel="noreferrer noopener">
            {t(lang, 'footer.repo')}
          </a>
          <span className="footer-sep">·</span>
          <span className="footer-star">{t(lang, 'footer.star')}</span>
        </p>
        <p className="footer-visitors">
          <img
            src={visitorBadgeUrl(`${visitorSite}-today-${localDay}`, t(lang, 'footer.visitorsToday'))}
            alt={t(lang, 'footer.visitorsToday')}
            loading="lazy"
          />
          <img
            src={visitorBadgeUrl(visitorSite, t(lang, 'footer.visitorsTotal'))}
            alt={t(lang, 'footer.visitorsTotal')}
            loading="lazy"
          />
        </p>
      </footer>
    </div>
  );
}
