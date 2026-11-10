import { useLayoutEffect, useRef, useState } from 'react';
import { formatFramesAsSeconds } from '../lib/format';
import { spellIconUrl } from '../lib/icons';
import { spellTypeLabel, t } from '../lib/i18n';
import type { GameData, Lang } from '../lib/types';
import type { TooltipState } from '../hooks/useSpellTooltip';

interface Props {
  tooltip: TooltipState | null;
  data: GameData;
  lang: Lang;
}

/** In-game style spell tooltip (shown when hovering a spell for ~400 ms). */
export function SpellTooltip({ tooltip, data, lang }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!tooltip || !ref.current) {
      setPosition(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const margin = 8;
    let left = tooltip.x;
    let top = tooltip.y;
    if (left + rect.width > window.innerWidth - margin) left = tooltip.x - rect.width - 20;
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    setPosition({ left: Math.max(margin, left), top: Math.max(margin, top) });
  }, [tooltip]);

  if (!tooltip) return null;
  const { spell } = tooltip;
  const icon = spellIconUrl(data, spell);
  const name = lang === 'zh' ? spell.displayZh : spell.nameEn;
  const second = lang === 'zh' ? spell.nameEn : spell.nameZh;
  const desc = lang === 'zh' ? spell.descZh || spell.descEn : spell.descEn;

  const rows: { label: string; value: string }[] = [
    { label: t(lang, 'tooltip.type'), value: spellTypeLabel(lang, spell.type) },
    { label: t(lang, 'tooltip.mana'), value: spell.mana === null ? '—' : String(spell.mana) },
  ];
  if (spell.maxUses !== null && spell.maxUses > 0) {
    rows.push({ label: t(lang, 'tooltip.uses'), value: String(spell.maxUses) });
  }
  if (spell.castDelayFrames !== 0) {
    rows.push({
      label: t(lang, 'tooltip.castDelay'),
      value: formatFramesAsSeconds(spell.castDelayFrames),
    });
  }
  if (spell.reloadFrames !== 0) {
    rows.push({
      label: t(lang, 'tooltip.recharge'),
      value: formatFramesAsSeconds(spell.reloadFrames),
    });
  }

  const extraRows: { label: string; value: string }[] = [];
  if (lang === 'zh' && spell.unlockZh) {
    extraRows.push({ label: t(lang, 'tooltip.unlock'), value: spell.unlockZh });
  } else if (spell.spawnRequiresFlag && !spell.unlockZh) {
    extraRows.push({ label: t(lang, 'tooltip.unlock'), value: spell.spawnRequiresFlag });
  }
  const levels = (spell.spawnLevel ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const probabilities = (spell.spawnProbability ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const tiers = levels.map((level, index) => ({
    level,
    probability: probabilities[index] ?? '—',
    key: `${level}-${index}`,
  }));

  return (
    <div
      ref={ref}
      className="spell-tooltip"
      role="tooltip"
      style={{
        left: position?.left ?? tooltip.x,
        top: position?.top ?? tooltip.y,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <div className="tt-header">
        <div className="tt-names">
          <div className="tt-name">{name}</div>
          <div className="tt-sub">{second}</div>
        </div>
        {icon && <img className="tt-icon" src={icon} alt="" />}
      </div>
      {desc && <p className="tt-desc">{desc}</p>}
      <dl className="tt-rows">
        {rows.map((row) => (
          <div className="tt-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {extraRows.length > 0 && (
        <dl className="tt-rows tt-extra">
          {extraRows.map((row) => (
            <div className="tt-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {tiers.length > 0 && (
        <table className="tt-tier-table">
          <tbody>
            <tr>
              <th>{t(lang, 'tooltip.spawnLevel')}</th>
              {levels.map((level, index) => (
                <td key={`level-${index}`}>{level}</td>
              ))}
            </tr>
            <tr>
              <th>{t(lang, 'tooltip.spawnProbability')}</th>
              {levels.map((_, index) => (
                <td key={`weight-${index}`}>{probabilities[index] ?? '—'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      {lang === 'zh' && spell.aliasNoteZh && <div className="tt-note">{spell.aliasNoteZh}</div>}
    </div>
  );
}
