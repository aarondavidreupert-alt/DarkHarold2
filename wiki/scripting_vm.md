# DarkHarold2 — Scripting VM Architecture

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/interpreter.cc` (`_interpret`, `_executeProc`,
`_executeProcedure`, `programCreateByPath`, `_doEvents`, `_updatePrograms`),
`raw/fallout2-ce/src/interpreter.h` (opcode enum, `ProgramValue`, `Program`,
`Procedure`), `raw/fallout2-ce/src/scripts.cc` (`scriptExecProc`,
`scriptLocateProcs`, `gScriptProcNames`, `scriptsExecMapEnterProc`, et al.),
`raw/fallout2-ce/src/scripts.h` (`ScriptProc`, `ScriptType`, `Script`)  
**DH2 ref:** `src/vm.ts` (`ScriptVM`, `opMap`), `src/vm_bridge.ts`
(`ScriptVMBridge`, `GameScriptVM`, `bridgeOpMap`), `src/scripting.ts`
(`loadScript`, procedure dispatchers), `src/intfile.ts` (`parseIntFile`,
`IntFile`)

---

## 1. CE .int File Format

### 1.1 Physical Layout

Compiled scripts are stored as `.int` files. `programCreateByPath()`
(`interpreter.cc:464`) reads the entire file into `program->data` and computes
section pointers relative to that buffer:

| Offset | Content |
|---|---|
| 0x00–0x29 | Unknown / unused header (42 bytes) |
| 0x2A | Procedure table: `int32 count` then `count × 24-byte Procedure` records |
| After procs | Identifier section: `int32 length`, then length-prefixed C strings |
| After identifiers | `0xFFFFFFFF` sentinel |
| After sentinel | String section: `int32 length`, then strings (or `0xFFFFFFFF` = empty) |
| After strings | Code section: bytecodes from this offset onwards |

Section pointers stored in `Program`:

```c
program->procedures = data + 42;                         // 0x2A
program->identifiers = 24 * procCount + procedures + 4;  // after procs
program->staticStrings = identifiers + identEndSize + 4; // after identifiers
// dynamicStrings: heap-allocated at runtime
```

(`interpreter.cc:493–495`)

### 1.2 Procedure Table Entry (`Procedure` struct)

Each entry is 24 bytes (`interpreter.h:175`):

```c
typedef struct Procedure {
    int nameOffset;       // byte offset into identifiers section
    int flags;            // PROCEDURE_FLAG_* bitmask
    int time;             // for TIMED procs: expiry timestamp
    int conditionOffset;  // for CONDITIONAL procs: code offset of condition expr
    int bodyOffset;       // byte offset into code section (instruction pointer start)
    int argCount;         // number of declared parameters
} Procedure;
```

**Procedure flags** (`interpreter.h:147`):

| Flag | Value | Meaning |
|---|---|---|
| `PROCEDURE_FLAG_TIMED` | 0x01 | Runs when `time` field expires |
| `PROCEDURE_FLAG_CONDITIONAL` | 0x02 | Runs when condition expr returns non-zero |
| `PROCEDURE_FLAG_IMPORTED` | 0x04 | Defined in another program (external ref) |
| `PROCEDURE_FLAG_EXPORTED` | 0x08 | Exported for use by other programs |
| `PROCEDURE_FLAG_CRITICAL` | 0x10 | Runs in critical section (no burst limit) |

---

## 2. CE Value System

### 2.1 `ProgramValue`

Every stack slot is a tagged value (`interpreter.h:180`):

```c
struct ProgramValue {
    opcode_t opcode;   // value type tag
    union {
        int   integerValue;
        float floatValue;
        void* pointerValue;
    };
};
```

Value type tags:

| Constant | Hex | Description |
|---|---|---|
| `VALUE_TYPE_INT` | `0xC001` | 32-bit signed integer |
| `VALUE_TYPE_FLOAT` | `0xA001` | 32-bit IEEE float |
| `VALUE_TYPE_STRING` | `0x9001` | Offset into `staticStrings` |
| `VALUE_TYPE_DYNAMIC_STRING` | `0x9801` | Offset into `dynamicStrings` heap |
| `VALUE_TYPE_PTR` | `0xE001` | Raw pointer |

The type tag is the same 16-bit value that is also pushed as an opcode before a
literal push. When the interpreter fetches an opcode via `_getOp()` and stores
it in `program->flags >> 16`, that tag is available to the subsequent `opPush`
handler to know what type to assign the following literal.

Dynamic strings are reference-counted via a 2-byte header `(short refcount, short len)`
in the `dynamicStrings` heap. `_interpretIncStringRef` / `_interpretDecStringRef`
maintain the count; `programMarkHeap` collects unreferenced blocks.
(`interpreter.cc:374–397, 549–587`)

### 2.2 Two-Stack Layout

`Program` has exactly two stacks (`interpreter.h:207`):

```c
ProgramStack* stackValues;       // data stack (std::vector<ProgramValue>)
ProgramStack* returnStackValues; // return stack (std::vector<ProgramValue>)
```

Both are `std::vector<ProgramValue>` but serve different roles:

- **Data stack** (`stackValues`): computation, local variables, call frame,
  arguments, results. Frame pointer (`framePointer`) and base pointer
  (`basePointer`) index into this.
- **Return stack** (`returnStackValues`): holds saved instruction pointers and
  frame pointers for call/return. Also used by `_setupExternalCall` to save
  cross-program call context.

Stack overflow is caught at ≥ 0x1000 bytes (4096 bytes; `interpreter.cc:318`).
Underflow and overflow call `programFatalError`.

---

## 3. CE Interpreter Loop

### 3.1 `_interpret(program, burstSize)` (`interpreter.cc:2614`)

The central execution function. One call runs at most `burstSize` opcodes before
returning, unless the program is in a critical section.

```
_interpret(program, burstSize):
  setjmp(program->env)          ← error recovery point
  while (critical || --burstSize != -1):
    check EXITED/STOPPED/WAITING flags → break
    opcode = _getOp()            ← read 2-byte opcode, advance IP by 2
    store opcode in program->flags >> 16 (used by opPush for type tagging)
    validate: (opcode >> 8) & 0x80 must be set
    index = opcode & 0x3FF
    handler = gInterpreterOpcodeHandlers[index]
    if handler == nullptr: programFatalError("Undefined opcode")
    handler(program)
  programMarkHeap(program)       ← GC dynamic strings
