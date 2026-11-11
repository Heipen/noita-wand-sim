import { to_jsstring, to_luastring, lauxlib, lua, lualib } from 'fengari';
import { resolveSpell } from './localization';
import type { RawSpell, SpellMeta, WakArchive } from './types';
import type { Translations } from './csv';
import { wakText } from './wak';

/**
 * Extracts spell metadata by executing the game's own `gun.lua` in a Lua VM.
 *
 * Two passes, both mirroring how the game itself builds spell cards:
 *  1. load `gun.lua` (it loads `gun_actions.lua`, the generated config glue and the
 *     extra modifiers), then serialize the `actions` table;
 *  2. "reflection pass" like `data/scripts/gun/gun_collect_metadata.lua`: with
 *     `reflecting = true`, run every spell's action closure on an empty shot and record
 *     the resulting shot state (cast delay, recharge, damage modifiers, ...). This is the
 *     same data the in-game tooltip is derived from, so it is kept per spell for the
 *     future hover tooltip / stats panel.
 */

/**
 * Minimal engine API stubs, enough to *load* gun.lua and run the reflection pass.
 * The M1 rule engine will replace this with a real shim that records events.
 */
const ENGINE_STUBS = `
function RegisterGun() end
function RegisterGunAction() end
function RegisterGunShotEffects() end
function SetProjectileConfigs() end
function BeginProjectile() end
function EndProjectile() end
function BeginTriggerTimer() end
function BeginTriggerHitWorld() end
function BeginTriggerDeath() end
function EndTrigger() end
function Reflection_RegisterProjectile() end
function OnActionPlayed() end
function OnActionCalled() end
function OnActionFinished() end
function OnNotEnoughManaForAction() end
function ActionUsed() end
function ActionUsesRemainingChanged() return true end
function LogAction() end
function StartReload() end
function BaabInstruction() end
function SetRandomSeed() end
function Random(a, b) return a end
function GameGetFrameNum() return 0 end
function GameGetRealWorldTimeSinceStarted() return 0 end
function GamePrint() end
function Note() end
function HasFlagPersistent() return false end
function GlobalsGetValue(k, d) return d or '' end
function GlobalsSetValue() end
function EntityLoad() return 0 end
function EntityCreate() return 0 end
function EntityKill() end
function EntityGetWithTag() return {} end
function EntityGetInRadiusWithTag() return {} end
function EntityGetAllChildren() return {} end
function EntityGetName() return '' end
function EntityHasTag() return false end
function EntityGetTransform() return 0, 0 end
function EntityGetFirstComponent() return nil end
function EntityGetFirstComponentIncludingDisabled() return nil end
function EntityGetComponent() return nil end
function EntityInflictDamage() end
function GetUpdatedEntityID() return 0 end
function GetWorldEntityID() return 0 end
function ComponentGetValue2() return 0 end
function ComponentSetValue2() end
function ComponentGetValueBool() return false end
function ComponentGetValueInt() return 0 end
function ComponentGetValueFloat() return 0 end
function ComponentSetValueBool() end
function ComponentSetValueInt() end
function ComponentSetValueFloat() end
function ComponentGetMemberBool() return false end
function print_error() end
`;

const LUA_PRELUDE = `
_loaded = {}
function dofile_once(p)
  if _loaded[p] then return end
  _loaded[p] = true
  dofile(p)
end

function __json_encode(v)
  local t = type(v)
  if t == 'nil' then return 'null'
  elseif t == 'boolean' then return tostring(v)
  elseif t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    if math.floor(v) == v and math.abs(v) < 1e15 then return string.format('%d', v) end
    return string.format('%.17g', v)
  elseif t == 'string' then
    local s = v:gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"'):gsub('\\n', '\\\\n'):gsub('\\r', '\\\\r'):gsub('\\t', '\\\\t')
    return '"' .. s .. '"'
  elseif t == 'table' then
    local is_arr = true
    local n = 0
    for k in pairs(v) do
      n = n + 1
      if type(k) ~= 'number' then is_arr = false end
    end
    if is_arr and n == #v then
      local parts = {}
      for i = 1, #v do parts[i] = __json_encode(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    local parts = {}
    for k, val in pairs(v) do
      parts[#parts + 1] = __json_encode(tostring(k)) .. ':' .. __json_encode(val)
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end
`;

