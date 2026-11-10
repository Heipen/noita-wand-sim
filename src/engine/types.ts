/** Public types of the wand rule engine (M1). */

export type EngineEvent =
  | { type: 'shotStart'; mana: number; frame: number }
  | { type: 'orderDeck'; shuffled: boolean }
  | { type: 'draw'; deckBefore: number; deckAfter: number; cardsDrawn: number; ok: boolean | null }
  | { type: 'drawBlockBegin'; count: number; instantReload: boolean }
  | { type: 'drawBlockEnd' }
  | {
      type: 'drawCard';
      spellId: string | null;
      deckBefore: number;
      deckAfter: number;
      ok: boolean | null;
      /** Mana available before/after the draw attempt (used to explain failed draws). */
      manaBefore?: number;
      manaAfter?: number;
    }
  | { type: 'playAction'; id: string; deckIndex: number | null }
  | {
      type: 'callAction';
      id: string;
      recursion: number | null;
      iteration: number | null;
      dontDraw: boolean;
      permanent: boolean;
      /** Shot-state lifetime addition when this action started (e.g. CESSATION duration). */
      lifetimeAdd?: number;
      delta?: Record<string, number>;
    }
  | { type: 'callActionEnd' }
  | { type: 'discard'; spellId: string; discardedCount: number; sourceAction: string | null }
  | {
      type: 'action';
      id: string;
      deckIndex?: number | null;
      delta?: Record<string, number>;
      lifetimeAdd?: number;
    }
  | { type: 'projectileBegin'; entity: string }
  | { type: 'projectileEnd' }
  | { type: 'triggerBegin'; kind: 'timer' | 'hitWorld' | 'death'; delayFrames?: number }
  | { type: 'triggerEnd' }
  | { type: 'notEnoughMana' }
  | { type: 'reload'; timeFrames: number }
  | { type: 'shotEnd'; castDelayFrames: number; reloadFrames: number };

export interface ActionCallNode {
  id: string;
  deckIndex: number | null;
  /** Shot-state fields this action changed (after - before), for human-readable explanations. */
  delta?: Record<string, number>;
  /** Accumulated `lifetime_add` when the action ran (used by CESSATION's own duration). */
  lifetimeAdd?: number;
}

/** Evaluation tree node: the wand draw → card draw → action call hierarchy. */
export type CastTreeNode =
  | { kind: 'cast'; children: CastTreeNode[] }
  | { kind: 'drawBlock'; count: number; instantReload: boolean; children: CastTreeNode[] }
  | {
      kind: 'drawCard';
      spellId: string | null;
      ok: boolean | null;
      deckBefore: number;
      deckAfter: number;
      /** Mana before/after the draw attempt; a failed draw usually means "not enough mana". */
      manaBefore?: number;
      manaAfter?: number;
      children: CastTreeNode[];
    }
  | {
      kind: 'action';
      id: string;
      deckIndex: number | null;
      recursion: number | null;
      iteration: number | null;
      dontDraw: boolean;
      permanent: boolean;
      delta?: Record<string, number>;
      lifetimeAdd?: number;
      projectiles: string[];
      children: CastTreeNode[];
    }
  | {
      kind: 'trigger';
      triggerKind: 'timer' | 'hitWorld' | 'death';
      projectile: string | null;
      children: CastTreeNode[];
    }
  | { kind: 'discard'; spellId: string; sourceAction: string | null; children: CastTreeNode[] };

export interface ProjectileNode {
  entity: string;
  /** Which kind of trigger this projectile carries (hit world / timer / death). */
  triggerKind?: 'timer' | 'hitWorld' | 'death';
  trigger?: CastBlock;
}

export interface CastBlock {
  projectiles: ProjectileNode[];
  /** Spells executed in this cast block, in call order. */
  actions: ActionCallNode[];
  castState: Record<string, number | string>;
}

export interface ShotResult {
  /** One cast block per wand click. */
  block: CastBlock;
  /** Evaluation tree: wand draws → drawn cards → called actions → nested draws/triggers. */
  tree: CastTreeNode;
  /** Raw ordered event log (for detailed UI / debugging). */
  events: EngineEvent[];
  /** Root shot state after the cast (cast delay, damage modifiers, spread, ...). */
  castState: Record<string, number | string>;
  manaBefore: number;
  manaAfter: number;
  /** `fire_rate_wait` (cast delay) at the end of this shot, in frames. */
  castDelayFrames: number;
  /** `current_reload_time` at the end of this shot, in frames. */
  reloadFrames: number;
  /** Reload time reported by StartReload for this shot (null when no reload). */
  reloadTimeFrames: number | null;
  reloaded: boolean;
  frame: number;
  deck: string[];
  hand: string[];
  discarded: string[];
}

export interface SimulationResult {
  shots: ShotResult[];
  mana: number;
  frame: number;
}

export interface WandConfig {
  actions_per_round: number;
  shuffle_deck_when_empty: boolean;
  /** Wand recharge time, frames. */
  reload_time: number;
  deck_capacity: number;
  /** Wand cast delay, frames (added to spell cast delay contributions). */
  cast_delay?: number;
  mana_max?: number;
  /** Mana regeneration per second. */
  mana_charge_speed?: number;
  /** Spell ids in slot order; `null` = empty slot. */
  spells: (string | null)[];
  /** Always-cast spell ids. */
  always_cast?: (string | null)[];
}

export interface WandSpell {
  id: string;
  /** Remaining uses, null/undefined = use the spell's max_uses from the data pack. */
  uses?: number | null;
}

export interface ExtraWand {
  spells: string[];
}

export interface RequirementOptions {
  enemies?: boolean;
  projectiles?: boolean;
  hp?: boolean;
  half?: boolean;
}

export interface SimulateOptions {
  /** Number of clicks to simulate (default 1). */
  clicks?: number;
  /** Starting mana; defaults to the wand's mana max. */
  mana?: number;
  /** Starting frame number (default 0). Used by RNG seeds. */
  frame?: number;
  /** World seed for the engine RNG (default 0). */
  worldSeed?: number;
  /** Other wands in the inventory, for ZETA. */
  extraWands?: ExtraWand[];
  /** World conditions for toggled spells (IF_ENEMY / IF_HP / ...). */
  requirements?: RequirementOptions;
  /** Stop after the wand reloads (like the old simulator's "cast until reload"). */
  untilReload?: boolean;
  /** Safety limit for untilReload mode. */
  maxShots?: number;
}

export interface ScriptSource {
  read(path: string): string | undefined | Promise<string | undefined>;
}
