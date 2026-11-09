import { t } from '../lib/i18n';
import type { GameData, Lang } from '../lib/types';

interface Props {
  data: GameData;
  lang: Lang;
  onReimport: () => void;
}

export function StatsBar({ data, lang, onReimport }: Props) {
  const time = new Date(data.importedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
  return (
    <section className="stats-bar">
      <span className="stat strong">{t(lang, 'stats.spells', { n: data.spells.length })}</span>
      <span className="stat">{t(lang, 'stats.files', { n: data.wak.fileCount })}</span>
      <span className="stat">{t(lang, 'stats.version', { hash: data.signature })}</span>
      <span className="stat">{t(lang, 'stats.source', { source: data.sourceName })}</span>
      <span className="stat muted">{t(lang, 'stats.importedAt', { time })}</span>
      <button className="secondary small" onClick={onReimport}>
        {t(lang, 'stats.reimport')}
      </button>
    </section>
  );
}