```

(`interpreter.cc:2648–2708`)

**Burst limit**: `_cpuBurstSize = 10` per call from `_updatePrograms`.
`_executeProcedure` passes `-1` (unlimited) for direct procedure execution.
`runScript` passes `24` for the initial program run.

**Critical section**: `PROGRAM_FLAG_CRITICAL_SECTION` overrides burst limit to
at least `3` and disables the burst countdown entirely while set.
(`interpreter.cc:2644–2648`)

### 3.2 Error Handling

`programFatalError(fmt, ...)` (`interpreter.cc:250`):

1. Prints the error and the current procedure name.
2. Calls `longjmp(gInterpreterCurrentProgram->env, 1)`.
3. `setjmp` in `_interpret` catches this and sets `PROGRAM_FLAG_EXITED | 0x04`.
4. Execution of that program stops permanently.

Causes: stack overflow/underflow (`pushShortStack: Stack overflow`), unknown
opcode, bad opcode (high byte missing `0x80`), internal consistency errors.

### 3.3 Waiting

`opWait` (`interpreter.cc:771`) sets `PROGRAM_IS_WAITING` flag and stores a
deadline in `program->waitEnd`. Each subsequent `_interpret` call skips
execution and calls `checkWaitFunc(program)` until it returns false (deadline
passed), then clears the flag and resumes. (`interpreter.cc:2657–2669`)

---

## 4. CE Opcode Set

Opcodes are 16-bit values. All CE base opcodes have `(opcode >> 8) & 0x80` set
(i.e., high bit of the upper byte is set). The dispatch index is `opcode & 0x3FF`,
allowing up to 1024 slots; SFALL extends `OPCODE_MAX_COUNT` to 768.

Base opcode range: `0x8000–0x804B` (76 opcodes). Key opcodes:

| Opcode | Name | Operation |
|---|---|---|
| `0x8000` | noop | No-op |
| `0x8001` | push | Push literal (type from flags, value follows opcode in bytecode) |
| `0x8002` | push_base | Pop argc; push framePointer to retStack; framePointer = stackSize − argc |
| `0x8003` | pop_base | Pop framePointer from retStack |
| `0x8004` | pop_to_base | Pop data stack back down to framePointer |
| `0x8005` | set_global | basePointer = stackSize (marks global frame boundary) |
| `0x8006` | dump | Pop N items from data stack |
| `0x8007` | call_condition | Set CONDITIONAL flag on procedure |
| `0x8008` | call_start | Not fully implemented |
| `0x8009` | wait | Set PROGRAM_IS_WAITING with delay |
| `0x800A` | cancel | Clear TIMED/CONDITIONAL flags on a procedure |
| `0x800B` | cancel_all | Clear all procedure flags |
| `0x800C` | if | Branch if top of stack is zero |
| `0x800D` | while | Loop branch if top of stack is zero |
| `0x800E` | store | Pop addr, pop value; write to dataStack[framePointer + addr] |
| `0x800F` | fetch | Pop addr; push dataStack[framePointer + addr] |
| `0x8010` | != | Compare top two items |
| `0x8011` | == | Compare top two items |
| `0x8012` | <= | Compare top two items |
| `0x8013` | >= | Compare top two items |
| `0x8014` | < | Compare top two items |
| `0x8015` | > | Compare top two items |
| `0x8016` | + | Add |
| `0x8017` | - | Subtract |
| `0x8018` | * | Multiply |
| `0x8019` | / | Divide |
| `0x801A` | % | Modulo |
| `0x801B` | && | Logical and |
| `0x801C` | \|\| | Logical or |
| `0x801D` | ! | Logical not |
| `0x801E` | - (unary) | Negate |
| `0x801F` | ~ | Bitwise not |
| `0x8020` | floor | Float→int floor |
| `0x8021` | & | Bitwise and |
| `0x8022` | \| | Bitwise or |
| `0x8023` | ^ | Bitwise xor |
| `0x8024` | swap_ret | Swap return stack top |
| `0x8025` | critical_done | Leave critical section |
| `0x8026` | critical_start | Enter critical section |
| `0x8027` | jmp | Set IP to immediate 4-byte address |
| `0x8029` | call | Pop proc index; jump to proc's bodyOffset |
| `0x802A` | pop_flags | Pop windowId, checkWaitFunc, flags from data stack |
| `0x802B` | pop_return | Pop IP from return stack |
| `0x802C` | pop_exit | Pop IP from return stack; set 0x40 flag (exit) |
| `0x802D` | pop_flags_return | pop_flags + pop_return |
| `0x802E` | pop_flags_exit | pop_flags + pop_exit |
| `0x802F` | pop_flags_return_val_exit | Save return value, pop_flags, pop_return, exit |
| `0x8030` | pop_flags_return_val_exit_extern | External call return with value |
| `0x8031` | pop_flags_return_extern | External call return |
| `0x8032` | pop_flags_exit_extern | External call exit |
| `0x8033` | pop_flags_return_val_extern | External return with value (no exit) |
| `0x8034` | pop_addr | Pop from return stack (discard) |
| `0x8035` | atod | ASCII to decimal |
| `0x8036` | dtoa | decimal to ASCII (int→string) |
| `0x8037` | exit_prog | Set PROGRAM_FLAG_EXITED |
| `0x8038` | stop_prog | Set PROGRAM_FLAG_STOPPED |
| `0x8039` | fetch_global | Pop addr; push dataStack[basePointer + addr] |
| `0x803A` | store_global | Pop addr, pop value; write to dataStack[basePointer + addr] |
| `0x803B` | swap | Swap top two data stack items |
| `0x803C` | fetch_proc_address | Pop proc index; push proc's bodyOffset |
| `0x803D` | pop | Pop and discard data stack item |
| `0x803E` | dup | Duplicate data stack top |
| `0x803F` | store_external | Store to exported variable in external program |
| `0x8040` | fetch_external | Fetch exported variable from external program |
| `0x8041` | export_proc | Mark procedure as exported |
| `0x8042` | export_var | Mark variable as exported |
| `0x8043` | exit | Exit (program stop) |
| `0x8044` | detach | Detach child program |
| `0x8045` | callstart | Start a procedure call |
| `0x8046` | spawn | Spawn child program |
| `0x8047` | fork | Fork program |
| `0x8048` | exec | Execute external program |
| `0x8049` | check_arg_count | Validate argument count |
| `0x804A` | lookup_string_proc | Look up procedure by string name |
| `0x804B` | (intrinsics start) | `interpreter_extra.cc` / `interpreter_lib.cc` opcodes |

Opcodes `0x804C`+ are registered by `intLibRegisterProcedures()` (intrinsic built-ins:
`display_msg`, `script_overrides`, `obj_being_used_with`, etc.) and extended
further by `interpreterRegisterOpcode()` calls in the rest of the engine.

(`interpreter.h:60–130`, `interpreter.cc:2520–2608`)

---

## 5. CE Call Convention

CE does not have a single "call" opcode that saves a return address. The return
address is set up explicitly by `_setupCallWithReturnVal` before `_interpret` is
called, or compiled inline by the SSL compiler into the bytecode preceding each
procedure call site.

### 5.1 `_setupCallWithReturnVal(program, address, returnAddress)` (`interpreter.cc:2713`)

```
retStack.push(instructionPointer)   ← saved IP
retStack.push(returnAddress)        ← where to return (proc index e.g. 28)
dataStack.push(flags & 0xFFFF)      ← saved program flags
dataStack.push(checkWaitFunc ptr)   ← saved wait callback (as PTR)
dataStack.push(windowId)            ← saved window
instructionPointer = address        ← jump to callee body
```

`_setupCall` additionally pushes a 0 integer (the return value placeholder).

### 5.2 Callee Prologue (`opPushBase`, `opSetGlobal`)

At the top of each compiled procedure:

```
opPushBase:
  argc = dataStack.pop()
  retStack.push(framePointer)   ← save caller's frame pointer
  framePointer = stackSize − argc