// Fields captured in the reflection pass — the ones shown on the in-game spell tooltip
// plus a few that the stats panel will need later.
const REFLECT_FIELDS = [
  'fire_rate_wait',
  'reload_time',
  'action_draw_many_count',
  'spread_degrees',
  'speed_multiplier',
  'lifetime_add',
  'damage_projectile_add',
  'damage_explosion_add',
  'damage_critical_chance',
  'explosion_radius',
  'bounces',
  'gravity',
  'screenshake',
  'recoil',
  'draw_many_count',
];

const LUA_EXTRACT = `
local fields = { ${REFLECT_FIELDS.map((f) => `'${f}'`).join(', ')} }

local defaults = {}
ConfigGunActionInfo_Init(defaults)

local out = {}
for i = 1, #actions do
  local a = actions[i]
  out[#out + 1] = {
    id = a.id,
    name = a.name,
    description = a.description,
    type = a.type,
    mana = a.mana,
    max_uses = a.max_uses,
    price = a.price,
    sprite = a.sprite,
    sprite_unidentified = a.sprite_unidentified,
    related_projectiles = a.related_projectiles,
    related_extra_entities = a.related_extra_entities,
    custom_xml_file = a.custom_xml_file,
    recursive = a.recursive,
    spawn_level = a.spawn_level,
    spawn_probability = a.spawn_probability,
    spawn_requires_flag = a.spawn_requires_flag,
    spawn_manual_unlock = a.spawn_manual_unlock,
    is_dangerous_blast = a.is_dangerous_blast,
    ai_never_uses = a.ai_never_uses,
    never_unlimited = a.never_unlimited,
  }
end

-- reflection pass: compute each spell's shot-state contribution
local state = {}
reflecting = true
ConfigGunShotEffects_Init(shot_effects)
for i = 1, #actions do
  local action = actions[i]
  current_reload_time = 0
  local shot = create_shot(1)
  c = shot.state
  set_current_action(action)
  local ok = pcall(action.action)
  register_action(c)

  local delta = {}
  for _, field in ipairs(fields) do
    local value = c[field]
    if value ~= nil and value ~= defaults[field] then
      delta[field] = value
    end
  end
  state[#state + 1] = { id = action.id, ok = ok, state = delta }
end
reflecting = false

return __json_encode({ count = #actions, spells = out, reflection = state })
`;

