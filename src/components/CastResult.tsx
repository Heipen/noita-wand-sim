import { useMemo, useState } from 'react';
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

// --- repeat grouping ----------------------------------------------------------

/** A cast-tree node whose identical consecutive siblings may be folded (count > 1). */
interface GroupedNode {
  node: CastTreeNode;
  count: number;
  signature: string;
  children: GroupedNode[];
}

function nodeSignature(node: CastTreeNode): string {
  switch (node.kind) {
    case 'cast':
      return `cast[${node.children.map(nodeSignature).join(',')}]`;
    case 'drawBlock':
      return `draw(${node.count},${node.instantReload})[${node.children.map(nodeSignature).join(',')}]`;
    case 'drawCard':
      return `card(${node.spellId ?? '-'},${node.ok})[${node.children.map(nodeSignature).join(',')}]`;
    case 'action': {
      const delta = node.delta ? JSON.stringify(Object.entries(node.delta).sort()) : '';
      return `action(${node.id},${node.recursion ?? '-'},${node.iteration ?? '-'},${node.dontDraw},${
        node.permanent
      },${node.projectiles.join('|')},${delta})[${node.children.map(nodeSignature).join(',')}]`;
    }
    case 'trigger':
      return `trigger(${node.triggerKind},${node.projectile ?? '-'})[${node.children.map(nodeSignature).join(',')}]`;
    case 'discard':
      return `discard(${node.spellId})`;
    default:
      return 'unknown';
  }
}

function groupChildren(children: CastTreeNode[], foldRepeats: boolean): GroupedNode[] {
  const out: GroupedNode[] = [];
  for (const child of children) {
    const signature = nodeSignature(child);
    const last = out[out.length - 1];
    if (foldRepeats && last && last.signature === signature) {
      last.count += 1;
      continue;
    }
    out.push({ node: child, count: 1, signature, children: groupChildren(child.children, foldRepeats) });
  }
  return out;
}

function groupTree(tree: CastTreeNode, foldRepeats: boolean): GroupedNode {
  return {
    node: tree,
    count: 1,
    signature: nodeSignature(tree),
    children: groupChildren(tree.children, foldRepeats),
  };
}

// --- spell summary -----------------------------------------------------------

interface SummaryItem {
  entity: string;
  count: number;
  modifiers: [string, number][];
}

function summarizeProjectiles(
  tree: CastTreeNode,
  maps: SpellMaps,
): { items: SummaryItem[]; projectileCount: number; modifierKinds: number } {
  const items = new Map<string, SummaryItem>();
  let projectileCount = 0;

  const processScope = (nodes: CastTreeNode[]) => {
    const projectiles: string[] = [];
    const modifiers: string[] = [];
    const triggers: CastTreeNode[] = [];

    const walk = (node: CastTreeNode) => {
      switch (node.kind) {
        case 'action': {
          const spell = maps.byId.get(node.id);
          if (spell?.type === 'modifier') modifiers.push(node.id);
          for (const entity of node.projectiles) projectiles.push(entity);
          node.children.forEach(walk);
          break;
        }
        case 'trigger':
          triggers.push(node);
          break;
        default:
          node.children.forEach(walk);
          break;
      }
    };
    nodes.forEach(walk);

    const counts = new Map<string, number>();
    for (const id of modifiers) counts.set(id, (counts.get(id) ?? 0) + 1);
    const signature = [...counts.entries()]
      .map(([id, count]) => `${id}:${count}`)
      .sort()
      .join(',');
    const modifierList = [...counts.entries()];

    for (const entity of projectiles) {
      projectileCount += 1;
      const key = `${entity}|${signature}`;
      const existing = items.get(key);
      if (existing) existing.count += 1;
      else items.set(key, { entity, count: 1, modifiers: modifierList });
    }
    triggers.forEach((trigger) => processScope(trigger.children));
  };

  processScope(tree.children);
  const modifierKinds = new Set<string>();
  for (const item of items.values()) for (const [id] of item.modifiers) modifierKinds.add(id);
  return { items: [...items.values()], projectileCount, modifierKinds: modifierKinds.size };
}