opSetGlobal:
  basePointer = stackSize       ← marks global variable frame
```

Local variables are accessed as `dataStack[framePointer + N]` (via `store`/`fetch`).
Global variables are `dataStack[basePointer + N]` (via `store_global`/`fetch_global`).

### 5.3 Return (`opPopFlagsReturn` and variants)

```
opPopFlags:
  windowId = dataStack.pop()
  checkWaitFunc = dataStack.pop() (PTR)
  flags = dataStack.pop()

opPopReturn:
  instructionPointer = retStack.pop()

opPopFlagsReturn = opPopFlags + opPopReturn
opPopFlagsExit   = opPopFlags + pop IP + set 0x40 flag
```

Return value variants save the top of the data stack across the flag-pop, then
re-push it after restoration.

---

## 6. CE Program Lifecycle

### 6.1 Initialization

`programCreateByPath(path)` (`interpreter.cc:464`):
1. Reads `.int` file into a malloc'd `data` buffer.
2. Allocates `Program` struct, zeroed.
3. Sets section pointers: `procedures`, `identifiers`, `staticStrings`.
4. Allocates two empty `ProgramStack*` (initially empty `std::vector<ProgramValue>`).
5. Sets `basePointer = framePointer = -1`.

### 6.2 Running

`runProgram(program)` (`interpreter.cc:2998`): sets `PROGRAM_FLAG_0x02` and adds
the program to `gInterpreterProgramListHead` linked list.

`runScript(name)` (`interpreter.cc:3007`): calls `programCreateByPath`, then
`runProgram`, then `_interpret(program, 24)` — a 24-opcode burst to execute the
initial code (before any procedure calls).

### 6.3 Per-Frame Update

`_updatePrograms()` (`interpreter.cc:3022`) is called every game frame:
1. `sfall_gl_scr_update(_cpuBurstSize)` — runs global sfall scripts.
2. Iterates `gInterpreterProgramListHead`, calls `_interpret(program, 10)` for
   each live program.
3. Removes exited programs from the list.
4. Calls `_doEvents()` — fires TIMED and CONDITIONAL procedures whose trigger
   condition is now true.

### 6.4 Timed and Conditional Events

`_doEvents()` (`interpreter.cc:2896`) scans all programs' procedure tables.
For each procedure:
- **CONDITIONAL**: temporarily runs the `conditionOffset` code (as an `_interpret`
  sub-call), pops the result; if non-zero, clears the flag and calls `_executeProc`.
- **TIMED**: if the current time exceeds `procedure->time`, clears the flag and
  calls `_executeProc`.

(`interpreter.cc:2916–2956`)

---

## 7. CE Script Procedure Types

### 7.1 `gScriptProcNames` (`scripts.cc:149`)

```c
const char* gScriptProcNames[SCRIPT_PROC_COUNT] = {
    "no_p_proc",               //  0 — never called
    "start",                   //  1 — program initialization
    "spatial_p_proc",          //  2 — critter enters tile
    "description_p_proc",      //  3 — player examines object
    "pickup_p_proc",           //  4 — player picks up item
    "drop_p_proc",             //  5 — player drops item
    "use_p_proc",              //  6 — player uses item/object
    "use_obj_on_p_proc",       //  7 — player uses one object on another
    "use_skill_on_p_proc",     //  8 — player uses skill on object
    "none_x_bad",              //  9 — unused (use_ad_on_proc)
    "none_x_bad",              // 10 — unused (use_disad_on_proc)
    "talk_p_proc",             // 11 — critter dialogue starts
    "critter_p_proc",          // 12 — critter heartbeat (combat or map update)
    "combat_p_proc",           // 13 — combat turn (for critter)
    "damage_p_proc",           // 14 — critter takes damage
    "map_enter_p_proc",        // 15 — map loaded / player enters
    "map_exit_p_proc",         // 16 — player leaves map
    "create_p_proc",           // 17 — object created
    "destroy_p_proc",          // 18 — object destroyed
    "none_x_bad",              // 19 — unused (barter_init_proc)
    "none_x_bad",              // 20 — unused (barter_proc)
    "look_at_p_proc",          // 21 — player looks at (examine) object
    "timed_event_p_proc",      // 22 — script-registered timer fires
    "map_update_p_proc",       // 23 — per-heartbeat map update
    "push_p_proc",             // 24 — critter is pushed
    "is_dropping_p_proc",      // 25 — critter is dropping something
    "combat_is_starting_p_proc", // 26 — combat begins globally
    "combat_is_over_p_proc",   // 27 — combat ends globally
};
```

`scriptLocateProcs(script)` (`scripts.cc:1348`) calls `programFindProcedure`
for each name and stores the procedure index in `script->procs[proc]`, or
`SCRIPT_PROC_NO_PROC = -1` if not found.

### 7.2 Trigger Conditions

| Proc | Triggered by |
|---|---|
| `start` (1) | `scriptsExecStartProc()` — once at map load, for all scripts |
| `spatial_p_proc` (2) | `scriptsExecSpatialProc()` — critter steps onto trigger tile |
| `description_p_proc` (3) | `obj_examine_func()` in `proto_instance.cc` |
| `pickup_p_proc` (4) | `_obj_pickup()` in `item.cc` |
| `drop_p_proc` (5) | `_obj_drop()` in `item.cc` |
| `use_p_proc` (6) | `_protinst_default_use_item()` / `_obj_use()` |
| `use_obj_on_p_proc` (7) | `_obj_use_item_on()` |
| `use_skill_on_p_proc` (8) | `_obj_use_skill()` |
| `talk_p_proc` (11) | `dialogueEnter()` in `dialog.cc` |
| `critter_p_proc` (12) | `_critter_update_busted()` per heartbeat (when in combat: combat_p_proc instead) |
| `combat_p_proc` (13) | CE combat loop, critter's turn |
| `damage_p_proc` (14) | `_apply_damage()` in `combat.cc` |
| `map_enter_p_proc` (15) | `scriptsExecMapEnterProc()` → `scriptsExecMapUpdateScripts(MAP_ENTER)` |
| `map_exit_p_proc` (16) | `scriptsExecMapExitProc()` |
| `create_p_proc` (17) | `_obj_new_sid_num()` (new object with sid) |
| `destroy_p_proc` (18) | `_obj_destroy()` |
| `look_at_p_proc` (21) | `_obj_examine_func_()` (separate from description) |
| `timed_event_p_proc` (22) | `_scr_exec_timed_event()` when timer fires |
| `map_update_p_proc` (23) | `scriptsExecMapUpdateProc()` per heartbeat |
| `push_p_proc` (24) | `_critter_attempt_placement()` |
| `is_dropping_p_proc` (25) | drop resolution |
| `combat_is_starting_p_proc` (26) | `scriptsCombatIsStartingProc()` |
| `combat_is_over_p_proc` (27) | `scriptsCombatIsOverProc()` |

### 7.3 `scriptExecProc(sid, proc)` (`scripts.cc:1261`)

The central dispatch function:
1. Validates `gScriptsEnabled`.
2. Loads the script's `.int` file if not already loaded (`SCRIPT_FLAG_0x01`).
3. If first load: calls `runProgram(program)`, then `_interpret(program, -1)` to
   execute the top-level code (global inits, exports).
4. Calls `scriptLocateProcs(script)` on first load.
5. Looks up `script->procs[proc]` to get the procedure index.
6. Calls `_executeProcedure(program, procedureIndex)`.

`_executeProcedure` (`interpreter.cc:2851`) calls `_setupCall` then `_interpret(program, -1)`,
giving the procedure an unlimited burst. It saves and restores `program->env`
across the call to allow nested `programFatalError` handling.

---

## 8. DH2 .int File Parsing (`src/intfile.ts`)

`parseIntFile(reader, name)` seeks to offset `0x2A` — the same offset as CE's
procedure table — and reads the same binary layout:

```ts
interface Procedure {
    nameIndex: number;  // byte offset into identifiers section
    name: string;       // resolved from identifiers (populated after reading)
    offset: number;     // bodyOffset (same as CE Procedure.bodyOffset)
    index: number;      // position in proceduresTable
    argc: number;       // argCount
}
```

**Differences from CE**:
- `flags` field is read as `reader.read32()` but **not stored** — it is
  discarded after the parse loop. TIMED and CONDITIONAL procedure flags are lost.
  (`intfile.ts:52–53`)
- `time` and `conditionOffset` fields are read via `assertEq(reader.read32(), 0)` —
  the parser **asserts** they are always 0. Any script using timed or conditional
  procs at the bytecode level would crash the parser.
  (`intfile.ts:54–55`)
- DH2 maps identifiers by numeric offset → string. CE maps by the same offset.
  The mechanism is compatible.

After parsing, `parseIntFile` returns `IntFile`:
```ts
interface IntFile {
    procedures: { [name: string]: Procedure };   // name → Procedure
    proceduresTable: Procedure[];                // ordered by index
    identifiers: { [offset: number]: string };
    strings: { [offset: number]: string };
    codeOffset: number;   // reader offset after string section = start of code
    name: string;
}
```

---

## 9. DH2 VM (`src/vm.ts`, `src/vm_bridge.ts`)

### 9.1 `ScriptVM` Class

```ts
class ScriptVM {
    dataStack: any[]   // untyped (no ProgramValue wrapper)
    retStack: number[] // return addresses only (no ProgramValue)
    pc: number
    intfile: IntFile
    opMap: { [opcode: number]: () => void }
}
```

`step()` fetches a 2-byte opcode at `pc`, advances `pc += 2`, dispatches via
`opMap[opcode]`. Returns `false` if no handler is found (halts run loop with
a warning). `run()` is `while(this.step()) {}`.

Stack errors:
- `pop()` throws `'VM data stack underflow'` as a JS exception (propagates to caller).
- `popAddr()` (retStack) throws `'VM return stack underflow'`.

No critical sections, no burst limit, no `setjmp/longjmp`. Each `run()` call
executes until the return stack sentinel is encountered or an unknown opcode
is hit.

### 9.2 `opMap` — Base Opcodes (`vm.ts`)

~35 opcodes are implemented directly in `opMap`:

| CE Opcode | DH2 behavior |
|---|---|
| `0x8001` push | Reads 4-byte literal; type determined by lookahead — if next call is `fetch_proc_address` or a string-lookup pattern, it may be an identifier or string reference |
| `0x8002` push_base | Pop argc from dataStack; push framePointer to retStack; framePointer = dataStack.length − argc |
| `0x8003` pop_base | Pop framePointer from retStack |
| `0x8004` pop_to_base | Truncate dataStack to framePointer length |
| `0x8005` set_global | basePointer = dataStack.length |
| `0x8006` dump | Pop N items |
| `0x8027` jmp | Set pc to 4-byte address following opcode |
| `0x8029` call | Pop proc index; set pc to proc.offset |
| `0x802B` pop_return | pc = retStack.pop() |
| `0x800C` if | Pop condition; if zero, pc = dataStack.pop() (branch); else discard address |
| `0x800D` while | Pop condition; if zero, pc = dataStack.pop() |
| `0x800E` store | Pop addr, pop value; dataStack[framePointer + addr] = value |
| `0x800F` fetch | Pop addr; push dataStack[framePointer + addr] |
| `0x8039` fetch_global | Pop addr; push dataStack[basePointer + addr] |
| `0x803A` store_global | Pop addr, pop value; dataStack[basePointer + addr] = value |
| `0x803B` swap | Swap top two stack items |
| `0x803D` pop | Discard top of stack |
| `0x803E` dup | Duplicate top of stack |
| Arithmetic ops | Implemented: +, -, *, /, %, -(unary), &&, \|\|, !, &, \|, ^, ~, floor, <, <=, >, >=, ==, != |
| `0x8036` dtoa | int → string |
| `0x8037` exit_prog | Halts (how: pops return stack sentinel or sets flag) |

DH2 does **not** implement:
- `opWait` (0x8009) — no waiting / `PROGRAM_IS_WAITING` support
- `opDelayedCall` (0x8007) — no timed procedure schedule
- `opCancel` / `opCancelAll` (0x800A/0x800B) — no procedure flag management
- `opSpawn` / `opFork` / `opExec` (0x8046–0x8048) — no child programs
- `opStoreExternal` / `opFetchExternal` (0x803F/0x8040) — external var access has a workaround via `mapScript()`
- Critical section opcodes (0x8025/0x8026) — not implemented

### 9.3 `vm_bridge.ts` — `bridgeOpMap`

~150 additional opcode handlers are registered in `bridgeOpMap`.
`Object.assign(opMap, bridgeOpMap)` merges them at load.

`bridged(procName, argc, pushResult=true)` factory:
1. Pops `argc` values from `dataStack` (reversed order).
2. Calls `scriptObj[procName](...args)`.
3. If `pushResult`, pushes the return value onto `dataStack`.

Special handlers override bridged():

- **`gsay_end` (0x811D)**: saves `pc + 2` to `retStack`, then halts the run
  loop by returning `false` from `step()`. This allows the dialogue system to
  re-enter the VM later and resume from the saved address.
- **`giq_option` (0x8121)**: wraps the target procedure address in a closure
  stored in `dialogueOptionProcs[]`.
- **`reg_anim_func` (0x810E)**: wraps a procedure address as an animation batch
  callback.

External variable access (MVARs):
- `0x8014` `fetch_external` — calls `mapScript()` which returns `_mapScript`
  if the current script has one, enabling reading of map variables.
- `0x8015` `store_external` — same mechanism for writing.
- `0x8016` — look up external by name.

### 9.4 `GameScriptVM` (`vm_bridge.ts`)

```ts
class GameScriptVM extends ScriptVM {
    scriptObj: Scripting.Script

