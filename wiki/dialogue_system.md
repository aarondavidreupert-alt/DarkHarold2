# Dialogue System Reference

> Last audited: 2026-05-31  
> Sources: `raw/fallout2-ce/src/game_dialog.cc`, `dialog.cc`, `reaction.cc`  
> DH2 sources: `src/scripting.ts`, `src/vm_bridge.ts`, `src/ui_dialogue.ts`

---

## Overview

Fallout 2 dialogue is driven entirely by NPC `.int` scripts. The VM executes a procedure tree where each "node" calls opcode helpers (`gsay_reply`, `gsay_start`, etc.) to post text and options to the UI, then suspends itself at `gsay_end` until the player makes a choice. The selected option resumes the VM at the next node procedure.

DH2 replicates this pattern: the VM halts, the browser event loop handles user interaction, and `dialogueExit()` resumes the VM.

---

## Session Lifecycle

### CE (`game_dialog.cc`)

```
Player activates NPC → actionUseObject → scriptExecProc(SCRIPT_PROC_TALK)
  → start_gdialog opcode → _gdialogInitFromScript(headFid, reaction)
      sets _gdialog_state=1, creates windows, mutes music
  → gsay_start / gsay_reply / gsay_option / gsay_end  (node loop)
  → end_dialogue  (or node999 falls through to _dialogQuit)
  → _gdialogExitFromScript()
      tears down windows, restores music, re-enables mouse
```

Key CE globals:
- `_dialog_state_fix` — non-zero while a dialogue session is active
- `_gdialog_state` — 1 = window open, 0 = closed
- `gGameDialogSpeaker` — current NPC `Object*`
- `gGameDialogBarterModifier` — per-session barter modifier, reset to 0 on `gameDialogEnter`

### DH2 (`src/scripting.ts`)

```
Player clicks NPC → talk(script, obj)
  → start_gdialog opcode → sets currentDialogueObject, calls uiStartDialogue()
  → gsay_start → clears dialogueOptionProcs[]
  → gsay_reply  → calls uiSetDialogueReply()
  → gsay_option / giq_option → pushes proc into dialogueOptionProcs[]
  → gsay_end → VM halts (vm.halted = true), retStack.push(pc + 2)
  [player clicks option]
  → dialogueReply(id) → calls proc, then checks if more options exist
  → if no more options: dialogueExit()
      → uiEndDialogue()
      → dialogueBarterMod = 0
      → vm.pc = vm.popAddr(); vm.run()   ← VM resumes
```

Module-level state (`src/scripting.ts` lines 57–68):

| Variable | Type | Purpose |
|---|---|---|
| `dialogueOptionProcs` | `(() => void)[]` | Option index → script proc callback |
| `currentDialogueObject` | `Obj \| null` | NPC being talked to; null outside dialogue |
| `dialogueBarterMod` | `number` | Set by `gdialog_set_barter_mod`; reset on exit |

---

## VM Halt / Resume Mechanism

This is the core architectural feature. The script VM is single-threaded; it must pause while the player reads text and clicks options.

### gsay_end (halt)

`vm_bridge.ts` line 191–199 (inline, not bridged):

```typescript
0x811D: function() {    // gsay_end
    this.retStack.push(this.pc + 2)   // save return address
    this.halted = true                 // pause execution
    this.scriptObj.gsay_end()         // sets vm.halted = true (also)
}
```

`pc + 2` skips past the current opcode (2-byte opcode) so when resumed the VM continues with the instruction immediately after `gsay_end`.

### gsay_message (halt, alternate path)

When `gsay_message` is used instead of the gsay_start/gsay_reply/gsay_option/gsay_end sequence, it pushes the resume address differently (`scripting.ts` line 1476):

```typescript
this._vm.retStack.push(this._vm.script.offset)  // push script base offset (not pc+2)
this._vm.halted = true
```

This synthesises a `[Done]` option that, when clicked, triggers `dialogueExit()`.

### dialogueExit (resume)

`src/scripting.ts` lines 261–275:

```typescript
function dialogueExit() {
    uiEndDialogue()
    dialogueBarterMod = 0
    if (currentDialogueObject) {
        var vm = currentDialogueObject._script!._vm!
        vm.pc = vm.popAddr()    // pop the address pushed by gsay_end
        vm.run()                 // resume execution
    }
    currentDialogueObject = null
}
```

Triggered by:
- `dialogueReply(id)` when `dialogueOptionProcs` is empty after running the option proc
- `dialogueEnd()` (called from UI "Done" button)
- `end_dialogue` opcode
- `node999()` procedure convention

