# Lua Scripts — decompiled `.int` running as Lua

> DH2 addition (no CE counterpart). Started 2026-10-19 on branch `decompile-ini-to-lua`.
> Goal: every game script readable and moddable, behaving exactly like the original bytecode.
> Status: **pilot**. 1439 of 1443 scripts decompile; the four left are explained under "Scripts that stay
> `.int`". The VM-vs-Lua test over every decompiled script (1436, 646 965 runs) differs only in one
> Black Isle script bug neither backend can match CE on (`known_bugs.md` L7). The bytecode VM stays the default (`[dh2] script_backend=vm`).

## Pieces

| Part | File | What it does |
|------|------|--------------|
| Decompiler | `tools/int2lua.py` | `.int` bytecode → Lua 5.4. Pipeline stage `decompile_scripts` writes `data/scripts/<name>.lua` next to each `.int` |
| Lua engine | `lib/wasmoon/` | wasmoon 1.16.0 (Lua 5.4 in WebAssembly, MIT, vendored like `lib/pathfinding-browser.js`; loaded by `play.html` as the `wasmoon` global) |
| Prelude | `src/lua/prelude.ts` | Lua side: SSL semantics, the per-script sandbox, coroutine driver for dialogue |
| Runtime | `src/lua/luaRuntime.ts` | TS side: starts the engine, turns a `Script` object into a Lua-backed one (`attachLuaScript`) |
| Hook | `src/scripting.ts` `loadScript` / `loadLuaScript` | With `Config.scripting.backend === 'lua'`, loads `<name>.lua`; no file or a load error → the `.int` runs |
| Test | `luadiff.html`, `src/lua/luaDiff.ts` | VM-vs-Lua differential test (below) |

Select the backend with `fallout2.cfg` `[dh2] script_backend=lua` (default `vm`), or for one page load
with `play.html#script_backend=lua` (the query string is the `?mapname` shortcut).

## Why a decompiler of our own

int2ssl (sfall-team, GPL-3.0) is the standard `.int` → SSL decompiler. It is a native program, so a pipeline
stage calling it would not run on macOS/Linux without a build, and SSL → Lua would need an SSL parser on
top. `int2lua.py` decompiles the bytecode the VM runs directly to Lua, in the pipeline's Python.
int2ssl 8.4.9 (sfall modderspack 4.5.1) was used as a reference to cross-check the output; it is not part
of the repo or the pipeline.

## What the decompiler recognises

Only the shapes the original sslc compiler emits — anything else fails the whole script (it stays `.int`),
never a silently wrong translation:

- **Startup code** (before the first procedure): `export variable` (push name; `0x8016`), exported variables'
  initial values (`0x8015`), one push per script variable, the entry procedure's argument count, `0x8003`,
  `push <entry>; jmp`. Same section order int2ssl reads.
- **Names**: the identifier table holds procedure, script-variable, exported and imported names in
  declaration order. Script variables = the names left after the others (int2ssl `TryRenameGlobalVariables`;
  on a count mismatch both fall back to `GVar0…`). Procedure-local variables and arguments have no names in
  the `.int`: `LVar0…`, `arg0…`.
- **if / else**: `push <else>; <cond>; op_if (0x802F)`; a then-branch ending in `push E; jmp` has an else
  `[else, E)`, possibly empty (`E == else`).
- **while**: `push <exit>; L: <cond>; op_while (0x8030); body; push L; jmp`. CE `opWhile` keeps the exit
  address on the stack while the loop runs, so the back jump goes past the `push`.
- **call**: `push <ret>; d_to_a; args…; push argc; push <index>; op_call`; `call <variable>` uses
  `op_lookup_string_proc` (`0x8028`) + `dup` + `check_arg_count` → `call(name, …)`.
- **return**: `push v; d_to_a; swapa; pop_to_base; pop_base; a_to_d; pop_return`; the trailing `return 0` sslc
  adds is dropped.
