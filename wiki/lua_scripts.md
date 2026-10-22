# Lua Scripts — decompiled `.int` running as Lua

> DH2 addition (no CE counterpart). Started 2026-10-19 on branch `decompile-ini-to-lua`.
> Goal: every game script readable and moddable, behaving exactly like the original bytecode.
> Status: **default backend since 2026-10-21**. 1439 of 1443 scripts decompile; the four left are explained under "Scripts that stay
> `.int`". The VM-vs-Lua test over every decompiled script (1436, 646 965 runs) differs only in one
> Black Isle script bug neither backend can match CE on (`known_bugs.md` L7), and the story crawler plays 29 maps
> identically on both. Lua is the default; `[dh2] script_backend=vm` runs the bytecode VM.

## Pieces

| Part | File | What it does |
|------|------|--------------|
| Decompiler | `tools/int2lua.py` | `.int` bytecode → Lua 5.4. Pipeline stage `decompile_scripts` writes `data/scripts/<name>.lua` next to each `.int` |
| Lua engine | `lib/wasmoon/` | wasmoon 1.16.0 (Lua 5.4 in WebAssembly, MIT, vendored like `lib/pathfinding-browser.js`; loaded by `play.html` as the `wasmoon` global) |
| Prelude | `src/lua/prelude.ts` | Lua side: SSL semantics, the per-script sandbox, coroutine driver for dialogue |
| Runtime | `src/lua/luaRuntime.ts` | TS side: starts the engine, turns a `Script` object into a Lua-backed one (`attachLuaScript`) |
| Hook | `src/scripting.ts` `loadScript` / `loadLuaScript` | With `Config.scripting.backend === 'lua'`, loads `<name>.lua`; no file or a load error → the `.int` runs |
| Test | `luadiff.html`, `src/lua/luaDiff.ts` | VM-vs-Lua differential test (below) |

