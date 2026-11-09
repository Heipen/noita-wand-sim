import { useMemo, useState } from 'react';
import { t } from '../lib/i18n';
import type { GameData, Lang, SpellType } from '../lib/types';
import { Toolbar } from './Toolbar';
import { SpellCard, type HoverHandlers } from './SpellCard';

interface Props {
  data: GameData;
  lang: Lang;
  hover: HoverHandlers;
  onAdd: (spellId: string) => void;
}

export function SpellPicker({ data, lang, hover, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<SpellType | 'all'>('all');

  const filtered = useMemo(() => {
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
  }, [data.spells, query, typeFilter]);

  return (
    <section className="panel spell-picker">
      <header className="panel-header">
        <h2>{t(lang, 'picker.title')}</h2>
        <span className="panel-sub">{t(lang, 'picker.hint')}</span>
      </header>
      <Toolbar
        lang={lang}
        query={query}
        typeFilter={typeFilter}
        shown={filtered.length}
        total={data.spells.length}
        onQueryChange={setQuery}
        onTypeChange={setTypeFilter}
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
    </section>
  );
}
