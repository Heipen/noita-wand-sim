import fs from 'node:fs';
import path from 'node:path';
import { createWandEngine } from '../src/engine/engine.ts';
import { ENGINE_SCRIPT_PATHS, staticScriptSource } from '../src/engine/sources.ts';
import type { WandConfig } from '../src/engine/types.ts';

const dataDir = path.join(process.cwd(), 'public/data');
const files = new Map<string, string>();
for (const p of ENGINE_SCRIPT_PATHS) files.set(p, fs.readFileSync(path.join(dataDir, 'game', p.slice('data/'.length)), 'utf8'));
const engine = await createWandEngine(staticScriptSource(files));

const wand = (spells: (string | null)[], extra: Partial<WandConfig> = {}): WandConfig => ({
  actions_per_round: 1,
  shuffle_deck_when_empty: false,
  reload_time: 40,
  deck_capacity: 26,
  spells,
  ...extra,
});

for (const [label, spells] of [
  ['single', ['LIGHT_BULLET']],
  ['trigger', ['LIGHT_BULLET_TRIGGER', 'BOMB']],
  ['d10', ['DIVIDE_10', 'DAMAGE', 'LIGHT_BULLET']],
] as const) {
  const shot = engine.simulate(wand([...spells]), { mana: 10000 }).shots[0];
  const discards = shot.events.filter((e) => e.type === 'discard');
  console.log(label, 'discards:', discards.length, JSON.stringify(discards.slice(0, 5)));
  console.log('  discarded pile:', shot.discarded);
  console.log('  hand:', shot.hand, 'deck:', shot.deck.length);
}
engine.dispose();