Select the backend with `fallout2.cfg` `[dh2] script_backend=lua` (the default; the pipeline's `write_config`
stage writes the key) or `=vm`, or for one page load with `play.html#script_backend=vm` (the query string is the
`?mapname` shortcut). Lua falls back to the VM as a whole when the install has no decompiled scripts
(`data/scripts/obj_dude.lua` missing: the `decompile_scripts` stage did not run) or the Lua runtime does not
start, and per script when a `.lua` is missing or does not load.

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
  - with SSL sources (local only, never committed): local variables (`local_var(LVAR_Herebefore)`) and the
    map variables a script uses, from its `<name>.ssl` and the headers it `#include`s; and PIDs
    (`party_member_obj(PID_SULIK)`, `obj_pid(x) == PID_STIMPAK`) from `itempid.h`, `critrpid.h`, `scenepid.h`.
    Two source trees are read, best first (`ssl_sources`):
    1. `ssl/` in the project (git-ignored): Black Isle's own sources, from the Fallout wiki's
       [Fallout 2 script library](https://fallout.fandom.com/wiki/Category:Fallout_2_script_files) —
       scripts in `ssl/scripts/`, headers in `ssl/headers/` (their `#include "..\headers\…"` expects that
       layout). Their local-variable counts fit the vanilla `scripts.lst` far better (28 scripts over the
       count vs 71) and where the two trees disagree the Unofficial Patch has renumbered (dcvic inserts
       `LVAR_Hostile` at 5);
    2. `data/scripts_src/`: the Unofficial Patch's `scripts_src` (by killap), for the scripts the first
       tree does not match.
    A script takes its LVAR/MVAR names from the first tree whose `.ssl` declares every procedure of the
    vanilla `.int` (1164 of 1245 from `ssl/`, the rest of 1238 from the patch); PID and `define.h` names
    come from both, the first tree's spelling winning. Procedures count as declared when the `.ssl` tree
    has them as `procedure x`, under a `#define x y` alias (`def_description_p_proc`), as the target of a
    `call`, or from a `procedure Name##…` macro template (zcCrpDel.ssl `NOdds##name##x`); `#include` finds
    a file of that name anywhere in the tree when its folder is missing (`..\generic\ziLocker.ssl`) and
    follows `#include NAME` through a string `#define` (ziLocker's `EXTRA_HEADER`). A number two headers
    name differently takes the name the script's own `.ssl` defines (ricshbox: `LVAR_Restock_Time`, not
    modreact.h's `LVAR_reaction`), else the one its `.ssl` mentions (wtpltrp2: depolva.h names MVAR 77
    twice, the trap uses `MVAR_Plasma_Trap_L2_00`), else stays a number. `/* … */` comments are skipped,
    also one a line leaves open. A few other defines name a variable number when nothing else does
    (`VAR_DEFINES`): `NPC_REACTION_VAR` (define.h's theft counter, fcmarc: 8), `MAP_NOTIFY` /
    `GLOBAL_NOTIFY` (the emitter scripts); their default -1 means none and sits in dead code
    (`if -1 > -1`). Without the files, or for a computed number, the number stays.
  - **Inferred names** (marked `-- inferred: <why>` where they are declared): an `.ssl` whose tree lacks at
    most 3 of the `.int`'s procedures is taken as another version of the same script and names its
    variables (door: the `.int` also has `checkPartyMembers`); a global variable used as the base of an
    index expression (`GVAR_SALVATORE_WARNINGS + 2 - 1`, sslc folds the index to `251 + 2 - 1`); an
    operand the compiler left out, restored from the source (`MISSING_OPERANDS`: mitoilet); and a map
    variable whose code only runs on one map, named from that map's `.gam` (`CURATED_NAMES`: mcatkdog,
    `cur_map_index == 20` → modbrah's `MVAR_Did_Fake_Dog_Kill`).
  - **Guessed names** (marked `-- guessed: <why>`): no source names them; chosen by hand from what the
    code does (`CURATED_NAMES`): the cut Colusa/Navarro guards (`ccguard`, `cctech`, `ccmaster`: the
    template's `LVAR_Hostile` (5) / `LVAR_Personal_Enemy` (6) and modreact.h's reaction variables, by
    number and use; `MVAR_Alert_Status`, `MVAR_Claimed_New_Guy` …) and `test1` — scripts no map uses.
  - **The variable list**: the `decompile_scripts` stage (or `int2lua.py --report FILE`) writes
    `data/scripts/variable_names.tsv` — every GVAR / MVAR / LVAR each script uses, its name, where the name
    comes from (`data/vault13.gam`, `maps/<map>.gam`, the `.ssl` file and tree) and whether it is
    inferred, or why it stays a number. Like the `.lua` files it is derived from the install and not
    committed; [lua_variable_names.md](lua_variable_names.md) (`tools/variable_review.py`) keeps its
    inferred and guessed names for review. 2026-10-22, the variables of the scripts in scripts.lst: 18 589
    named from a source, 68 inferred, 22 guessed, none left as a number.
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
- **Message texts**: a line that uses a message with constant numbers (`message_str`, `gsay_reply`,
  `gsay_message`, `gsay_option`, `giq_option`) ends with the text as a comment —
  `gsay_reply(11, 103)  -- "Congratulations, Chosen One, …"`. Message list n is the script on line n of
  `data/scripts/scripts.lst` (as `src/data.ts lookupScriptName`), the text from
  `data/text/english/dialog/<script>.msg`, cut at 70 characters. 50 483 lines get one; a message whose
  `.msg` or number the game data lacks (e.g. `newrgo`, the bookshelf scripts' copied Lorri lines) gets none.

### Scripts that stay `.int`

- **barstow, dumar, surf** use the interpreter library's own dialogue (`0x804C`–`0x8061`, CE
  `interpreter_lib.cc opSayStart`, `opSayReply`, `opSayOption`, `opSayMessage`, `opSayEnd`), which Fallout 2
  replaced with gdialog. Neither backend implements it, and no scripts.lst entry or map names these
  Fallout 1 leftovers.
- **mitoilet** (decompiled since 2026-10-21): `description_p_proc` compiles `set_local_var(1)` without the
  variable number, so the bytecode pops a word from below its own frame — in CE the `windowId` that
  `_setupCallWithReturnVal` pushed. A game script's `windowId` is 0 (`programCreateByPath` zeroes the
  `Program`), so CE writes local variable 0 — the source's `LVAR_Examined` — shows the message, then hits
  "Stack underflow" at the exit stub. The Lua writes `set_local_var(LVAR_Examined, 1)` from the source
  (`MISSING_OPERANDS`, marked inferred); the VM pushes CE's three call words (flags, `checkWaitFunc`,
  `windowId`) since 2026-10-22 (L18) and does the same. Only examining the open Modoc toilet runs it.

`python tools/int2lua.py --check-bridge src/vm_bridge.ts` checks the intrinsic table (name, argc, pushes a
result) against the VM bridge.

## Script fixes (deliberate deviations from the shipped scripts)

The decompiler leaves the scripts' behaviour alone — with one kind of exception: a Black Isle bug whose
intent the sources make clear may be repaired in the generated Lua. Each repair is a **deliberate deviation
from the shipped `.int` and from CE**, so every one is:

- listed in `SCRIPT_FIXES` in `tools/int2lua.py` (script, procedure, the intrinsic, the variable the
  bytecode passes by mistake, the expression the source meant, and why), and in the table below;
- marked where it happens in the generated Lua, as an inline comment
  (`--[[ DH2 fix (L7): … ]]`);
