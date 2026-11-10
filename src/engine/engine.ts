import { lauxlib, lua, lualib, to_jsstring, to_luastring } from 'fengari';
import { buildCastBlock, buildCastTree } from './castTree';
import { NoitaRng } from './rng';
import { ENGINE_STUBS, LUA_HOOKS, LUA_PRELUDE, LUA_PREPARE, toLuaLiteral } from './shimLua';
import { loadEngineScripts } from './sources';
import type {
  EngineEvent,
  ScriptSource,
  ShotResult,
  SimulateOptions,
  SimulationResult,
  WandConfig,
} from './types';

export interface WandEngine {
  readonly availableScripts: number;
  getSpellIds(): string[];
  simulate(wand: WandConfig, options?: SimulateOptions): SimulationResult;
  dispose(): void;
}

interface Snapshot {
  deck: string[];
  hand: string[];
  discarded: string[];
  mana: number;
  castDelayFrames: number;
  reloadFrames: number;
  reloaded: boolean;
  reloadTime: number | null;
  notEnoughMana: boolean;
  castState: Record<string, number | string>;
  events: Record<string, unknown>[];
}

function parseEvents(raw: Record<string, unknown>[]): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const entry of raw) {
    const name = entry.name;
    switch (name) {
      case 'shotStart':
        events.push({ type: 'shotStart', mana: Number(entry[1]), frame: Number(entry[2]) });
        break;
      case 'orderDeck':
        events.push({ type: 'orderDeck', shuffled: entry[1] === true });
        break;
      case 'draw':
        events.push({
          type: 'draw',
          deckBefore: Number(entry[1]),
          deckAfter: Number(entry[2]),
          cardsDrawn: Number(entry[3]),
          ok: entry[4] === undefined ? null : entry[4] === true,
        });
        break;
      case 'drawBlockBegin':
        events.push({
          type: 'drawBlockBegin',
          count: Number(entry[1]),
          instantReload: entry[2] === true,
        });
        break;
      case 'drawBlockEnd':
        events.push({ type: 'drawBlockEnd' });
        break;
      case 'drawCard':
        events.push({
          type: 'drawCard',
          spellId: entry[1] === undefined ? null : String(entry[1]),
          deckBefore: Number(entry[2]),
          deckAfter: Number(entry[3]),
          ok: entry[4] === undefined ? null : entry[4] === true,
          manaBefore: entry[5] === undefined ? undefined : Number(entry[5]),
          manaAfter: entry[6] === undefined ? undefined : Number(entry[6]),
        });
        break;
      case 'playAction':
        events.push({
          type: 'playAction',
          id: String(entry[1]),
          deckIndex: entry[2] === undefined ? null : Number(entry[2]),
        });
        break;
      case 'callAction': {
        const deltaRaw = entry[6];
        let delta: Record<string, number> | undefined;
        if (deltaRaw && typeof deltaRaw === 'object') {
          const parsed: Record<string, number> = {};
          for (const [key, value] of Object.entries(deltaRaw as Record<string, unknown>)) {
            if (typeof value === 'number' && value !== 0) parsed[key] = value;
          }
          if (Object.keys(parsed).length > 0) delta = parsed;
        }
        events.push({
          type: 'callAction',
          id: String(entry[1]),
          recursion: entry[2] === undefined ? null : Number(entry[2]),
          iteration: entry[3] === undefined ? null : Number(entry[3]),
          dontDraw: entry[4] === true,
          permanent: entry[5] === true,
          lifetimeAdd: entry[7] === undefined ? undefined : Number(entry[7]),
          delta,
        });
        break;
      }
      case 'callActionEnd':
        events.push({ type: 'callActionEnd' });
        break;
      case 'discard':
        events.push({
          type: 'discard',
          spellId: String(entry[1]),
          discardedCount: Number(entry[2]),
          sourceAction: entry[3] === undefined ? null : String(entry[3]),
        });
        break;
      case 'action': {
        const deltaRaw = entry[3];
        let delta: Record<string, number> | undefined;
        if (deltaRaw && typeof deltaRaw === 'object') {
          const parsed: Record<string, number> = {};
          for (const [key, value] of Object.entries(deltaRaw as Record<string, unknown>)) {
            if (typeof value === 'number' && value !== 0) parsed[key] = value;
          }
          if (Object.keys(parsed).length > 0) delta = parsed;
        }
        events.push({
          type: 'action',
          id: String(entry[1]),
          deckIndex: entry[2] === undefined ? null : Number(entry[2]),
          lifetimeAdd: entry[4] === undefined ? undefined : Number(entry[4]),
          delta,
        });
        break;
      }
      case 'projectileBegin':
        events.push({ type: 'projectileBegin', entity: String(entry[1]) });
        break;
      case 'projectileEnd':
        events.push({ type: 'projectileEnd' });
        break;
      case 'triggerBegin':
        events.push({
          type: 'triggerBegin',
          kind: String(entry[1]) as 'timer' | 'hitWorld' | 'death',
          delayFrames: entry[2] === undefined ? undefined : Number(entry[2]),
        });
        break;
      case 'triggerEnd':
        events.push({ type: 'triggerEnd' });
        break;
      case 'notEnoughMana':
        events.push({ type: 'notEnoughMana' });
        break;
      case 'reload':
        events.push({ type: 'reload', timeFrames: Number(entry[1]) });
        break;
      case 'shotEnd':
        events.push({
          type: 'shotEnd',
          castDelayFrames: Number(entry[1]),
          reloadFrames: Number(entry[2]),
        });
        break;
      default:
        break;
    }
  }
  return events;
}

