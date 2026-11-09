// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatFramesAsSeconds, parseUrlFrames } from '../src/lib/format';
import {
  decodeWandFromQuery,
  encodeWandToQuery,
  createDefaultWand,
  createEmptyWand,
  firstEmptySlot,
  placeSpell,
  setAlwaysCast,
  swapSlots,
  toEngineWand,
  wandSlots,
} from '../src/lib/wand';

describe('frames formatting', () => {
  it('converts frames to the seconds shown by the game', () => {
    expect(formatFramesAsSeconds(3)).toBe('0.05');
    expect(formatFramesAsSeconds(-8)).toBe('-0.13');
    expect(formatFramesAsSeconds(0)).toBe('0');
  });

  it('parses URL frame params (integers = frames, decimals = seconds)', () => {
    expect(parseUrlFrames('10')).toBe(10);
    expect(parseUrlFrames('0.17')).toBe(10);
    expect(parseUrlFrames('')).toBeNull();
    expect(parseUrlFrames('abc')).toBeNull();
  });
});

describe('wand helpers', () => {
  it('builds an engine wand with the expected fields', () => {
    const wand = placeSpell(createEmptyWand(), 0, 'LIGHT_BULLET');
    const config = toEngineWand(wand);
    expect(config.spells[0]).toBe('LIGHT_BULLET');
    expect(config.cast_delay).toBe(wand.castDelayFrames);
    expect(config.reload_time).toBe(wand.rechargeFrames);
    expect(config.mana_max).toBe(wand.manaMax);
  });

  it('places, swaps and removes spells', () => {
    let wand = createEmptyWand();
    wand = placeSpell(wand, 2, 'BOMB');
    wand = placeSpell(wand, 0, 'LIGHT_BULLET');
    expect(wandSlots(wand).slice(0, 3)).toEqual(['LIGHT_BULLET', null, 'BOMB']);
    expect(firstEmptySlot(wand)).toBe(1);
    wand = swapSlots(wand, 0, 2);
    expect(wandSlots(wand).slice(0, 3)).toEqual(['BOMB', null, 'LIGHT_BULLET']);
    wand = placeSpell(wand, 0, null);
    expect(wandSlots(wand)[0]).toBeNull();
  });

  it('sets always-cast slots', () => {
    const wand = setAlwaysCast(createEmptyWand(), 1, 'DAMAGE');
    expect(wand.alwaysCast[1]).toBe('DAMAGE');
    expect(setAlwaysCast(wand, 9, 'BOMB')).toBe(wand); // out of range is ignored
  });

  it('clamps capacity and action counts', () => {
    const wand = createDefaultWand();
    const config = toEngineWand({ ...wand, capacity: 999, actionsPerRound: 0, rechargeFrames: -5 });
    expect(config.deck_capacity).toBe(26);
    expect(config.actions_per_round).toBe(1);
    expect(config.reload_time).toBe(0);
  });
});

describe('URL share format', () => {
  it('round-trips a wand', () => {
    let wand = createDefaultWand();
    wand.spells[2] = 'DAMAGE';
    wand.alwaysCast[0] = 'HOMING';
    wand.shuffle = true;
    wand.name = '测试杖';
    const decoded = decodeWandFromQuery(`?${encodeWandToQuery(wand)}`);
    expect(decoded).not.toBeNull();
    expect(decoded?.actionsPerRound).toBe(wand.actionsPerRound);
    expect(decoded?.capacity).toBe(wand.capacity);
    expect(decoded?.castDelayFrames).toBe(wand.castDelayFrames);
    expect(decoded?.rechargeFrames).toBe(wand.rechargeFrames);
    expect(decoded?.manaMax).toBe(wand.manaMax);
    expect(decoded?.shuffle).toBe(true);
    expect(decoded?.name).toBe('测试杖');
    expect(decoded?.spells.slice(0, 3)).toEqual([wand.spells[0], wand.spells[1], 'DAMAGE']);
    expect(decoded?.alwaysCast[0]).toBe('HOMING');
  });

  it('accepts the wiki (v2) parameter names and second-based delays', () => {
    const decoded = decodeWandFromQuery(
      '?a=2&l=12&r=0.48&d=0.17&c=200&m=900&q=-2&v=1.2&x=1&s=LIGHT_BULLET,,BOMB&w=DAMAGE',
    );
    expect(decoded).not.toBeNull();
    expect(decoded?.actionsPerRound).toBe(2);
    expect(decoded?.capacity).toBe(12);
    expect(decoded?.rechargeFrames).toBe(29);
    expect(decoded?.castDelayFrames).toBe(10);
    expect(decoded?.shuffle).toBe(true);
    expect(decoded?.spells.slice(0, 3)).toEqual(['LIGHT_BULLET', null, 'BOMB']);
    expect(decoded?.alwaysCast[0]).toBe('DAMAGE');
  });

  it('returns null for an unrelated query string', () => {
    expect(decodeWandFromQuery('?utm_source=x')).toBeNull();
  });
});
