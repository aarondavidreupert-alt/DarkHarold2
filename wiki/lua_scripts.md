# Lua Scripts — decompiled `.int` running as Lua

> DH2 addition (no CE counterpart). Started 2026-10-19 on branch `decompile-ini-to-lua`.
> Goal: every game script readable and moddable, behaving exactly like the original bytecode.
> Status: **pilot**. 1439 of 1443 scripts decompile; the four left are explained under "Scripts that stay
> `.int`". The VM-vs-Lua test passes for Arroyo; Klamath, Den, Modoc and the scripts added on 2026-10-19
> matched the VM except where the VM differed from CE; those VM bugs are fixed (`known_bugs.md` L6). The bytecode VM stays the default (`[dh2] script_backend=vm`).

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
  This is CE (`gameDialogEnter` runs the whole dialogue inside `gsay_end`). The VM instead resumes only the
  most recent halt address, so after a `gsay_message` inside an option the code after `talk_p_proc`'s
  `gsay_end` does not run there — see `known_bugs.md` L2.
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

In game (`play.html?arvillag#script_backend=lua`): all 143 scripted objects and the map script run in Lua;
the Elder's dialogue (talking head, quest node with the flask and money, the `gsay_message` farewell) runs
through and returns to the map; 21 critter heartbeats at 0 ms update time.

## Open

- 4 scripts stay `.int` (see above, `known_bugs.md` L1).
- Integer arithmetic is 64-bit in Lua; CE wraps at 32 bits. Vanilla scripts were not seen to overflow.
- Constants are numbers (`global_var(7)`): naming from `vault13.gam` (GVARs) and the Black Isle script
  headers is the next readability step (L3).
- Floats: the VM rounds every float result to 32 bits (`Math.fround`); Lua keeps doubles (L4).
- Mods: a load order for mod `.lua` files over the generated ones (L5).