---

## Opcodes

### Wiring summary

All opcodes below are wired in `src/vm_bridge.ts`. Opcodes marked INLINE have a custom function body instead of the `bridged()` factory.

| Opcode | Name | Signature | CE counterpart | DH2 |
|--------|------|-----------|----------------|-----|
| 0x80DE | `start_gdialog` | `(msgFileID, obj, mood, headNum, bgID)` | `_gdialogInitFromScript` | IMPLEMENTED |
| 0x811C | `gsay_start` | `()` | `_gdialogStart` | IMPLEMENTED |
| 0x811D | `gsay_end` | `()` | halts interpreter | IMPLEMENTED (inline) |
| 0x811E | `gsay_reply` | `(msgList, msgID)` | `gameDialogSetMessageReply` | IMPLEMENTED |
| 0x8120 | `gsay_message` | `(msgList, msgID, reaction)` | `_gdialogSayMessage` | IMPLEMENTED |
| 0x8121 | `giq_option` | `(iqTest, msgList, msgID, target, reaction)` | `gameDialogAddMessageOptionWithProcIdentifier` | IMPLEMENTED (inline) |
| 0x80DF | `end_dialogue` | `()` | `_endDialog` / `_dialogQuit` | IMPLEMENTED |
| 0x80F9 | `dialogue_system_enter` | `()` | `_gdialogSystemEnter` | IMPLEMENTED |
| 0x8129 | `gdialog_mod_barter` | `(mod)` | `gameDialogBarter` | IMPLEMENTED |
| 0x814E | `gdialog_set_barter_mod` | `(mod)` | `gameDialogSetBarterModifier` | IMPLEMENTED |

Missing / stubbed:

| Opcode | Name | Notes |
|--------|------|-------|
| 0x811F | `gSay_Option` | Commented out in `scripting.ts` line 1453; CE: `gameDialogAddMessageOption` |

### Opcode details

#### `start_gdialog` (0x80DE)

```
start_gdialog(msgFileID: number, obj: Obj, mood: number, headNum: number, backgroundID: number)
```

CE: `_gdialogInitFromScript(headFid, reaction)` — creates the dialogue window, sets up the talking-head fidget animation, disables the ISO map, stores `gGameDialogSpeaker`.

DH2: Sets `currentDialogueObject = self_obj`, calls `uiStartDialogue(false, self_obj)` to slide the dialogue box into view. `mood`, `headNum`, and `backgroundID` are silently ignored.

---

#### `gsay_start` (0x811C)

```
gsay_start()
```

CE: `_gdialogStart()` — resets option/review entry counts to 0.

DH2: Clears `dialogueOptionProcs = []`. Opens dialogue UI if not already open.

---

#### `gsay_reply` (0x811E)

```
gsay_reply(msgList: number, msgID: number)
```

CE: `gameDialogSetMessageReply` — looks up text in the message list and stores it for rendering in the NPC reply panel.

DH2: Looks up `msgID` in `scriptMessages[msgList]`, calls `uiSetDialogueReply(msg)` which sets `#dialogueBoxReply.innerHTML` and clears the options area.

---

#### `gsay_end` (0x811D) — inline

```
gsay_end()
```

CE: `_exitDialog = 1` sets a flag; the dialogue event loop then presents options and waits for input.

DH2: `retStack.push(pc + 2)`, `halted = true`. Execution stops; the browser event loop takes over. No return value.

---

#### `gsay_message` (0x8120)

```
gsay_message(msgList: number, msgID: number, reaction: number)
```

CE: `_gdialogSayMessage` — a combined reply+option shorthand for a single-option "OK/Done" dialogue beat.

DH2: Calls `uiSetDialogueReply(msg)`, pushes a no-op proc into `dialogueOptionProcs`, renders `[Done]`, then halts the VM (uses `script.offset` as resume address, not `pc + 2`).

`reaction` is accepted but not applied in DH2.

---

#### `giq_option` (0x8121) — inline

```
giq_option(iqTest: number, msgList: number, msgID: number, target: proc, reaction: number)
```

CE: `gameDialogAddMessageOptionWithProcIdentifier` — adds the option text and a pointer to the target procedure if the IQ gate passes.

