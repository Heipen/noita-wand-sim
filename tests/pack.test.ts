// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpellMeta } from '../src/lib/types';

const DATA_DIR = join(process.cwd(), 'public/data');
const spellsPath = join(DATA_DIR, 'spells.json');
const versionPath = join(DATA_DIR, 'version.json');
const available = existsSync(spellsPath) && existsSync(versionPath);

/**
 * M0.5 acceptance: the committed data pack must be complete so the site works with
 * zero setup. Regenerate with `npm run build:data` after a game update.
 */
describe.skipIf(!available)('bundled data pack', () => {
  const pack = JSON.parse(readFileSync(spellsPath, 'utf8')) as { count: number; spells: SpellMeta[] };
  const version = JSON.parse(readFileSync(versionPath, 'utf8')) as {
    signature: string;
    spellCount: number;
    build: string;
  };

  it('has a valid version manifest', () => {
    expect(version.signature).toMatch(/^[0-9a-f]{12}$/);
    expect(version.spellCount).toBe(pack.spells.length);
    expect(version.build.length).toBeGreaterThan(0);
  });

  it('contains 422 spells with zh names', () => {
    expect(pack.spells.length).toBe(422);
    expect(pack.count).toBe(422);
    for (const spell of pack.spells) {
      expect(spell.id.length).toBeGreaterThan(0);
      expect(spell.nameZh.length).toBeGreaterThan(0);
      expect(spell.nameEn.length).toBeGreaterThan(0);
    }
    const byId = new Map(pack.spells.map((s) => [s.id, s]));
    expect(byId.get('LIGHT_BULLET')?.nameZh).toBe('火花弹');
    expect(byId.get('GAMMA')?.displayZh).toBe('伽马');
    expect(byId.get('DIVIDE_10')?.type).toBe('other');
  });

  it('keeps the fields needed for the in-game-style hover tooltip', () => {
    const byId = new Map(pack.spells.map((s) => [s.id, s]));
    const rainbow = byId.get('COLOUR_RAINBOW');
    expect(rainbow).toBeTruthy();
    expect(rainbow).toMatchObject({
      nameZh: '彩虹闪光',
      type: 'modifier',
      mana: 0,
      // -8 frames @60fps = -0.13s 施放延迟
      castDelayFrames: -8,
      spawnLevel: '2,3,4,10',
      spawnProbability: '0.1,0.1,0.1,0.2',
      spawnRequiresFlag: 'card_unlocked_paint',
      unlockZh: '找到实验性魔杖',
    });
    expect(rainbow?.descZh).toContain('随机颜色');

    const recharge = byId.get('RECHARGE');
    expect(recharge?.castDelayFrames).toBe(-10);
    expect(recharge?.reloadFrames).toBe(-20);

    // castDelayFrames must be the reflection-pass fire_rate_wait delta
    for (const spell of pack.spells) {
      const delta = spell.stateDelta?.fire_rate_wait;
      if (typeof delta === 'number') expect(spell.castDelayFrames).toBe(delta);
    }

    const withUnlockText = pack.spells.filter((s) => s.unlockZh).length;
    expect(withUnlockText).toBeGreaterThan(90);
    const withState = pack.spells.filter((s) => Object.keys(s.stateDelta ?? {}).length > 0).length;
    expect(withState).toBeGreaterThan(350);
  });

  it('ships every icon referenced by the catalog', () => {
    const missing = pack.spells.filter((spell) => {
      if (!spell.icon) return true;
      const iconPath = join(process.cwd(), 'public', spell.icon);
      return !existsSync(iconPath) || statSync(iconPath).size === 0;
    });
    expect(missing.map((s) => s.id)).toEqual([]);
  });

  it('ships the game Lua needed by the rule engine', () => {
    for (const script of [
      'game/scripts/gun/gun.lua',
      'game/scripts/gun/gun_actions.lua',
      'game/scripts/gun/gunaction_generated.lua',
      'game/scripts/gun/gun_enums.lua',
      'game/scripts/gun/gun_extra_modifiers.lua',
      'game/scripts/gun/procedural/gun_action_utils.lua',
      'game/scripts/lib/utilities.lua',
    ]) {
      const path = join(DATA_DIR, script);
      expect(existsSync(path), script).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(100);
    }
  });

  it('stays reasonably small (site payload, not the whole game)', () => {
    const walk = (dir: string): number =>
      readdirSync(dir).reduce((sum, name) => {
        const path = join(dir, name);
        return sum + (statSync(path).isDirectory() ? walk(path) : statSync(path).size);
      }, 0);
    const total = walk(DATA_DIR);
    expect(total).toBeLessThan(8 * 1024 * 1024);
  });
});
