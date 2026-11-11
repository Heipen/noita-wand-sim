export type Lang = 'zh' | 'en';

export type SpellType =
  | 'projectile'
  | 'static_projectile'
  | 'modifier'
  | 'draw_many'
  | 'material'
  | 'other'
  | 'utility'
  | 'passive'
  | 'unknown';

export const SPELL_TYPES: SpellType[] = [
  'projectile',
  'static_projectile',
  'modifier',
  'draw_many',
  'material',
  'other',
  'utility',
  'passive',
];

export interface WakEntry {
  name: string;
  offset: number;
  size: number;
}

export interface WakArchive {
  version: number;
  fileCount: number;
  dataStart: number;
  entries: Map<string, WakEntry>;
  bytes: Uint8Array;
}

/** Raw spell row as exported from the game's `gun_actions.lua` actions table. */
export interface RawSpell {
  id: string;
  nameKey: string;
  descKey: string;
  typeValue: number;
  mana: number | null;
  maxUses: number | null;
  sprite: string | null;
  spriteUnidentified: string | null;
  relatedProjectiles: string[];
  relatedExtraEntities: string[];
  customXmlFile: string | null;
  recursive: boolean;
  price: number | null;
  spawnRequiresFlag: string | null;
  /** `spawn_level` from gun_actions.lua, e.g. "2,3,4,10" (法术等级). */
  spawnLevel: string | null;
  /** `spawn_probability`, e.g. "0.1,0.1,0.1,0.2" (对应等级生成权重). */
  spawnProbability: string | null;
  spawnManualUnlock: boolean;
  isDangerousBlast: boolean;
  /** Cannot be made unlimited by the Unlimited Spells perk. */
  neverUnlimited: boolean;
  /** Reflection pass: this spell's contribution to cast delay, in frames. */
  castDelayFrames: number;
  /** Reflection pass: this spell's contribution to recharge time, in frames. */
  reloadFrames: number;
  /** Reflection pass: multicast count (`action_draw_many_count`). */
  drawManyCount: number;
  /** Reflection pass: all non-default shot-state fields (for tooltip / stats panel). */
  stateDelta: Record<string, number | string>;
}

export interface SpellMeta extends RawSpell {
  type: SpellType;
  /** English display name (official translation). */
  nameEn: string;
  /** Official zh-cn name from common.csv. */
  nameZh: string;
  /** Name shown in Chinese UI (community alias when available). */
  displayZh: string;
  /** Optional tooltip note, e.g. official translation vs community name. */
  aliasNoteZh?: string;
  descEn: string;
  descZh: string;
  /** Relative path of the bundled icon (e.g. `data/sprites/light_bullet.png`). */
  icon?: string | null;
  /** Chinese unlock condition text (from the Chinese wiki Cargo table, attribution required). */
  unlockZh?: string | null;
}

export type DataOrigin = 'bundled' | 'local';

export interface GameData {
  spells: SpellMeta[];
  /** Stable signature of the game data (hash of gun_actions.lua). */
  signature: string;
  importedAt: number;
  sourceName: string;
  /** Whether zh-cn translations were available (bundled pack always has them). */
  hasTranslations: boolean;
  origin: DataOrigin;
  /** Present only for locally imported data; bundled data uses static icon paths. */
  wak?: WakArchive;
}
