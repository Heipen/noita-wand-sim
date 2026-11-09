import fs from 'node:fs';
import path from 'node:path';
import { createWandEngine } from '../src/engine/engine.ts';
import { ENGINE_SCRIPT_PATHS, staticScriptSource } from '../src/engine/sources.ts';

const dataDir = path.join(process.cwd(), 'public/data');
const files = new Map<string, string>();
for (const p of ENGINE_SCRIPT_PATHS) files.set(p, fs.readFileSync(path.join(dataDir, 'game', p.slice('data/'.length)), 'utf8'));
const engine = await createWandEngine(staticScriptSource(files));

const shot = engine.simulate(
  {
    actions_per_round: 1,
    shuffle_deck_when_empty: false,
    reload_time: 40,
    deck_capacity: 26,
    spells: ['TAU', 'DIVIDE_2', 'DIVIDE_4', 'DIVIDE_2', 'LIGHT_BULLET'],
    mana: 2000,
    mana_charge_speed: 2000,
  },
).shots[0];

let depth = 0;
for (const e of shot.events.slice(0, 140)) {
  switch (e.type) {
    case 'shotStart':
      console.log('shotStart', e.mana);
      break;
    case 'drawBlockBegin':
      depth += 1;
      console.log('  '.repeat(depth) + `drawBlockBegin ×${e.count} instant=${e.instantReload}`);
      break;
    case 'drawBlockEnd':
      console.log('  '.repeat(depth) + 'drawBlockEnd');
      depth -= 1;
      break;
    case 'drawCard':
      console.log('  '.repeat(depth) + `drawCard ${e.spellId ?? '∅'} ok=${e.ok} deck ${e.deckBefore}->${e.deckAfter}`);
      break;
    case 'playAction':
      console.log('  '.repeat(depth) + `playAction ${e.id} idx=${e.deckIndex}`);
      break;
    case 'callAction':
      depth += 1;
      console.log(
        '  '.repeat(depth) + `call ${e.id} rec=${e.recursion} iter=${e.iteration} dontDraw=${e.dontDraw} permanent=${e.permanent}`,
      );
      break;
    case 'callActionEnd':
      console.log('  '.repeat(depth) + 'end');
      depth -= 1;
      break;
    case 'discard':
      console.log('  '.repeat(depth) + `discard ${e.spellId}`);
      break;
    case 'orderDeck':
      console.log('orderDeck');
      break;
    case 'reload':
      console.log('reload');
      break;
    case 'shotEnd':
      console.log('shotEnd', e.castDelayFrames, e.reloadFrames);
      break;
    default:
      break;
  }
}
engine.dispose();
