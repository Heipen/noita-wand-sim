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
  customXmlFile: string | null;
  recursive: boolean;
  price: number | null;
  spawnRequiresFlag: string | null;
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
}

export interface GameData {
  wak: WakArchive;
  spells: SpellMeta[];
  /** Stable signature of the imported data (hash of gun_actions.lua + wak header). */
  signature: string;
  importedAt: number;
  sourceName: string;
  /** Whether common.csv was available (Chinese names). */
  hasTranslations: boolean;
}
