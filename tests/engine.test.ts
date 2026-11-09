// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWandEngine, type WandEngine } from '../src/engine/engine';
import { ENGINE_SCRIPT_PATHS, staticScriptSource } from '../src/engine/sources';
import { flattenProjectiles } from '../src/engine/castTree';
import type { SimulateOptions, WandConfig } from '../src/engine/types';

const DATA_DIR = join(process.cwd(), 'public/data');
const available = existsSync(join(DATA_DIR, 'game/scripts/gun/gun.lua'));

const wand = (spells: (string | null)[], extra: Partial<WandConfig> = {}): WandConfig => ({
  actions_per_round: 1,
  shuffle_deck_when_empty: false,
  reload_time: 40,
  deck_capacity: 26,
  spells,
  ...extra,
});

const projectileNames = (shot: { block: unknown }) =>
  flattenProjectiles(shot.block as never).map((node) => node.entity.split('/').pop());

describe.skipIf(!available)('rule engine (real gun.lua from the data pack)', () => {
  let engine: WandEngine;

  beforeAll(async () => {
    const files = new Map<string, string>();
    for (const gamePath of ENGINE_SCRIPT_PATHS) {
      files.set(gamePath, readFileSync(join(DATA_DIR, 'game', gamePath.slice('data/'.length)), 'utf8'));
    }
    engine = await createWandEngine(staticScriptSource(files));
  });

  afterAll(() => {
    engine.dispose();
  });

  it('loads the full spell table', () => {
    expect(engine.getSpellIds().length).toBe(422);
    expect(engine.getSpellIds()).toContain('LIGHT_BULLET');
  });

  it('casts a single projectile', () => {
    const result = engine.simulate(wand(['LIGHT_BULLET']));
    const shot = result.shots[0];
    expect(projectileNames(shot)).toEqual(['light_bullet.xml']);
    expect(shot.manaBefore - shot.manaAfter).toBe(5);
    expect(shot.castDelayFrames).toBe(3);
    expect(shot.reloaded).toBe(true);
    expect(shot.events.filter((event) => event.type === 'action').map((event) => (event as { id: string }).id)).toEqual([
      'LIGHT_BULLET',
    ]);
  });

  it('casts multiple spells per round and accumulates cast delay', () => {
    const shot = engine.simulate(wand(['LIGHT_BULLET', 'BOMB'], { actions_per_round: 2 })).shots[0];
    expect(projectileNames(shot)).toEqual(['light_bullet.xml', 'bomb.xml']);
    expect(shot.castDelayFrames).toBe(103); // 3 + 100
    expect(shot.manaBefore - shot.manaAfter).toBe(30);
  });

  it('nests trigger payloads', () => {
    const shot = engine.simulate(wand(['LIGHT_BULLET_TRIGGER', 'BOMB'])).shots[0];
    expect(shot.block.projectiles).toHaveLength(1);
    expect(shot.block.projectiles[0].trigger?.projectiles.map((p) => p.entity)).toEqual([
      'data/entities/projectiles/bomb.xml',
    ]);
  });

  it('supports add trigger / add timer / add death trigger', () => {
    for (const [modifier, kind] of [
      ['ADD_TRIGGER', 'hitWorld'],
      ['ADD_TIMER', 'timer'],
      ['ADD_DEATH_TRIGGER', 'death'],
    ] as const) {
      const shot = engine.simulate(wand([modifier, 'LIGHT_BULLET', 'BOMB'])).shots[0];
      expect(shot.block.projectiles).toHaveLength(1);
      const triggerEvent = shot.events.find((event) => event.type === 'triggerBegin');
      expect(triggerEvent).toBeTruthy();
      expect((triggerEvent as { kind: string }).kind).toBe(kind);
      expect(shot.block.projectiles[0].trigger?.projectiles).toHaveLength(1);
    }
  });

  it('duplicates spells with divide by N', () => {
    const divide2 = engine.simulate(wand(['DIVIDE_2', 'LIGHT_BULLET'])).shots[0];
    expect(projectileNames(divide2)).toHaveLength(2);
    expect(divide2.castDelayFrames).toBe(20); // divide penalty, target's cast delay is swallowed

    const chain = engine.simulate(wand(['DIVIDE_2', 'DIVIDE_2', 'DIVIDE_2', 'LIGHT_BULLET'])).shots[0];
    expect(projectileNames(chain)).toHaveLength(8);

    const big = engine.simulate(wand(['DIVIDE_10', 'DIVIDE_10', 'DIVIDE_4', 'DIVIDE_2', 'LIGHT_BULLET']), {
      mana: 10000,
    }).shots[0];
    expect(projectileNames(big)).toHaveLength(800); // the known iteration cap
  });

  it('copies spells with the Greek letters', () => {
    const tau = engine.simulate(wand(['TAU', 'LIGHT_BULLET', 'LIGHT_BULLET'])).shots[0];
    expect(projectileNames(tau)).toHaveLength(2);

    const gamma = engine.simulate(wand(['GAMMA', 'LIGHT_BULLET'])).shots[0];
    expect(projectileNames(gamma)).toHaveLength(1);

    const zeta = engine.simulate(wand(['ZETA']), { extraWands: [{ spells: ['BOMB'] }] }).shots[0];
    expect(projectileNames(zeta)).toEqual(['bomb.xml']);
  });

  it('handles wand refresh (RESET)', () => {
    const shot = engine.simulate(wand(['RESET', 'LIGHT_BULLET'])).shots[0];
    expect(projectileNames(shot)).toEqual([]);
    // RESET flushes the deck; the end-of-cast reload then moves the discarded cards back
    expect(shot.deck).toEqual(['RESET', 'LIGHT_BULLET']);
    expect(shot.hand).toHaveLength(0);
    expect(shot.discarded).toHaveLength(0);
    // a single RESET refreshes the deck but does not force a reload by itself
    expect(shot.reloaded).toBe(false);
    // RESET subtracts 25 frames from the recharge time
    expect(shot.reloadFrames).toBe(15);
  });

  it('applies always-cast spells to the shot state', () => {
    const shot = engine.simulate(wand(['LIGHT_BULLET'], { always_cast: ['DAMAGE'] })).shots[0];
    expect(projectileNames(shot)).toEqual(['light_bullet.xml']);
    expect(shot.castState.damage_projectile_add).toBe(0.4);
    expect(shot.castDelayFrames).toBe(8); // DAMAGE +5, LIGHT_BULLET +3
    expect(shot.events.some((event) => event.type === 'action' && event.id === 'DAMAGE')).toBe(true);
  });

  it('models mana limits', () => {
    const shot = engine.simulate(wand(['BOMB']), { mana: 10 }).shots[0];
    expect(projectileNames(shot)).toEqual([]);
    expect(shot.events.some((event) => event.type === 'notEnoughMana')).toBe(true);
  });

  it('advances frames, mana regeneration and reloads between clicks', () => {
    const result = engine.simulate(wand(['LIGHT_BULLET'], { mana_max: 100, mana_charge_speed: 600 }), {
      clicks: 3,
      mana: 100,
    });
    expect(result.shots.map((shot) => shot.frame)).toEqual([0, 40, 80]);
    expect(result.shots[0].manaAfter).toBe(95);
    expect(result.shots[1].manaBefore).toBe(100); // regenerated during the 40-frame wait
    expect(result.shots.every((shot) => shot.reloaded)).toBe(true);
  });

  it('supports cast-until-reload mode', () => {
    const result = engine.simulate(wand(['LIGHT_BULLET', 'BOMB', 'CHAINSAW']), { untilReload: true });
    expect(result.shots).toHaveLength(3);
    expect(result.shots.map((shot) => shot.reloaded)).toEqual([false, false, true]);
  });

  it('records which spells were called in each cast block (modifiers included)', () => {
    const shot = engine.simulate(wand(['DAMAGE', 'LIGHT_BULLET'])).shots[0];
    expect(shot.block.actions.map((action) => action.id)).toEqual(['DAMAGE', 'LIGHT_BULLET']);
    expect(shot.block.actions[0].delta?.damage_projectile_add).toBe(0.4);
    expect(shot.block.actions[0].deckIndex).toBe(0);
    expect(shot.block.actions[1].delta?.fire_rate_wait).toBe(3);

    const triggerShot = engine.simulate(wand(['LIGHT_BULLET_TRIGGER', 'BOMB'])).shots[0];
    expect(triggerShot.block.actions.map((action) => action.id)).toEqual(['LIGHT_BULLET_TRIGGER']);
    const payload = triggerShot.block.projectiles[0].trigger;
    expect(payload?.actions.map((action) => action.id)).toEqual(['BOMB']);
    expect(payload?.actions[0].delta?.fire_rate_wait).toBe(100);
  });

  it('builds the evaluation tree (draw block → card → action → nested draws)', () => {
    const shot = engine.simulate(wand(['LIGHT_BULLET_TRIGGER', 'BOMB'])).shots[0];
    expect(shot.tree.kind).toBe('cast');
    const block = shot.tree.children[0];
    expect(block.kind).toBe('drawBlock');
    if (block.kind !== 'drawBlock') throw new Error('expected drawBlock');
    expect(block.count).toBe(1);
    const card = block.children[0];
    expect(card.kind).toBe('drawCard');
    if (card.kind !== 'drawCard') throw new Error('expected drawCard');
    expect(card.spellId).toBe('LIGHT_BULLET_TRIGGER');
    const action = card.children[0];
    expect(action.kind).toBe('action');
    if (action.kind !== 'action') throw new Error('expected action');
    expect(action.projectiles).toEqual(['data/entities/projectiles/deck/light_bullet.xml']);
    const trigger = action.children.find((child) => child.kind === 'trigger');
    expect(trigger?.kind).toBe('trigger');
    if (trigger?.kind !== 'trigger') throw new Error('expected trigger');
    const payloadCard = trigger.children[0];
    expect(payloadCard.kind).toBe('drawBlock');
  });

  it('matches the wiki preload example: D10 + DAMAGE + LIGHT_BULLET = 11 damage modifiers', () => {
    const shot = engine.simulate(wand(['DIVIDE_10', 'DAMAGE', 'LIGHT_BULLET']), { mana: 10000 }).shots[0];
    let damageCalls = 0;
    let bulletCalls = 0;
    let dontDraw = 0;
    let projectiles = 0;
    const walk = (node: typeof shot.tree) => {
      if (node.kind === 'action') {
        if (node.id === 'DAMAGE') damageCalls += 1;
        if (node.id === 'LIGHT_BULLET') bulletCalls += 1;
        if (node.dontDraw) dontDraw += 1;
        projectiles += node.projectiles.length;
      }
      node.children.forEach(walk);
    };
    walk(shot.tree);
    expect(damageCalls).toBe(11);
    expect(bulletCalls).toBe(1);
    expect(dontDraw).toBe(1);
    expect(projectiles).toBe(1);
  });

  it('shuffles deterministically for the same frame/world seed', () => {
    const shuffled = wand(['LIGHT_BULLET', 'BOMB', 'CHAINSAW', 'DAMAGE', 'SPARK_BOLT'], {
      shuffle_deck_when_empty: true,
    });
    const options: SimulateOptions = { clicks: 2, frame: 0, worldSeed: 0 };
    const first = engine.simulate(shuffled, options);
    const second = engine.simulate(shuffled, options);
    expect(JSON.stringify(first.shots)).toBe(JSON.stringify(second.shots));
    // the deck is actually shuffled: orderDeck reports a shuffle for shuffle wands
    const orderEvent = first.shots[0].events.find((event) => event.type === 'orderDeck');
    expect(orderEvent).toEqual({ type: 'orderDeck', shuffled: true });
  });

  it('tracks deck / hand / discard across a shot', () => {
    const shot = engine.simulate(wand(['LIGHT_BULLET', 'BOMB'])).shots[0];
    expect(shot.hand).toHaveLength(0); // hand is moved to discard at the end of the cast
    expect(shot.discarded).toEqual(['LIGHT_BULLET']);
    expect(shot.deck).toEqual(['BOMB']);
  });

  it('runs every spell as a single-card wand without throwing', () => {
    const ids = engine.getSpellIds();
    const failures: string[] = [];
    for (const id of ids) {
      try {
        const result = engine.simulate(wand([id]), { mana: 50000, clicks: 1 });
        if (result.shots.length !== 1) failures.push(id);
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
