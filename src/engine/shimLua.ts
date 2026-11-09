/**
 * Lua-side scaffolding for the rule engine: JSON encoder, engine API stubs that record
 * events, a fake entity graph (for ZETA / requirement spells), and hooks that wrap the
 * game's own gun.lua functions.
 *
 * The actual casting logic is the game's own Lua (`gun.lua` + `gun_actions.lua`) from the
 * user's data.wak / the bundled data pack — nothing here re-implements it.
 */

export const LUA_PRELUDE = `
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

export const ENGINE_STUBS = `
-- state / event log ----------------------------------------------------------
__events = {}
__last_state = nil
__last_reload_time = nil
__not_enough = false
__if_half = 0
__frame = 0

function __ev(name, ...)
  local n = select('#', ...)
  local t = { name = name }
  for i = 1, n do t[i] = select(i, ...) end
  __events[#__events + 1] = t
end

function __reset_events()
  __events = {}
  __last_state = nil
  __last_reload_time = nil
  __not_enough = false
end

-- casting callbacks ----------------------------------------------------------
function BeginProjectile(name) __ev('projectileBegin', name) end
function EndProjectile() __ev('projectileEnd') end
function BeginTriggerTimer(d) __ev('triggerBegin', 'timer', d) end
function BeginTriggerHitWorld() __ev('triggerBegin', 'hitWorld') end
function BeginTriggerDeath() __ev('triggerBegin', 'death') end
function EndTrigger() __ev('triggerEnd') end
function Reflection_RegisterProjectile() end
function SetProjectileConfigs() end
function RegisterGun() end
function RegisterGunAction(state) __last_state = state end
function RegisterGunShotEffects() end
function OnActionPlayed() end
function OnActionCalled() end
function OnActionFinished() end
function OnNotEnoughManaForAction()
  __not_enough = true
  __ev('notEnoughMana')
end
function ActionUsed() end
function ActionUsesRemainingChanged() return true end
function LogAction() end
function StartReload(t)
  __last_reload_time = t
  __ev('reload', t)
end
function BaabInstruction() end

-- misc engine globals --------------------------------------------------------
function GameGetFrameNum() return __frame end
function GameGetRealWorldTimeSinceStarted() return __frame / 60 end
function GamePrint() end
function Note() end
function HasFlagPersistent() return true end
function GlobalsGetValue(key, default)
  if key == 'GUN_ACTION_IF_HALF_STATUS' then return tostring(__if_half) end
  return default or ''
end
function GlobalsSetValue(key, value)
  if key == 'GUN_ACTION_IF_HALF_STATUS' then __if_half = tonumber(value) or 0 end
end

-- RNG (implemented in TS and injected as __engine_random / __engine_set_seed)
function Random(a, b) return __engine_random(a, b) end
function SetRandomSeed(a, b) __engine_set_seed(a, b) end

-- fake entity graph ----------------------------------------------------------
__entities = {}
__comps = {}
__next_comp = 1000
__req = {}
__caster_x = 0
__caster_y = 0

function __entity(id, name, tag)
  __entities[id] = { name = name or '', tag = tag, children = {}, comps = {} }
  return id
end
function __add_child(parent, child)
  local e = __entities[parent]
  if e then table.insert(e.children, child) end
end
function __add_comp(entity, kind, values)
  local cid = __next_comp
  __next_comp = cid + 1
  __comps[cid] = values or {}
  local e = __entities[entity]
  if e then e.comps[kind] = cid end
  return cid
end

function __setup_entities(cfg)
  __entities = {}
  __comps = {}
  __next_comp = 1000
  __req = cfg.req or {}
  __caster_x = cfg.x or 0
  __caster_y = cfg.y or 0

  __entity(1, 'player')
  __add_comp(1, 'Inventory2Component', { mActiveItem = 10 })
  __entity(2, 'inventory_quick')
  __add_child(1, 2)
  __entity(10, 'wand', 'wand')

  for wi, wand in ipairs(cfg.extraWands or {}) do
    local wand_id = 300 + wi
    __entity(wand_id, 'wand', 'wand')
    __add_child(2, wand_id)
    for si, spell in ipairs(wand.spells or {}) do
      local spell_id = 400 + wi * 100 + si
      __entity(spell_id, 'spell')
      __add_comp(spell_id, 'ItemActionComponent', { action_id = spell })
      __add_child(wand_id, spell_id)
    end
  end
end

function __fake_enemies()
  if __req.enemies then return { 901, 902, 903, 904, 905 } end
  return {}
end
function __fake_projectiles()
  if __req.projectiles then return { 911, 912, 913, 914, 915 } end
  return {}
end

function EntityGetAllChildren(id)
  local e = __entities[id]
  if e then return e.children end
  return {}
end
function EntityGetName(id)
  local e = __entities[id]
  if e then return e.name end
  return ''
end
function EntityHasTag(id, tag)
  local e = __entities[id]
  return e ~= nil and e.tag == tag
end
function EntityGetTransform(id) return __caster_x, __caster_y end
function EntityGetFirstComponent(id, kind)
  if kind == 'DamageModelComponent' and id == 1 then
    __comps[990] = { hp = (__req.hp and 25 or 100), max_hp = 100 }
    return 990
  end
  local e = __entities[id]
  if e then return e.comps[kind] end
  return nil
end
function EntityGetFirstComponentIncludingDisabled(id, kind)
  return EntityGetFirstComponent(id, kind)
end
function EntityGetComponent(id, kind)
  local comp = EntityGetFirstComponent(id, kind)
  if comp then return { comp } end
  return {}
end
function ComponentGetValue2(comp, field)
  local t = __comps[comp]
  if t and t[field] ~= nil then return t[field] end
  return 0
end
function ComponentSetValue2(comp, field, value)
  local t = __comps[comp]
  if t then t[field] = value end
end
-- legacy engine API names used by some scripts
function ComponentGetValue(comp, field) return ComponentGetValue2(comp, field) end
function ComponentSetValue(comp, field, value) ComponentSetValue2(comp, field, value) end
function ComponentGetValueBool(comp, field) return ComponentGetValue2(comp, field) == true end
function ComponentGetValueInt(comp, field) return math.floor(ComponentGetValue2(comp, field)) end
function ComponentGetValueFloat(comp, field) return ComponentGetValue2(comp, field) end
function ComponentSetValueBool(comp, field, v) ComponentSetValue2(comp, field, v) end
function ComponentSetValueInt(comp, field, v) ComponentSetValue2(comp, field, v) end
function ComponentSetValueFloat(comp, field, v) ComponentSetValue2(comp, field, v) end
function ComponentGetMemberBool() return false end
function GetUpdatedEntityID() return 1 end
function GetWorldEntityID() return 1 end
function EntityLoad() return 0 end
function EntityCreate() return 0 end
function EntityKill() end
function EntityInflictDamage() end
function EntityGetWithTag(tag)
  if tag == 'enemy' or tag == 'homing_target' then return __fake_enemies() end
  if tag == 'projectile' then return __fake_projectiles() end
  return {}
end
function EntityGetInRadiusWithTag(x, y, radius, tag)
  if tag == 'homing_target' or tag == 'enemy' then return __fake_enemies() end
  if tag == 'projectile' then return __fake_projectiles() end
  return {}
end
function print_error() end
`;

/** Wraps the game's own gun.lua functions to emit richer events. */
export const LUA_HOOKS = `
-- shot-state fields whose change is reported per action (human-readable explanations)
local __delta_fields = {
  'fire_rate_wait', 'reload_time',
  'damage_projectile_add', 'damage_explosion_add', 'damage_melee_add',
  'damage_electricity_add', 'damage_fire_add', 'damage_ice_add',
  'damage_slice_add', 'damage_healing_add', 'damage_curse_add', 'damage_drill_add',
  'damage_critical_chance', 'damage_critical_multiplier',
  'spread_degrees', 'speed_multiplier', 'lifetime_add', 'explosion_radius',
  'bounces', 'screenshake', 'recoil', 'action_draw_many_count',
}

local function __capture_shot_state()
  local out = {}
  for i = 1, #__delta_fields do
    local field = __delta_fields[i]
    out[field] = c[field] or 0
  end
  return out
end

local function __state_delta(before)
  local after = __capture_shot_state()
  local delta = {}
  for i = 1, #__delta_fields do
    local field = __delta_fields[i]
    if after[field] ~= before[field] then
      delta[field] = after[field] - before[field]
    end
  end
  return delta
end

function __install_hooks()
  -- 0) capture discards: spells and the end-of-cast hand flush insert into 'discarded'.
  --    (discards caused by a failed draw are already reported via drawCard ok=false)
  __inside_draw_action = false
  local orig_table_insert = table.insert
  table.insert = function(list, a, b)
    local value = b ~= nil and b or a
    if (not __inside_draw_action) and list == discarded and type(value) == 'table' and value.id then
      __ev('discard', value.id, #discarded)
    end
    if b ~= nil then
      return orig_table_insert(list, a, b)
    end
    return orig_table_insert(list, a)
  end

  -- 1) wrap every spell's action closure: captures recursion/iteration, "don't draw"
  --    state, permanent-card flag and the exact shot-state delta it caused.
  for i = 1, #actions do
    local action = actions[i]
    local original = action.action
    action.action = function(recursion_level, iteration)
      local eventIndex = #__events + 1
      local before = __capture_shot_state()
      __ev(
        'callAction',
        action.id,
        recursion_level,
        iteration,
        dont_draw_actions == true,
        playing_permanent_card == true
      )
      local result = original(recursion_level, iteration)
      __events[eventIndex][6] = __state_delta(before)
      __ev('callActionEnd')
      return result
    end
  end

  -- 2) draw machinery: draw block begin/end + one event per draw attempt.
  local orig_draw_action = draw_action
  function draw_action(instant_reload_if_empty)
    local before = #deck
    local top = nil
    if deck[1] then top = deck[1].id end
    __inside_draw_action = true
    local ok = orig_draw_action(instant_reload_if_empty)
    __inside_draw_action = false
    __ev('drawCard', top, before, #deck, ok)
    __ev('draw', before, #deck, state_cards_drawn, ok)
    return ok
  end

  local orig_draw_actions = draw_actions
  function draw_actions(how_many, instant_reload_if_empty)
    __ev('drawBlockBegin', how_many, instant_reload_if_empty == true)
    local result = orig_draw_actions(how_many, instant_reload_if_empty)
    __ev('drawBlockEnd')
    return result
  end

  -- 3) playing a card: which card was drawn, then the action itself.
  local orig_play_action = play_action
  function play_action(action)
    -- the draw attempt itself is over: discards caused by spells (e.g. divide) are
    -- real discards and must be reported, unlike the failed-draw discard above
    __inside_draw_action = false
    local before = __capture_shot_state()
    __ev('playAction', action.id, action.deck_index)
    local actionIndex = #__events + 1
    __ev('action', action.id, action.deck_index)
    local result = orig_play_action(action)
    __events[actionIndex][3] = __state_delta(before)
    return result
  end

  local orig_order_deck = order_deck
  function order_deck()
    __ev('orderDeck', gun.shuffle_deck_when_empty == true)
    return orig_order_deck()
  end

  local orig_start_shot = _start_shot
  function _start_shot(current_mana)
    __ev('shotStart', current_mana, __frame)
    return orig_start_shot(current_mana)
  end

  local orig_draw_actions_for_shot = _draw_actions_for_shot
  function _draw_actions_for_shot(can_reload_at_end)
    orig_draw_actions_for_shot(can_reload_at_end)
    __ev('shotEnd', (c and c.fire_rate_wait) or 0, current_reload_time or 0)
  end
end
`;

/** Prepares the wand deck. `cfg` is generated as a Lua table literal by the TS side. */
export const LUA_PREPARE = `
function __prepare_wand(cfg)
  gun = {
    actions_per_round = cfg.actions_per_round,
    shuffle_deck_when_empty = cfg.shuffle_deck_when_empty,
    reload_time = cfg.reload_time,
    deck_capacity = cfg.deck_capacity,
  }
  __always = cfg.always or {}
  __always_count = cfg.alwaysCount or #__always
  current_reload_time = gun.reload_time
  _clear_deck(false)
  local count = cfg.spellCount or #cfg.spells
  for i = 1, count do
    local spell = cfg.spells[i]
    if spell then
      _add_card_to_deck(spell.id, i - 1, spell.uses or -1, true)
    end
  end
end

function __do_shot(mana_in, frame, cast_delay)
  __frame = frame
  state_cards_drawn = 0
  __reset_events()
  state_from_game = {}
  ConfigGunActionInfo_Init(state_from_game)
  state_from_game.fire_rate_wait = cast_delay
  __globaldata = state_from_game
  _set_gun2()
  _start_shot(mana_in)
  for i = 1, __always_count do
    if __always[i] then _play_permanent_card(__always[i]) end
  end
  _draw_actions_for_shot(true)
  return __snapshot()
end

function __snapshot()
  local function ids(list)
    local out = {}
    for i = 1, #list do out[i] = list[i].id end
    return out
  end
  -- c is the root shot state; draw_shot() restores it after nested trigger shots.
  local state = c or {}
  return __json_encode({
    deck = ids(deck),
    hand = ids(hand),
    discarded = ids(discarded),
    mana = mana,
    castDelayFrames = state.fire_rate_wait or 0,
    reloadFrames = current_reload_time or 0,
    reloaded = __last_reload_time ~= nil,
    reloadTime = __last_reload_time,
    notEnoughMana = __not_enough,
    castState = state,
    events = __events,
  })
end
`;

/** Serializes a JS value into a Lua table/expression literal. */
export function toLuaLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `{ ${value.map((item) => toLuaLiteral(item)).join(', ')} }`;
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).map(
      ([key, val]) => `[${JSON.stringify(key)}] = ${toLuaLiteral(val)}`,
    );
    return `{ ${parts.join(', ')} }`;
  }
  return 'nil';
}