DH2: See [IQ Gate](#iq-gate--giq_option) section. Wraps target proc in a closure and pushes it to `dialogueOptionProcs`.

---

#### `end_dialogue` (0x80DF)

```
end_dialogue()
```

CE: `_dialogQuit()` → `_endDialog()` — frees reply structures, decrements the dialog stack depth.

DH2: Calls `dialogueExit()` directly.

---

#### `dialogue_system_enter` (0x80F9)

```
dialogue_system_enter()
```

CE: `_gdialogSystemEnter()` — re-enters the dialogue loop from inside a script (used by spatial scripts and some item interactions).

DH2: Calls `talk(self_obj._script, self_obj)` to restart the talk procedure on the current object.

---

#### `gdialog_set_barter_mod` (0x814E)

```
gdialog_set_barter_mod(mod: number)
```

CE: `gameDialogSetBarterModifier(modifier)` — sets `gGameDialogBarterModifier` (persists until session end).

DH2: `dialogueBarterMod = mod`. Value is exported via `getDialogueBarterMod()` and consumed by `src/ui_barter.ts` as a percentage markup. Reset to 0 on `dialogueExit()`.

---

#### `gdialog_mod_barter` (0x8129)

```
gdialog_mod_barter(mod: number)
```

CE: `gameDialogBarter(modifier)` — sets the barter modifier and switches the dialogue UI to barter mode.

DH2: Calls `uiBarterMode(self_obj as Critter)`, which opens the barter UI panel. The dialogue box remains visible (`uiMode` is set to `UIMode.barter`). If `dialogueReply` fires after this, the barter branch is detected and the dialogue is not closed (`vm_bridge.ts` / `scripting.ts:243–245`).

---

## IQ Gate — `giq_option`

### CE logic

`gameDialogAddMessageOptionWithProcIdentifier` in `game_dialog.cc` line 1096: the IQ check is performed at the scripting layer by `_intlib_gdialog_get_reply` before calling the add-option function. Effectively: if the option should be hidden, the script simply does not call the add-option function.

### DH2 logic (`scripting.ts` lines 1502–1506)

```typescript
const INT = globalState.player.getStat('INT')
if ((iqTest > 0 && INT < iqTest) || (iqTest < 0 && INT > -iqTest)) return
dialogueOptionProcs.push(target.bind(this))
uiAddDialogueOption(msg, dialogueOptionProcs.length - 1)
```

Gate rules:
- `iqTest > 0`: option requires `INT ≥ iqTest` — hidden if player INT is too low
- `iqTest < 0`: option requires `INT ≤ -iqTest` — hidden if player INT is too high (used for "dumb" dialogue)
- `iqTest == 0`: always shown (no gate)

The `target` argument is an INT bytecode procedure index. In the inline handler (`vm_bridge.ts` line 213–217) it is resolved to a procedure name and wrapped:

```typescript
var targetProc = this.intfile.proceduresTable[target].name
var targetFn = () => { this.call(targetProc) }
```

---

## Reaction Values

### CE (`reaction.cc`, `game_dialog.cc`)

Reaction is an integer stored in script local variable 0 of the NPC script:

```c
// reaction.cc
int reactionSetValue(Object* critter, int value) {
    scriptSetLocalVar(critter->sid, 0, value);
}
int reactionGetValue(Object* critter) {
    scriptGetLocalVar(critter->sid, 0, &programValue);
    return programValue.integerValue;
}
```

Translation thresholds (`reaction.cc:reactionTranslateValue`):

| Raw value | Translated |
|-----------|-----------|
| > 10 | `NPC_REACTION_GOOD` |
| > −10 | `NPC_REACTION_NEUTRAL` |
| ≤ −10 | `NPC_REACTION_BAD` |

`NPC_REACTION_GOOD/NEUTRAL/BAD` drive talking-head fidget animation transitions (`_talk_to_critter_reacts`, `game_dialog.cc` line 2888).

The `GameDialogReaction` enum maps to ASCII values:
```c
GAME_DIALOG_REACTION_GOOD    = 49   // '1'
GAME_DIALOG_REACTION_NEUTRAL = 50   // '2'
GAME_DIALOG_REACTION_BAD     = 51   // '3'
```

Each option entry (`GameDialogOptionEntry`) carries a `reaction` field; when the player selects that option, `_talk_to_critter_reacts(entry->reaction - 50)` is called which may shift the NPC's fidget animation up or down.

Barter modifier and speech checks can shift the raw reaction value up or down; gifts and Gift Giver perk also affect it via `reactionSetValue`.

### DH2 status

**STUB.** The `reaction` parameter is accepted by `gsay_message`, `gsay_reply` (CE: `gSay_Option`), and `giq_option` in function signatures, but it is never stored, read, or applied. No equivalent of `reactionSetValue` / `reactionGetValue` is implemented. The talking-head animation system does not exist in DH2.

---

## Barter Integration

### CE flow

1. NPC script calls `gdialog_mod_barter(mod)` or the player clicks the Barter button.
2. `gameDialogBarter(mod)` creates the barter sub-window, sets `_dialogue_switch_mode = 2`.
3. When barter ends, `_barter_end_to_talk_to()` calls `_dialogQuit()` then re-enters `_dialogue_state = 1`.

### DH2 flow

1. Script calls `gdialog_mod_barter(mod)` → `uiBarterMode(self_obj)`.
2. `uiBarterMode` sets `globalState.uiMode = UIMode.barter` and opens the barter panel.
3. `dialogueReply` checks `uiMode === UIMode.barter` and returns early instead of closing dialogue.
4. `gdialog_set_barter_mod` / `dialogueBarterMod` is consumed by `src/ui_barter.ts` via `getDialogueBarterMod()`.

---

## node999 Convention

Scripts conventionally name the terminal dialogue node `node999`. When this procedure is called, it calls `end_dialogue` (or falls through to the VM halt and exit machinery).

In DH2 `scripting.ts` line 1420–1424:

```typescript
node999() {
    info('DIALOGUE EXIT (Node999)')
    dialogueExit()
}
```

This is a Script method, not a VM opcode — it is invoked when the INT script calls `call node999`.

---

## Known Gaps vs. CE

| Feature | CE | DH2 | Notes |
|---------|-----|-----|-------|
| `gSay_Option` (0x811F) | `gameDialogAddMessageOption` | MISSING | Uncommented stub only. Most scripts use `giq_option` instead. |
| Reaction storage | `reactionSetValue` / local var 0 | MISSING | `reaction` param ignored everywhere in DH2 |
| Reaction translation | `reactionTranslateValue` | MISSING | Threshold → GOOD/NEUTRAL/BAD mapping not implemented |
| Talking-head fidget | `_talk_to_critter_reacts` | MISSING | No head FRM animation system |
| `start_gdialog` mood/headNum/bgID | Used for head FRM and background | IGNORED | Parameters accepted but unused |
| Dialogue review window | "Review" button shows history | MISSING | No `GameDialogReviewEntry` equivalent |
| Party-member customisation | Combat-control sub-dialog | MISSING | `PartyMemberCustomizationOption` buttons not wired |
| `gsay_message` resume address | `script.offset` (base of script) | DIFFERENT | CE uses the post-opcode address; DH2 uses script base. Functionally equivalent in practice because execution continues from the correct call frame, but diverges if the script has deeply nested calls. |
| `_gdialog_barter_destroy_win` → re-enter talk | Seamless barter → dialogue return | PARTIAL | DH2 leaves re-entry to the script's own `node999` / `end_dialogue` call |
| Music volume halved during dialogue | `_gsound_background_volume_get_set(vol/2)` | MISSING | No audio system in DH2 |

---

## How to Use — Guidance for Future Prompts

**Adding a new dialogue opcode:**

1. Add the opcode number → method name mapping in `src/vm_bridge.ts` using `bridged("methodName", argCount)`.
2. Implement the method in the `Script` class in `src/scripting.ts` (methods are in the `class Script { ... }` block).
3. If the opcode needs to halt the VM, follow the `gsay_end` inline pattern: push `pc + 2` to `retStack`, set `halted = true`.

**Tracking down a dialogue opcode:**
- Cross-reference opcode number in `raw/fallout2-ce/src/scripts.cc` or `interpreter.cc` to get the CE function name.
- Search `src/vm_bridge.ts` for the hex opcode.
- Search `src/scripting.ts` for the method name.

**Debugging a dialogue hang:**
- If the VM halts and never resumes, check whether `retStack` was pushed before `halted = true`.
- If `dialogueExit()` fires but the VM crashes, check that `currentDialogueObject._script._vm` is non-null.
- `dialogueOptionProcs` length determines whether `dialogueReply` calls `dialogueExit` — if it is non-empty after the option proc runs, the VM stays halted and the UI waits for another click.

**Implementing reaction:**
1. Add `reactionValue: number = 0` to the `Script` class.
2. In `gsay_message`, `giq_option`, and any future `gSay_Option`: store the `reaction` argument and call `reactionSetValue` equivalent.
3. Translate via the `reactionTranslateValue` thresholds and wire to a talking-head animation system (out of scope for DH2's current HTML UI).

**Implementing `gSay_Option` (0x811F):**
- Signature: `gSay_Option(msgList, msgID, target, reaction)` — same as `giq_option` but without the `iqTest` gate.
- Implement as inline handler in `vm_bridge.ts` (same wrapping as `giq_option` but skip the INT check).
