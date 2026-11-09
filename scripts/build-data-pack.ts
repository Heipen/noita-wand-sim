/**
 * Build a self-contained data pack from a locally installed Noita, so the web app works
 * without asking visitors to import data.wak.
 *
 * Reads the game's `data/data.wak` (and `data/translations/common.csv`) and writes:
 *   public/data/spells.json            spell catalog (422 entries, names/descriptions/stats)
 *   public/data/sprites/<id>.png       spell icons (only the ones used by spells)
 *   public/data/game/scripts/...       gun.lua + gun_actions.lua + helpers (used by the rule engine)
 *   public/data/game/entities/...      projectile XML + custom cards (used by the stats layer)
 *   public/data/version.json           build/signature metadata
 *
 * Usage:
 *   npm run build:data                 (uses the default Steam path)
 *   NOITA_DIR="D:/Games/Noita" npm run build:data
 *
 * NOTE: the generated pack contains Noita game data © Nolla Games. It is generated locally
 * and is not fetched from any third-party service. See README for the takedown note.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSpellCatalog } from '../src/lib/catalog.ts';
import { buildTranslations } from '../src/lib/csv.ts';
import { parseWak, wakBytes, wakText } from '../src/lib/wak.ts';

const NOITA_DIR = process.env.NOITA_DIR ?? 'C:/Program Files/Steam/steamapps/common/Noita';
const WAK_PATH = join(NOITA_DIR, 'data/data.wak');
const CSV_PATH = join(NOITA_DIR, 'data/translations/common.csv');
const OUT_DIR = process.env.OUT_DIR ?? 'public/data';

if (!existsSync(WAK_PATH)) {
  console.error(`找不到 ${WAK_PATH}，请通过 NOITA_DIR 指定 Noita 安装目录`);
  process.exit(1);
}

const wakBuffer = readFileSync(WAK_PATH);
const wak = parseWak(wakBuffer.buffer.slice(wakBuffer.byteOffset, wakBuffer.byteOffset + wakBuffer.byteLength));
const translations = buildTranslations(existsSync(CSV_PATH) ? readFileSync(CSV_PATH, 'utf8') : null);
const spells = buildSpellCatalog(wak, translations);

const written: { path: string; bytes: number }[] = [];

function writeOut(relativePath: string, data: Uint8Array | string): void {
  const target = join(OUT_DIR, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  writeFileSync(target, bytes);
  written.push({ path: relativePath, bytes: bytes.length });
}

function copyFromWak(wakPath: string, outRelativePath = wakPath.replace(/^data\//, 'game/')): boolean {
  const bytes = wakBytes(wak, wakPath);
  if (!bytes) {
    console.warn(`  ! missing in wak: ${wakPath}`);
    return false;
  }
  writeOut(outRelativePath, bytes);
  return true;
}

// --- spell catalog + icons ---------------------------------------------------
// Unlock-condition text comes from the Chinese Noita Wiki Cargo table (CC BY-NC-SA 3.0);
// see scripts/data/README.md. Missing entries simply stay null.
const UNLOCK_ZH_PATH = 'scripts/data/wiki-unlocks-zh.json';
const unlockZh: Record<string, string> = existsSync(UNLOCK_ZH_PATH)
  ? JSON.parse(readFileSync(UNLOCK_ZH_PATH, 'utf8').replace(/^\uFEFF/, ''))
  : {};

const packSpells = spells.map((spell) => {
  const iconName = `${spell.id.toLowerCase()}.png`;
  if (spell.sprite) {
    const bytes = wakBytes(wak, spell.sprite);
    if (bytes) writeOut(`sprites/${iconName}`, bytes);
  }
  return {
    id: spell.id,
    nameKey: spell.nameKey,
    descKey: spell.descKey,
    nameEn: spell.nameEn,
    nameZh: spell.nameZh,
    displayZh: spell.displayZh,
    aliasNoteZh: spell.aliasNoteZh ?? null,
    descEn: spell.descEn,
    descZh: spell.descZh,
    type: spell.type,
    typeValue: spell.typeValue,
    mana: spell.mana,
    maxUses: spell.maxUses,
    recursive: spell.recursive,
    price: spell.price,
    spawnRequiresFlag: spell.spawnRequiresFlag,
    relatedProjectiles: spell.relatedProjectiles,
    relatedExtraEntities: spell.relatedExtraEntities,
    customXmlFile: spell.customXmlFile,
    sprite: spell.sprite,
    icon: spell.sprite ? `data/sprites/${iconName}` : null,
    // --- fields used by the (future) hover tooltip / stats panel -------------
    // 法术等级 / 对应等级生成权重
    spawnLevel: spell.spawnLevel,
    spawnProbability: spell.spawnProbability,
    spawnManualUnlock: spell.spawnManualUnlock,
    isDangerousBlast: spell.isDangerousBlast,
    // 施放延迟 / 充能（reflection pass, frames @60fps）
    castDelayFrames: spell.castDelayFrames,
    reloadFrames: spell.reloadFrames,
    drawManyCount: spell.drawManyCount,
    stateDelta: spell.stateDelta,
    // 解锁
    unlockFlag: spell.spawnRequiresFlag,
    unlockZh: unlockZh[spell.id] ?? null,
  };
});

// --- game scripts needed to run the real casting logic -----------------------
const gunScripts = [
  'data/scripts/gun/gun.lua',
  'data/scripts/gun/gun_actions.lua',
  'data/scripts/gun/gunaction_generated.lua',
  'data/scripts/gun/gunshoteffects_generated.lua',
  'data/scripts/gun/gun_generated.lua',
  'data/scripts/gun/gun_enums.lua',
  'data/scripts/gun/gun_extra_modifiers.lua',
  'data/scripts/gun/gun_collect_metadata.lua',
  'data/scripts/gun/procedural/gun_action_utils.lua',
  'data/scripts/lib/utilities.lua',
];

// --- entity data for the projectile stats layer (M3) -------------------------
const entityPrefixes = ['data/entities/projectiles/', 'data/entities/misc/custom_cards/'];
const entityExtra = [
  'data/entities/base_projectile.xml',
  'data/entities/base_projectile_physics.xml',
  'data/entities/base_custom_card.xml',
  'data/entities/misc/material_converter_freeze.xml',
];

const gunActionsCode = wakText(wak, 'data/scripts/gun/gun_actions.lua');
if (!gunActionsCode) throw new Error('gun_actions.lua missing from wak');
const signature = createHash('sha256').update(gunActionsCode, 'utf8').digest('hex').slice(0, 12);

// clean summary of what is about to be written
console.log(`Noita data: ${NOITA_DIR}`);
console.log(`wak: ${wak.fileCount} files, signature ${signature}`);

const pack = {
  generator: 'scripts/build-data-pack.ts',
  generatedAt: new Date().toISOString(),
  game: {
    signature,
    fileCount: wak.fileCount,
    build: 'Jan 2025 (9dbd52ce)',
    source: 'local data.wak',
  },
  count: packSpells.length,
  spells: packSpells,
};
writeOut('spells.json', JSON.stringify(pack));

for (const scriptPath of gunScripts) copyFromWak(scriptPath);
for (const name of wak.entries.keys()) {
  if (entityPrefixes.some((prefix) => name.startsWith(prefix))) copyFromWak(name);
}
for (const name of entityExtra) copyFromWak(name);

writeOut(
  'version.json',
  JSON.stringify(
    {
      schema: 2,
      generator: pack.generator,
      generatedAt: pack.generatedAt,
      signature,
      fileCount: wak.fileCount,
      spellCount: packSpells.length,
      build: pack.game.build,
      fields: {
        tooltip: ['mana', 'castDelayFrames', 'reloadFrames', 'spawnLevel', 'spawnProbability', 'unlockFlag', 'unlockZh', 'descZh', 'descEn'],
        stats: ['stateDelta', 'relatedProjectiles', 'relatedExtraEntities', 'customXmlFile'],
      },
      unlockSource: 'noita.wiki.gg/zh Cargo:Spells.unlockCondition (CC BY-NC-SA 3.0)',
    },
    null,
    2,
  ),
);

const totalBytes = written.reduce((sum, entry) => sum + entry.bytes, 0);
const byGroup = new Map<string, { files: number; bytes: number }>();
for (const entry of written) {
  const group = entry.path.split('/')[0];
  const current = byGroup.get(group) ?? { files: 0, bytes: 0 };
  current.files += 1;
  current.bytes += entry.bytes;
  byGroup.set(group, current);
}
console.log(`\nwrote ${written.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total:`);
for (const [group, stats] of byGroup) {
  console.log(`  ${group.padEnd(10)} ${String(stats.files).padStart(4)} files  ${(stats.bytes / 1024).toFixed(1)} KB`);
}
console.log(`\noutput: ${OUT_DIR}`);
