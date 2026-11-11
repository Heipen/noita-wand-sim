import { useMemo, useState } from 'react';
import { t } from '../lib/i18n';
import type { GameData, Lang, SpellType } from '../lib/types';
import spellAliases from '../data/spellAliases.json';
import { Toolbar } from './Toolbar';
import { SpellCard, type HoverHandlers } from './SpellCard';

const ALIASES = spellAliases as Record<string, string[]>;

interface Props {
  data: GameData;
  lang: Lang;
  hover: HoverHandlers;
  onAdd: (spellId: string) => void;
}

export function SpellPicker({ data, lang, hover, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<SpellType | 'all'>('all');
  const [collapsed, setCollapsed] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const compactQ = q.replace(/\s+/g, '');
    return data.spells.filter((spell) => {
      if (q) {
        // search always covers every type; the type selector is cleared while searching
        if (
          spell.id.toLowerCase().includes(q) ||
          spell.nameEn.toLowerCase().includes(q) ||
          spell.nameZh.includes(q) ||
          spell.displayZh.includes(q)
        ) {
          return true;
        }
        return (ALIASES[spell.id] ?? []).some((alias) => {
          const lowered = alias.toLowerCase();
          return lowered.includes(q) || lowered.replace(/\s+/g, '').includes(compactQ);
        });
      }
      return typeFilter === 'all' || spell.type === typeFilter;
    });
  }, [data.spells, query, typeFilter]);

  // Search and type filtering are mutually exclusive: typing searches all types,
  // while choosing a type discards the current search.
  const changeQuery = (value: string) => {
    setQuery(value);
    if (value.trim()) setTypeFilter('all');
  };
  const changeType = (value: SpellType | 'all') => {
    setQuery('');
    setTypeFilter(value);
  };

  return (
    <section className="panel spell-picker">
      <header className="panel-header">
        <h2>
          <button
            type="button"
            className="section-toggle picker-toggle"
            aria-expanded={!collapsed}
            title={t(lang, collapsed ? 'picker.expand' : 'picker.collapse')}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '▸' : '▾'} {t(lang, 'picker.title')}
          </button>
        </h2>
        <span className="panel-sub">{t(lang, 'picker.hint')}</span>
      </header>
      {!collapsed && (
        <>
          <Toolbar
            lang={lang}
            query={query}
            typeFilter={typeFilter}
            shown={filtered.length}
            total={data.spells.length}
            onQueryChange={changeQuery}
            onTypeChange={changeType}
          />
          <div className="picker-grid">
            {filtered.map((spell) => (
              <SpellCard
                key={spell.id}
                spell={spell}
                data={data}
                lang={lang}
                variant="compact"
                hover={hover}
                onAdd={onAdd}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
