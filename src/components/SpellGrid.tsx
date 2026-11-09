import { spellIconUrl } from '../lib/icons';
import { spellTypeLabel, t } from '../lib/i18n';
import type { Lang, SpellMeta, WakArchive } from '../lib/types';

interface Props {
  spells: SpellMeta[];
  wak: WakArchive;
  lang: Lang;
}

function SpellCard({ spell, wak, lang }: { spell: SpellMeta; wak: WakArchive; lang: Lang }) {
  const icon = spellIconUrl(wak, spell.sprite);
  const title = lang === 'zh' ? spell.displayZh : spell.nameEn;
  const subtitle = lang === 'zh' ? spell.nameEn : spell.nameZh;
  const tooltip = [
    spell.id,
    lang === 'zh' ? spell.descZh || spell.descEn : spell.descEn,
    spell.aliasNoteZh,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <article className="spell-card" title={tooltip}>
      <div className="spell-icon">
        {icon ? <img src={icon} alt="" loading="lazy" /> : <span className="no-icon">{t(lang, 'spell.noSprite')}</span>}
      </div>
      <div className="spell-text">
        <div className="spell-title">{title}</div>
        <div className="spell-subtitle">
          {subtitle}
          {lang === 'zh' && spell.aliasNoteZh ? <span className="alias-note"> · {spell.aliasNoteZh}</span> : null}
        </div>
        <div className="spell-meta">
          <span className="badge type">{spellTypeLabel(lang, spell.type)}</span>
          {spell.mana !== null && (
            <span className="badge mana">
              {t(lang, 'spell.mana')} {spell.mana}
            </span>
          )}
          {spell.maxUses !== null && (
            <span className="badge uses">
              {t(lang, 'spell.uses')} {spell.maxUses < 0 ? t(lang, 'spell.infinite') : spell.maxUses}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function SpellGrid({ spells, wak, lang }: Props) {
  if (spells.length === 0) {
    return <div className="empty-grid">…</div>;
  }
  return (
    <section className="spell-grid">
      {spells.map((spell) => (
        <SpellCard key={spell.id} spell={spell} wak={wak} lang={lang} />
      ))}
    </section>
  );
}
