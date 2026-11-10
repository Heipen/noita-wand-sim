import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
  /** Wand slots (0-based) used to label each spell with its wand number. */
  wandSpells: (string | null)[];
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

/** Spells that copy/duplicate other spells from the deck. */
function isDuplicator(id: string): boolean {
  return /^DIVIDE_\d+$/.test(id) || id === 'TAU' || id === 'OMEGA';
}

function copiesNothing(node: Extract<CastTreeNode, { kind: 'action' }>): boolean {
  return isDuplicator(node.id) && node.children.length === 0 && node.projectiles.length === 0;
}

function SpellIcon({ spell, data, size }: { spell?: SpellMeta; data: GameData; size?: 'big' }) {
  const icon = spell ? spellIconUrl(data, spell) : undefined;
  return icon ? (
    <img className={`mini-icon${size === 'big' ? ' big' : ''}`} src={icon} alt="" />
  ) : (
    <span className={`mini-icon placeholder${size === 'big' ? ' big' : ''}`} />
  );
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

interface GroupedNode {
  node: CastTreeNode;
  children: GroupedEntry[];
}

type GroupedEntry =
  | {
      kind: 'node';
      group: GroupedNode;
      /** Every concrete occurrence in this folded run (in order). */
      copies: GroupedNode[];
      repeat: number;
      sig: string;
      id: string;
    }
  | {
      kind: 'sequence';
      count: number;
      pattern: GroupedEntry[];
      /** The concrete pattern of every repetition, so expanding shows real slot numbers. */
      instances: GroupedEntry[][];
      sig: string;
      id: string;
    };

function childSignature(children: CastTreeNode[]): string {
  // Ignore repeated copies entirely when comparing trees: two copies of the same process
  // that execute a different number of identical sub-actions should still fold together.
  // Keep the order in which different children first appear.
  const sigs = children.map(nodeSignature);
  return [...new Set(sigs)].join(',');
}

function nodeSignature(node: CastTreeNode): string {
  switch (node.kind) {
    case 'cast':
      return 'cast';
    case 'drawBlock':
      return `draw[${childSignature(node.children)}]`;
    case 'drawCard':
      // fold by the card itself; nested differences are visible when expanding
      return `card(${node.spellId ?? '-'},${node.ok})`;
    case 'action':
      // fold repeated casts of the same spell regardless of their internal copy counts
      return `action(${node.id})`;
    case 'trigger':
      // keep the payload shape in the signature: two triggers on the same projectile but
      // with different payloads must not fold into one
      return `trigger(${node.triggerKind},${node.projectile ?? '-'})[${childSignature(node.children)}]`;
    case 'discard':
      return `discard(${node.spellId})`;
    default:
      return 'unknown';
  }
}

function entrySignature(entry: GroupedEntry): string {
  // ignore the fold counts themselves so the same pattern folds regardless of how many
  // times each sub-run happened
  if (entry.kind === 'node') return `n:${entry.sig}`;
  return `s:${entry.pattern.map(entrySignature).join('+')}`;
}

function foldSequences(entries: GroupedEntry[], path: string): GroupedEntry[] {
  const out: GroupedEntry[] = [];
  let index = 0;
  while (index < entries.length) {
    let folded = false;
    for (let period = 1; period <= Math.floor((entries.length - index) / 2); period += 1) {
      const pattern = entries.slice(index, index + period);
      const patternSigs = pattern.map(entrySignature);
      let repeats = 1;
      while (index + (repeats + 1) * period <= entries.length) {
        const block = entries.slice(index + repeats * period, index + (repeats + 1) * period).map(entrySignature);
        if (block.every((sig, i) => sig === patternSigs[i])) repeats += 1;
        else break;
      }
      if (repeats >= 2) {
        const instances = Array.from({ length: repeats }, (_, rep) =>
          entries.slice(index + rep * period, index + (rep + 1) * period),
        );
        out.push({
          kind: 'sequence',
          count: repeats,
          pattern: instances[0],
          instances,
          sig: patternSigs.join('+'),
          id: `${path}.seq${out.length}`,
        });
        index += period * repeats;
        folded = true;
        break;
      }
    }
    if (!folded) {
      out.push(entries[index]);
      index += 1;
    }
  }
  return out;
}

function groupEntries(nodes: CastTreeNode[], foldRepeats: boolean, path: string): GroupedEntry[] {
  const built: GroupedNode[] = nodes.map((node, index) => ({
    node,
    children: groupEntries(node.children, foldRepeats, `${path}.${index}`),
  }));
  if (!foldRepeats) {
    return built.map((group, index) => ({
      kind: 'node',
      group,
      copies: [group],
      repeat: 1,
      sig: nodeSignature(group.node),
      id: `${path}.${index}`,
    }));
  }
  const collapsed: GroupedEntry[] = [];
  for (const group of built) {
    const sig = nodeSignature(group.node);
    const last = collapsed[collapsed.length - 1];
    if (last && last.kind === 'node' && last.sig === sig) {
      last.copies.push(group);
      last.repeat += 1;
    } else {
      collapsed.push({
        kind: 'node',
        group,
        copies: [group],
        repeat: 1,
        sig,
        id: `${path}.${collapsed.length}`,
      });
    }
  }
  return foldSequences(collapsed, path);
}

function groupTree(tree: CastTreeNode, foldRepeats: boolean): GroupedNode {
  return { node: tree, children: groupEntries(tree.children, foldRepeats, 'r') };
}

export { groupTree };
export type { GroupedEntry, GroupedNode };

// --- spell summary -----------------------------------------------------------

interface SummaryTrigger {
  kind: 'timer' | 'hitWorld' | 'death';
  payload: SummaryItem[];
}

interface SummaryItem {
  entity: string;
  count: number;
  modifiers: [string, number][];
  trigger?: SummaryTrigger;
}

function summarizeNodes(nodes: CastTreeNode[], maps: SpellMaps): SummaryItem[] {
  const collected: { entity: string; trigger?: SummaryTrigger }[] = [];
  const modifierCounts = new Map<string, number>();

  const walk = (node: CastTreeNode) => {
    switch (node.kind) {
      case 'action': {
        const spell = maps.byId.get(node.id);
        if (spell?.type === 'modifier') {
          modifierCounts.set(node.id, (modifierCounts.get(node.id) ?? 0) + 1);
        }
        // multiple related projectiles (e.g. BUCKSHOT) can each carry their own trigger;
        // pair them in order instead of always matching the first trigger node
        const triggerNodes = node.children.filter(
          (child): child is Extract<CastTreeNode, { kind: 'trigger' }> => child.kind === 'trigger',
        );
        const usedTriggers = new Set<number>();
        for (const entity of node.projectiles) {
          const triggerIndex = triggerNodes.findIndex(
            (trigger, index) => !usedTriggers.has(index) && trigger.projectile === entity,
          );
          let trigger: SummaryTrigger | undefined;
          if (triggerIndex >= 0) {
            usedTriggers.add(triggerIndex);
            const triggerNode = triggerNodes[triggerIndex];
            trigger = { kind: triggerNode.triggerKind, payload: summarizeNodes(triggerNode.children, maps) };
          }
          collected.push({ entity, trigger });
        }
        node.children.forEach((child) => {
          // a trigger node belongs to the projectile that carries it: its payload was
          // summarized above in a fresh modifier scope, not in the outer cast block
          if (child.kind !== 'trigger') walk(child);
        });
        break;
      }
      case 'trigger':
        break;
      default:
        node.children.forEach(walk);
        break;
    }
  };
  nodes.forEach(walk);

  const modifierList = [...modifierCounts.entries()];
  const modifierSignature = modifierList
    .map(([id, count]) => `${id}:${count}`)
    .sort()
    .join(',');
  const grouped = new Map<string, SummaryItem>();

  for (const projectile of collected) {
    const triggerSignature = projectile.trigger
      ? JSON.stringify([
          projectile.trigger.kind,
          projectile.trigger.payload.map((item) => [item.entity, item.count, item.modifiers]),
        ])
      : '';
    const key = `${projectile.entity}|${modifierSignature}|${triggerSignature}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else {
      grouped.set(key, {
        entity: projectile.entity,
        count: 1,
        modifiers: modifierList,
        trigger: projectile.trigger,
      });
    }
  }
  return [...grouped.values()];
}

function countSummary(items: SummaryItem[], acc = { projectiles: 0, modifiers: new Set<string>() }) {
  for (const item of items) {
    acc.projectiles += item.count;
    for (const [id] of item.modifiers) acc.modifiers.add(id);
    if (item.trigger) countSummary(item.trigger.payload, acc);
  }
  return acc;
}

const CESSATION_BASE_LIFETIME = 20;

interface CessationEffect {
  frames: number;
  bonus: number;
  count: number;
}

function collectCessationEffects(tree: CastTreeNode): CessationEffect[] {
  const effects = new Map<string, CessationEffect>();
  const walk = (node: CastTreeNode) => {
    if (node.kind === 'action' && node.id === 'CESSATION' && node.lifetimeAdd !== undefined) {
      const bonus = node.lifetimeAdd;
      const frames = CESSATION_BASE_LIFETIME + bonus;
      const key = `${frames}|${bonus}`;
      const existing = effects.get(key);
      if (existing) existing.count += 1;
      else effects.set(key, { frames, bonus, count: 1 });
    }
    node.children.forEach(walk);
  };
  walk(tree);
  return [...effects.values()];
}

function CessationLifetimeBadge({
  node,
  lang,
}: {
  node: { id: string; lifetimeAdd?: number };
  lang: Lang;
}) {
  if (node.id !== 'CESSATION' || node.lifetimeAdd === undefined) return null;
  const bonus = node.lifetimeAdd;
  const frames = CESSATION_BASE_LIFETIME + bonus;
  return (
    <span
      className={`tree-effect${bonus !== 0 ? ' active' : ''}`}
      title={t(lang, 'tree.cessationHint', { bonus, frames })}
    >
      {t(lang, 'tree.cessationLifetime', { frames, seconds: formatFramesAsSeconds(frames) })}
      {bonus !== 0 && (
        <sup>
          {bonus > 0 ? '+' : ''}
          {bonus}
        </sup>
      )}
    </span>
  );
}

const SUMMARY_STATE_ROWS: {
  key: string;
  format: 'seconds' | 'percent' | 'multiplier' | 'degrees' | 'number';
}[] = [
  { key: 'damage_projectile_add', format: 'number' },
  { key: 'damage_explosion_add', format: 'number' },
  { key: 'damage_critical_chance', format: 'percent' },
  { key: 'spread_degrees', format: 'degrees' },
  { key: 'speed_multiplier', format: 'multiplier' },
  { key: 'lifetime_add', format: 'number' },
  { key: 'bounces', format: 'number' },
  { key: 'explosion_radius', format: 'number' },
];

function stateValue(
  format: (typeof SUMMARY_STATE_ROWS)[number]['format'],
  value: number,
  signed = false,
): string {
  if (format === 'seconds') return formatFramesAsSeconds(value);
  const text = formatNumber(value);
  return signed && value > 0 ? `+${text}` : text;
}

function summaryStateChips(
  castState: Record<string, number | string>,
  lang: Lang,
): { key: string; text: string }[] {
  return SUMMARY_STATE_ROWS.flatMap((row) => {
    const value = castState[row.key];
    if (typeof value !== 'number' || value === 0) return [];
    // 1.0 is the neutral speed multiplier, not an actual modifier
    if (row.key === 'speed_multiplier' && value === 1) return [];
    return [
      {
        key: row.key,
        text: t(lang, `state.${row.key}`, {
          value: stateValue(row.format, value, row.format !== 'multiplier'),
        }),
      },
    ];
  });
}

function SummaryItemCard({
  item,
  data,
  lang,
  maps,
  castState,
  depth = 0,
}: {
  item: SummaryItem;
  data: GameData;
  lang: Lang;
  maps: SpellMaps;
  castState?: Record<string, number | string>;
  depth?: number;
}) {
  const spell = maps.byEntity.get(item.entity);
  const projectileName = spellName(spell, entityLabel(item.entity), lang);
  const stateChips = depth === 0 && castState ? summaryStateChips(castState, lang) : [];

  return (
    <div className={`summary-card${depth > 0 ? ' summary-payload-card' : ''}`}>
      <div className="summary-card-main">
        <div className="summary-zone summary-projectile-zone">
          <span className="summary-zone-label">{t(lang, 'summary.labelProjectile')}</span>
          <span className="summary-proj" title={projectileName}>
            <SpellIcon spell={spell} data={data} size="big" />
            <span className="summary-count">×{item.count}</span>
          </span>
        </div>
        {item.modifiers.length > 0 && (
          <div className="summary-zone summary-modifier-zone">
            <span className="summary-zone-label">{t(lang, 'summary.labelModifier')}</span>
            <span className="summary-mods-icons">
              {item.modifiers.map(([id, count]) => {
                const modSpell = maps.byId.get(id);
                const modName = spellName(modSpell, id, lang);
                return (
                  <span className="summary-mod" key={id} title={`${modName} ×${count}`}>
                    <SpellIcon spell={modSpell} data={data} />
                    <sup>×{count}</sup>
                  </span>
                );
              })}
            </span>
          </div>
        )}
      </div>
      {stateChips.length > 0 && (
        <div className="summary-state-chips">
          {stateChips.map((chip) => (
            <span className="summary-state-chip" key={chip.key}>
              {chip.text}
            </span>
          ))}
        </div>
      )}
      {item.trigger && (
        <div className="summary-trigger">
          <div className="summary-trigger-head">
            <span className="summary-trigger-badge">
              {t(lang, triggerLabel(item.trigger.kind))}
            </span>
            <span className="summary-trigger-arrow">→</span>
          </div>
          <div className="summary-trigger-payload">
            {item.trigger.payload.length === 0 ? (
              <span className="muted small">{t(lang, 'summary.none')}</span>
            ) : (
              item.trigger.payload.map((child, index) => (
                <SummaryItemCard
                  key={index}
                  item={child}
                  data={data}
                  lang={lang}
                  maps={maps}
                  depth={depth + 1}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SpellSummary({
  tree,
  data,
  lang,
  maps,
  castState,
}: {
  tree: CastTreeNode;
  data: GameData;
  lang: Lang;
  maps: SpellMaps;
  castState: Record<string, number | string>;
}) {
  const summary = useMemo(() => {
    const items = summarizeNodes(tree.children, maps);
    const counts = countSummary(items);
    return {
      items,
      projectileCount: counts.projectiles,
      modifierKinds: counts.modifiers.size,
      cessations: collectCessationEffects(tree),
    };
  }, [tree, maps]);
  const stateChips = summaryStateChips(castState, lang);
  const generalStateChips =
    summary.cessations.length > 0
      ? stateChips.filter((chip) => chip.key !== 'lifetime_add')
      : stateChips;
  return (
    <section className="spell-summary">
      <h4>{t(lang, 'result.summary')}</h4>
      {summary.items.length === 0 &&
      summary.cessations.length === 0 &&
      generalStateChips.length === 0 ? (
        <p className="muted small">{t(lang, 'summary.none')}</p>
      ) : (
        <>
          {summary.items.length > 0 && (
            <div className="summary-grid">
              {summary.items.map((item, index) => (
                <SummaryItemCard
                  key={index}
                  item={item}
                  data={data}
                  lang={lang}
                  maps={maps}
                  castState={castState}
                />
              ))}
            </div>
          )}
          {summary.items.length > 0 && (
            <div className="summary-total muted small">
              {t(lang, 'summary.total', {
                projectiles: summary.projectileCount,
                modifiers: summary.modifierKinds,
              })}
            </div>
          )}
          {summary.cessations.length > 0 && (
            <div className="summary-effects">
              <span className="summary-effects-label">{t(lang, 'summary.effects')}</span>
              {summary.cessations.map((effect, index) => (
                <span
                  className="summary-effect"
                  key={index}
                  title={t(lang, 'tree.cessationHint', { bonus: effect.bonus, frames: effect.frames })}
                >
                  <SpellIcon spell={maps.byId.get('CESSATION')} data={data} />
                  <span>
                    {t(lang, 'summary.cessation', {
                      frames: effect.frames,
                      seconds: formatFramesAsSeconds(effect.frames),
                    })}
                  </span>
                  {effect.bonus !== 0 && (
                    <span className="summary-effect-bonus">
                      {effect.bonus > 0 ? '+' : ''}
                      {effect.bonus}
                    </span>
                  )}
                  {effect.count > 1 && <span className="summary-effect-count">×{effect.count}</span>}
                </span>
              ))}
            </div>
          )}
          {summary.items.length === 0 && generalStateChips.length > 0 && (
            <div className="summary-state-card">
              <span className="summary-state-label">{t(lang, 'summary.state')}</span>
              <div className="summary-state-chips">
                {generalStateChips.map((chip) => (
                  <span className="summary-state-chip" key={chip.key}>
                    {chip.text}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// --- tree view ---------------------------------------------------------------

function TreeNodeView({
  group,
  repeat,
  groupId,
  expanded,
  onToggle,
  data,
  lang,
  maps,
  showDeltas,
  slotMap,
  parentDontDraw,
  parentKind,
  level = 0,
}: {
  group: GroupedNode;
  repeat: number;
  groupId?: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  data: GameData;
  lang: Lang;
  maps: SpellMaps;
  showDeltas: boolean;
  slotMap: Map<string, number>;
  parentDontDraw?: boolean;
  parentKind?: CastTreeNode['kind'];
  level?: number;
}) {
  const node = group.node;
  const renderEntries = (entries: GroupedEntry[], dontDrawContext?: boolean, parentK?: CastTreeNode['kind']) =>
    entries.map((entry, index) => (
      <TreeEntryView
        key={`${entry.id}-${index}`}
        entry={entry}
        expanded={expanded}
        onToggle={onToggle}
        data={data}
        lang={lang}
        maps={maps}
        showDeltas={showDeltas}
        slotMap={slotMap}
        parentDontDraw={dontDrawContext}
        parentKind={parentK ?? node.kind}
        level={level}
      />
    ));

  const repeatBadge = repeat > 1 && (
    <button
      type="button"
      className="tree-repeat"
      title={t(lang, 'tree.repeatTitle', { count: repeat })}
      onClick={() => groupId && onToggle(groupId)}
    >
      ×{repeat}
    </button>
  );

  switch (node.kind) {
    case 'cast':
      return <>{renderEntries(group.children)}</>;
    case 'drawBlock':
      if (parentDontDraw) return null;
      // a modifier/draw block inside an action is already represented by that action's line
      if (parentKind === 'action') return <>{renderEntries(group.children)}</>;
      return (
        <div className="tree-node tree-drawblock">
          <div className="tree-line">
            <span className="tree-tag">抽取</span>
            <span>
              {node.count === 1 ? t(lang, 'tree.drawBlockOne') : t(lang, 'tree.drawBlock', { count: node.count })}
            </span>
            {repeatBadge}
          </div>
          {renderEntries(group.children)}
        </div>
      );
    case 'drawCard': {
      const spell = node.spellId ? maps.byId.get(node.spellId) : undefined;
      const name = spell ? spellName(spell, node.spellId ?? '', lang) : '';
      const failed = node.ok === false;
      const onlyAction =
        group.children.length === 1 &&
        group.children[0].kind === 'node' &&
        group.children[0].group.node.kind === 'action' &&
        group.children[0].repeat === 1
          ? group.children[0]
          : null;
      if (onlyAction && !failed) {
        const actionNode = onlyAction.group.node as Extract<CastTreeNode, { kind: 'action' }>;
        const actionSpell = maps.byId.get(actionNode.id);
        const actionName = spellName(actionSpell, actionNode.id, lang);
        const deltas = showDeltas ? formatDeltas(actionNode.delta, lang) : [];
        const slot = actionNode.deckIndex !== null ? actionNode.deckIndex + 1 : slotMap.get(actionNode.id);
        return (
          <div className="tree-node tree-action">
            <div className="tree-line">
              <SpellIcon spell={actionSpell} data={data} />
              <span className="tree-action-name">{t(lang, 'tree.drawAndAction', { name: actionName })}</span>
              {actionSpell && <span className={`tree-type type-${actionSpell.type}`}>{t(lang, `type.${actionSpell.type}`)}</span>}
              {slot !== undefined && <span className="tree-slot">#{slot}</span>}
              {actionNode.dontDraw && <span className="tree-badge warn">{t(lang, 'tree.dontDraw')}</span>}
              {actionNode.permanent && <span className="tree-badge">{t(lang, 'tree.permanent')}</span>}
              <CessationLifetimeBadge node={actionNode} lang={lang} />
              {actionNode.recursion !== null && (
                <span className="tree-badge">{t(lang, 'tree.recursion', { n: actionNode.recursion })}</span>
              )}
              {actionNode.iteration !== null && (
                <span className="tree-badge">{t(lang, 'tree.iteration', { n: actionNode.iteration })}</span>
              )}
              {copiesNothing(actionNode) && <span className="tree-badge warn">{t(lang, 'tree.noCopies')}</span>}
              {actionNode.projectiles.length > 0 && (
                <span className="tree-projectile-inline">
                  →{' '}
                  {actionNode.projectiles.map((entity, index) => {
                    const projectileSpell = maps.byEntity.get(entity);
                    const projectileName = spellName(projectileSpell, entityLabel(entity), lang);
                    return (
                      <span className="tree-projectile" key={index} title={projectileName}>
                        <SpellIcon spell={projectileSpell} data={data} />
                        {projectileName}
                      </span>
                    );
                  })}
                </span>
              )}
              {repeatBadge}
            </div>
            {deltas.length > 0 && (
              <div className="tree-deltas">
                {deltas.map((delta, index) => (
                  <span className="tree-delta" key={index}>
                    {delta}
                  </span>
                ))}
              </div>
            )}
            {renderEntries(onlyAction.group.children, actionNode.dontDraw, 'action')}
          </div>
        );
      }
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
            {repeatBadge}
          </div>
          {renderEntries(group.children)}
        </div>
      );
    }
    case 'action': {
      const spell = maps.byId.get(node.id);
      const name = spellName(spell, node.id, lang);
      const deltas = showDeltas ? formatDeltas(node.delta, lang) : [];
      const directCall = node.deckIndex === null && !node.permanent;
      const slot = node.deckIndex !== null ? node.deckIndex + 1 : !node.permanent ? slotMap.get(node.id) : undefined;
      return (
        <div className="tree-node tree-action">
          <div className="tree-line">
            <SpellIcon spell={spell} data={data} />
            <span className="tree-action-name">
              {directCall ? t(lang, 'tree.actionCall', { name }) : t(lang, 'tree.action', { name })}
            </span>
            {spell && <span className={`tree-type type-${spell.type}`}>{t(lang, `type.${spell.type}`)}</span>}
            {slot !== undefined && <span className="tree-slot">#{slot}</span>}
            {node.dontDraw && <span className="tree-badge warn">{t(lang, 'tree.dontDraw')}</span>}
            {node.permanent && <span className="tree-badge">{t(lang, 'tree.permanent')}</span>}
            <CessationLifetimeBadge node={node} lang={lang} />
            {node.recursion !== null && <span className="tree-badge">{t(lang, 'tree.recursion', { n: node.recursion })}</span>}
            {node.iteration !== null && <span className="tree-badge">{t(lang, 'tree.iteration', { n: node.iteration })}</span>}
            {copiesNothing(node) && <span className="tree-badge warn">{t(lang, 'tree.noCopies')}</span>}
            {node.projectiles.length > 0 && (
              <span className="tree-projectile-inline">
                →{' '}
                {node.projectiles.map((entity, index) => {
                  const projectileSpell = maps.byEntity.get(entity);
                  const name = spellName(projectileSpell, entityLabel(entity), lang);
                  return (
                    <span className="tree-projectile" key={index} title={name}>
                      <SpellIcon spell={projectileSpell} data={data} />
                      {name}
                    </span>
                  );
                })}
              </span>
            )}
            {repeatBadge}
          </div>
          {deltas.length > 0 && (
            <div className="tree-deltas">
              {deltas.map((delta, index) => (
                <span className="tree-delta" key={index}>
                  {delta}
                </span>
              ))}
            </div>
          )}
          {node.dontDraw ? renderEntries(group.children, true, 'action') : renderEntries(group.children, undefined, 'action')}
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
            {repeatBadge}
          </div>
          {renderEntries(group.children)}
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
            {repeatBadge}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

function TreeEntryView({
  entry,
  expanded,
  onToggle,
  data,
  lang,
  maps,
  showDeltas,
  slotMap,
  parentDontDraw,
  parentKind,
  level = 0,
}: {
  entry: GroupedEntry;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  data: GameData;
  lang: Lang;
  maps: SpellMaps;
  showDeltas: boolean;
  slotMap: Map<string, number>;
  parentDontDraw?: boolean;
  parentKind?: CastTreeNode['kind'];
  level?: number;
}) {
  if (entry.kind === 'sequence') {
    const isExpanded = expanded.has(entry.id);
    const color = sequenceColor(level);
    return (
      <div
        className={`tree-sequence${isExpanded ? ' expanded' : ''}`}
        style={{ background: foldBackground(color) }}
      >
        <button
          type="button"
          className="tree-sequence-head"
          onClick={() => onToggle(entry.id)}
          title={t(lang, isExpanded ? 'tree.foldAgain' : 'tree.expand')}
          style={{ color }}
        >
          <span className="tree-sequence-count">×{entry.count}</span>
          <span className="tree-sequence-hint">{isExpanded ? '▾' : '▸'}</span>
        </button>
        <div className="tree-sequence-body">
          {(isExpanded ? entry.instances : [entry.pattern]).map((instance, rep) => (
            <div className="tree-sequence-rep" key={rep}>
              {instance.map((item, index) => (
                <TreeEntryView
                  key={`${item.id}-${index}-${rep}`}
                  entry={item}
                  expanded={expanded}
                  onToggle={onToggle}
                  data={data}
                  lang={lang}
                  maps={maps}
                  showDeltas={showDeltas}
                  slotMap={slotMap}
                  parentDontDraw={parentDontDraw}
                  parentKind={parentKind}
                  level={level + 1}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (entry.repeat > 1) {
    const isExpanded = expanded.has(entry.id);
    const color = sequenceColor(level);
    return (
      <div
        className={`tree-sequence tree-repeat-block${isExpanded ? ' expanded' : ''}`}
        style={{ background: foldBackground(color) }}
      >
        <button
          type="button"
          className="tree-sequence-head tree-repeat"
          onClick={() => onToggle(entry.id)}
          title={t(lang, isExpanded ? 'tree.foldAgain' : 'tree.expand')}
          style={{ color }}
        >
          <span className="tree-sequence-count">×{entry.repeat}</span>
          <span className="tree-sequence-hint">{isExpanded ? '▾' : '▸'}</span>
        </button>
        <div className="tree-sequence-body">
          {(isExpanded ? entry.copies : [entry.copies[0] ?? entry.group]).map((copy, rep) => (
            <TreeNodeView
              key={`${entry.id}-${rep}`}
              group={copy}
              repeat={1}
              groupId={entry.id}
              expanded={expanded}
              onToggle={onToggle}
              data={data}
              lang={lang}
              maps={maps}
              showDeltas={showDeltas}
              slotMap={slotMap}
              parentDontDraw={parentDontDraw}
              parentKind={parentKind}
              level={level + 1}
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <TreeNodeView
      group={entry.group}
      repeat={entry.repeat}
      groupId={entry.id}
      expanded={expanded}
      onToggle={onToggle}
      data={data}
      lang={lang}
      maps={maps}
      showDeltas={showDeltas}
      slotMap={slotMap}
      parentDontDraw={parentDontDraw}
      parentKind={parentKind}
      level={level}
    />
  );
}

// --- narrative ----------------------------------------------------------------

const INDENT = 14;
const NO_EXPAND: Set<string> = new Set();
/** 施法过程暂时注释停用；保留实现，需要恢复时改成 true。 */
const SHOW_CASTING_STEPS = false;
const SEQUENCE_COLORS = ['#8fe0b8', '#8fb8e0', '#e8a87c', '#c9a0ff', '#ffd479', '#7fd1c7'];

function sequenceColor(level: number): string {
  return SEQUENCE_COLORS[level % SEQUENCE_COLORS.length];
}

/** Colored fold range drawn inside the block, leaving the tree guide line clean. */
function foldBackground(color: string): string {
  return `linear-gradient(90deg, transparent 5px, ${color} 5px, ${color} 9px, transparent 9px), ${color}12`;
}

interface StoryStep {
  depth: number;
  tone: string;
  text: string;
  spell?: SpellMeta;
  deltas: string[];
  groupId?: string;
  /** For a folded multi-line story sequence: the repeated pattern and its repetition count. */
  pattern?: StoryStep[];
  /** The concrete steps of every repetition (keeps distinct slot numbers when expanded). */
  instances?: StoryStep[][];
  count?: number;
}

function storyStepKey(step: StoryStep): string {
  // ignore copy bookkeeping annotations (#slot, dont-draw, recursion/iteration) so the
  // same repeated process still folds even if one copy is marked differently
  const text = step.text
    .replace(/\s*#\d+/g, '')
    .replace(/（[^）]*(禁抽|始终施放)[^）]*）/g, '')
    .replace(/\s*递归 \d+/g, '')
    .replace(/\s*迭代 \d+/g, '')
    .trim();
  return `${step.depth}|${step.tone}|${text}|${step.spell?.id ?? ''}|${JSON.stringify(step.deltas)}`;
}

/**
 * Fold repeated multi-line runs in the flat narrative (e.g. "抽取/抽到/执行" blocks
 * appearing several times) into a single clickable "repeats N times" step.
 */
function foldStorySteps(steps: StoryStep[], lang: Lang): StoryStep[] {
  const out: StoryStep[] = [];
  let index = 0;
  while (index < steps.length) {
    let folded = false;
    const maxPeriod = Math.min(30, Math.floor((steps.length - index) / 2));
    for (let period = 2; period <= maxPeriod; period += 1) {
      const pattern = steps.slice(index, index + period);
      const sigs = pattern.map(storyStepKey);
      let repeats = 1;
      while (index + (repeats + 1) * period <= steps.length) {
        const block = steps
          .slice(index + repeats * period, index + (repeats + 1) * period)
          .map(storyStepKey);
        if (block.every((sig, i) => sig === sigs[i])) repeats += 1;
        else break;
      }
      if (repeats >= 2) {
        const instances = Array.from({ length: repeats }, (_, rep) =>
          foldStorySteps(steps.slice(index + rep * period, index + (rep + 1) * period), lang),
        );
        out.push({
          depth: steps[index].depth,
          tone: 'sequence',
          text: t(lang, 'tree.storySequence', { count: repeats }),
          deltas: [],
          groupId: `story-${index}-${period}`,
          count: repeats,
          pattern: instances[0],
          instances,
        });
        index += period * repeats;
        folded = true;
        break;
      }
    }
    if (!folded) {
      out.push(steps[index]);
      index += 1;
    }
  }
  return out;
}

function buildStory(
  root: GroupedNode,
  lang: Lang,
  maps: SpellMaps,
  showDeltas: boolean,
  slotMap: Map<string, number>,
  expanded: Set<string>,
): StoryStep[] {
  const steps: StoryStep[] = [];

  const slotSuffix = (node: Extract<CastTreeNode, { kind: 'action' }>): string => {
    const slot = node.deckIndex !== null ? node.deckIndex + 1 : !node.permanent ? slotMap.get(node.id) : undefined;
    return slot !== undefined ? ` #${slot}` : '';
  };

  const actionAnnotations = (node: Extract<CastTreeNode, { kind: 'action' }>): string => {
    let text = slotSuffix(node);
    if (node.dontDraw) text += `（${t(lang, 'tree.dontDraw')}）`;
    if (node.permanent) text += `（${t(lang, 'tree.permanent')}）`;
    if (node.recursion !== null) text += ` ${t(lang, 'tree.recursion', { n: node.recursion })}`;
    if (node.iteration !== null) text += ` ${t(lang, 'tree.iteration', { n: node.iteration })}`;
    return text;
  };

  const projectileText = (entities: string[]): string => {
    if (entities.length === 0) return '';
    const names = entities.map((entity) =>
      spellName(maps.byEntity.get(entity), entityLabel(entity), lang),
    );
    return t(lang, 'tree.storyProjectilesInline', { names: names.join('、') });
  };

  const pushRepeat = (count: number, depth: number, groupId?: string) => {
    if (count <= 1) return;
    steps.push({ depth, tone: 'repeat', text: t(lang, 'tree.storyRepeat', { count }), deltas: [], groupId });
  };

  const walkEntry = (
    entry: GroupedEntry,
    depth: number,
    context: { parentAction?: string; parentActionDontDraw?: boolean; inTrigger?: boolean },
  ) => {
    if (entry.kind === 'sequence') {
      const isExpanded = expanded.has(entry.id);
      steps.push({
        depth,
        tone: 'repeat',
        text: t(lang, 'tree.storySequence', { count: entry.count }),
        deltas: [],
        groupId: entry.id,
      });
      const reps = isExpanded ? entry.count : 1;
      for (let rep = 0; rep < reps; rep += 1) {
        entry.pattern.forEach((item) => walkEntry(item, depth + 1, context));
      }
      return;
    }
    if (entry.repeat > 1 && expanded.has(entry.id)) {
      steps.push({
        depth,
        tone: 'repeat',
        text: t(lang, 'tree.storyRepeatExpanded', { count: entry.repeat }),
        deltas: [],
        groupId: entry.id,
      });
      for (let rep = 0; rep < entry.repeat; rep += 1) {
        walkNode(entry.group.node, entry.group.children, depth, context, 1, undefined);
      }
      return;
    }
    walkNode(entry.group.node, entry.group.children, depth, context, entry.repeat, entry.id);
  };

  const walkNode = (
    node: CastTreeNode,
    children: GroupedEntry[],
    depth: number,
    context: { parentAction?: string; parentActionDontDraw?: boolean; inTrigger?: boolean },
    repeat: number,
    groupId?: string,
  ) => {
    switch (node.kind) {
      case 'cast':
        walkChildren(children, 0, context);
        return;
      case 'drawBlock': {
        if (context.parentActionDontDraw) return;
        let text: string;
        if (context.inTrigger) {
          text = t(lang, 'tree.storyPayload', { count: node.count });
        } else if (context.parentAction) {
          text = t(lang, 'tree.storyDrawByAction', { name: context.parentAction, count: node.count });
        } else {
          text = node.count === 1 ? t(lang, 'tree.storyDrawOne') : t(lang, 'tree.storyDraw', { count: node.count });
        }
        steps.push({ depth, tone: 'draw', text, deltas: [] });
        walkChildren(children, depth + 1, {
          parentAction: undefined,
          parentActionDontDraw: undefined,
          inTrigger: undefined,
        });
        pushRepeat(repeat, depth + 1, groupId);
        return;
      }
      case 'drawCard': {
        const spell = node.spellId ? maps.byId.get(node.spellId) : undefined;
        const name = spell ? spellName(spell, node.spellId ?? '', lang) : '';
        const onlyChild = children.length === 1 ? children[0] : null;
        if (
          onlyChild &&
          onlyChild.kind === 'node' &&
          onlyChild.group.node.kind === 'action' &&
          onlyChild.repeat === 1 &&
          node.ok !== false
        ) {
          const actionNode = onlyChild.group.node;
          const actionSpell = maps.byId.get(actionNode.id);
          const actionName = spellName(actionSpell, actionNode.id, lang);
          steps.push({
            depth,
            tone: 'action',
            text: `${t(lang, 'tree.storyDrawAndAction', { name: actionName })}${actionAnnotations(actionNode)}${projectileText(
              actionNode.projectiles,
            )}${copiesNothing(actionNode) ? t(lang, 'tree.storyNoCopies') : ''}`,
            spell: actionSpell,
            deltas: showDeltas ? formatDeltas(actionNode.delta, lang) : [],
          });
          walkChildren(onlyChild.group.children, depth + 1, {
            parentAction: actionName,
            parentActionDontDraw: actionNode.dontDraw,
          });
          pushRepeat(repeat, depth + 1, groupId);
          return;
        }
        if (node.ok === false) {
          steps.push({ depth, tone: 'fail', text: t(lang, 'tree.storyCardFailed', { name }), spell, deltas: [] });
        } else if (node.spellId) {
          steps.push({ depth, tone: 'draw', text: t(lang, 'tree.storyCard', { name }), spell, deltas: [] });
        } else {
          steps.push({ depth, tone: 'fail', text: t(lang, 'tree.storyCardEmpty'), deltas: [] });
        }
        walkChildren(children, depth + 1, context);
        pushRepeat(repeat, depth + 1, groupId);
        return;
      }
      case 'action': {
        const spell = maps.byId.get(node.id);
        const name = spellName(spell, node.id, lang);
        const direct = node.deckIndex === null && !node.permanent;
        const text = `${direct ? t(lang, 'tree.storyCall', { name }) : t(lang, 'tree.storyAction', { name })}${actionAnnotations(
          node,
        )}${projectileText(node.projectiles)}${copiesNothing(node) ? t(lang, 'tree.storyNoCopies') : ''}`;
        steps.push({
          depth,
          tone: direct ? 'call' : 'action',
          text,
          spell,
          deltas: showDeltas ? formatDeltas(node.delta, lang) : [],
        });
        walkChildren(children, depth + 1, { parentAction: name, parentActionDontDraw: node.dontDraw });
        pushRepeat(repeat, depth + 1, groupId);
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
        walkChildren(children, depth + 1, { inTrigger: true });
        pushRepeat(repeat, depth + 1, groupId);
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
        pushRepeat(repeat, depth + 1, groupId);
        return;
      }
      default:
        return;
    }
  };

  const walkChildren = (
    entries: GroupedEntry[],
    depth: number,
    context: { parentAction?: string; parentActionDontDraw?: boolean; inTrigger?: boolean },
  ) => {
    let index = 0;
    while (index < entries.length) {
      const entry = entries[index];
      // group a run of "discarded by spell X" nodes into one sentence:
      //「一分二」收尾：从牌库顶依次弃掉 4 张牌（…）
      if (
        entry.kind === 'node' &&
        entry.repeat === 1 &&
        entry.group.node.kind === 'discard' &&
        entry.group.node.sourceAction
      ) {
        const source = entry.group.node.sourceAction;
        const run: string[] = [];
        while (index < entries.length) {
          const next = entries[index];
          const nextNode = next.kind === 'node' ? next.group.node : null;
          if (nextNode && nextNode.kind === 'discard' && nextNode.sourceAction === source) {
            run.push(nextNode.spellId);
            index += 1;
          } else {
            break;
          }
        }
        const sourceName = spellName(maps.byId.get(source), source, lang);
        const cards = run.map((id) => spellName(maps.byId.get(id), id, lang)).join('、');
        steps.push({
          depth,
          tone: 'discard',
          text:
            run.length === 1
              ? t(lang, 'tree.storyDiscardByAction', { action: sourceName, name: cards })
              : t(lang, 'tree.storyDiscardRun', { action: sourceName, count: run.length, cards }),
          spell: run.length === 1 ? maps.byId.get(run[0]) : undefined,
          deltas: [],
        });
        continue;
      }
      walkEntry(entry, depth, context);
      index += 1;
    }
  };

  walkEntry({ kind: 'node', group: root, copies: [root], repeat: 1, sig: '', id: 'root' }, 0, {});
  return steps;
}

// --- shot card -----------------------------------------------------------------

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
          const name = spellName(spell, id, lang);
          return (
            <span className="pile-chip" key={`${id}-${index}`} title={name} aria-label={name}>
              <SpellIcon spell={spell} data={data} />
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

function buildSlotMap(wandSpells: (string | null)[]): Map<string, number> {
  const map = new Map<string, number>();
  wandSpells.forEach((id, index) => {
    if (id && !map.has(id)) map.set(id, index + 1);
  });
  return map;
}

function ShotCard({
  shot,
  index,
  data,
  lang,
  showDeltas,
  foldRepeats,
  wandSpells,
}: {
  shot: ShotResult;
  index: number;
  data: GameData;
  lang: Lang;
  showDeltas: boolean;
  foldRepeats: boolean;
  wandSpells: (string | null)[];
}) {
  const maps = useSpellMaps(data);
  const slotMap = useMemo(() => buildSlotMap(wandSpells), [wandSpells]);
  const [treeOpen, setTreeOpen] = useState(true);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded(new Set());
  }, [shot, foldRepeats]);
  const toggleGroup = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const stats = useMemo(() => collectStats(shot.tree), [shot.tree]);
  const grouped = useMemo(() => groupTree(shot.tree, foldRepeats), [shot.tree, foldRepeats]);
  // 施法过程暂时停用：保留全部实现，需要恢复时把 SHOW_CASTING_STEPS 改成 true。
  const storyTree = useMemo(
    () => (SHOW_CASTING_STEPS ? groupTree(shot.tree, false) : null),
    [shot.tree],
  );
  const rawStory = useMemo(
    () => (storyTree ? buildStory(storyTree, lang, maps, showDeltas, slotMap, NO_EXPAND) : []),
    [storyTree, lang, maps, showDeltas, slotMap],
  );
  const story = useMemo(
    () => (foldRepeats ? foldStorySteps(rawStory, lang) : rawStory),
    [rawStory, lang, foldRepeats],
  );
  const castDiscards = useMemo(
    () =>
      shot.events.flatMap((event) =>
        event.type === 'discard' && event.sourceAction !== null ? [event.spellId] : [],
      ),
    [shot.events],
  );

  const renderStorySteps = (steps: StoryStep[], baseDepth = 0, prefix = '', level = 0): ReactNode =>
    steps.map((step, index) => {
      const key = `${prefix}${index}`;
      const marginLeft = (step.depth - baseDepth) * INDENT;
      if (step.pattern && step.groupId) {
        const isExpanded = expanded.has(step.groupId);
        const groups = isExpanded ? step.instances ?? [step.pattern] : [step.pattern];
        const color = sequenceColor(level);
        return (
          <li
            key={key}
            className="step step-sequence"
            style={{ marginLeft, boxShadow: `inset 3px 0 0 ${color}`, background: `${color}12` }}
          >
            <button
              type="button"
              className="step-seq-head"
              onClick={() => toggleGroup(step.groupId!)}
              title={t(lang, isExpanded ? 'tree.foldAgain' : 'tree.expand')}
              style={{ color }}
            >
              {step.text} {isExpanded ? '▾' : '▸'}
            </button>
            <ol
              className="step-sublist"
              style={{ boxShadow: `inset 3px 0 0 ${color}`, background: `${color}0d` }}
            >
              {groups.map((group, rep) => (
                <Fragment key={rep}>
                  {renderStorySteps(group, step.depth, `${key}-${rep}-`, level + 1)}
                </Fragment>
              ))}
            </ol>
          </li>
        );
      }
      return (
        <li key={key} className={`step step-${step.tone}`} style={{ marginLeft }}>
          {step.spell && <SpellIcon spell={step.spell} data={data} />}
          {step.groupId ? (
            <button
              type="button"
              className="step-text step-repeat-toggle"
              onClick={() => toggleGroup(step.groupId!)}
              title={t(lang, expanded.has(step.groupId) ? 'tree.foldAgain' : 'tree.expand')}
            >
              {step.text} {expanded.has(step.groupId) ? '▾' : '▸'}
            </button>
          ) : (
            <span className="step-text">{step.text}</span>
          )}
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
      );
    });

  return (
    <article className="shot-card" data-shot={index + 1}>
      <header className="shot-header">
        <h3>{t(lang, 'result.shotN', { n: index + 1 })}</h3>
        <span className="shot-stat">{t(lang, 'result.mana', { before: shot.manaBefore, after: shot.manaAfter })}</span>
        <span className="shot-stat">
          {t(lang, 'result.castDelay')} {formatFramesAsSeconds(shot.castDelayFrames)}s
        </span>
        <span className="shot-stat">
          {t(lang, 'result.recharge')} {formatFramesAsSeconds(shot.reloadTimeFrames ?? shot.reloadFrames)}s
        </span>
        {shot.reloaded && (
          <span className="badge reloaded" title={t(lang, 'result.reloadedHint')}>
            {t(lang, 'result.reloaded')}
          </span>
        )}
      </header>

      <SpellSummary tree={shot.tree} data={data} lang={lang} maps={maps} castState={shot.castState} />

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
                  repeat={1}
                  expanded={expanded}
                  onToggle={toggleGroup}
                  data={data}
                  lang={lang}
                  maps={maps}
                  showDeltas={showDeltas}
                  slotMap={slotMap}
                />
              </div>
            ))}
        </section>
        <section className="piles">
          <h4>
            {t(lang, 'result.piles')} <span className="muted small">{t(lang, 'result.pilesNote')}</span>
          </h4>
          <div className="piles-grid">
            <Pile title={t(lang, 'result.pileDeck')} ids={shot.deck} data={data} lang={lang} maps={maps} />
            <Pile title={t(lang, 'result.pileHand')} ids={shot.hand} data={data} lang={lang} maps={maps} />
            <Pile title={t(lang, 'result.pileDiscard')} ids={shot.discarded} data={data} lang={lang} maps={maps} />
            {castDiscards.length > 0 && (
              <div className="cast-discards">
                <Pile title={t(lang, 'result.castDiscards')} ids={castDiscards} data={data} lang={lang} maps={maps} />
                <div className="pile-note muted small">{t(lang, 'result.castDiscardsNote')}</div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 施法过程暂时停用（保留实现）：恢复时把 SHOW_CASTING_STEPS 改成 true */}
      {SHOW_CASTING_STEPS && (
        <section className="shot-steps">
          <h4 className="tree-heading">
            <button
              type="button"
              className="section-toggle"
              aria-expanded={stepsOpen}
              onClick={() => setStepsOpen((open) => !open)}
            >
              {stepsOpen ? '▾' : '▸'} {t(lang, 'result.steps')}
            </button>
          </h4>
          {stepsOpen && <ol className="step-list">{renderStorySteps(story)}</ol>}
        </section>
      )}

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
    </article>
  );
}

export function CastResult({
  result,
  data,
  lang,
  mode,
  onModeChange,
  simulating,
  error,
  wandSpells,
}: Props) {
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
              wandSpells={wandSpells}
            />
          ))}
        </div>
      )}
    </section>
  );
}
