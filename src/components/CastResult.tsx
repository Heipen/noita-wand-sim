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

function useSpellMaps(data: GameData) {
  return useMemo(() => {
    const byId = new Map(data.spells.map((spell) => [spell.id, spell]));
    const byEntity = new Map<string, SpellMeta>();
    for (const spell of data.spells) {
      for (const entity of spell.relatedProjectiles) {
        if (!byEntity.has(entity)) byEntity.set(entity, spell);
      }
    }
    return { byId, byEntity };
  }, [data.spells]);
}

function spellName(spell: SpellMeta | undefined, fallback: string, lang: Lang): string {
  if (!spell) return fallback;
  return lang === 'zh' ? spell.displayZh : spell.nameEn;
}

function entityLabel(entity: string): string {
  return entity.split('/').pop() ?? entity;
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

/** Recursive cast-block view: called spells (modifiers, multicasts, projectiles) + projectiles. */
function BlockView({
  block,
  depth,
  data,
  lang,
  byId,
  byEntity,
  triggerKind,
}: {
  block: CastBlock;
  depth: number;
  data: GameData;
  lang: Lang;
  byId: Map<string, SpellMeta>;
  byEntity: Map<string, SpellMeta>;
  triggerKind?: ProjectileNode['triggerKind'];
}) {
  const actions = block.actions.map((action) => ({ ...action, spell: byId.get(action.id) }));
  const modifiers = actions.filter((action) => action.spell?.type === 'modifier');
  const empty = block.actions.length === 0 && block.projectiles.length === 0;

  return (
    <div className={`cast-block${depth > 0 ? ' nested' : ''}`}>
      {depth > 0 && (
        <div className="block-label">
          ↳ {t(lang, 'result.payload')}
          {triggerKind ? `（${t(lang, triggerLabel(triggerKind))}）` : ''}
        </div>
      )}

      {actions.length > 0 && (
        <div className="block-actions">
          {actions.map((action, index) => (
            <span
              key={`${action.id}-${index}`}
              className={`action-chip type-${action.spell?.type ?? 'unknown'}`}
              title={action.id}
            >
              <SpellIcon spell={action.spell} data={data} />
              <span className="chip-name">{spellName(action.spell, action.id, lang)}</span>
              {action.deckIndex !== null && <span className="chip-slot">#{action.deckIndex + 1}</span>}
            </span>
          ))}
        </div>
      )}

      {modifiers.length > 0 && (
        <div className="block-mods">
          {t(lang, 'result.modifiers')}：{modifiers.map((action) => spellName(action.spell, action.id, lang)).join('、')}
        </div>
      )}

      {block.projectiles.length > 0 && (
        <div className="block-projectiles">
          {block.projectiles.map((projectile, index) => {
            const spell = byEntity.get(projectile.entity);
            return (
              <div className="proj-card" key={`${projectile.entity}-${index}`}>
                <div className="proj-line">
                  <SpellIcon spell={spell} data={data} />
                  <span className="proj-name">{spellName(spell, entityLabel(projectile.entity), lang)}</span>
                  <span className="proj-file">{entityLabel(projectile.entity)}</span>
                  {projectile.trigger && (
                    <span className="trigger-badge">
                      {t(lang, triggerLabel(projectile.triggerKind))}
                    </span>
                  )}
                </div>
                {projectile.trigger && (
                  <BlockView
                    block={projectile.trigger}
                    depth={depth + 1}
                    data={data}
                    lang={lang}
                    byId={byId}
                    byEntity={byEntity}
                    triggerKind={projectile.triggerKind}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {empty && <div className="muted small">—</div>}
    </div>
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

function Pile({ title, ids, data, lang, byId }: { title: string; ids: string[]; data: GameData; lang: Lang; byId: Map<string, SpellMeta> }) {
  return (
    <div className="pile">
      <div className="pile-title">
        {title} <span className="pile-count">{ids.length}</span>
      </div>
      <div className="pile-items">
        {ids.length === 0 && <span className="muted small">{t(lang, 'result.empty')}</span>}
        {ids.map((id, index) => {
          const spell = byId.get(id);
          return (
            <span className="pile-chip" key={`${id}-${index}`} title={id}>
              <SpellIcon spell={spell} data={data} />
              <span>{spellName(spell, id, lang)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// --- human readable cast steps ----------------------------------------------

interface Step {
  depth: number;
  tone: string;
  text: string;
  spell?: SpellMeta;
  deltas: string[];
}

const DELTA_FORMATS: Record<string, { label: string; kind: 'seconds' | 'number' | 'percent' | 'degrees' | 'multiplier' }> = {
  fire_rate_wait: { label: 'delta.castDelay', kind: 'seconds' },
  reload_time: { label: 'delta.recharge', kind: 'seconds' },
  damage_projectile_add: { label: 'delta.damageProjectile', kind: 'number' },
  damage_explosion_add: { label: 'delta.damageExplosion', kind: 'number' },
  damage_critical_chance: { label: 'delta.critChance', kind: 'percent' },
  spread_degrees: { label: 'delta.spread', kind: 'degrees' },
  speed_multiplier: { label: 'delta.speed', kind: 'multiplier' },
  lifetime_add: { label: 'delta.lifetime', kind: 'number' },
  bounces: { label: 'delta.bounces', kind: 'number' },
  explosion_radius: { label: 'delta.explosionRadius', kind: 'number' },
  screenshake: { label: 'delta.screenshake', kind: 'number' },
  recoil: { label: 'delta.recoil', kind: 'number' },
};

function signed(value: string): string {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  return numeric > 0 ? `+${value}` : value;
}

function formatDeltas(delta: Record<string, number> | undefined, lang: Lang): string[] {
  if (!delta) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(delta)) {
    const format = DELTA_FORMATS[key];
    if (!format || value === 0) continue;
    let rendered: string;
    switch (format.kind) {
      case 'seconds':
        rendered = `${signed(formatFramesAsSeconds(value))}s`;
        break;
      case 'percent':
        rendered = `${signed(formatNumber(value))}%`;
        break;
      case 'degrees':
        rendered = `${signed(formatNumber(value))}°`;
        break;
      case 'multiplier':
        rendered = `${signed(formatNumber(value))}×`;
        break;
      default:
        rendered = signed(formatNumber(value));
    }
    out.push(t(lang, format.label, { value: rendered }));
  }
  return out.slice(0, 4);
}

function buildSteps(shot: ShotResult, lang: Lang, byId: Map<string, SpellMeta>, byEntity: Map<string, SpellMeta>): Step[] {
  const steps: Step[] = [];
  let depth = 0;
  let lastProjectile = '';
  let draws = 0;
  let calls = 0;

  for (const event of shot.events as EngineEvent[]) {
    switch (event.type) {
      case 'shotStart':
        steps.push({
          depth: 0,
          tone: 'start',
          text: t(lang, 'event.shotStart', { mana: event.mana, frame: event.frame }),
          deltas: [],
        });
        break;
      case 'orderDeck':
        steps.push({
          depth: 0,
          tone: 'deck',
          text: event.shuffled ? t(lang, 'event.shuffle', { frame: shot.frame }) : t(lang, 'event.orderDeck'),
          deltas: [],
        });
        break;
      case 'draw':
        if (event.ok === false) {
          steps.push({ depth, tone: 'fail', text: t(lang, 'event.drawFail'), deltas: [] });
        } else {
          draws += 1;
        }
        break;
      case 'action': {
        calls += 1;
        const spell = byId.get(event.id);
        steps.push({
          depth,
          tone: 'action',
          text: t(lang, 'event.action', { name: spellName(spell, event.id, lang) }),
          spell,
          deltas: formatDeltas(event.delta, lang),
        });
        break;
      }
      case 'projectileBegin': {
        const spell = byEntity.get(event.entity);
        lastProjectile = spellName(spell, entityLabel(event.entity), lang);
        steps.push({
          depth,
          tone: 'projectile',
          text: t(lang, 'event.projectile', { name: lastProjectile }),
          spell,
          deltas: [],
        });
        break;
      }
      case 'triggerBegin':
        steps.push({
          depth,
          tone: 'trigger',
          text: t(lang, 'step.trigger', {
            name: lastProjectile,
            kind: t(lang, triggerLabel(event.kind)),
          }),
          deltas: [],
        });
        depth += 1;
        break;
      case 'triggerEnd':
        depth = Math.max(0, depth - 1);
        steps.push({ depth, tone: 'trigger', text: t(lang, 'step.triggerEnd'), deltas: [] });
        break;
      case 'reload':
        steps.push({
          depth: 0,
          tone: 'reload',
          text: t(lang, 'event.reload', { seconds: formatFramesAsSeconds(event.timeFrames) }),
          deltas: [],
        });
        break;
      case 'shotEnd':
        steps.push({
          depth: 0,
          tone: 'end',
          text: t(lang, 'event.shotEnd', {
            delay: formatFramesAsSeconds(event.castDelayFrames),
            recharge: formatFramesAsSeconds(event.reloadFrames),
          }),
          deltas: [],
        });
        break;
      case 'notEnoughMana':
        break;
      default:
        break;
    }
  }
  return [{ depth: 0, tone: 'summary', text: t(lang, 'step.summary', { draws, calls }), deltas: [] }, ...steps];
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

function stateValue(format: (typeof STATE_ROWS)[number]['format'], value: number): string {
  switch (format) {
    case 'seconds':
      return formatFramesAsSeconds(value);
    case 'percent':
    case 'degrees':
    case 'multiplier':
      return formatNumber(value);
    default:
      return formatNumber(value);
  }
}

function ShotCard({ shot, index, data, lang }: { shot: ShotResult; index: number; data: GameData; lang: Lang }) {
  const { byId, byEntity } = useSpellMaps(data);
  const projectiles = countProjectiles(shot.block);
  const steps = useMemo(() => buildSteps(shot, lang, byId, byEntity), [shot, lang, byId, byEntity]);
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
          {projectiles === 0 && shot.block.actions.length === 0 ? (
            <p className="muted">{t(lang, 'result.noProjectiles')}</p>
          ) : (
            <BlockView block={shot.block} depth={0} data={data} lang={lang} byId={byId} byEntity={byEntity} />
          )}
        </section>
        <section className="piles">
          <h4>{t(lang, 'result.piles')}</h4>
          <Pile title={t(lang, 'result.pileDeck')} ids={shot.deck} data={data} lang={lang} byId={byId} />
          <Pile title={t(lang, 'result.pileHand')} ids={shot.hand} data={data} lang={lang} byId={byId} />
          <Pile title={t(lang, 'result.pileDiscard')} ids={shot.discarded} data={data} lang={lang} byId={byId} />
        </section>
      </div>

      <section className="shot-steps">
        <h4>{t(lang, 'result.steps')}</h4>
        <ol className="step-list">
          {steps.map((step, stepIndex) => (
            <li
              key={stepIndex}
              className={`step step-${step.tone}`}
              style={{ marginLeft: step.depth * 18 }}
            >
              {step.spell && <SpellIcon spell={step.spell} data={data} />}
              <span className="step-text">{step.text}</span>
              {step.deltas.length > 0 && (
                <span className="step-deltas">
                  {step.deltas.map((delta, deltaIndex) => (
                    <span className="step-delta" key={deltaIndex}>
                      {delta}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <details className="shot-details">
        <summary>{t(lang, 'result.rawEvents')}</summary>
        <ol className="event-list">
          {shot.events.map((event, eventIndex) => (
            <li key={eventIndex} className={`event event-${event.type}`}>
              {JSON.stringify(event)}
            </li>
          ))}
        </ol>
      </details>

      {stateRows.length > 0 && (
        <details className="shot-details">
          <summary>{t(lang, 'result.stateTitle')}</summary>
          <ul className="state-list">
            {stateRows.map((row) => (
              <li key={row.key}>{t(lang, `state.${row.key}`, { value: stateValue(row.format, row.value) })}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

export function CastResult({ result, data, lang, mode, onModeChange, simulating, error }: Props) {
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
            <ShotCard key={index} shot={shot} index={index} data={data} lang={lang} />
          ))}
        </div>
      )}
    </section>
  );
}
