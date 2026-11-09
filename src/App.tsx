import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImportPanel } from './components/ImportPanel';
import { SpellGrid } from './components/SpellGrid';
import { StatsBar } from './components/StatsBar';
import { Toolbar } from './components/Toolbar';
import {
  buildGameData,
  importFromFiles,
  pickFromDirectory,
  supportsDirectoryPicker,
  type ImportStage,
  type RawGameImport,
} from './lib/gameData';
import { t } from './lib/i18n';
import { clearIconCache } from './lib/icons';
import { loadStoredImport, saveStoredImport } from './lib/idb';
import type { GameData, Lang, SpellType } from './lib/types';

const LANG_KEY = 'noita-wand-sim.lang';

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

export default function App() {
  const [lang, setLang] = useState<Lang>(readInitialLang);
  const [phase, setPhase] = useState<Phase>('boot');
  const [stage, setStage] = useState<ImportStage | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GameData | null>(null);
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

  // Restore the cached game data from IndexedDB on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadStoredImport();
        if (cancelled) return;
        if (!stored) {
          setPhase('empty');
          return;
        }
        setPhase('loading');
        const game = await buildGameData(
          { wakBuffer: stored.wak, csvText: stored.csv, sourceName: stored.sourceName },
          (next) => !cancelled && setStage(next),
          stored.importedAt,
        );
        if (cancelled) return;
        setData(game);
        setPhase('ready');
      } catch {
        if (cancelled) return;
        setPhase('empty');
      } finally {
        if (!cancelled) setStage(undefined);
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
      clearIconCache();
      setData(game);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('empty');
    } finally {
      setStage(undefined);
    }
  }, []);

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
          <ImportPanel
            lang={lang}
            supportsDirectory={supportsDirectory}
            stage={stage}
            error={error}
            onPickDirectory={() => void handleImport(() => pickFromDirectory(setStage))}
            onPickFiles={(files) => void handleImport(() => importFromFiles(files))}
          />
        )}

        {phase === 'ready' && data && (
          <>
            <StatsBar
              data={data}
              lang={lang}
              onReimport={() => {
                clearIconCache();
                setData(null);
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
            <SpellGrid spells={filteredSpells} wak={data.wak} lang={lang} />
          </>
        )}
      </main>

      <footer className="app-footer">{t(lang, 'footer.note')}</footer>
    </div>
  );
}