    constructor(reader, intfile) {
        super(reader, intfile)
        this.scriptObj = new Scripting.Script()
        // Patch scriptObj: for each procedure in intfile,
        // add a JS method that calls vm.call(procName)
        for (const name in intfile.procedures) {
            this.scriptObj[name] = () => this.call(name)
        }
    }
}
```

`vm.call(procName, args=[])`:
1. Reverses `args`; pushes each onto `dataStack`.
2. Pushes `argc` onto `dataStack`.
3. Pushes `-1` sentinel onto `retStack`.
4. Sets `pc` to `intfile.procedures[procName].offset`.
5. Calls `run()`.

The run loop continues until `pop_return` (0x802B) pops `-1` from `retStack`
(which sets `pc = -1`); the next `step()` call cannot decode at address `-1` and
halts. This is the DH2 equivalent of CE's `_executeProcedure` + `_interpret(-1)`.

### 9.5 Script Loading (`src/scripting.ts`)

`loadScript(name)` (`scripting.ts:1900`):
1. Reads `data/scripts/name.int` as binary.
2. `parseIntFile(reader, name)` → `IntFile`.
3. `new ScriptVMBridge.GameScriptVM(reader, intfile)` — creates VM, patches `scriptObj`.
4. `vm.scriptObj.lvars = {}`, `scriptObj._mapScript = currentMapObject`.
5. `vm.run()` — executes the top-level code section (global variable
   initialization, `export_proc` opcodes, etc.). This is equivalent to CE's
   initial `_interpret(program, -1)` on first load.
6. Returns `vm.scriptObj` — an instance of `Scripting.Script` with procedure
   methods attached.

`initScript(script, obj)` (`scripting.ts:1938`) calls `script.start()` if
defined — equivalent to CE's `SCRIPT_PROC_START` dispatch.

---

## 10. DH2 Procedure Dispatch

DH2 dispatches procedures by calling JS methods directly on the `Script` object.
The dispatching functions in `scripting.ts` set up the `Script`'s context
variables (`self_obj`, `source_obj`, `game_time`, etc.) then call the method.

### 10.1 Implemented Dispatchers

| DH2 function | Proc called | CE equivalent |
|---|---|---|
| `initScript(script, obj)` | `script.start()` | `SCRIPT_PROC_START` (1) |
| `spatial(spatialObj, source)` | `script.spatial_p_proc()` | `SCRIPT_PROC_SPATIAL` (2) |
| `use(obj, source)` | `obj._script.use_p_proc()` | `SCRIPT_PROC_USE` (6) |
| `useObjOnMe(obj, item, source)` | `obj._script.use_obj_on_me_p_proc()` | `SCRIPT_PROC_USE_OBJ_ON` (7) |
| `useSkillOn(who, skill, obj)` | `obj._script.use_skill_on_p_proc()` | `SCRIPT_PROC_USE_SKILL_ON` (8) |
| `talk(script, obj)` | `script.talk_p_proc()` | `SCRIPT_PROC_TALK` (11) |
| `updateCritter(script, obj)` | `script.critter_p_proc()` | `SCRIPT_PROC_CRITTER` (12) |
| `combatEvent(obj, event)` | `obj._script.combat_p_proc()` | `SCRIPT_PROC_COMBAT` (13) |
| `damage(obj, target, source, dmg)` | `obj._script.damage_p_proc()` | `SCRIPT_PROC_DAMAGE` (14) |
| `enterMap(...)` | `mapScript.map_enter_p_proc()` | `SCRIPT_PROC_MAP_ENTER` (15) |
| `objectEnterMap(obj, ...)` | `script.map_enter_p_proc()` | `SCRIPT_PROC_MAP_ENTER` per object |
| `updateMap(mapScript, ...)` | `mapScript.map_update_p_proc()` | `SCRIPT_PROC_MAP_UPDATE` (23) |
| `destroy(obj, source)` | `obj._script.destroy_p_proc()` | `SCRIPT_PROC_DESTROY` (18) |
| `timedEvent(script, userdata)` | `script.timed_event_p_proc()` | `SCRIPT_PROC_TIMED` (22) |
| `pickup(obj, source)` | `obj._script.pickup_p_proc()` | `SCRIPT_PROC_PICKUP` (4) |
| `drop(obj, source)` | `obj._script.drop_p_proc()` | `SCRIPT_PROC_DROP` (5) |

(`scripting.ts:1938–2072`)

### 10.2 `_didOverride`

`script._didOverride` mirrors CE's `script->scriptOverrides`. Set to `false`
before each proc call; the script sets it to `true` via `script_overrides()` if
it wants to suppress the default engine action. The dispatcher returns
`_didOverride` to the caller.

---

## 11. Known Gaps

### Gap #1 — No timed/conditional procedure flags at parse time

`intfile.ts` asserts that procedure `time` and `conditionOffset` fields are 0.
`flags` is read but dropped. DH2 cannot run TIMED or CONDITIONAL procedures via
the bytecode mechanism — the compiled `call_condition` / `call_start` opcodes in
scripts would trigger unhandled-opcode halts.

DH2 uses its own `timeEventList` mechanism for timed events, bypassing CE's
in-procedure-table scheduling entirely.

### Gap #2 — No `_doEvents()` equivalent

CE's `_doEvents()` runs every frame, scanning all loaded programs' procedure
tables for TIMED/CONDITIONAL entries. DH2 has no equivalent loop. Scheduled
events are handled entirely via `Scripting.timeEventList` and `Scripting.timedEvent()`.

### Gap #3 — No per-frame program burst (`_updatePrograms`)

CE runs all loaded scripts 10 opcodes per frame via `_updatePrograms`. DH2 has
no equivalent continuous execution loop. Scripts only run when an event
dispatcher (use, talk, map_enter, etc.) calls a specific proc.

### Gap #4 — No `scriptsExecStartProc()` for all script types

CE's `scriptsExecStartProc()` iterates all scripts in all five script type lists
and calls SCRIPT_PROC_START on each. DH2's `initScript()` is called per-object,
not via an engine-wide sweep.

### Gap #5 — Missing procedure types

Not dispatched in DH2:

| CE Proc | Name | Reason not implemented |
|---|---|---|
| 3 | `description_p_proc` | No examine action |
| 16 | `map_exit_p_proc` | Map exit dispatches neither this nor object-level procs |
| 17 | `create_p_proc` | Objects created without script notification |
| 21 | `look_at_p_proc` | No look-at action |
| 24 | `push_p_proc` | Critter push not implemented |
| 25 | `is_dropping_p_proc` | Drop flow truncated |
| 26 | `combat_is_starting_p_proc` | Global combat start not broadcast |
| 27 | `combat_is_over_p_proc` | Global combat end not broadcast |

### Gap #6 — Value type erasure

CE's `ProgramValue` carries a type tag (`VALUE_TYPE_INT`, `VALUE_TYPE_STRING`,
etc.) on every stack slot. DH2's `dataStack: any[]` is untyped. String values
are stored as JS strings, integers as JS numbers; pointer/float distinction is
lost. Opcode handlers like `opConditionalOperatorEqual` in CE perform
typed comparison (string-vs-string, float-vs-int, ptr-vs-int). DH2 uses JS `==`
and `===` which collapse these distinctions.

### Gap #7 — No external program calls (`opSpawn`, `opFork`, `opExec`)

CE supports spawning child programs and calling exported procedures across
program boundaries. DH2 has no cross-program call mechanism. `fetch_external`
and `store_external` are patched via `_mapScript` references for the common
MVAR read/write case, but arbitrary exported procedure calls are not supported.

### Gap #8 — No `opWait` / suspension

CE's `opWait` suspends a program mid-execution for N milliseconds. DH2 has no
suspension; scripts must complete synchronously within a single `run()` call.

### Gap #9 — Dynamic string heap not implemented

CE has a reference-counted dynamic string heap in `program->dynamicStrings`
with GC via `programMarkHeap`. DH2 uses raw JS strings — no reference counting,
no heap, no `VALUE_TYPE_DYNAMIC_STRING` handling.

<!-- audited: 2026-06-01 -->
