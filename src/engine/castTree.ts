import type { CastBlock, EngineEvent, ProjectileNode } from './types';

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
