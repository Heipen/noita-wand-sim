// Quick manual probe for the rule engine: node --import tsx scripts/probe-engine.ts
import fs from 'node:fs';
import path from 'node:path';
import { createWandEngine } from '../src/engine/engine.ts';
import { ENGINE_SCRIPT_PATHS, staticScriptSource } from '../src/engine/sources.ts';
import type { WandConfig } from '../src/engine/types.ts';

const dataDir = path.join(process.cwd(), 'public/data');
const files = new Map<string, string>();
for (const gamePath of ENGINE_SCRIPT_PATHS) {
  const relative = gamePath.startsWith('data/') ? gamePath.slice('data/'.length) : gamePath;
  files.set(gamePath, fs.readFileSync(path.join(dataDir, 'game', relative), 'utf8'));
}

const engine = await createWandEngine(staticScriptSource(files));
console.log('scripts:', engine.availableScripts, '| spells:', engine.getSpellIds().length);

const wand = (spells: (string | null)[], extra: Partial<WandConfig> = {}): WandConfig => ({
  actions_per_round: 1,
  shuffle_deck_when_empty: false,
  reload_time: 40,
  deck_capacity: 10,
  spells,
  ...extra,
});

const draw = (shot: ReturnType<typeof engine.simulate>['shots'][number]) => {
  const walk = (block: typeof shot.block, depth = 0): string[] => {
    const lines: string[] = [];
    for (const projectile of block.projectiles) {
      lines.push(`${'  '.repeat(depth)}projectile ${projectile.entity}`);
      if (projectile.trigger) lines.push(...walk(projectile.trigger, depth + 1));
    }
    return lines;
  };
  return walk(shot.block).join('\n') || '(no projectiles)';
};

const cases: [string, WandConfig, Parameters<typeof engine.simulate>[1]?][] = [
  ['single bullet', wand(['LIGHT_BULLET'])],
  ['double cast', wand(['LIGHT_BULLET', 'BOMB'], { actions_per_round: 2 })],
  ['trigger', wand(['LIGHT_BULLET_TRIGGER', 'BOMB'])],
  ['add trigger', wand(['ADD_TRIGGER', 'LIGHT_BULLET', 'BOMB'])],
  ['divide 2', wand(['DIVIDE_2', 'LIGHT_BULLET'])],
  ['tau', wand(['TAU', 'LIGHT_BULLET', 'LIGHT_BULLET'])],
  ['reset', wand(['RESET', 'LIGHT_BULLET'])],
  ['always cast damage', wand(['LIGHT_BULLET'], { always_cast: ['DAMAGE'] })],
  ['zeta + extra wand', wand(['ZETA'], {}), { extraWands: [{ spells: ['BOMB'] }] }],
];

for (const [name, config, options] of cases) {
  try {
    const result = engine.simulate(config, options);
    const shot = result.shots[0];
    console.log(`\n### ${name}`);
    console.log(draw(shot));
    console.log(
      `mana ${shot.manaBefore}->${shot.manaAfter}, castDelay ${shot.castDelayFrames}, reloadFrames ${shot.reloadFrames}, reloaded ${shot.reloaded}`,
    );
    console.log(
      'actions:',
      shot.events
        .filter((event) => event.type === 'action')
        .map((event) => (event as { id: string }).id)
        .join(' '),
    );
  } catch (error) {
    console.log(`\n### ${name} FAILED:`, (error as Error).message);
  }
}

engine.dispose();