- switchable at run time: the Lua asks `dh2_script_fixes()` (a `Script` method, not an opcode) and
  takes the original path when `fallout2.cfg [dh2] script_fixes=0`, drawing no extra random number;
- tracked in `known_bugs.md`.

The VM runs the original bytecode either way. `luadiff.html` shows a fix as a difference at that call —
and only there.

| ID | Script / procedure | The shipped script | The fix | Source of the intent |
|----|--------------------|--------------------|---------|----------------------|
| L7 | `bhrnddst` `DMRV_Caravan`, the guard loop (also reached from `Redding_DMRV_Encounter`, `Redding_Band_Encounter`) | `give_money(Critter, item)`: `item` (`LVar3`) holds the hunting rifle `Create_Enemy` just made, so every caravan guard is given the rifle object as caps — `item_caps_adjust(Critter, LVar3)`, `2 * LVar3` with Fortune Finder. CE adds a garbage amount (pointer bits), the VM NaN, the Lua stopped the procedure (with the perk: the slaves were never created) | `random(10, 20)` caps, doubled with Fortune Finder as the rest of the script does | the Unofficial Patch's `scripts_src/maps/bhrnddst.ssl` (killap) gives `random(10, 20)`, the guards' amount in `DMRV_Highwaymen` |

Not a script fix, and not switchable: `item_caps_adjust` with an amount that is not a number changes nothing
(with a warning) instead of making the caps stack NaN — a guard in `src/scripting.ts` for both backends.
CE adds a garbage amount there, which cannot be reproduced. (mitoilet's restored operand, `MISSING_OPERANDS`,
is not a deviation: it is what CE does, L18.)

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

Story crawler (`autoCrawler.runStoryCrawler`, 2026-10-20): the main-quest maps in story order, every
talkable NPC's dialogue tree path by path, each step's changes recorded (GVARs, the map's MVARs, every
script's LVARs, the player's stats, XP, caps and inventory). Deterministic — the frame loop paused, the
clock pinned, the RNG reseeded per step with `randomSeedExact` (CE's own seeding keeps one table slot from
before, so the same seed could give different rolls) — so a `script_backend=vm` and a `=lua` run must give
the same trace; each run stores its trace in IndexedDB and compares with the other backend's and with its
own previous run (`repeatDiff`: nondeterminism in the crawl, not a backend difference). Objects are named
`pid@tile` where the map file puts them (named before `map_enter_p_proc` moves any), so one extra object
does not shift every later name. Each map starts from the crawl's starting state (GVARs, MVARs, the player's
XP, HP and inventory with its caps reset), so a difference on one map does not carry into the next. A script's `play_gmovie`
ends at once during the crawl (`setGameMovieSkipAll`), and `?crawl=` skips the opening movies and the main
menu: a real movie's fade timer and `uiMode` switches would land in later steps. Each map gets a verdict:
`backend-difference` only when VM and Lua part before either backend's own run-to-run instability
(`repeatDiff`), else `inconclusive` — run each backend twice (VM, VM, Lua, Lua). `rng:n` per line counts
the random numbers the step's script code drew; with
`?draws=<label>` (or `traceDrawsFor`) the lines of matching steps list a call stack per draw, and Lua
errors and exceptions in click handlers are appended in `[…]`; a fatal script error (CE `programFatalError`:
stack overflow, division by zero) is `[FATAL …]` on both backends. Each line also has the message-window
text the step produced (`log=[…]`: `display_msg`, skill results, XP). A barter screen a script opens is
recorded with its price modifier and the merchant's inventory (`BARTER mod=… inv=[pid x n,…]`), then the
crawl buys one of the merchant's cheapest items, paying exactly the caps the screen asks
(`buy=<pid>@<price>:ok`, `:refused("<the merchant's answer>")`, `:short` when the player has too few caps,
`buy=nothing`) through the screen's own trade logic (`activeBarter`: CE `_barter_compute_value` /
`_barter_attempt_transaction`), and closes it; what is bought shows in the step's state change and the
later dialogues run with it. A world map or elevator screen is noted and closed. After the dialogues an **object pass** (`objects: false` turns it
off) runs every scripted object's other entry points with the player next to it: examine
(`description_p_proc`), look (`look_at_p_proc`), use (`use_p_proc`, not on critters), pick up
(`pickup_p_proc`, items) and First Aid, Doctor, Lockpick, Traps, Science and Repair (`use_skill_on_p_proc`)
— only the script, as CE runs it before its engine fallback. Last a **time pass** (`time: false` turns it
off) lets game time go on in 11 steps from the crawl's fixed clock (6 × a game minute, 4 × an hour, a day):
each step advances the clock the way a time jump does (the timed events that came due fire in due order,
midnight; CE `queueProcessEvents`) and runs `map_update_p_proc` on the map's scripts, then every living
scripted critter's `critter_p_proc` once, in map order (CE runs one per main-loop pass, round-robin,
`_script_chk_critters`). Where a step sends a critter walking (`animate_move_obj_to_tile`, which the paused
frame loop never plays) the line has `W<object>:walk@<tile>`. A fight a heartbeat starts is ended (`COMBAT`),
a dialogue ended. Each map starts with no timed events, and objects a script destroys leave the map at the
end of each step, as at the end of a frame. The runs found L8–L17.