export async function createWandEngine(source: ScriptSource): Promise<WandEngine> {
  const scripts = await loadEngineScripts(source);
  if (!scripts.has('data/scripts/gun/gun.lua')) {
    throw new Error('缺少 data/scripts/gun/gun.lua —— 数据源不完整');
  }

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  const rng = new NoitaRng();
  let worldSeed = 0;

  const fail = (L2: any, message: string): number =>
    lauxlib.luaL_error(L2, to_luastring(message));

  // Game `dofile`: served from the preloaded script map.
  const dofile = (state: any): number => {
    const path = to_jsstring(lua.lua_tostring(state, 1));
    const text = scripts.get(path);
    if (text === undefined) return fail(state, `dofile: 缺少脚本 ${path}`);
    const status = lauxlib.luaL_loadbuffer(state, to_luastring(text), null, to_luastring(path));
    if (status !== lua.LUA_OK) return fail(state, `dofile 编译失败 ${path}`);
    const result = lua.lua_pcall(state, 0, 0, 0);
    if (result !== lua.LUA_OK) {
      const message = to_jsstring(lua.lua_tostring(state, -1));
      // utilities.lua is engine-side glue that the simulator does not need; ignore it.
      if (/lib\/utilities\.lua$/.test(path)) {
        lua.lua_pop(state, 1);
        return 0;
      }
      return fail(state, `dofile 执行失败 ${path}: ${message}`);
    }
    return 0;
  };
  lua.lua_pushjsfunction(L, dofile);
  lua.lua_setglobal(L, to_luastring('dofile'));

  lua.lua_pushjsfunction(L, (state: any) => {
    const min = Number(lua.lua_tonumber(state, 1));
    const max = Number(lua.lua_tonumber(state, 2));
    lua.lua_pushnumber(state, rng.random(min, max));
    return 1;
  });
  lua.lua_setglobal(L, to_luastring('__engine_random'));

  lua.lua_pushjsfunction(L, (state: any) => {
    const a = Number(lua.lua_tonumber(state, 1));
    const b = Number(lua.lua_tonumber(state, 2));
    rng.setSeed(worldSeed, a, b);
    return 0;
  });
  lua.lua_setglobal(L, to_luastring('__engine_set_seed'));

  const luaError = (state: any): string => {
    const raw = lua.lua_tostring(state, -1);
    if (raw) return to_jsstring(raw);
    const typeName = lua.lua_typename(state, lua.lua_type(state, -1));
    return `<${typeName}>`;
  };

  const run = (code: string, name: string, resultCount = 0): void => {
    const status = lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name));
    if (status !== lua.LUA_OK) {
      throw new Error(`Lua 编译失败 (${name}): ${luaError(L)}`);
    }
    const result = lua.lua_pcall(L, 0, resultCount, 0);
    if (result !== lua.LUA_OK) {
      throw new Error(`Lua 执行失败 (${name}): ${luaError(L)}`);
    }
  };

  const evalString = (code: string, name: string): string => {
    const status = lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name));
    if (status !== lua.LUA_OK) {
      throw new Error(`Lua 编译失败 (${name}): ${to_jsstring(lua.lua_tostring(L, -1))}`);
    }
    const result = lua.lua_pcall(L, 0, 1, 0);
    if (result !== lua.LUA_OK) {
      throw new Error(`Lua 执行失败 (${name}): ${to_jsstring(lua.lua_tostring(L, -1))}`);
    }
    const value = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return value;
  };

  run(LUA_PRELUDE, 'prelude.lua');
  run(ENGINE_STUBS, 'engine_stubs.lua');
  run(scripts.get('data/scripts/gun/gun.lua')!, 'gun.lua');
  run(LUA_HOOKS, 'hooks.lua');
  run(LUA_PREPARE, 'session.lua');
  run('__install_hooks()', 'install_hooks');

  const spellIds = JSON.parse(
    evalString(
      'local out = {} for i = 1, #actions do out[i] = actions[i].id end return __json_encode(out)',
      'spell_ids',
    ),
  ) as string[];

  let disposed = false;

  const doShot = (
    wand: WandConfig,
    mana: number,
    frame: number,
    castDelayFrames: number,
  ): { shot: ShotResult; snapshot: Snapshot } => {
    const json = evalString(`return __do_shot(${mana}, ${frame}, ${castDelayFrames})`, 'do_shot');
    const snapshot = JSON.parse(json) as Snapshot;
    const events = parseEvents(snapshot.events);
    // StartReload can be called more than once in a shot (e.g. CESSATION copied by
    // DIVIDE_2); the last call is the one that determines the actual recharge time.
    const reloadEvent = [...events].reverse().find((event) => event.type === 'reload');
    const block = buildCastBlock(events);
    block.castState = snapshot.castState;
    const shot: ShotResult = {
      block,
      tree: buildCastTree(events),
      events,
      castState: snapshot.castState,
      manaBefore: mana,
      manaAfter: Number(snapshot.mana),
      castDelayFrames: Number(snapshot.castDelayFrames),
      reloadFrames: Number(snapshot.reloadFrames),
      reloadTimeFrames: reloadEvent ? reloadEvent.timeFrames : snapshot.reloadTime,
      reloaded: snapshot.reloaded === true,
      frame,
      deck: snapshot.deck,
      hand: snapshot.hand,
      discarded: snapshot.discarded,
    };
    return { shot, snapshot };
  };

  return {
    availableScripts: scripts.size,
    getSpellIds(): string[] {
      return [...spellIds];
    },
    simulate(wand: WandConfig, options: SimulateOptions = {}): SimulationResult {
      if (disposed) throw new Error('engine already disposed');
      worldSeed = options.worldSeed ?? 0;
      rng.setSeed(worldSeed, 0, 0);

      run(
        `__setup_entities(${toLuaLiteral({
          extraWands: options.extraWands ?? [],
          req: options.requirements ?? {},
          player: options.player ?? {},
          x: 0,
          y: 0,
        })})`,
        'setup_entities',
      );

      const spells = wand.spells.map((id) => (id ? { id, uses: null } : null));
      const always = (wand.always_cast ?? []).map((id) => id ?? null);
      run(
        `__prepare_wand(${toLuaLiteral({
          actions_per_round: wand.actions_per_round,
          shuffle_deck_when_empty: wand.shuffle_deck_when_empty,
          reload_time: wand.reload_time,
          deck_capacity: wand.deck_capacity,
          spells,
          spellCount: spells.length,
          always,
          alwaysCount: always.length,
        })})`,
        'prepare_wand',
      );

      const manaMax = wand.mana_max ?? 1000;
      const chargeSpeed = wand.mana_charge_speed ?? 0;
      const castDelayWand = wand.cast_delay ?? 0;
      let mana = options.mana ?? manaMax;
      let frame = options.frame ?? 0;
      const shots: ShotResult[] = [];

      if (options.untilReload) {
        const maxShots = options.maxShots ?? 50;
        for (let i = 0; i < maxShots; i++) {
          const { shot } = doShot(wand, mana, frame, castDelayWand);
          shots.push(shot);
          if (shot.reloaded) break;
          const actionCount = shot.events.filter((event) => event.type === 'action').length;
          if (actionCount === 0) break;
          mana = shot.manaAfter;
        }
      } else {
        const clicks = options.clicks ?? 1;
        for (let i = 0; i < clicks; i++) {
          const { shot } = doShot(wand, mana, frame, castDelayWand);
          shots.push(shot);
          const chargeTime = shot.reloaded
            ? (shot.reloadTimeFrames ?? shot.reloadFrames)
            : 0;
          const wait = Math.max(shot.castDelayFrames, chargeTime);
          frame += wait;
          mana = Math.min(manaMax, shot.manaAfter + (chargeSpeed * wait) / 60);
        }
      }

      return { shots, mana, frame };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      lua.lua_close(L);
    },
  };
}
