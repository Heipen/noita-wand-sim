// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSpellCatalog } from '../src/lib/catalog';
import { buildTranslations } from '../src/lib/csv';
import { parseWak, wakBytes } from '../src/lib/wak';

const NOITA_DIR = process.env.NOITA_DIR ?? 'C:/Program Files/Steam/steamapps/common/Noita';
const WAK_PATH = `${NOITA_DIR}/data/data.wak`;
const CSV_PATH = `${NOITA_DIR}/data/translations/common.csv`;

function readFileBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const available = existsSync(WAK_PATH);

/**
 * Integration test against the locally installed game (skipped when Noita is not installed).
 * This is the M0 acceptance test: import the real .wak in pure JS, run the game's own
 * gun_actions.lua through fengari, and get the full spell catalog with zh names.
 */
describe.skipIf(!available)('spell catalog from real game data', () => {
  const wak = parseWak(readFileBuffer(WAK_PATH));
  const translations = buildTranslations(existsSync(CSV_PATH) ? readFileSync(CSV_PATH, 'utf8') : null);
  const spells = buildSpellCatalog(wak, translations);
  const byId = new Map(spells.map((spell) => [spell.id, spell]));

  it('parses the archive index', () => {
    expect(wak.fileCount).toBeGreaterThan(14000);
    expect(wak.dataStart).toBeGreaterThan(0);
  });

  it('extracts every spell from gun_actions.lua', () => {
    expect(spells.length).toBeGreaterThanOrEqual(400);
    expect(new Set(spells.map((s) => s.id)).size).toBe(spells.length);
  });

  it('resolves official zh names from common.csv', () => {
    expect(byId.get('LIGHT_BULLET')?.nameZh).toBe('火花弹');
    expect(byId.get('LIGHT_BULLET')?.type).toBe('projectile');
    expect(byId.get('DIVIDE_2')?.nameZh).toBe('一分为二');
    expect(byId.get('ADD_TRIGGER')?.nameZh).toBe('追加触发');
    expect(byId.get('RESET')?.nameZh).toBe('魔杖刷新');
  });

  it('applies community aliases for Chinese UI', () => {
    expect(byId.get('GAMMA')?.displayZh).toBe('伽马');
    expect(byId.get('GAMMA')?.aliasNoteZh).toContain('伽马校正');
    expect(byId.get('ALPHA')?.displayZh).toBe('阿尔法');
    expect(byId.get('RESET')?.displayZh).toBe('魔杖刷新');
  });

  it('most spells have an icon inside the archive', () => {
    const withSprite = spells.filter((s) => s.sprite && wakBytes(wak, s.sprite));
    expect(withSprite.length).toBeGreaterThan(spells.length * 0.9);
  });
});
