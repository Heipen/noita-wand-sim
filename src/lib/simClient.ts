import type { SimulationResult, SimulateOptions, WandConfig } from '../engine/types';

/**
 * Thin main-thread client around the rule-engine web worker.
 * The engine (fengari + game Lua) lives in the worker so the UI never blocks.
 */

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: SimulationResult) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/simWorker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as
      | { type: 'ready'; spellCount: number }
      | { type: 'initError'; error: string }
      | { type: 'result'; id: number; result?: SimulationResult; error?: string };
    if (message.type === 'result') {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error));
      else if (message.result) entry.resolve(message.result);
    }
  });
  return worker;
}

/** Recreate the engine with a specific set of game scripts (local data.wak import). */
export function configureEngineScripts(scripts: Record<string, string> | undefined): void {
  getWorker().postMessage({ type: 'init', scripts });
}

export function simulateWand(wand: WandConfig, options: SimulateOptions): Promise<SimulationResult> {
  const id = ++nextId;
  return new Promise<SimulationResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'simulate', id, wand, options });
  });
}
