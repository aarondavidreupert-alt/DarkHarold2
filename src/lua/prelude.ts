// Lua side of the Lua script backend: SSL semantics, the per-script sandbox and
// the coroutine driver. Runs once per Lua engine (luaRuntime.ts).
//
// The decompiled scripts (tools/int2lua.py) use plain Lua wherever SSL and Lua
// agree and the helpers below where they do not. SSL semantics follow
// fallout2-ce interpreter.cc (opAdd, opDivide, opModulo, opFloor, opIf) as the
// bytecode VM (src/vm.ts) implements them.
//
// The host (TypeScript) sets these globals before running this chunk:
//   __host_call(script, name, ...)   run Script[name](...), result normalised
//   __host_var(script, name)          a built-in variable (self_obj, dude_obj, ...)
//   __host_get_ext(script, name)      an exported variable of the map script
//   __host_set_ext(script, name, v)
//   __host_option(script, kind, fn, ...)  gsay_option / giq_option with a Lua target
//   __host_log(level, text)

export const LUA_PRELUDE = String.raw`
local host_call, host_var = __host_call, __host_var
local host_get_ext, host_set_ext = __host_get_ext, __host_set_ext
local host_option, host_log = __host_option, __host_log
__host_call, __host_var, __host_get_ext, __host_set_ext, __host_option, __host_log = nil

local type, tostring, select, pairs, error, pcall = type, tostring, select, pairs, error, pcall
local load, rawget, rawset, setmetatable = load, rawget, rawset, setmetatable
local mtype, fmt = math.type, string.format
local co_create, co_resume, co_status, co_yield, co_running = coroutine.create, coroutine.resume,
    coroutine.status, coroutine.yield, coroutine.running

-- ---------------------------------------------------------------------------
-- SSL value semantics
-- ---------------------------------------------------------------------------

-- CE opAdd: a string operand turns the other into text, a float as "%.5f".
local function text(v)
    local t = mtype(v)
    if t == "float" then return fmt("%.5f", v) end
    if t == "integer" then return fmt("%d", v) end
    return tostring(v)
end

-- Lua 5.4 does string arithmetic through the string metatable, so this makes
-- "Base Reaction == " + local_var(3) work as written in the SSL source.
local string_mt = getmetatable("")
string_mt.__add = function(a, b) return text(a) .. text(b) end

-- CE opDivide: int / int truncates toward zero, a float operand divides as
-- floats. Division by zero stops the procedure (programFatalError longjmps out
-- of the script); the runtime catches the error and the call returns 0.
local function div(a, b)
    if b == 0 then error("Division (DIV) by zero", 0) end
    if mtype(a) == "float" or mtype(b) == "float" then return a / b end
    local q = a // b
    if q < 0 and q * b ~= a then q = q + 1 end
    return q
end

-- CE opModulo: the remainder takes the sign of the dividend (C %); by zero it
-- stops the procedure like div.
local function mod(a, b)
    if b == 0 then error("Division (MOD) by zero", 0) end
    return math.fmod(a, b)
end

-- CE opFloor: (int)value, i.e. truncation.
local function floor(v)
    if mtype(v) ~= "float" then return v end
    local r = v >= 0 and math.floor(v) or math.ceil(v)
    return math.tointeger(r) or r
end

-- SSL truth: 0 (and the empty string, as in the VM) is false.
local function truthy(v)
    return v ~= 0 and v ~= false and v ~= nil and v ~= ""
end

-- sslc compiles and/or to opAnd/opOr: both sides are evaluated first.
local function AND(a, b) return truthy(a) and truthy(b) end
local function OR(a, b) return truthy(a) or truthy(b) end

local function b2i(c) return c and 1 or 0 end

-- ---------------------------------------------------------------------------
-- Sandbox: what a script's environment can see besides its own globals
-- ---------------------------------------------------------------------------

local safe = {
    math = math, string = string, table = table,
    pairs = pairs, ipairs = ipairs, next = next, select = select,
    tostring = tostring, tonumber = tonumber, type = type,
    print = function(...)
        local parts = {}
        for i = 1, select("#", ...) do parts[#parts + 1] = text((select(i, ...))) end
        host_log("info", table.concat(parts, " "))
    end,
}

-- SSL built-in variables: opcodes without arguments, read on every access.
local BUILTIN_VARS = {
    dude_obj = true, self_obj = true, source_obj = true, target_obj = true,
    fixed_param = true, action_being_used = true, game_time = true,
    game_time_hour = true, game_time_in_seconds = true, cur_map_index = true,
    combat_is_initialized = true, get_month = true, get_day = true,
    obj_being_used_with = true, script_action = true, game_difficulty = true,
    combat_difficulty = true, game_ui_is_disabled = true, days_since_visited = true,
    running_burning_guy = true,
}

local SUSPEND = {}  -- yielded by gsay_end / gsay_message
local EXIT = {}     -- raised by exit() (CE opExit / opExitProgram)

-- Scripts are keyed by a numeric id the host assigns: wasmoon wraps a JS object
-- in a new userdata every time it crosses into Lua, so the object itself is not
-- a usable table key (== still works, through the userdata's __eq).
local scripts = {}  -- id -> env

-- Dialogue option targets stay on the Lua side (a Lua function that went
-- through JS comes back as a JS proxy); the host gets a number for each.
local options = {}  -- id -> { [n] = function }
local option_seq = 0
local function option_ref(id, f)
    if type(f) ~= "function" then error("dialogue option target is not a procedure", 3) end
    option_seq = option_seq + 1
    local t = options[id]
    if t == nil then t = {}; options[id] = t end
    t[option_seq] = f
    return option_seq
end

local function new_env(id, script, name)
    local env = {}
    local imports = {}
    local api = {}  -- intrinsic closures, made on first use

    local function intrinsic(k)
        local f = api[k]
        if f == nil then
            f = function(...) return host_call(script, k, ...) end
            api[k] = f
        end
        return f
    end

    -- helpers the generated code calls
    local lib = {
        div = div, mod = mod, floor = floor, AND = AND, OR = OR, b2i = b2i,
        import = function(...)
            for i = 1, select("#", ...) do imports[(select(i, ...))] = true end
        end,
        export = function(n, v)
            imports[n] = true
            host_set_ext(script, n, v == nil and 0 or v)
        end,
        entry = function(n) rawset(env, "__entry", n) end,
        -- the VM's own versions (vm_bridge.ts): roll_dice is CE's predefined
        -- error stub and pushes 0, display shows nothing (interpreter_lib.cc opDisplay)
        roll_dice = function() return 0 end,
        display = function() end,
        call = function(n, ...)
            local f = rawget(env, n)
            if type(f) ~= "function" then error("call: no procedure " .. tostring(n), 2) end
            return f(...)
        end,
        exit = function() error(EXIT, 0) end,
        gsay_end = function()
            host_call(script, "gsay_end")
            co_yield(SUSPEND)
        end,
        gsay_message = function(list, msg, reaction)
            host_call(script, "gsay_message", list, msg, reaction)
            co_yield(SUSPEND)
        end,
        gsay_option = function(list, msg, target, reaction)
            host_option(script, "gsay_option", option_ref(id, target), list, msg, reaction)
        end,
        giq_option = function(iq, list, msg, target, reaction)
            host_option(script, "giq_option", option_ref(id, target), iq, list, msg, reaction)
        end,
    }

    setmetatable(env, {
        __index = function(_, k)
            if BUILTIN_VARS[k] then return host_var(script, k) end
            if imports[k] then return host_get_ext(script, k) end
            local v = lib[k]
            if v ~= nil then return v end
            v = safe[k]
            if v ~= nil then return v end
            if type(k) == "string" then return intrinsic(k) end
            return nil
        end,
        __newindex = function(t, k, v)
            if imports[k] then host_set_ext(script, k, v) else rawset(t, k, v) end
        end,
    })
    scripts[id] = env
    return env
end

-- ---------------------------------------------------------------------------
-- Running procedures. Every entry from the engine runs in a coroutine so that
-- gsay_end / gsay_message can suspend it until the dialogue resumes it (CE runs
-- the dialogue loop inside gsay_end, game_dialog.cc gameDialogEnter).
-- ---------------------------------------------------------------------------

local suspended = {}  -- id -> stack of suspended coroutines

local function report(id, where, err)
    if err == EXIT then return end
    local env = scripts[id]
    host_log("error", tostring(env and env.__name or "?") .. ":" .. tostring(where) .. ": " .. tostring(err))
end

local function step(id, co, where, ...)
    local ok, r = co_resume(co, ...)
    if not ok then
        report(id, where, r)
        return 0
    end
    if co_status(co) == "suspended" then
        local s = suspended[id]
        if s == nil then s = {}; suspended[id] = s end
        s[#s + 1] = { co = co, where = where }
        return 0
    end
    if r == nil or r == false then return 0 end
    if r == true then return 1 end
    return r
end

-- Load a decompiled script's source into a fresh environment. Returns the
-- names of its procedures.
function __load(id, script, name, source)
    local env = new_env(id, script, name)
    rawset(env, "__name", name)
    local chunk, err = load(source, "@" .. name .. ".lua", "t", env)
    if not chunk then error(err, 0) end
    local ok, e = pcall(chunk)
    if not ok and e ~= EXIT then error(tostring(e), 0) end
    local procs = {}
    for k, v in pairs(env) do
        if type(v) == "function" and type(k) == "string" and k:sub(1, 2) ~= "__" then
            procs[#procs + 1] = k
        end
    end
    return procs
end

function __entry_name(id)
    local env = scripts[id]
    return env and rawget(env, "__entry") or "start"
end

function __call(id, name, ...)
    local env = scripts[id]
    local f = env and rawget(env, name)
    if type(f) ~= "function" then return 0 end
    return step(id, co_create(f), name, ...)
end

-- A dialogue option target (see option_ref) run as an engine entry.
function __call_option(id, n)
    local t = options[id]
    local f = t and t[n]
    if f == nil then return 0 end
    return step(id, co_create(f), "option")
end

-- Resume the most recently suspended procedure of this script; when it
-- finishes, the one suspended before it continues too (a gsay_message inside
-- an option, then the talk_p_proc that is waiting in gsay_end).
function __resume(id)
    local s = suspended[id]
    while s ~= nil and #s > 0 do
        local top = table.remove(s)
        step(id, top.co, top.where)
        if co_status(top.co) == "suspended" then return true end
    end
    return false
end

function __has_suspended(id)
    local s = suspended[id]
    return s ~= nil and #s > 0
end

function __unload(id)
    scripts[id] = nil
    suspended[id] = nil
    options[id] = nil
end

-- nothing in the engine state needs these after this chunk (the locals above
-- keep load and friends for __load); script environments never see them
for _, k in ipairs({ "load", "loadstring", "dofile", "loadfile", "require", "io", "os", "debug", "package" }) do
    _G[k] = nil
end
`
