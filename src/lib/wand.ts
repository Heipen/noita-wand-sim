import type { WandConfig } from '../engine/types';

export const MAX_CAPACITY = 26;
export const MAX_ALWAYS_CAST = 4;

export interface WandState {
  name: string;
  actionsPerRound: number;
  shuffle: boolean;
  rechargeFrames: number;
  castDelayFrames: number;
  manaMax: number;
  manaChargeSpeed: number;
  capacity: number;
  spreadDegrees: number;
  speedMultiplier: number;
  spells: (string | null)[];
  alwaysCast: (string | null)[];
}

export function createEmptyWand(): WandState {
  return {
    name: '',
    actionsPerRound: 1,
    shuffle: false,
    rechargeFrames: 29,
    castDelayFrames: 10,
    manaMax: 250,
    manaChargeSpeed: 200,
    capacity: 10,
    spreadDegrees: -2,
    speedMultiplier: 1,
    spells: Array.from({ length: MAX_CAPACITY }, () => null),
    alwaysCast: Array.from({ length: MAX_ALWAYS_CAST }, () => null),
  };
}

/** Wand used before the user touches anything: a simple trigger wand from the wiki examples. */
export function createDefaultWand(): WandState {
  const wand = createEmptyWand();
  wand.name = '触发火花弹';
  wand.capacity = 5;
  wand.actionsPerRound = 1;
  wand.rechargeFrames = 29;
  wand.castDelayFrames = 10;
  wand.manaMax = 250;
  wand.manaChargeSpeed = 200;
  wand.spells[0] = 'LIGHT_BULLET_TRIGGER';
  wand.spells[1] = 'BOMB';
  return wand;
}

export function normalizeWand(wand: WandState): WandState {
  const capacity = Math.min(MAX_CAPACITY, Math.max(1, Math.round(wand.capacity)));
  const spells = Array.from({ length: MAX_CAPACITY }, (_, index) => wand.spells[index] ?? null);
  const alwaysCast = Array.from({ length: MAX_ALWAYS_CAST }, (_, index) => wand.alwaysCast[index] ?? null);
  return {
    ...wand,
    capacity,
    actionsPerRound: Math.min(MAX_CAPACITY, Math.max(1, Math.round(wand.actionsPerRound))),
    rechargeFrames: Math.max(0, Math.round(wand.rechargeFrames)),
    castDelayFrames: Math.round(wand.castDelayFrames),
    manaMax: Math.max(1, Math.round(wand.manaMax)),
    manaChargeSpeed: Math.max(0, Math.round(wand.manaChargeSpeed)),
    spells,
    alwaysCast,
  };
}

export function toEngineWand(wand: WandState): WandConfig {
  const normalized = normalizeWand(wand);
  const spells = normalized.spells.slice(0, normalized.capacity);
  return {
    actions_per_round: normalized.actionsPerRound,
    shuffle_deck_when_empty: normalized.shuffle,
    reload_time: normalized.rechargeFrames,
    deck_capacity: normalized.capacity,
    cast_delay: normalized.castDelayFrames,
    mana_max: normalized.manaMax,
    mana_charge_speed: normalized.manaChargeSpeed,
    spells,
    always_cast: normalized.alwaysCast,
  };
}

export function wandSlots(wand: WandState): (string | null)[] {
  return wand.spells.slice(0, wand.capacity);
}

export function placeSpell(wand: WandState, slot: number, spellId: string | null): WandState {
  const spells = [...wand.spells];
  if (slot >= 0 && slot < MAX_CAPACITY) spells[slot] = spellId;
  return normalizeWand({ ...wand, spells });
}

export function swapSlots(wand: WandState, from: number, to: number): WandState {
  const spells = [...wand.spells];
  const tmp = spells[to] ?? null;
  spells[to] = spells[from] ?? null;
  spells[from] = tmp;
  return normalizeWand({ ...wand, spells });
}

