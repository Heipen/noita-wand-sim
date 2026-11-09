import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImportPanel } from './components/ImportPanel';
import { SpellGrid } from './components/SpellGrid';
import { StatsBar } from './components/StatsBar';
import { Toolbar } from './components/Toolbar';
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
import type { GameData, Lang, SpellType } from './lib/types';

const LANG_KEY = 'noita-wand-sim.lang';
const PREFER_LOCAL_KEY = 'noita-wand-sim.preferLocal';

type Phase = 'boot' | 'empty' | 'loading' | 'ready';

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    /* ignore */
  }
  return 'zh';
}

function prefersLocalData(): boolean {
  try {
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
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<SpellType | 'all'>('all');
  const supportsDirectory = useMemo(() => supportsDirectoryPicker(), []);

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
      // A previously imported local dataset takes priority when the user chose it.
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

  const filteredSpells = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.spells.filter((spell) => {
      if (typeFilter !== 'all' && spell.type !== typeFilter) return false;
      if (!q) return true;
      return (
        spell.id.toLowerCase().includes(q) ||
        spell.nameEn.toLowerCase().includes(q) ||
        spell.nameZh.includes(q) ||
        spell.displayZh.includes(q)
      );
    });
  }, [data, query, typeFilter]);

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
          <>
            <StatsBar
              data={data}
              lang={lang}
              onUseLocal={() => {
                setError(null);
                setPhase('empty');
              }}
              onUseBundled={data.origin === 'local' ? () => void useBundled() : null}
              onReimport={() => {
                setError(null);
                setPhase('empty');
              }}
            />
            <Toolbar
              lang={lang}
              query={query}
              typeFilter={typeFilter}
              shown={filteredSpells.length}
              total={data.spells.length}
              onQueryChange={setQuery}
              onTypeChange={setTypeFilter}
            />
            <SpellGrid spells={filteredSpells} data={data} lang={lang} />
          </>
        )}
      </main>

      <footer className="app-footer">{t(lang, 'footer.note')}</footer>
    </div>
  );
}
