import { useMemo } from 'react';
import type { CastBlock, EngineEvent, ProjectileNode, ShotResult, SimulationResult } from '../engine/types';
import { formatFramesAsSeconds, formatNumber } from '../lib/format';
import { spellIconUrl } from '../lib/icons';
import { t } from '../lib/i18n';
import type { GameData, Lang, SpellMeta } from '../lib/types';

interface Props {
  result: SimulationResult | null;
  data: GameData;
  lang: Lang;
  mode: 'single' | 'untilReload';
  onModeChange: (mode: 'single' | 'untilReload') => void;
  simulating: boolean;
  error: string | null;
}

function useEntityMap(data: GameData): Map<string, SpellMeta> {
  return useMemo(() => {
    const map = new Map<string, SpellMeta>();
    for (const spell of data.spells) {
      for (const entity of spell.relatedProjectiles) {
        if (!map.has(entity)) map.set(entity, spell);
      }
    }
    return map;
  }, [data.spells]);
}

function spellForEntity(entity: string, entityMap: Map<string, SpellMeta>): SpellMeta | undefined {
  return entityMap.get(entity);
}

function SpellIcon({ spell, data }: { spell?: SpellMeta; data: GameData }) {
  const icon = spell ? spellIconUrl(data, spell) : undefined;
  return icon ? <img className="mini-icon" src={icon} alt="" /> : <span className="mini-icon placeholder" />;
}

function triggerLabel(kind: ProjectileNode['triggerKind']): string {
  if (kind === 'timer') return 'result.triggerTimer';
  if (kind === 'death') return 'result.triggerDeath';
  return 'result.triggerHitWorld';
}