function loadChunk(L: any, code: string, name: string, resultCount = 0): void {
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name));
  if (status !== lua.LUA_OK) {
    throw new Error(`Lua 编译失败 (${name}): ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  const result = lua.lua_pcall(L, 0, resultCount, 0);
  if (result !== lua.LUA_OK) {
    throw new Error(`Lua 执行失败 (${name}): ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
}

interface ReflectionRow {
  id: string;
  ok: boolean;
  state: Record<string, number | string>;
}

interface RawExtraction {
  count: number;
  spells: Record<string, any>[];
  reflection: ReflectionRow[];
}

function toRawSpell(a: Record<string, any>): RawSpell {
  return {
    id: String(a.id ?? ''),
    nameKey: String(a.name ?? ''),
    descKey: String(a.description ?? ''),
    typeValue: typeof a.type === 'number' ? a.type : -1,
    mana: typeof a.mana === 'number' ? a.mana : null,
    maxUses: typeof a.max_uses === 'number' ? a.max_uses : null,
    sprite: typeof a.sprite === 'string' ? a.sprite : null,
    spriteUnidentified: typeof a.sprite_unidentified === 'string' ? a.sprite_unidentified : null,
    relatedProjectiles: Array.isArray(a.related_projectiles)
      ? a.related_projectiles.filter((p: unknown) => typeof p === 'string')
      : [],
    relatedExtraEntities: Array.isArray(a.related_extra_entities)
      ? a.related_extra_entities.filter((p: unknown) => typeof p === 'string')
      : [],
    customXmlFile: typeof a.custom_xml_file === 'string' ? a.custom_xml_file : null,
    recursive: a.recursive === true,
    price: typeof a.price === 'number' ? a.price : null,
    spawnRequiresFlag: typeof a.spawn_requires_flag === 'string' ? a.spawn_requires_flag : null,
    spawnLevel: typeof a.spawn_level === 'string' ? a.spawn_level : null,
    spawnProbability: typeof a.spawn_probability === 'string' ? a.spawn_probability : null,
    spawnManualUnlock: a.spawn_manual_unlock === true,
    isDangerousBlast: a.is_dangerous_blast === true,
    neverUnlimited: a.never_unlimited === true,
    // filled from the reflection pass below
    castDelayFrames: 0,
    reloadFrames: 0,
    drawManyCount: 0,
    stateDelta: {},
  };
}

export function extractRawSpells(wak: WakArchive): RawSpell[] {
  const gunLua = wakText(wak, 'data/scripts/gun/gun.lua');
  if (!gunLua) {
    throw new Error('data.wak 中找不到 data/scripts/gun/gun.lua —— 请确认选择的是 Noita 的 data 目录');
  }

  const L = lauxlib.luaL_newstate();
  try {
    lualib.luaL_openlibs(L);

    // `dofile` resolves paths against the .wak archive; engine-only libraries are skipped.
    const dofile = (state: any): number => {
      const path = to_jsstring(lua.lua_tostring(state, 1));
      if (/\/lib\/utilities\.lua$/.test(path)) return 0;
      const text = wakText(wak, path);
      if (text === undefined) {
        return lauxlib.luaL_error(state, to_luastring(`dofile: 缺少文件 ${path}`));
      }
      const status = lauxlib.luaL_loadbuffer(state, to_luastring(text), null, to_luastring(path));
      if (status !== lua.LUA_OK) {
        return lauxlib.luaL_error(state, to_luastring(`dofile 编译失败 ${path}`));
      }
      const result = lua.lua_pcall(state, 0, 0, 0);
      if (result !== lua.LUA_OK) {
        return lauxlib.luaL_error(state, to_luastring(`dofile 执行失败 ${path}`));
      }
      return 0;
    };
    lua.lua_pushjsfunction(L, dofile);
    lua.lua_setglobal(L, to_luastring('dofile'));

    loadChunk(L, LUA_PRELUDE, 'prelude.lua');
    loadChunk(L, ENGINE_STUBS, 'engine_stubs.lua');
    loadChunk(L, gunLua, 'gun.lua');

    const status = lauxlib.luaL_loadbuffer(L, to_luastring(LUA_EXTRACT), null, to_luastring('extract.lua'));
    if (status !== lua.LUA_OK) {
      throw new Error(`Lua 编译失败 (extract): ${to_jsstring(lua.lua_tostring(L, -1))}`);
    }
    const result = lua.lua_pcall(L, 0, 1, 0);
    if (result !== lua.LUA_OK) {
      throw new Error(`Lua 执行失败 (extract): ${to_jsstring(lua.lua_tostring(L, -1))}`);
    }
    const json = to_jsstring(lua.lua_tostring(L, -1));
    const parsed = JSON.parse(json) as RawExtraction;

    const reflectionById = new Map(parsed.reflection.map((row) => [row.id, row.state]));
    return parsed.spells.map((a) => {
      const spell = toRawSpell(a);
      const state = reflectionById.get(spell.id) ?? {};
      return {
        ...spell,
        castDelayFrames: typeof state.fire_rate_wait === 'number' ? state.fire_rate_wait : 0,
        reloadFrames: typeof state.reload_time === 'number' ? state.reload_time : 0,
        drawManyCount: typeof state.action_draw_many_count === 'number' ? state.action_draw_many_count : 0,
        stateDelta: state,
      };
    });
  } finally {
    lua.lua_close(L);
  }
}

/** Extract + localize the full spell catalog. */
export function buildSpellCatalog(wak: WakArchive, translations: Translations): SpellMeta[] {
  return extractRawSpells(wak).map((spell) => resolveSpell(spell, translations));
}
