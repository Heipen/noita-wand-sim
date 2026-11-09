import { to_jsstring, to_luastring, lauxlib, lua, lualib } from 'fengari';
import { resolveSpell } from './localization';
import type { RawSpell, SpellMeta, WakArchive } from './types';
import type { Translations } from './csv';
import { wakText } from './wak';

/**
 * Extracts spell metadata by executing the game's own `gun_actions.lua` in a Lua VM.
 *
 * We only build the `actions` table (the per-spell `action` closures are never called),
 * so no engine API shim beyond `dofile` is required. This is the same approach that the
 * M0/M1 rule engine will use; here we just serialize the table.
 */

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

const LUA_EXTRACT = `
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
    sprite = a.sprite,
    sprite_unidentified = a.sprite_unidentified,
    related_projectiles = a.related_projectiles,
    custom_xml_file = a.custom_xml_file,
    recursive = a.recursive,
    price = a.price,
    spawn_requires_flag = a.spawn_requires_flag,
  }
end
return __json_encode({ count = #actions, spells = out })
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

export function extractRawSpells(wak: WakArchive): RawSpell[] {
  const actionsCode = wakText(wak, 'data/scripts/gun/gun_actions.lua');
  if (!actionsCode) {
    throw new Error('data.wak 中找不到 data/scripts/gun/gun_actions.lua —— 请确认选择的是 Noita 的 data 目录');
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
    loadChunk(L, "dofile('data/scripts/gun/gun_enums.lua')", 'gun_enums');
    loadChunk(L, actionsCode, 'gun_actions.lua');

    const status = lauxlib.luaL_loadbuffer(L, to_luastring(LUA_EXTRACT), null, to_luastring('extract.lua'));
    if (status !== lua.LUA_OK) {
      throw new Error(`Lua 编译失败 (extract): ${to_jsstring(lua.lua_tostring(L, -1))}`);
    }
    const result = lua.lua_pcall(L, 0, 1, 0);
    if (result !== lua.LUA_OK) {
      throw new Error(`Lua 执行失败 (extract): ${to_jsstring(lua.lua_tostring(L, -1))}`);
    }
    const json = to_jsstring(lua.lua_tostring(L, -1));

    const parsed = JSON.parse(json) as { count: number; spells: Record<string, any>[] };
    return parsed.spells.map((a) => ({
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
      customXmlFile: typeof a.custom_xml_file === 'string' ? a.custom_xml_file : null,
      recursive: a.recursive === true,
      price: typeof a.price === 'number' ? a.price : null,
      spawnRequiresFlag: typeof a.spawn_requires_flag === 'string' ? a.spawn_requires_flag : null,
    }));
  } finally {
    lua.lua_close(L);
  }
}

/** Extract + localize the full spell catalog. */
export function buildSpellCatalog(wak: WakArchive, translations: Translations): SpellMeta[] {
  return extractRawSpells(wak).map((spell) => resolveSpell(spell, translations));
}
