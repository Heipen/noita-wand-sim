import type { PointerEvent as ReactPointerEvent } from 'react';
import { spellIconUrl } from '../lib/icons';
import { spellTypeLabel, t } from '../lib/i18n';
import type { GameData, Lang, SpellMeta } from '../lib/types';

export interface HoverHandlers {
  show: (event: { currentTarget: HTMLElement }, spell: SpellMeta | undefined) => void;
  hide: () => void;
}

interface Props {
  spell: SpellMeta;
  data: GameData;
  lang: Lang;
  variant?: 'picker' | 'compact';
  draggable?: boolean;
  onAdd?: (spellId: string) => void;
  hover: HoverHandlers;
  onDragStart?: (event: React.DragEvent, spell: SpellMeta) => void;
}

export function SpellCard({ spell, data, lang, variant = 'picker', draggable = true, onAdd, hover, onDragStart }: Props) {
  const icon = spellIconUrl(data, spell);
  const title = lang === 'zh' ? spell.displayZh : spell.nameEn;
  const subtitle = lang === 'zh' ? spell.nameEn : spell.nameZh;

  return (
    <button
      type="button"
      className={`spell-card spell-card-${variant}`}
      data-spell-id={spell.id}
      draggable={draggable}
      onClick={() => onAdd?.(spell.id)}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-spell', spell.id);
        event.dataTransfer.setData('text/plain', spell.id);
        event.dataTransfer.effectAllowed = 'copy';
        onDragStart?.(event, spell);
      }}
      onPointerEnter={(event: ReactPointerEvent<HTMLButtonElement>) => hover.show(event, spell)}
      onPointerLeave={hover.hide}
      onFocus={(event) => hover.show(event, spell)}
      onBlur={hover.hide}
    >
      <span className="spell-icon">
        {icon ? <img src={icon} alt="" loading="lazy" /> : <span className="no-icon">{t(lang, 'spell.noSprite')}</span>}
      </span>
      <span className="spell-text">
        <span className="spell-title">{title}</span>
        <span className="spell-subtitle">{subtitle}</span>
        <span className="spell-meta">
          <span className="badge type">{spellTypeLabel(lang, spell.type)}</span>
          {spell.mana !== null && (
            <span className="badge mana">
              {t(lang, 'spell.mana')} {spell.mana}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
