import type { CastBlock, CastTreeNode, EngineEvent, ProjectileNode } from './types';

/**
 * Build the *evaluation tree* of one wand click:
 *
 *   cast
 *   └─ drawBlock (spells/cast)          "抽取 N 张"
 *      └─ drawCard (top card)          "抽到 伤害增强（槽位 #2）"
 *         └─ action                    "执行 伤害增强（修正）"
 *            └─ drawBlock              "伤害增强再抽 1 张"
 *               └─ drawCard → action → ...
 *            └─ trigger                "命中触发 → 载荷"
 *               └─ drawBlock ...
 *
 * This mirrors the wiki's preload model and is what the UI renders as the cast tree.
 */
export function buildCastTree(events: EngineEvent[]): CastTreeNode {
  const root: CastTreeNode = { kind: 'cast', children: [] };
  const stack: CastTreeNode[] = [root];
  let pendingPlay: { id: string; deckIndex: number | null } | null = null;
  let lastProjectile: string | null = null;
  // A card's action runs *inside* draw_action, while the drawCard event is emitted when
  // draw_action returns. Keep the played action around and move it under its drawCard node.
  const unattachedActions: { action: CastTreeNode; parent: CastTreeNode }[] = [];

  const top = (): CastTreeNode => stack[stack.length - 1];

  const nearest = (kind: CastTreeNode['kind']): CastTreeNode | null => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].kind === kind) return stack[i];
    }
    return null;
  };

  for (const event of events) {
    switch (event.type) {
      case 'drawBlockBegin': {
        const node: CastTreeNode = {
          kind: 'drawBlock',
          count: event.count,
          instantReload: event.instantReload,
          children: [],
        };
        top().children.push(node);
        stack.push(node);
        break;
      }
      case 'drawCard': {
        const block = nearest('drawBlock') ?? top();
        let drawnAction: CastTreeNode | null = null;
        // find the played action that belongs to *this* draw block (nested draws consume
        // their own actions first, so search from the end)
        for (let i = unattachedActions.length - 1; i >= 0; i--) {
          const candidate = unattachedActions[i];
          if (candidate.parent !== block) continue;
          unattachedActions.splice(i, 1);
          const index = block.children.indexOf(candidate.action);
          if (index >= 0) block.children.splice(index, 1);
          drawnAction = candidate.action;
          break;
        }
        const node: CastTreeNode = {
          kind: 'drawCard',
          spellId: event.spellId,
          ok: event.ok,
          deckBefore: event.deckBefore,
          deckAfter: event.deckAfter,
          children: drawnAction ? [drawnAction] : [],
        };
        block.children.push(node);
        break;
      }
      case 'playAction':
        pendingPlay = { id: event.id, deckIndex: event.deckIndex };
        break;
      case 'callAction': {
        const parent = top();
        const fromPlay = pendingPlay !== null;
        const deckIndex = pendingPlay?.deckIndex ?? null;
        pendingPlay = null;
        const node: CastTreeNode = {
          kind: 'action',
          id: event.id,
          deckIndex,
          recursion: event.recursion,
          iteration: event.iteration,
          dontDraw: event.dontDraw,
          permanent: event.permanent,
          delta: event.delta,
          projectiles: [],
          children: [],
        };
        parent.children.push(node);
        stack.push(node);
        if (fromPlay) unattachedActions.push({ action: node, parent });
        break;
      }
      case 'callActionEnd': {
        while (stack.length > 1) {
          const popped = stack.pop();
          if (popped?.kind === 'action') break;
        }
        break;
      }
      case 'triggerBegin': {
        const node: CastTreeNode = {
          kind: 'trigger',
          triggerKind: event.kind,
          projectile: lastProjectile,
          children: [],
        };
        top().children.push(node);
        stack.push(node);
        break;
      }
      case 'triggerEnd':
        if (top().kind === 'trigger') stack.pop();
        break;
      case 'projectileBegin': {
        lastProjectile = event.entity;
        const action = nearest('action');
        if (action && action.kind === 'action') action.projectiles.push(event.entity);
        break;
      }
      case 'drawBlockEnd': {
        while (stack.length > 1) {
          const popped = stack.pop();
          if (popped?.kind === 'drawBlock') break;
        }
        break;
      }
      case 'discard': {
        const node: CastTreeNode = {
          kind: 'discard',
          spellId: event.spellId,
          sourceAction: event.sourceAction,
          children: [],
        };
        top().children.push(node);
        break;
      }
      default:
        break;
    }
  }
  return root;
}

/**
 * Build the nested cast-block tree (a projectile carries a trigger block) from the flat
 * ordered event log produced by the Lua shim.
 *
 * `castState` is filled in by the engine from the root shot state snapshot.
 */
export function buildCastBlock(events: EngineEvent[]): CastBlock {
  const root: CastBlock = { projectiles: [], actions: [], castState: {} };
  const stack: CastBlock[] = [root];
  const lastProjectile = new Map<CastBlock, ProjectileNode>();

  for (const event of events) {
    const current = stack[stack.length - 1];
    switch (event.type) {
      case 'action':
        current.actions.push({ id: event.id, deckIndex: event.deckIndex ?? null, delta: event.delta });
        break;
      case 'projectileBegin': {
        const node: ProjectileNode = { entity: event.entity };
        current.projectiles.push(node);
        lastProjectile.set(current, node);
        break;
      }
      case 'triggerBegin': {
        const carrier = lastProjectile.get(current);
        const block: CastBlock = { projectiles: [], actions: [], castState: {} };
        if (carrier) {
          carrier.trigger = block;
          carrier.triggerKind = event.kind;
        }
        stack.push(block);
        break;
      }
      case 'triggerEnd':
        if (stack.length > 1) stack.pop();
        break;
      default:
        break;
    }
  }
  return root;
}

/** Flatten all projectiles of a block (depth first), useful for tests / lists. */
export function flattenProjectiles(block: CastBlock): ProjectileNode[] {
  const out: ProjectileNode[] = [];
  const visit = (node: ProjectileNode) => {
    out.push(node);
    if (node.trigger) for (const child of node.trigger.projectiles) visit(child);
  };
  for (const node of block.projectiles) visit(node);
  return out;
}
