// Generate src/data/spellAliases.json from scripts/data/spell-aliases.txt.
// The source file is the community alias table: "canonical, alias alias alias".
import fs from 'node:fs';
import path from 'node:path';

interface SpellRow {
  id: string;
  displayZh: string;
  nameEn: string;
}

const root = process.cwd();
const raw = fs.readFileSync(path.join(root, 'scripts/data/spell-aliases.txt'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/spells.json'), 'utf8')) as {
  spells: SpellRow[];
};

const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();

const byZh = new Map<string, string>();
const byZhCompact = new Map<string, string>();
const byEn = new Map<string, string>();
const byId = new Map<string, string>();
for (const spell of data.spells) {
  byZh.set(spell.displayZh, spell.id);
  byZhCompact.set(normalize(spell.displayZh), spell.id);
  byEn.set(spell.nameEn.toLowerCase(), spell.id);
  byId.set(spell.id.toLowerCase(), spell.id);
}

// a few community names differ from the in-game Chinese names
const overrides: Record<string, string> = {
  遁入虚空: 'CESSATION',
  激光: 'LASER',
  聚爆光束: 'GLOWING_BOLT',
  折跃施法: 'SUPER_TELEPORT_CAST',
  '复制法术 - 十字': 'QUAD_SHOT',
  螺旋路径: 'SPIRALING_SHOT',
  螺旋魔弹: 'SPIRAL_SHOT',
  陨石雨: 'METEOR_RAIN',
  蠕虫雨: 'WORM_RAIN',
  四重施法: 'BURST_4',
  '???': 'FUNKY_SPELL',
};

const aliases = new Map<string, Set<string>>();
const missing: string[] = [];

for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line) continue;
  const comma = line.indexOf(',');
  if (comma < 0) {
    missing.push(line);
    continue;
  }
  const canonical = line.slice(0, comma).trim();
  const rest = line.slice(comma + 1).trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  const candidates = [canonical, ...tokens];

  let id: string | undefined;
  for (const candidate of candidates) {
    id =
      overrides[candidate] ??
      byZh.get(candidate) ??
      byZhCompact.get(normalize(candidate)) ??
      byEn.get(candidate.toLowerCase()) ??
      byId.get(candidate.toLowerCase());
    if (id) break;
  }

  if (!id) {
    missing.push(canonical);
    continue;
  }

  const set = aliases.get(id) ?? new Set<string>();
  // the canonical name itself is searchable already, but for renamed community names
  // (e.g. 遁入虚空) it is a real alias and should be included
  set.add(canonical);
  for (const token of tokens) set.add(token);
  aliases.set(id, set);
}

const out: Record<string, string[]> = {};
for (const spell of data.spells) {
  const set = aliases.get(spell.id);
  if (set && set.size > 0) out[spell.id] = [...set];
}

fs.writeFileSync(
  path.join(root, 'src/data/spellAliases.json'),
  `${JSON.stringify(out, null, 2)}\n`,
  'utf8',
);

const count = Object.values(out).reduce((sum, list) => sum + list.length, 0);
console.log(`aliases: ${Object.keys(out).length} spells, ${count} aliases`);
if (missing.length > 0) {
  console.log(`unmatched canonical names (${missing.length}):`);
  console.log(missing.join('\n'));
}
