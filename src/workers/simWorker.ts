/// <reference lib="webworker" />
import { bundledScriptSource, createWandEngine, staticScriptSource, type WandEngine } from '../engine';
import type { SimulateOptions, WandConfig } from '../engine/types';

interface InitMessage {
  type: 'init';
  scripts?: Record<string, string>;
}

interface SimulateMessage {
  type: 'simulate';
  id: number;
  wand: WandConfig;
  options: SimulateOptions;
}

type Incoming = InitMessage | SimulateMessage;

let enginePromise: Promise<WandEngine> | null = null;

function ensureEngine(scripts?: Record<string, string>): Promise<WandEngine> {
  if (!enginePromise) {
    const source = scripts ? staticScriptSource(new Map(Object.entries(scripts))) : bundledScriptSource();
    enginePromise = createWandEngine(source);
  }
  return enginePromise;
}

self.addEventListener('message', async (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'init') {
    try {
      enginePromise = null;
      const engine = await ensureEngine(message.scripts);
      self.postMessage({ type: 'ready', spellCount: engine.getSpellIds().length });
    } catch (error) {
      self.postMessage({ type: 'initError', error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (message.type === 'simulate') {
    try {
      const engine = await ensureEngine();
      const result = engine.simulate(message.wand, message.options);
      self.postMessage({ type: 'result', id: message.id, result });
    } catch (error) {
      self.postMessage({
        type: 'result',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
});
