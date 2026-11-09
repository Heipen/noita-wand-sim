import fs from 'node:fs';
import path from 'node:path';
import { createWandEngine } from '../src/engine/engine.ts';
import { ENGINE_SCRIPT_PATHS, staticScriptSource } from '../src/engine/sources.ts';
import type { CastTreeNode, WandConfig } from '../src/engine/types.ts';

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

function print(node: CastTreeNode, depth = 0): void {
  const pad = '  '.repeat(depth);
  switch (node.kind) {
    case 'cast':
      node.children.forEach((c) => print(c, depth));
      return;
    case 'drawBlock':
      console.log(`${pad}drawBlock ×${node.count}`);
      break;
    case 'drawCard':
      console.log(`${pad}drawCard ${node.spellId ?? '∅'} ok=${node.ok}`);
      break;
    case 'action':
      console.log(
        `${pad}action ${node.id} deckIndex=${node.deckIndex} rec=${node.recursion} iter=${node.iteration} dontDraw=${node.dontDraw}`,
      );
      break;
    case 'trigger':
      console.log(`${pad}trigger ${node.triggerKind}`);
      break;
    case 'discard':
      console.log(`${pad}discard ${node.spellId}`);
      break;
  }
  node.children.forEach((c) => print(c, depth + 1));
}

const cases: [string, WandConfig][] = [
  ['tau seq', wand(['TAU', 'DIVIDE_2', 'DIVIDE_4', 'DIVIDE_2', 'LIGHT_BULLET'], { mana: 2000, mana_charge_speed: 2000 })],
  ['divide4 alone before bullet', wand(['DIVIDE_4', 'DIVIDE_2', 'LIGHT_BULLET'], { mana: 2000, mana_charge_speed: 2000 })],
  ['tau + divide4 only', wand(['TAU', 'DIVIDE_4', 'LIGHT_BULLET'], { mana: 2000, mana_charge_speed: 2000 })],
];

for (const [name, config] of cases) {
  console.log(`\n### ${name}`);
  const shot = engine.simulate(config).shots[0];
  print(shot.tree);
  console.log('-- deck after:', shot.deck, 'discarded:', shot.discarded, 'hand:', shot.hand);
  console.log('-- actions:', shot.events.filter((e) => e.type === 'callAction').map((e) => (e.type === 'callAction' ? `${e.id}(rec=${e.recursion},iter=${e.iteration})` : '')).join(' '));
}

engine.dispose();
