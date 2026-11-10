import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DAMAGE_DISPLAY_SCALE, formatFramesAsSeconds, formatNumber } from '../lib/format';
import { spellIconUrl } from '../lib/icons';
import { spellTypeLabel, t } from '../lib/i18n';
import type { GameData, Lang, SpellMeta } from '../lib/types';
import { wakText } from '../lib/wak';
import type { TooltipState } from '../hooks/useSpellTooltip';

interface Props {
  tooltip: TooltipState | null;
  data: GameData;
  lang: Lang;
}

interface ProjectileStats {
  damage: number | null;
  explosionDamage: number | null;
  lifetime: number | null;
  speedMin: number | null;
  speedMax: number | null;
}

const projectileStatsCache = new Map<string, ProjectileStats | null>();

function xmlAttribute(tag: string | undefined, name: string): string | null {
  if (!tag) return null;
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : null;
}

async function readEntityXml(data: GameData, path: string): Promise<string | null> {
  if (data.origin === 'local' && data.wak) return wakText(data.wak, path) ?? null;
  try {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}data/game/${path.replace(/^data\//, '')}`);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function parseProjectileStats(xml: string): ProjectileStats {
  const component = xml.match(/<ProjectileComponent\b[^>]*>/i)?.[0];
  const explosion = xml.match(/<config_explosion\b[^>]*>/i)?.[0];
  const number = (value: string | null) => {
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    damage: number(xmlAttribute(component, 'damage')),
    explosionDamage: number(xmlAttribute(explosion, 'damage')),
    lifetime: number(xmlAttribute(component, 'lifetime')),
    speedMin: number(xmlAttribute(component, 'speed_min')),
    speedMax: number(xmlAttribute(component, 'speed_max')),
  };
}

async function loadProjectileStats(data: GameData, spell: SpellMeta): Promise<ProjectileStats | null> {
  const path = spell.relatedProjectiles?.[0];
  if (!path) return null;
  const key = `${data.signature}|${path}`;
  if (projectileStatsCache.has(key)) return projectileStatsCache.get(key) ?? null;
  const xml = await readEntityXml(data, path);
  const stats = xml ? parseProjectileStats(xml) : null;
  projectileStatsCache.set(key, stats);
  return stats;
}

const EFFECT_FIELDS: { key: string; label: string; kind: 'damage' | 'percent' | 'degrees' | 'multiplier' | 'number' | 'seconds' }[] = [
  { key: 'damage_projectile_add', label: 'effect.damageProjectile', kind: 'damage' },
  { key: 'damage_explosion_add', label: 'effect.damageExplosion', kind: 'damage' },
  { key: 'damage_critical_chance', label: 'effect.critChance', kind: 'percent' },
  { key: 'spread_degrees', label: 'effect.spread', kind: 'degrees' },
  { key: 'speed_multiplier', label: 'effect.speed', kind: 'multiplier' },
  { key: 'lifetime_add', label: 'effect.lifetime', kind: 'number' },
  { key: 'bounces', label: 'effect.bounces', kind: 'number' },
  { key: 'explosion_radius', label: 'effect.explosionRadius', kind: 'number' },
  { key: 'fire_rate_wait', label: 'effect.castDelay', kind: 'seconds' },
  { key: 'reload_time', label: 'effect.recharge', kind: 'seconds' },
  { key: 'action_draw_many_count', label: 'effect.draw', kind: 'number' },
];

function effectValue(kind: (typeof EFFECT_FIELDS)[number]['kind'], raw: number): string {
  switch (kind) {
    case 'damage':
      return `${raw > 0 ? '+' : ''}${formatNumber(raw * DAMAGE_DISPLAY_SCALE)}`;
    case 'percent':
      return `${raw > 0 ? '+' : ''}${formatNumber(raw)}%`;
    case 'degrees':
      return `${raw > 0 ? '+' : ''}${formatNumber(raw)}°`;
    case 'multiplier':
      return `${raw > 0 ? '+' : ''}${formatNumber(raw)}×`;
    case 'seconds':
      return `${raw > 0 ? '+' : ''}${formatFramesAsSeconds(raw)}s`;
    default:
      return `${raw > 0 ? '+' : ''}${formatNumber(raw)}`;
  }
}

/** In-game style spell tooltip (shown when hovering a spell for ~400 ms). */
export function SpellTooltip({ tooltip, data, lang }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [projectileStats, setProjectileStats] = useState<ProjectileStats | null>(null);
  const tooltipSpell = tooltip?.spell;

  useEffect(() => {
    let alive = true;
    setProjectileStats(null);
    if (!tooltipSpell) return;
    void loadProjectileStats(data, tooltipSpell).then((stats) => {
      if (alive) setProjectileStats(stats);
    });
    return () => {
      alive = false;
    };
  }, [tooltipSpell, data]);

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
  }, [tooltip, projectileStats]);

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
  if (projectileStats?.damage !== null && projectileStats?.damage !== undefined) {
    rows.push({
      label: t(lang, 'tooltip.damage'),
      value: formatNumber(projectileStats.damage * DAMAGE_DISPLAY_SCALE),
    });
  }
  if (projectileStats?.explosionDamage !== null && projectileStats?.explosionDamage !== undefined && projectileStats.explosionDamage > 0) {
    rows.push({
      label: t(lang, 'tooltip.explosionDamage'),
      value: formatNumber(projectileStats.explosionDamage * DAMAGE_DISPLAY_SCALE),
    });
  }
  if (projectileStats?.speedMin !== null && projectileStats?.speedMin !== undefined) {
    const max = projectileStats.speedMax ?? projectileStats.speedMin;
    rows.push({
      label: t(lang, 'tooltip.speed'),
      value: max === projectileStats.speedMin ? formatNumber(projectileStats.speedMin) : `${formatNumber(projectileStats.speedMin)}–${formatNumber(max)}`,
    });
  }
  if (projectileStats?.lifetime !== null && projectileStats?.lifetime !== undefined) {
    rows.push({
      label: t(lang, 'tooltip.lifetime'),
      value: `${formatFramesAsSeconds(projectileStats.lifetime)}s`,
    });
  }

  const effectRows = EFFECT_FIELDS.flatMap(({ key, label, kind }) => {
    const raw = spell.stateDelta[key];
    if (typeof raw !== 'number' || raw === 0) return [];
    const value = effectValue(kind, raw);
    return [{ label: t(lang, label), value }];
  });

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
      {effectRows.length > 0 && (
        <>
          <div className="tt-section-title">{t(lang, 'tooltip.effects')}</div>
          <dl className="tt-rows tt-extra">
            {effectRows.map((row) => (
              <div className="tt-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
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