Result 2026-10-20 (29 story maps, 14 461 steps per run, VM twice and Lua twice): **all 29 maps identical
on both backends, each backend identical to its own previous run** (`unstable: 0`, 0 backend differences, 0
inconclusive). The run-to-run noise of the first runs (kladwtwn, the Den, Modoc, New Reno, reddown) did
not come from setTimeout-driven animations (nothing moves while the frame loop is paused) but from the RNG
being reseeded from the clock on every first visit to a map (L12); the opening movies and script movies
switched `uiMode` in real time (now skipped in the crawl), and stalled music streams blocked image loads
(L13). The fixed runs found L14 (proto scripts one entry off in scripts.lst) and L15 (VM stack frame of a
procedure halted in a nested call).

With the object pass (2026-10-20; 29 maps, 27 196 steps per run, 12 803 of them object steps, 55 barter
screens, 3 570 lines with message-window text; VM, Lua, VM): **all 29 maps identical on both backends, the
VM identical to its own previous run** (0 backend differences, `unstable: 0`). It found L16 (`.msg` lines
starting with a space were lost: miwell's examine text; a missing message threw instead of giving "Error")
and L17 (the Lua backend froze on a procedure that calls itself: First Aid on Eldridge's doors in New Reno;
24 steps now end in `[FATAL Stack overflow]` on both backends).

With a purchase in every barter screen and the inventory reset per map (2026-10-20; 29 maps, 27 264 steps;
54 barter screens: 39 purchases, 3 refused for weight with the heavy debug start kit, 6 short of caps, 6 with
nothing for sale; VM, Lua, VM): **all 29 maps identical on both backends**. A trade runs no script (CE
calls none in `inventoryOpenTrade`); what it checks is that the script-set price modifier, the merchant's
reaction (LVAR 0) and the stock a script gave the merchant agree, and the bought items in later dialogues.

With the time pass (2026-10-21; 29 maps, 37 681 steps, 10 425 of them time steps; VM, Lua, VM): **all 29 maps
identical on both backends, the VM identical to its own previous run** (0 backend differences, `unstable: 0`).
The only fights a heartbeat starts are the Klamath trap caves' gecko (`ZCGecko`, every step, ended the same
way on both). On this result Lua became the default backend (`[dh2] script_backend=lua`).

After the 2026-10-21 engine fixes (worldmap entry elevation C66, object draw order C67) and the
decompiler's new names (inferred names, mitoilet decompiled; L1, L3) — 29 maps, 37 681 steps, VM, VM, Lua,
Lua: **all 29 maps `same`, each backend identical to its own previous run** (`unstable: 0`, 0 backend
differences, 0 inconclusive). With the VM's CE call words (L18) and every listed script's variables named
(2026-10-22; VM, Lua): all 29 maps `same`, the VM identical to its run before the change.

AutoCrawler, both backends (2026-10-19): `runDialogueCrawler` (every talkable NPC, every option clicked
through to the end) on ncr1, broken1, redment and sfchina — 185 NPCs; status (complete / no dialogue /
stuck / combat), options seen and replies per NPC are identical, no exceptions, no Lua errors. The 4
"stuck" NPCs (e.g. the NCR craps dealer) are stuck in both. `runCombatCrawler` on klatoxcv: 5 of 5 fights
complete in both. Not covered yet: selling in a barter screen, and quest chains across maps.

In game (`play.html?arvillag#script_backend=lua`): all 143 scripted objects and the map script run in Lua;
the Elder's dialogue (talking head, quest node with the flask and money, the `gsay_message` farewell) runs
through and returns to the map; 21 critter heartbeats at 0 ms update time.

## Open

- 3 scripts stay `.int`, the Fallout 1 leftovers (see above, `known_bugs.md` L1).
- Integer `+ - *` are 64-bit in Lua and doubles in the VM; CE wraps at 32 bits. Matching CE in Lua would
  need a helper call for every operator (unreadable output) and the VM would have to change with it; no
  vanilla script is known to overflow, so both stay as they are.
- Message numbers stay numbers, with the text as a comment. Every variable of the listed scripts has a
  name; 22 of them are guessed (cut content and the test script, `lua_variable_names.md`, L3).
- Floats: the VM rounds every float result to 32 bits (`Math.fround`); Lua keeps doubles (L4).
