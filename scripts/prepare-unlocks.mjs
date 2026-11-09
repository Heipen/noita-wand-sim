// Turn the cached Chinese wiki Cargo response into a compact spell-id -> unlock text map.
// Source: noita.wiki.gg/zh Cargo table "Spells", field "unlockCondition" (CC BY-NC-SA 3.0).
// Only used as reference data for tooltip text; game data itself comes from data.wak.
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.env.WIKI_UNLOCKS_RAW ?? 'scripts/data/wiki-unlocks-zh.raw.json';
const OUT = 'scripts/data/wiki-unlocks-zh.json';

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));
const rows = raw.cargoquery ?? [];
console.log('wiki rows:', rows.length);

function clean(value) {
  return String(value ?? '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const map = {};
for (const row of rows) {
  const id = row.title?.gameID;
  const text = clean(row.title?.unlockCondition);
  if (id && text) map[id] = text;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(map, null, 1), 'utf8');
console.log('non-empty unlock conditions:', Object.keys(map).length);
console.log('COLOUR_RAINBOW:', map.COLOUR_RAINBOW);
console.log('ADD_DEATH_TRIGGER:', map.ADD_DEATH_TRIGGER);
console.log('DIVIDE_10:', map.DIVIDE_10);
console.log('GAMMA:', map.GAMMA);
console.log('sample:', Object.entries(map).slice(0, 8));
