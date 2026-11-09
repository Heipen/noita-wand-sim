import { ZH_ALIAS_NOTES, ZH_COMMUNITY_NAMES } from './aliases';
import type { Translations } from './csv';
import type { RawSpell, SpellMeta, SpellType } from './types';

const TYPE_BY_VALUE: Record<number, SpellType> = {
  0: 'projectile',
  1: 'static_projectile',
  2: 'modifier',
  3: 'draw_many',
  4: 'material',
  5: 'other',
  6: 'utility',
  7: 'passive',
};

function stripDollar(key: string | null | undefined): string {
  return (key ?? '').replace(/^\$/, '');
}

/** Fallback human readable name from an ID like `LIGHT_BULLET_TRIGGER`. */
function prettifyId(id: string): string {
  return id
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function resolveSpell(raw: RawSpell, tr: Translations): SpellMeta {
  const nameKey = stripDollar(raw.nameKey);
  const descKey = stripDollar(raw.descKey);

  const fallback = prettifyId(raw.id);
  const nameEn = tr.get(nameKey, 'en') ?? fallback;
  const nameZh = tr.get(nameKey, 'zh') ?? nameEn;
  const descEn = tr.get(descKey, 'en') ?? '';
  const descZh = tr.get(descKey, 'zh') ?? descEn;

  const community = ZH_COMMUNITY_NAMES[raw.id];
  return {
    ...raw,
    type: TYPE_BY_VALUE[raw.typeValue] ?? 'unknown',
    nameEn,
    nameZh,
    displayZh: community ?? nameZh,
    aliasNoteZh: ZH_ALIAS_NOTES[raw.id],
    descEn,
    descZh,
  };
}
