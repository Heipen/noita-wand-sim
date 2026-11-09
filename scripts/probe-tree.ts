// Print the evaluation tree for key cases (dev probe).
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

function print(node: CastTreeNode, depth = 0, lang = true): void {
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
        `${pad}action ${node.id} deckIndex=${node.deckIndex} rec=${node.recursion} iter=${node.iteration} dontDraw=${node.dontDraw} permanent=${node.permanent}`,
      );
      if (node.projectiles.length) console.log(`${pad}  projectiles: ${node.projectiles.map((e) => e.split('/').pop()).join(', ')}`);
      break;
    case 'trigger':
      console.log(`${pad}trigger ${node.triggerKind} ${node.projectile?.split('/').pop()}`);
      break;
  }
  node.children.forEach((c) => print(c, depth + 1));
}

const cases: [string, WandConfig, Parameters<typeof engine.simulate>[1]?][] = [
  ['wiki example: D10 + DAMAGE + LIGHT_BULLET', wand(['DIVIDE_10', 'DAMAGE', 'LIGHT_BULLET']), { mana: 10000 }],
  ['trigger', wand(['LIGHT_BULLET_TRIGGER', 'BOMB'])],
  ['double cast', wand(['LIGHT_BULLET', 'BOMB'], { actions_per_round: 2 })],
  ['always cast', wand(['LIGHT_BULLET'], { always_cast: ['DAMAGE'] })],
];

for (const [name, config, options] of cases) {
  console.log(`\n### ${name}`);
  const shot = engine.simulate(config, options).shots[0];
  print(shot.tree);
}

engine.dispose();
