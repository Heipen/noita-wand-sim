import { t } from '../lib/i18n';
import type { GameData, Lang } from '../lib/types';

interface Props {
  data: GameData;
  lang: Lang;
  /** Show the "use local data" action (bundled data active). */
  onUseLocal: () => void;
  /** Show the "use bundled data" action (local data active). */
  onUseBundled: (() => void) | null;
  onReimport: () => void;
}

export function StatsBar({ data, lang, onUseLocal, onUseBundled, onReimport }: Props) {
  const time = data.importedAt ? new Date(data.importedAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US') : '';
  return (
    <section className="stats-bar">
      <span className="stat strong">{t(lang, 'stats.spells', { n: data.spells.length })}</span>
      {data.wak && <span className="stat">{t(lang, 'stats.files', { n: data.wak.fileCount })}</span>}
      <span className="stat">{t(lang, 'stats.version', { hash: data.signature })}</span>
      <span className="stat">{t(lang, 'stats.source', { source: data.sourceName })}</span>
      {time && <span className="stat muted">{t(lang, 'stats.importedAt', { time })}</span>}
      <span className="spacer" />
      {onUseBundled ? (
        <button className="secondary small use-bundled" onClick={onUseBundled}>
          {t(lang, 'stats.useBundled')}
        </button>
      ) : (
        <button className="secondary small use-local" onClick={onUseLocal}>
          {t(lang, 'stats.useLocal')}
        </button>
      )}
      <button className="secondary small" onClick={onReimport}>
        {t(lang, 'stats.reimport')}
      </button>
    </section>
  );
}
