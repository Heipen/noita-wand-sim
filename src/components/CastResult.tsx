import { useMemo } from 'react';
import type { CastTreeNode, EngineEvent, ShotResult, SimulationResult } from '../engine/types';
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

interface SpellMaps {
  byId: Map<string, SpellMeta>;
  byEntity: Map<string, SpellMeta>;
}

function useSpellMaps(data: GameData): SpellMaps {
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

function triggerLabel(kind: 'timer' | 'hitWorld' | 'death'): string {
  if (kind === 'timer') return 'result.triggerTimer';
  if (kind === 'death') return 'result.triggerDeath';
  return 'result.triggerHitWorld';
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

// --- tree view ---------------------------------------------------------------

const INDENT = 14;

function TreeNodeView({
  node,
  depth,
  data,
  lang,
  maps,
}: {
  node: CastTreeNode;
  depth: number;
  data: GameData;
  lang: Lang;
  maps: SpellMaps;
}) {
  const children = (extraDepth = 1) =>
    node.children.map((child, index) => (
      <TreeNodeView key={index} node={child} depth={depth + extraDepth} data={data} lang={lang} maps={maps} />
    ));

  switch (node.kind) {
    case 'cast':
      return <>{children(0)}</>;
    case 'drawBlock':
      return (
        <div className="tree-node tree-drawblock" style={{ marginLeft: depth * INDENT }}>
          <div className="tree-line">
            <span className="tree-tag">抽取</span>
            <span>
              {node.count === 1 ? t(lang, 'tree.drawBlockOne') : t(lang, 'tree.drawBlock', { count: node.count })}
            </span>
          </div>
          {children()}
        </div>
      );
    case 'drawCard': {
      const spell = node.spellId ? maps.byId.get(node.spellId) : undefined;
      const name = spell ? spellName(spell, node.spellId ?? '', lang) : '';
      const failed = node.ok === false;
      return (
        <div className="tree-node tree-drawcard" style={{ marginLeft: depth * INDENT }}>
          <div className="tree-line">
            <SpellIcon spell={spell} data={data} />
            {node.spellId ? (
              <span className={failed ? 'tree-failed' : ''}>
                {failed
                  ? t(lang, 'tree.drawCardFailed', { name })
                  : t(lang, 'tree.drawCard', { name })}
              </span>
            ) : (
              <span className="tree-failed">{t(lang, 'tree.drawCardEmpty')}</span>
            )}
          </div>
          {children()}
        </div>
      );
    }
    case 'action': {
      const spell = maps.byId.get(node.id);
      const name = spellName(spell, node.id, lang);
      const deltas = formatDeltas(node.delta, lang);
      const directCall = node.deckIndex === null && !node.permanent;
      return (
        <div className="tree-node tree-action" style={{ marginLeft: depth * INDENT }}>
          <div className="tree-line">
            <SpellIcon spell={spell} data={data} />
            <span className="tree-action-name">
              {directCall ? t(lang, 'tree.actionCall', { name }) : t(lang, 'tree.action', { name })}
            </span>
            {spell && <span className={`tree-type type-${spell.type}`}>{t(lang, `type.${spell.type}`)}</span>}
            {node.deckIndex !== null && <span className="tree-slot">#{node.deckIndex + 1}</span>}
            {node.dontDraw && <span className="tree-badge warn">{t(lang, 'tree.dontDraw')}</span>}
            {node.permanent && <span className="tree-badge">{t(lang, 'tree.permanent')}</span>}
            {node.recursion !== null && <span className="tree-badge">{t(lang, 'tree.recursion', { n: node.recursion })}</span>}
            {node.iteration !== null && <span className="tree-badge">{t(lang, 'tree.iteration', { n: node.iteration })}</span>}
          </div>
          {deltas.length > 0 && (
            <div className="tree-deltas" style={{ marginLeft: 24 }}>
              {deltas.map((delta, index) => (
                <span className="tree-delta" key={index}>
                  {delta}
                </span>
              ))}
            </div>
          )}
          {node.projectiles.length > 0 && (
            <div className="tree-projectiles" style={{ marginLeft: 24 }}>
              {node.projectiles.map((entity, index) => {
                const projectileSpell = maps.byEntity.get(entity);
                return (
                  <span className="tree-projectile" key={index}>
                    <SpellIcon spell={projectileSpell} data={data} />
                    {t(lang, 'tree.projectile', {
                      name: spellName(projectileSpell, entityLabel(entity), lang),
                    })}
                  </span>
                );
              })}
            </div>
          )}
          {children()}
        </div>
      );
    }
    case 'trigger': {
      const projectileSpell = node.projectile ? maps.byEntity.get(node.projectile) : undefined;
      return (
        <div className="tree-node tree-trigger" style={{ marginLeft: depth * INDENT }}>
          <div className="tree-line">
            <span className="tree-tag trigger">{t(lang, triggerLabel(node.triggerKind))}</span>
            <span>
              {t(lang, 'tree.trigger', {
                name: spellName(projectileSpell, node.projectile ? entityLabel(node.projectile) : '?', lang),
                kind: t(lang, triggerLabel(node.triggerKind)),
              })}
            </span>
          </div>
          {children()}
        </div>
      );
    }
    default:
      return null;
  }
}

// --- narrative ----------------------------------------------------------------

interface StoryStep {
  depth: number;
  tone: string;
  text: string;
  spell?: SpellMeta;
  deltas: string[];
}

function buildStory(tree: CastTreeNode, lang: Lang, maps: SpellMaps): StoryStep[] {
  const steps: StoryStep[] = [];

  const walk = (node: CastTreeNode, depth: number, context: { parentAction?: string; inTrigger?: boolean }): void => {
    switch (node.kind) {
      case 'cast':
        node.children.forEach((child) => walk(child, 0, context));
        return;
      case 'drawBlock': {
        let text: string;
        if (context.inTrigger) text = t(lang, 'tree.storyPayload', { count: node.count });
        else if (context.parentAction) text = t(lang, 'tree.storyDrawByAction', { name: context.parentAction, count: node.count });
        else text = node.count === 1 ? t(lang, 'tree.storyDrawOne') : t(lang, 'tree.storyDraw', { count: node.count });
        steps.push({ depth, tone: 'draw', text, deltas: [] });
        node.children.forEach((child) => walk(child, depth + 1, { ...context, parentAction: undefined, inTrigger: undefined }));
        return;
      }
      case 'drawCard': {
        const spell = node.spellId ? maps.byId.get(node.spellId) : undefined;
        const name = spell ? spellName(spell, node.spellId ?? '', lang) : '';
        if (node.ok === false) {
          steps.push({ depth, tone: 'fail', text: t(lang, 'tree.storyCardFailed', { name }), spell, deltas: [] });
        } else if (node.spellId) {
          steps.push({ depth, tone: 'draw', text: t(lang, 'tree.storyCard', { name }), spell, deltas: [] });
        } else {
          steps.push({ depth, tone: 'fail', text: t(lang, 'tree.storyCardEmpty'), deltas: [] });
        }
        node.children.forEach((child) => walk(child, depth + 1, context));
        return;
      }
      case 'action': {
        const spell = maps.byId.get(node.id);
        const name = spellName(spell, node.id, lang);
        const direct = node.deckIndex === null && !node.permanent;
        let text = direct ? t(lang, 'tree.storyCall', { name }) : t(lang, 'tree.storyAction', { name });
        if (node.dontDraw) text += `（${t(lang, 'tree.dontDraw')}）`;
        if (node.permanent) text += `（${t(lang, 'tree.permanent')}）`;
        if (node.recursion !== null) text += ` ${t(lang, 'tree.recursion', { n: node.recursion })}`;
        if (node.iteration !== null) text += ` ${t(lang, 'tree.iteration', { n: node.iteration })}`;
        steps.push({
          depth,
          tone: direct ? 'call' : 'action',
          text,
          spell,
          deltas: formatDeltas(node.delta, lang),
        });
        for (const entity of node.projectiles) {
          const projectileSpell = maps.byEntity.get(entity);
          steps.push({
            depth: depth + 1,
            tone: 'projectile',
            text: t(lang, 'tree.storyProjectile', {
              name: spellName(projectileSpell, entityLabel(entity), lang),
            }),
            spell: projectileSpell,
            deltas: [],
          });
        }
        node.children.forEach((child) => walk(child, depth + 1, { parentAction: name }));
        return;
      }
      case 'trigger': {
        const projectileSpell = node.projectile ? maps.byEntity.get(node.projectile) : undefined;
        steps.push({
          depth,
          tone: 'trigger',
          text: t(lang, 'tree.storyTrigger', {
            name: spellName(projectileSpell, node.projectile ? entityLabel(node.projectile) : '?', lang),
            kind: t(lang, triggerLabel(node.triggerKind)),
          }),
          deltas: [],
        });
        node.children.forEach((child) => walk(child, depth + 1, { inTrigger: true }));
        return;
      }
      default:
        return;
    }
  };

  walk(tree, 0, {});
  return steps;
}

function collectStats(tree: CastTreeNode, maps: SpellMaps) {
  let actions = 0;
  let projectiles = 0;
  const modifiers = new Map<string, number>();
  const projectilesByEntity = new Map<string, number>();
  const walk = (node: CastTreeNode) => {
    if (node.kind === 'action') {
      actions += 1;
      for (const entity of node.projectiles) {
        projectiles += 1;
        projectilesByEntity.set(entity, (projectilesByEntity.get(entity) ?? 0) + 1);
      }
    }
    if (node.kind === 'action') {
      const spell = maps.byId.get(node.id);
      if (spell?.type === 'modifier') modifiers.set(node.id, (modifiers.get(node.id) ?? 0) + 1);
    }
    node.children.forEach(walk);
  };
  walk(tree);
  return { actions, projectiles, modifiers: [...modifiers.entries()], projectilesByEntity };
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

function Pile({ title, ids, data, lang, maps }: { title: string; ids: string[]; data: GameData; lang: Lang; maps: SpellMaps }) {
  return (
    <div className="pile">
      <div className="pile-title">
        {title} <span className="pile-count">{ids.length}</span>
      </div>
      <div className="pile-items">
        {ids.length === 0 && <span className="muted small">{t(lang, 'result.empty')}</span>}
        {ids.map((id, index) => {
          const spell = maps.byId.get(id);
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

function ShotCard({ shot, index, data, lang }: { shot: ShotResult; index: number; data: GameData; lang: Lang }) {
  const maps = useSpellMaps(data);
  const stats = useMemo(() => collectStats(shot.tree, maps), [shot.tree, maps]);
  const story = useMemo(() => buildStory(shot.tree, lang, maps), [shot.tree, lang, maps]);
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
          {t(lang, 'result.projectiles')} {stats.projectiles}
        </span>
        {shot.reloaded && <span className="badge reloaded">{t(lang, 'result.reloaded')}</span>}
      </header>

      <div className="shot-columns">
        <section className="shot-tree">
          <h4>{t(lang, 'result.tree')}</h4>
          {stats.modifiers.length > 0 && (
            <div className="tree-mods">
              {t(lang, 'result.modifiers')}：
              {stats.modifiers
                .map(([id, count]) => {
                  const spell = maps.byId.get(id);
                  return `${spellName(spell, id, lang)} ×${count}`;
                })
                .join('、')}
            </div>
          )}
          {stats.projectiles === 0 && stats.actions === 0 ? (
            <p className="muted">{t(lang, 'result.noProjectiles')}</p>
          ) : (
            <div className="tree-root">
              <TreeNodeView node={shot.tree} depth={0} data={data} lang={lang} maps={maps} />
            </div>
          )}
        </section>
        <section className="piles">
          <h4>{t(lang, 'result.piles')}</h4>
          <Pile title={t(lang, 'result.pileDeck')} ids={shot.deck} data={data} lang={lang} maps={maps} />
          <Pile title={t(lang, 'result.pileHand')} ids={shot.hand} data={data} lang={lang} maps={maps} />
          <Pile title={t(lang, 'result.pileDiscard')} ids={shot.discarded} data={data} lang={lang} maps={maps} />
        </section>
      </div>

      <section className="shot-steps">
        <h4>{t(lang, 'result.steps')}</h4>
        <ol className="step-list">
          {story.map((step, stepIndex) => (
            <li key={stepIndex} className={`step step-${step.tone}`} style={{ marginLeft: step.depth * INDENT }}>
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
          {shot.events.map((event: EngineEvent, eventIndex: number) => (
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