function ProjectileRows({
  block,
  depth,
  data,
  lang,
  entityMap,
}: {
  block: CastBlock;
  depth: number;
  data: GameData;
  lang: Lang;
  entityMap: Map<string, SpellMeta>;
}) {
  return (
    <>
      {block.projectiles.map((node, index) => {
        const spell = spellForEntity(node.entity, entityMap);
        return (
          <div className="proj-node" key={index} style={{ marginLeft: depth * 18 }}>
            <div className="proj-line">
              <SpellIcon spell={spell} data={data} />
              <span className="proj-name">{spell ? (lang === 'zh' ? spell.displayZh : spell.nameEn) : node.entity.split('/').pop()}</span>
              <span className="proj-file">{node.entity.split('/').pop()}</span>
            </div>
            {node.trigger && (
              <>
                <div className="trigger-label" style={{ marginLeft: 18 }}>
                  ↳ {t(lang, triggerLabel(node.triggerKind))}
                </div>
                <ProjectileRows block={node.trigger} depth={depth + 1} data={data} lang={lang} entityMap={entityMap} />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function countProjectiles(block: CastBlock): number {
  let total = 0;
  for (const node of block.projectiles) {
    total += 1;
    if (node.trigger) total += countProjectiles(node.trigger);
  }
  return total;
}

function Pile({ title, ids, data, lang }: { title: string; ids: string[]; data: GameData; lang: Lang }) {
  const spellById = useMemo(() => new Map(data.spells.map((spell) => [spell.id, spell])), [data.spells]);
  return (
    <div className="pile">
      <div className="pile-title">
        {title} <span className="pile-count">{ids.length}</span>
      </div>
      <div className="pile-items">
        {ids.length === 0 && <span className="muted small">{t(lang, 'result.empty')}</span>}
        {ids.map((id, index) => {
          const spell = spellById.get(id);
          return (
            <span className="pile-chip" key={`${id}-${index}`} title={id}>
              <SpellIcon spell={spell} data={data} />
              <span>{spell ? (lang === 'zh' ? spell.displayZh : spell.nameEn) : id}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function renderEvent(
  event: EngineEvent,
  shot: ShotResult,
  data: GameData,
  lang: Lang,
  entityMap: Map<string, SpellMeta>,
): { label: string; tone: string; spell?: SpellMeta } {
  switch (event.type) {
    case 'shotStart':
      return { tone: 'start', label: t(lang, 'event.shotStart', { mana: event.mana, frame: event.frame }) };
    case 'orderDeck':
      return event.shuffled
        ? { tone: 'shuffle', label: t(lang, 'event.shuffle', { frame: shot.frame }) }
        : { tone: 'deck', label: t(lang, 'event.orderDeck') };
    case 'draw':
      return event.ok === false
        ? { tone: 'fail', label: t(lang, 'event.drawFail') }
        : { tone: 'draw', label: t(lang, 'event.draw', { before: event.deckBefore, after: event.deckAfter }) };
    case 'action': {
      const spell = data.spells.find((item) => item.id === event.id);
      return {
        tone: 'action',
        label: t(lang, 'event.action', { name: spell ? (lang === 'zh' ? spell.displayZh : spell.nameEn) : event.id }),
        spell,
      };
    }
    case 'projectileBegin': {
      const spell = spellForEntity(event.entity, entityMap);
      return {
        tone: 'projectile',
        label: t(lang, 'event.projectile', {
          name: spell ? (lang === 'zh' ? spell.displayZh : spell.nameEn) : event.entity.split('/').pop() ?? event.entity,
        }),
        spell,
      };
    }
    case 'triggerBegin':
      return { tone: 'trigger', label: t(lang, 'event.trigger', { kind: t(lang, triggerLabel(event.kind)) }) };
    case 'triggerEnd':
      return { tone: 'trigger', label: t(lang, 'event.triggerEnd') };
    case 'notEnoughMana':
      return { tone: 'fail', label: t(lang, 'event.notEnoughMana') };
    case 'reload':
      return { tone: 'reload', label: t(lang, 'event.reload', { seconds: formatFramesAsSeconds(event.timeFrames) }) };
    case 'shotEnd':
      return {
        tone: 'end',
        label: t(lang, 'event.shotEnd', {
          delay: formatFramesAsSeconds(event.castDelayFrames),
          recharge: formatFramesAsSeconds(event.reloadFrames),
        }),
      };
    default:
      return { tone: 'other', label: (event as { type: string }).type };
  }
}

const STATE_ROWS: { key: string; format: 'seconds' | 'percent' | 'multiplier' | 'degrees' | 'number' }[] = [
  { key: 'fire_rate_wait', format: 'seconds' },
  { key: 'reload_time', format: 'seconds' },
  { key: 'damage_projectile_add', format: 'number' },
  { key: 'damage_explosion_add', format: 'number' },
  { key: 'damage_critical_chance', format: 'percent' },
  { key: 'spread_degrees', format: 'degrees' },
  { key: 'speed_multiplier', format: 'multiplier' },
  { key: 'lifetime_add', format: 'number' },
  { key: 'bounces', format: 'number' },
  { key: 'explosion_radius', format: 'number' },
];

function stateValue(key: string, format: (typeof STATE_ROWS)[number]['format'], value: number): string {
  switch (format) {
    case 'seconds':
      return formatFramesAsSeconds(value);
    case 'percent':
    case 'degrees':
      return formatNumber(value);
    case 'multiplier':
      return formatNumber(value);
    default:
      return formatNumber(value);
  }
}

function ShotCard({ shot, index, data, lang, entityMap }: { shot: ShotResult; index: number; data: GameData; lang: Lang; entityMap: Map<string, SpellMeta> }) {
  const projectiles = countProjectiles(shot.block);
  const stateRows = STATE_ROWS.map((row) => {
    const value = shot.castState[row.key];
    return typeof value === 'number' && value !== 0 ? { ...row, value } : null;
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <article className="shot-card" data-shot={index + 1}>
      <header className="shot-header">
        <h3>{t(lang, 'result.shotN', { n: index + 1 })}</h3>
        <span className="shot-stat">{t(lang, 'result.mana', { before: shot.manaBefore, after: shot.manaAfter })}</span>
        <span className="shot-stat">
          {t(lang, 'result.castDelay')} {formatFramesAsSeconds(shot.castDelayFrames)}s
        </span>
        <span className="shot-stat">
          {t(lang, 'result.recharge')} {formatFramesAsSeconds(shot.reloadFrames)}s
        </span>
        <span className="shot-stat">
          {t(lang, 'result.projectiles')} {projectiles}
        </span>
        {shot.reloaded && <span className="badge reloaded">{t(lang, 'result.reloaded')}</span>}
      </header>

      <div className="shot-columns">
        <section className="shot-tree">
          <h4>{t(lang, 'result.tree')}</h4>
          {projectiles === 0 ? (
            <p className="muted">{t(lang, 'result.noProjectiles')}</p>
          ) : (
            <ProjectileRows block={shot.block} depth={0} data={data} lang={lang} entityMap={entityMap} />
          )}
        </section>
        <section className="piles">
          <h4>{t(lang, 'result.piles')}</h4>
          <Pile title={t(lang, 'result.pileDeck')} ids={shot.deck} data={data} lang={lang} />
          <Pile title={t(lang, 'result.pileHand')} ids={shot.hand} data={data} lang={lang} />
          <Pile title={t(lang, 'result.pileDiscard')} ids={shot.discarded} data={data} lang={lang} />
        </section>
      </div>

      <details className="shot-details">
        <summary>{t(lang, 'result.events')}</summary>
        <ol className="event-list">
          {shot.events.map((event, eventIndex) => {
            const rendered = renderEvent(event, shot, data, lang, entityMap);
            return (
              <li key={eventIndex} className={`event event-${rendered.tone}`}>
                {rendered.spell && <SpellIcon spell={rendered.spell} data={data} />}
                <span>{rendered.label}</span>
              </li>
            );
          })}
        </ol>
      </details>

      {stateRows.length > 0 && (
        <details className="shot-details">
          <summary>{t(lang, 'result.stateTitle')}</summary>
          <ul className="state-list">
            {stateRows.map((row) => (
              <li key={row.key}>
                {t(lang, `state.${row.key}`, { value: stateValue(row.key, row.format, row.value) })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export function CastResult({ result, data, lang, mode, onModeChange, simulating, error }: Props) {
  const entityMap = useEntityMap(data);

  return (
    <section className="panel cast-result">
      <header className="panel-header">
        <h2>{t(lang, 'result.title')}</h2>
        <div className="mode-switch">
          {(['single', 'untilReload'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`mode-btn${mode === value ? ' active' : ''}`}
              onClick={() => onModeChange(value)}
            >
              {t(lang, value === 'single' ? 'result.modeSingle' : 'result.modeUntilReload')}
            </button>
          ))}
        </div>
        {simulating && <span className="simulating">{t(lang, 'result.simulating')}</span>}
      </header>

      {error && <div className="error">{t(lang, 'result.error', { message: error })}</div>}

      {!result && !error && <p className="muted">{t(lang, 'result.emptyHint')}</p>}

      {result && (
        <div className="shot-list">
          {result.shots.map((shot, index) => (
            <ShotCard key={index} shot={shot} index={index} data={data} lang={lang} entityMap={entityMap} />
          ))}
        </div>
      )}
    </section>
  );
}