- **Unused results**: some intrinsics push a value sslc never pops (CE `opCritterModifySkill` pushes 0, the VM
  table pushes `critter_heal`'s result). The call is a statement where it ran.
- **Unused locals**: a local nobody reads leaves its initial value on the stack; the decompiler retries with
  one more local until the body balances.
- **Imported variable by number**: sslc compiles `x += 1` on an `import variable` as `push_int <identifier
  offset>; fetch_external` instead of `push_string`. CE `opFetchExternalVariable` reads the name as
  `programGetIdentifier(value.integerValue)` whatever the type (the VM's `varName` does the same), so an
  int constant that is an identifier offset is that name (bcgengrd, scbrahmn, the Vault City team9 scripts…).
- **Threaded jumps**: a nested `if` may jump straight to where the enclosing block's closing `push X; jmp`
  goes instead of to that jump (the NCR `talk_p_proc`s, modinn). Accepted only when the code at the block's
  end is a chain of `push; jmp` that reaches exactly that target; the branch then ends at the block's end.
- **`detach` (`0x800F`)**: CE `opDetach` only unlinks a program from its parent; game scripts have none, so
  it emits nothing (genint).
- **Argument count mismatch**: CE `opPushBase` builds the frame from the count the caller pushed, so a call
  with the wrong count is accepted when the callee never fetches or stores a frame variable (sccop calls
  `getArmedPartyMember`, declared with one parameter, with none). Otherwise it is an error.
- **Negative constants**: `push -2147483648; negate` folds to -2147483648 (CE int32 negation), not 2^31.
- **Names**: constant numbers that have a name are written as that name, declared as `local NAME = n` at
  the top of the file (at most 180, Lua's local limit is 200; the rest stay numbers):
  - global variables (`global_var(GVAR_ENEMY_ARROYO)`) from the install's `data/data/vault13.gam`, and in a
    map's own script its map variables from `data/maps/<map>.gam` — numbered by line order, as CE reads the
    values;
  - with SSL sources in `data/scripts_src/` (the Unofficial Patch's `scripts_src`, by killap — download it
    yourself, it is not part of the repo): local variables (`local_var(LVAR_Herebefore)`) and the map
    variables a script uses, from its `<name>.ssl` and the headers it `#include`s; and PIDs
    (`party_member_obj(PID_SULIK)`, `obj_pid(x) == PID_STIMPAK`) from `itempid.h`, `critrpid.h`, `scenepid.h`.
    The sources are the patched scripts, so a script takes their LVAR/MVAR names only when every procedure
    of the vanilla `.int` is also in its `.ssl` (1170 of 1238); a number two headers name differently stays
    a number. Without the files, or for a computed number, the number stays.
  - from the same sources' `define.h` / `animcomd.h`, the arguments that take one of their constants:
    `get_critter_stat(dude_obj, STAT_gender)`, `has_skill(…, SKILL_SPEECH)`, `get_pc_stat(PCSTAT_level)`,
    `critter_inven_obj(…, INVEN_TYPE_RIGHT_HAND)`, `metarule(METARULE_IS_LOADGAME, 0)`,
    `float_msg(…, FLOAT_MSG_YELLOW)`, `anim(…, ANIM_stand, …)`, `reg_anim_func(REG_ANIM_BEGIN, …)`,
    `critter_dmg(…, DMG_fire)`, `critter_injure(…, DAM_KNOCKED_DOWN)`, `mark_area_known(MARK_TYPE_TOWN, …,
    MARK_STATE_KNOWN)`, `start_gdialog(…, HEAD_ELDER, BACKGROUND_TENT)`, and `has_trait(TRAIT_PERK, dude_obj,
    PERK_empathy)` — the third argument of `has_trait` / `critter_add_trait` by its type (TRAIT_PERK /
    TRAIT_OBJECT / TRAIT_TRAIT, CE `CRITTER_TRAIT_*`). `metarule(METARULE_ELEVATOR, ELEV_…)` and
    `metarule3(METARULE3_GET_KILL_COUNT, KILL_TYPE_…)` name their argument too. Bit-flag combinations and a
    value two names share stay numbers.
  - Some expressions (`b2i`, `div`, `AND` …) are text before the declarations are known; a name in them is a
    marker until `emit` decides, so a name never appears without its `local`.

### Scripts that stay `.int`

- **barstow, dumar, surf** use the interpreter library's own dialogue (`0x804C`–`0x8061`, CE
  `interpreter_lib.cc opSayStart`, `opSayReply`, `opSayOption`, `opSayMessage`, `opSayEnd`), which Fallout 2
  replaced with gdialog. Neither backend implements it, and no scripts.lst entry or map names these
  Fallout 1 leftovers.
- **mitoilet**: `description_p_proc` compiles `set_local_var(1)` without the variable number, so it pops a
  word from below its own frame — in CE the `windowId` that `_setupCallWithReturnVal` pushed (it then writes
  local variable `windowId` and breaks the call's stack restore), in the VM the last script variable. That is
  undefined behaviour a decompiler can only reproduce by inventing an argument, so the script keeps its
  bytecode (`loadLuaScript` falls back to the `.int`).

`python tools/int2lua.py --check-bridge src/vm_bridge.ts` checks the intrinsic table (name, argc, pushes a
result) against the VM bridge.

## SSL semantics in Lua

The output uses plain Lua where SSL and Lua agree and helpers from the prelude where they do not:

| SSL | Lua output | Why |
|-----|-----------|-----|
| `if (x)` | `if x ~= 0 then` | 0 is true in Lua |
| `a + b` with a string | `a + b` | The prelude sets the string metatable's `__add` to SSL concatenation (CE `opAdd`; float as `%.5f`). Lua 5.4 does string arithmetic through that metatable — the reason for 5.4 over fengari's 5.3 |
| `a / b` | `div(a, b)` | int / int truncates toward 0 (CE `opDivide`); `// ` floors. By zero: a Lua error, so the procedure stops and returns 0 — CE `programFatalError` longjmps out of the script (the VM does the same since L6) |
| `a % b` | `mod(a, b)` | sign of the dividend (C `%`); by zero stops the procedure like `div` |
| `a and b` | `a and b` when `b` has no side effects, else `AND(a, b)` | sslc's `opAnd`/`opOr` evaluate both sides first; Lua skips the right side. The decompiler's `PURE` list says which intrinsics are safe to skip |
| comparison used as a value | `b2i(a == b)` | CE comparisons push 0/1 |
| `self_obj`, `dude_obj`, `game_time`, … | `self_obj`, … | Built-in variables, read on every access through the environment's `__index` (`vm_bridge.ts readBuiltinVar`, shared with the VM) |
| `import variable x` / `export variable x` | `import("x")` / `export("x", v)`, then plain `x` | Read/written on the map script object, like VM `op_fetch_external` / `op_store_external` |
| `giq_option(…, Node002, …)` | `giq_option(…, Node002, …)` | The procedure is passed as a Lua function |

Intrinsic results are normalised to SSL values (`luaRuntime.ts sslValue`): booleans become 0/1,
`null`/`undefined` become 0 (wasmoon also cannot return `null` into Lua).

## Mods

A mod is a folder `mods/<name>/scripts/` with `<script>.lua` files, written like the generated ones (start
from a copy of `data/scripts/<script>.lua`). `fallout2.cfg`:

    [dh2]
    script_backend=lua
    mods=bigger_guns,my_fixes

lists the mods in load order: for each script the last listed mod that has it wins, then the generated
`data/scripts/<script>.lua`, then the `.int`. `play.html#script_backend=lua&mods=a,b` overrides the list for one
page load. Mod names are folder names only (letters, digits, `_ . -`). A mod script that fails to load falls
back to the `.int`, like a generated one. `mods/` is git-ignored.

## Runtime

- **One engine, one environment per script.** Script globals live in the script's own table; everything else
  comes through its `__index`: built-in variables, imported variables, the helpers, a few safe libraries
  (`math`, `string`, `table`, …), then every other name as an intrinsic (`Script[name]`). Not visible to
  scripts: `load`, `require`, `io`, `os`, `debug`, `rawset`, `setmetatable`.
- **Scripts are keyed by a numeric id**, not by the `Script` object: wasmoon wraps a JS object in a new
  userdata each time it enters Lua, so the object is no table key (`==` between two wrappers still works).
- **Load** runs the chunk (script variables, exports) and then the entry procedure once, like the VM's startup
  code (CE `scriptExecProc`: `runProgram` + `_interpret` on first load).
- **Dialogue**: every engine call runs in a coroutine. `gsay_end` and `gsay_message` yield; the dialogue's
  end (`scripting.ts dialogueExit`) resumes the most recently suspended procedure, then the one before it.
  This is CE (`gameDialogEnter` runs the whole dialogue inside `gsay_end`). The VM does the same since
  2026-10-19 (`ScriptVM.resume`, `known_bugs.md` L2).
- **Dialogue option targets** stay on the Lua side (a numbered registry); a Lua function that went through JS
  comes back as a JS proxy.
- **Errors** in a Lua procedure are caught, logged (`dbgWarn('lua', …)`), and the call returns 0.

## VM-vs-Lua differential test

`luadiff.html?scripts=a,b&seeds=N` (default: the 36 Arroyo scripts, 20 seeds). For every procedure and seed,
the script is loaded in both backends against an identical fake game: every intrinsic call is answered
from a seeded random world (LVAR/GVAR/MVAR stores, a pool of fake objects) and recorded. Then the procedure
runs with random arguments, a suspended dialogue is resumed, and the first dialogue option offered is run.
The two call traces and the exported variables must match.

- Calls in the decompiler's `PURE` list are not traced and answered from their arguments only, so Lua
  skipping one in `a and b` changes neither the trace nor later answers.
- Imported variables (`fetch_external`/`store_external` of a name the script does not export, found by
  scanning the `.int`) start with a seeded value on the fake map script; in the game the map script
  exports them, and CE stops with "External variable does not exist" otherwise.
- `critter_inven_obj(obj, -2)` (`INVEN_TYPE_INV_COUNT`) answers a number, the other types an object.
- Procedures under test get their arguments in SSL order: `vm.call` pushes its argument list last-first,
  so the harness hands it over reversed (the engine never calls a procedure with arguments).
- A run is capped at 1000 calls with side effects (wait loops such as the traps' projectile loops never end
  against the fake world) and 50 000 calls in all; a run one backend cut at the total cap is compared as
  far as both got.

Result 2026-10-19: 36 scripts, 12 800 runs, **0 differences**. The only stopped runs are the wait loops
(`atsrtrp0`, `sprtrp50`, one `acvillgr` flee loop), stopped at the same call in both backends.

Wider sample, 2026-10-19 (20 seeds): the 21 scripts decompiled that day plus every Klamath (`k*`), Den
(`d*`) and Modoc (`m*`) script — 235 scripts, 113 361 runs (3 cut short at the total cap), **24 differing
procedures, all where the VM differs from CE** (`known_bugs.md` L6); none is a decompiler or prelude bug:
- 12 a comparison concatenated into a string, VM `false` vs CE `0` (sccop, dcjoey, mcrat, mcvegeir);
- 9 division / modulo by zero, which stops the procedure in CE and Lua but not in the VM (kcsulik, dcvic,
  mcdavin, mcgrisha, mcmiria; the fake world answers 0 where the game rarely would);
- 2 `and`/`or` used as a value, VM operand vs CE 0/1 (dccmitty `Node015`, dcsheila `talk_p_proc`);
- 1 unsigned `push_int`, a script variable initialised to `-1` reads 4294967295 in the VM (kcsulik).
After the VM fixes (L6, same day) the same 235 scripts: 113 780 runs, **0 differences**; Arroyo still 0.
Runs that stopped with an error (about 1100 where the VM threw) stopped the same way in both backends: wait loops
at the call cap, and `call(<variable>)` on a procedure variable the fake world leaves at 0.

All scripts, 2026-10-19, after the VM fixes (L2, L6, stack limits): every decompiled script (1436; the two
`copy of mcgrisha` files and `rnduvilg.ssl` in `data/scripts` are left out), 20 seeds — 646 965 runs, 1308
cut short at the total cap, **3 differing procedures**, all in bhrnddst (an object multiplied as the caps
amount, `known_bugs.md` L7). Runs that stopped, the same way in both backends: 17 880 at `call(<variable>)`
on a procedure variable the fake world leaves at 0 (the NCR / Reno talk scripts; the code after such a call
is not exercised), 1455 at the call caps (wait loops), 117 division by zero, 38 stack overflow (nimyrdor's
`use_skill_on_p_proc` calls itself; the VM stops at CE's 0x1000 limit, Lua at its own — 18 of these runs
reach the total call cap in Lua first and are compared as far as both got).

In game, both backends side by side (2026-10-19): on 12 town maps (ncr1, newr1, newr2, vctyctyd, redment,
kladwtwn, denbus1, modmain, broken1, sfchina, gecksetl, navarro) every scripted object ran as Lua with no
Lua error, and for each of the 194 critter scripts on them the player talked to the critter, took the first
option and closed the dialogue, once per backend: whether a dialogue opens, the first reply, the option
count and the reply after the first option match in all 58 dialogues. The one mismatch, the New Reno Jet
dealer's greeting, is `random()` drawn from the game's RNG, which the map's heartbeats also use, so it
depends on timing in either backend.

AutoCrawler, both backends (2026-10-19): `runDialogueCrawler` (every talkable NPC, every option clicked
through to the end) on ncr1, broken1, redment and sfchina — 185 NPCs; status (complete / no dialogue /
stuck / combat), options seen and replies per NPC are identical, no exceptions, no Lua errors. The 4
"stuck" NPCs (e.g. the NCR craps dealer) are stuck in both. `runCombatCrawler` on klatoxcv: 5 of 5 fights
complete in both. Not covered yet: barter screens and quest chains across maps.

In game (`play.html?arvillag#script_backend=lua`): all 143 scripted objects and the map script run in Lua;
the Elder's dialogue (talking head, quest node with the flask and money, the `gsay_message` farewell) runs
through and returns to the map; 21 critter heartbeats at 0 ms update time.

## Open

- 4 scripts stay `.int` (see above, `known_bugs.md` L1).
- Integer `+ - *` are 64-bit in Lua and doubles in the VM; CE wraps at 32 bits. Matching CE in Lua would
  need a helper call for every operator (unreadable output) and the VM would have to change with it; no
  vanilla script is known to overflow, so both stay as they are.
- Message numbers are still numbers (L3); so are the LVARs of the scripts without a matching `.ssl`.
- Floats: the VM rounds every float result to 32 bits (`Math.fround`); Lua keeps doubles (L4).