export function firstEmptySlot(wand: WandState): number {
  const slots = wandSlots(wand);
  return slots.findIndex((slot) => slot === null);
}

export function setAlwaysCast(wand: WandState, slot: number, spellId: string | null): WandState {
  if (slot < 0 || slot >= MAX_ALWAYS_CAST) return wand;
  const alwaysCast = [...wand.alwaysCast];
  alwaysCast[slot] = spellId;
  return normalizeWand({ ...wand, alwaysCast });
}

/** Count non-empty slots (for showing "x / capacity"). */
export function filledSlots(wand: WandState): number {
  return wandSlots(wand).filter((slot) => slot !== null).length;
}

// --- URL sharing (compatible with the wiki's v2 Tinker parameters) -----------

export const URL_PARAMS = ['a', 'l', 'r', 'd', 'c', 'm', 'q', 'v', 'x', 'n', 's', 'w'] as const;

export function encodeWandToQuery(wand: WandState): string {
  const normalized = normalizeWand(wand);
  const params = new URLSearchParams();
  params.set('a', String(normalized.actionsPerRound));
  params.set('l', String(normalized.capacity));
  params.set('r', String(normalized.rechargeFrames));
  params.set('d', String(normalized.castDelayFrames));
  params.set('c', String(normalized.manaChargeSpeed));
  params.set('m', String(normalized.manaMax));
  params.set('q', String(normalized.spreadDegrees));
  params.set('v', String(normalized.speedMultiplier));
  params.set('x', normalized.shuffle ? '1' : '0');
  if (normalized.name) params.set('n', normalized.name);
  params.set('s', wandSlots(normalized).map((id) => id ?? '').join(','));
  const always = normalized.alwaysCast.filter((id): id is string => Boolean(id));
  if (always.length > 0) params.set('w', always.join(','));
  return params.toString();
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function decodeWandFromQuery(search: string): WandState | null {
  const params = new URLSearchParams(search);
  if (!params.has('s') && !params.has('a') && !params.has('l')) return null;
  const wand = createEmptyWand();

  const readInt = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw === null || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clampInt(value, -100000, 100000) : fallback;
  };

  // frames: integers are frames, decimals are seconds (the wiki exports values*60)
  const readFrames = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Number.isInteger(value) ? value : Math.round(value * 60);
  };

  wand.actionsPerRound = Math.min(MAX_CAPACITY, Math.max(1, readInt('a', wand.actionsPerRound)));
  wand.capacity = Math.min(MAX_CAPACITY, Math.max(1, readInt('l', wand.capacity)));
  wand.rechargeFrames = Math.max(0, readFrames('r', wand.rechargeFrames));
  wand.castDelayFrames = readFrames('d', wand.castDelayFrames);
  wand.manaChargeSpeed = Math.max(0, readInt('c', wand.manaChargeSpeed));
  wand.manaMax = Math.max(1, readInt('m', wand.manaMax));
  wand.spreadDegrees = readInt('q', wand.spreadDegrees);
  wand.speedMultiplier = Number(params.get('v')) || wand.speedMultiplier;
  wand.shuffle = params.get('x') === '1';
  wand.name = params.get('n') ?? '';

  const spells = (params.get('s') ?? '').split(',');
  for (let i = 0; i < MAX_CAPACITY; i++) {
    const id = (spells[i] ?? '').trim();
    wand.spells[i] = id.length > 0 ? id : null;
  }
  const always = (params.get('w') ?? '').split(',');
  for (let i = 0; i < MAX_ALWAYS_CAST; i++) {
    const id = (always[i] ?? '').trim();
    wand.alwaysCast[i] = id.length > 0 ? id : null;
  }
  return normalizeWand(wand);
}

export function shareUrlForWand(wand: WandState): string {
  const url = new URL(window.location.href);
  url.search = encodeWandToQuery(wand);
  url.hash = '';
  return url.toString();
}