function SpellSummary({
  tree,
  data,
  lang,
  maps,
}: {
  tree: CastTreeNode;
  data: GameData;
  lang: Lang;
  maps: SpellMaps;
}) {
  const summary = useMemo(() => summarizeProjectiles(tree, maps), [tree, maps]);
  return (
    <section className="spell-summary">
      <h4>{t(lang, 'result.summary')}</h4>
      {summary.items.length === 0 ? (
        <p className="muted small">{t(lang, 'summary.none')}</p>
      ) : (
        <>
          <div className="summary-grid">
            {summary.items.map((item, index) => {
              const spell = maps.byEntity.get(item.entity);
              return (
                <div className="summary-card" key={index}>
                  <SpellIcon spell={spell} data={data} />
                  <div className="summary-body">
                    <div className="summary-name">
                      {spellName(spell, entityLabel(item.entity), lang)} ×{item.count}
                    </div>
                    {item.modifiers.length > 0 && (
                      <div className="summary-mods">
                        {t(lang, 'summary.modifiers')}：
                        {item.modifiers
                          .map(([id, count]) => {
                            const modSpell = maps.byId.get(id);
                            return `${spellName(modSpell, id, lang)} ×${count}`;
                          })
                          .join('、')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="summary-total muted small">
            {t(lang, 'summary.total', { projectiles: summary.projectileCount, modifiers: summary.modifierKinds })}
          </div>
        </>
      )}
    </section>
  );
}

// --- tree view ---------------------------------------------------------------

function RepeatBadge({ group, lang }: { group: GroupedNode; lang: Lang }) {
  if (group.count <= 1) return null;
  return (
    <span className="tree-repeat" title={t(lang, 'tree.repeatTitle', { count: group.count })}>
      ×{group.count}
    </span>
  );
}

function TreeNodeView({
  group,
  data,
  lang,
  maps,
  showDeltas,
  parentDontDraw,
}: {
  group: GroupedNode;
  data: GameData;
  lang: Lang;
  maps: SpellMaps;
  showDeltas: boolean;
  parentDontDraw?: boolean;
}) {
  const node = group.node;
  const children = () =>
    group.children.map((child, index) => (
      <TreeNodeView
        key={index}
        group={child}
        data={data}
        lang={lang}
        maps={maps}
        showDeltas={showDeltas}
        parentDontDraw={parentDontDraw}
      />
    ));

  switch (node.kind) {
    case 'cast':
      return <>{children()}</>;
    case 'drawBlock':
      return (
        <div className="tree-node tree-drawblock">
          <div className="tree-line">
            <span className="tree-tag">抽取</span>
            {parentDontDraw ? (
              <span className="tree-failed">{t(lang, 'tree.drawBlockBlocked')}</span>
            ) : (
              <span>
                {node.count === 1 ? t(lang, 'tree.drawBlockOne') : t(lang, 'tree.drawBlock', { count: node.count })}
              </span>
            )}
            <RepeatBadge group={group} lang={lang} />
          </div>
          {children()}
        </div>
      );
    case 'drawCard': {
      const spell = node.spellId ? maps.byId.get(node.spellId) : undefined;
      const name = spell ? spellName(spell, node.spellId ?? '', lang) : '';
      const failed = node.ok === false;
      return (
        <div className="tree-node tree-drawcard">
          <div className="tree-line">
            <SpellIcon spell={spell} data={data} />
            {node.spellId ? (
              <span className={failed ? 'tree-failed' : ''}>
                {failed ? t(lang, 'tree.drawCardFailed', { name }) : t(lang, 'tree.drawCard', { name })}
              </span>
            ) : (
              <span className="tree-failed">{t(lang, 'tree.drawCardEmpty')}</span>
            )}
            <RepeatBadge group={group} lang={lang} />
          </div>
          {children()}
        </div>
      );
    }
    case 'action': {
      const spell = maps.byId.get(node.id);
      const name = spellName(spell, node.id, lang);
      const deltas = showDeltas ? formatDeltas(node.delta, lang) : [];
      const directCall = node.deckIndex === null && !node.permanent;
      return (
        <div className="tree-node tree-action">
          <div className="tree-line">
            <SpellIcon spell={spell} data={data} />
            <span className="tree-action-name">
              {directCall ? t(lang, 'tree.actionCall', { name }) : t(lang, 'tree.action', { name })}
            </span>
            {spell && <span className={`tree-type type-${spell.type}`}>{t(lang, `type.${spell.type}`)}</span>}
            {node.deckIndex !== null && <span className="tree-slot">#{node.deckIndex + 1}</span>}
            {node.dontDraw && (
              <span className="tree-badge warn" title={t(lang, 'tree.dontDrawExplain')}>
                {t(lang, 'tree.dontDraw')}
              </span>
            )}
            {node.permanent && <span className="tree-badge">{t(lang, 'tree.permanent')}</span>}
            {node.recursion !== null && <span className="tree-badge">{t(lang, 'tree.recursion', { n: node.recursion })}</span>}
            {node.iteration !== null && <span className="tree-badge">{t(lang, 'tree.iteration', { n: node.iteration })}</span>}
            <RepeatBadge group={group} lang={lang} />
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
                    {t(lang, 'tree.projectile', { name: spellName(projectileSpell, entityLabel(entity), lang) })}
                  </span>
                );
              })}
            </div>
          )}
          {node.dontDraw
            ? group.children.map((child, index) => (
                <TreeNodeView
                  key={index}
                  group={child}
                  data={data}
                  lang={lang}
                  maps={maps}
                  showDeltas={showDeltas}
                  parentDontDraw
                />
              ))
            : children()}
        </div>
      );
    }
    case 'trigger': {
      const projectileSpell = node.projectile ? maps.byEntity.get(node.projectile) : undefined;
      return (
        <div className="tree-node tree-trigger">
          <div className="tree-line">
            <span className="tree-tag trigger">{t(lang, triggerLabel(node.triggerKind))}</span>
            <span>
              {t(lang, 'tree.trigger', {
                name: spellName(projectileSpell, node.projectile ? entityLabel(node.projectile) : '?', lang),
                kind: t(lang, triggerLabel(node.triggerKind)),
              })}
            </span>
            <RepeatBadge group={group} lang={lang} />
          </div>
          {children()}
        </div>
      );
    }
    case 'discard': {
      const spell = maps.byId.get(node.spellId);
      return (
        <div className="tree-node tree-discard">
          <div className="tree-line">
            <SpellIcon spell={spell} data={data} />
            <span className="tree-failed">{t(lang, 'tree.discard', { name: spellName(spell, node.spellId, lang) })}</span>
            <RepeatBadge group={group} lang={lang} />
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

// --- narrative ----------------------------------------------------------------

const INDENT = 14;

interface StoryStep {
  depth: number;
  tone: string;
  text: string;
  spell?: SpellMeta;
  deltas: string[];
}

function buildStory(root: GroupedNode, lang: Lang, maps: SpellMaps, showDeltas: boolean): StoryStep[] {
  const steps: StoryStep[] = [];

  const pushRepeat = (count: number, depth: number) => {
    if (count <= 1) return;
    steps.push({ depth, tone: 'repeat', text: t(lang, 'tree.storyRepeat', { count }), deltas: [] });
  };

  const actionAnnotations = (node: Extract<CastTreeNode, { kind: 'action' }>): string => {
    let text = '';
    if (node.dontDraw) text += `（${t(lang, 'tree.dontDrawExplain')}）`;
    if (node.permanent) text += `（${t(lang, 'tree.permanent')}）`;
    if (node.recursion !== null) text += ` ${t(lang, 'tree.recursion', { n: node.recursion })}`;
    if (node.iteration !== null) text += ` ${t(lang, 'tree.iteration', { n: node.iteration })}`;
    return text;
  };

  const walk = (
    group: GroupedNode,
    depth: number,
    context: { parentAction?: string; parentActionDontDraw?: boolean; inTrigger?: boolean },
  ): void => {
    const node = group.node;
    switch (node.kind) {
      case 'cast':
        group.children.forEach((child) => walk(child, 0, context));
        return;
      case 'drawBlock': {
        let text: string;
        if (context.parentActionDontDraw) {
          text = t(lang, 'tree.storyDrawBlocked', { name: context.parentAction ?? '' });
        } else if (context.inTrigger) {
          text = t(lang, 'tree.storyPayload', { count: node.count });
        } else if (context.parentAction) {
          text = t(lang, 'tree.storyDrawByAction', { name: context.parentAction, count: node.count });
        } else {
          text = node.count === 1 ? t(lang, 'tree.storyDrawOne') : t(lang, 'tree.storyDraw', { count: node.count });
        }
        steps.push({ depth, tone: context.parentActionDontDraw ? 'fail' : 'draw', text, deltas: [] });
        group.children.forEach((child) =>
          walk(child, depth + 1, {
            ...context,
            parentAction: undefined,
            parentActionDontDraw: undefined,
            inTrigger: undefined,
          }),
        );
        pushRepeat(group.count, depth + 1);
        return;
      }
      case 'drawCard': {
        const spell = node.spellId ? maps.byId.get(node.spellId) : undefined;
        const name = spell ? spellName(spell, node.spellId ?? '', lang) : '';
        // merge "drew X" and "call X" into one step when the card was played
        const onlyChild = group.children.length === 1 ? group.children[0] : null;
        if (onlyChild && onlyChild.node.kind === 'action' && node.ok !== false) {
          const actionNode = onlyChild.node;
          const actionSpell = maps.byId.get(actionNode.id);
          const actionName = spellName(actionSpell, actionNode.id, lang);
          steps.push({
            depth,
            tone: 'action',
            text: `${t(lang, 'tree.storyDrawAndAction', { name: actionName })}${actionAnnotations(actionNode)}`,
            spell: actionSpell,
            deltas: showDeltas ? formatDeltas(actionNode.delta, lang) : [],
          });
          for (const entity of actionNode.projectiles) {
            const projectileSpell = maps.byEntity.get(entity);
            steps.push({
              depth: depth + 1,
              tone: 'projectile',
              text: t(lang, 'tree.storyProjectile', { name: spellName(projectileSpell, entityLabel(entity), lang) }),
              spell: projectileSpell,
              deltas: [],
            });
          }
          onlyChild.children.forEach((child) =>
            walk(child, depth + 1, {
              parentAction: actionName,
              parentActionDontDraw: actionNode.dontDraw,
            }),
          );
          pushRepeat(group.count, depth + 1);
          return;
        }
        if (node.ok === false) {
          steps.push({ depth, tone: 'fail', text: t(lang, 'tree.storyCardFailed', { name }), spell, deltas: [] });
        } else if (node.spellId) {
          steps.push({ depth, tone: 'draw', text: t(lang, 'tree.storyCard', { name }), spell, deltas: [] });
        } else {
          steps.push({ depth, tone: 'fail', text: t(lang, 'tree.storyCardEmpty'), deltas: [] });
        }
        group.children.forEach((child) => walk(child, depth + 1, context));
        pushRepeat(group.count, depth + 1);
        return;
      }
      case 'action': {
        const spell = maps.byId.get(node.id);
        const name = spellName(spell, node.id, lang);
        const direct = node.deckIndex === null && !node.permanent;
        const text = `${direct ? t(lang, 'tree.storyCall', { name }) : t(lang, 'tree.storyAction', { name })}${actionAnnotations(node)}`;
        steps.push({
          depth,
          tone: direct ? 'call' : 'action',
          text,
          spell,
          deltas: showDeltas ? formatDeltas(node.delta, lang) : [],
        });
        for (const entity of node.projectiles) {
          const projectileSpell = maps.byEntity.get(entity);
          steps.push({
            depth: depth + 1,
            tone: 'projectile',
            text: t(lang, 'tree.storyProjectile', { name: spellName(projectileSpell, entityLabel(entity), lang) }),
            spell: projectileSpell,
            deltas: [],
          });
        }
        group.children.forEach((child) =>
          walk(child, depth + 1, { parentAction: name, parentActionDontDraw: node.dontDraw }),
        );
        pushRepeat(group.count, depth + 1);
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
        group.children.forEach((child) => walk(child, depth + 1, { inTrigger: true }));
        pushRepeat(group.count, depth + 1);
        return;
      }
      case 'discard': {
        const spell = maps.byId.get(node.spellId);
        steps.push({
          depth,
          tone: 'discard',
          text: t(lang, 'tree.storyDiscard', { name: spellName(spell, node.spellId, lang) }),
          spell,
          deltas: [],
        });
        pushRepeat(group.count, depth + 1);
        return;
      }
      default:
        return;
    }
  };

  walk(root, 0, {});
  return steps;
}

// --- shot card -----------------------------------------------------------------

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

function collectStats(tree: CastTreeNode) {
  let actions = 0;
  const walk = (node: CastTreeNode) => {
    if (node.kind === 'action') actions += 1;
    node.children.forEach(walk);
  };
  walk(tree);
  return { actions };
}

function ShotCard({
  shot,
  index,
  data,
  lang,
  showDeltas,
  foldRepeats,
}: {
  shot: ShotResult;
  index: number;
  data: GameData;
  lang: Lang;
  showDeltas: boolean;
  foldRepeats: boolean;
}) {
  const maps = useSpellMaps(data);
  const [treeOpen, setTreeOpen] = useState(true);
  const stats = useMemo(() => collectStats(shot.tree), [shot.tree]);
  const grouped = useMemo(() => groupTree(shot.tree, foldRepeats), [shot.tree, foldRepeats]);
  const story = useMemo(() => buildStory(grouped, lang, maps, showDeltas), [grouped, lang, maps, showDeltas]);
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
        {shot.reloaded && <span className="badge reloaded">{t(lang, 'result.reloaded')}</span>}
      </header>

      <SpellSummary tree={shot.tree} data={data} lang={lang} maps={maps} />

      <div className="shot-columns">
        <section className="shot-tree">
          <h4 className="tree-heading">
            <button
              type="button"
              className="section-toggle"
              aria-expanded={treeOpen}
              onClick={() => setTreeOpen((open) => !open)}
            >
              {treeOpen ? '▾' : '▸'} {t(lang, 'result.tree')}
            </button>
          </h4>
          {treeOpen &&
            (stats.actions === 0 ? (
              <p className="muted">{t(lang, 'result.noProjectiles')}</p>
            ) : (
              <div className="tree-root">
                <TreeNodeView
                  group={grouped}
                  data={data}
                  lang={lang}
                  maps={maps}
                  showDeltas={showDeltas}
                />
              </div>
            ))}
        </section>
        <section className="piles">
          <h4>{t(lang, 'result.piles')}</h4>
          <div className="piles-grid">
            <Pile title={t(lang, 'result.pileDeck')} ids={shot.deck} data={data} lang={lang} maps={maps} />
            <Pile title={t(lang, 'result.pileHand')} ids={shot.hand} data={data} lang={lang} maps={maps} />
            <Pile title={t(lang, 'result.pileDiscard')} ids={shot.discarded} data={data} lang={lang} maps={maps} />
          </div>
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
  const [showDeltas, setShowDeltas] = useState(false);
  const [foldRepeats, setFoldRepeats] = useState(true);

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
        <label className="deltas-toggle">
          <input
            type="checkbox"
            data-toggle="fold"
            checked={foldRepeats}
            onChange={(event) => setFoldRepeats(event.target.checked)}
          />
          {t(lang, 'result.foldRepeats')}
        </label>
        <label className="deltas-toggle">
          <input
            type="checkbox"
            data-toggle="deltas"
            checked={showDeltas}
            onChange={(event) => setShowDeltas(event.target.checked)}
          />
          {t(lang, 'result.showDeltas')}
        </label>
        {simulating && <span className="simulating">{t(lang, 'result.simulating')}</span>}
      </header>

      {error && <div className="error">{t(lang, 'result.error', { message: error })}</div>}
      {!result && !error && <p className="muted">{t(lang, 'result.emptyHint')}</p>}

      {result && (
        <div className="shot-list">
          {result.shots.map((shot, index) => (
            <ShotCard
              key={index}
              shot={shot}
              index={index}
              data={data}
              lang={lang}
              showDeltas={showDeltas}
              foldRepeats={foldRepeats}
            />
          ))}
        </div>
      )}
    </section>
  );
}
