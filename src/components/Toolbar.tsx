import { spellTypeLabel, t } from '../lib/i18n';
import { SPELL_TYPES, type Lang, type SpellType } from '../lib/types';

interface Props {
  lang: Lang;
  query: string;
  typeFilter: SpellType | 'all';
  shown: number;
  total: number;
  onQueryChange: (value: string) => void;
  onTypeChange: (value: SpellType | 'all') => void;
}

export function Toolbar({ lang, query, typeFilter, shown, total, onQueryChange, onTypeChange }: Props) {
  return (
    <section className="toolbar">
      <input
        className="search"
        type="search"
        placeholder={t(lang, 'toolbar.search')}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <select
        className="type-filter"
        value={typeFilter}
        onChange={(event) => onTypeChange(event.target.value as SpellType | 'all')}
      >
        <option value="all">{t(lang, 'toolbar.allTypes')}</option>
        {SPELL_TYPES.map((type) => (
          <option key={type} value={type}>
            {spellTypeLabel(lang, type)}
          </option>
        ))}
      </select>
      <span className="count">{t(lang, 'toolbar.count', { shown, total })}</span>
    </section>
  );
}
