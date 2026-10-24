# Dialogue System Reference

> Last audited: 2026-10-17  
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

`gsay_option` (0x811F, CE `_op_gsay_option`) is implemented too (inline, like `giq_option` without the IQ test).

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

INT here is the player's INT **plus the Smooth Talker rank** (CE `_op_giq_option`).

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

Implemented (audit 2026-10-17):
- Talking heads with fidgets, `_talk_to_critter_reacts` on the option's reaction (`src/talkingHead.ts reactToOption`), lips and speech (`startLips`).
- The engine-side reaction change: being hit by the player sets LVAR 0 to −3 (`combat/whoHitMe.ts critterSetWhoHitMe`, CE `_critter_set_who_hit_me` → `reactionSetValue`).
- Barter reads LVAR 0 through `reactionTranslateValue`: > 10 good (−15 %), > −10 neutral, else bad (+25 %). (Fixed 2026-10-17: −10 itself counted as neutral.)
- `start_gdialog` with a head uses `reactionTranslateValue` of LVAR 0 for the head's starting mood.

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
4. `gdialog_set_barter_mod` / `dialogueBarterMod` is consumed by `src/ui_barter/screen.ts` via `getDialogueBarterMod()`.

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

## MessageList Format (`message.cc`)

> **Source anchor:** `raw/fallout2-ce/src/message.cc` (`messageListLoad`, `messageListGetItem`, `_message_make_path`, `_message_find`, `badwordsInit`)

### MessageList Data Structures

```c
typedef struct MessageListItem {
    int  num;          // message ID (used as lookup key)
    int  flags;        // typically 0; reserved for future use
    char text[512];    // display string
    char sound[512];   // optional ACM speech file stem (e.g. "HV11AR1C")
} MessageListItem;

typedef struct MessageList {
    int              size;    // number of entries loaded
    MessageListItem* items;   // dynamically allocated array
} MessageList;
```

### `.msg` File Format

Each non-comment line in a `.msg` file uses one of two forms:

```
{<number>}{<flags>}{<text>}
{<number>}{<flags>}{<text>}{<sound>}
```

- Lines beginning with `#` are comments and are ignored.
- `<number>` is the integer message ID.
- `<flags>` is typically `0`; the field is parsed but unused in CE gameplay.
- `<text>` is the display string (up to 511 characters).
- `<sound>` (optional) specifies an `.ACM` speech file stem. When present, CE resolves `<sound>.acm` from the speech directory for voice-over playback.

### Loading and Lookup

**`messageListLoad(list, path)`** — loads a `.msg` file from disk. Path is resolved via `_message_make_path`, which prepends the data directory and the current language subdirectory (e.g. `data/text/english/dialog/<name>.msg`).

**`messageListGetItem(list, item)`** — looks up a `MessageListItem` by `item->num` via `_message_find`, which performs a linear scan through `list->items`. Returns a pointer to the matching entry, or `NULL` if not found.

### Message ID Ranges

| Range | Purpose |
|-------|---------|
| 0 – 0x0FFF | Standard per-script or per-dialog messages |
| 0x1000 – 0x1FFF | Proto-description messages (item/critter examine text) |
| 0x2000 – 0x2FFF | Persistent messages (survive across map transitions) |
| 0x3000 – 0x3FFF | Temporary messages (discarded on map unload) |

### Language Filter (`badwordsInit`)

When `settings.preferences.language_filter` is enabled, CE loads `data/text/english/game/badwords.msg` on startup. Any word appearing in that list is replaced with characters drawn from:

```c
const char* gBadwordsReplacements = "!@#$%&*@#*!&$%#&%#*%!$&%@*$@&"
```

The filter is applied post-lookup via `_message_censor` before the text is displayed.

### DH2 Equivalent

DH2 message loading lives in `src/data.ts`:

- `loadMsgFile(path)` — loads a `.msg` file and returns a `{[id: number]: string}` map. The asset pipeline pre-converts `.msg` files to JSON during extraction; at runtime DH2 fetches the JSON rather than parsing the raw `.msg` format.
- `getMsgStr(list, id)` — looks up message ID `id` in the pre-loaded map.

**DH2 gaps vs CE `message.cc`:**

| Gap | CE behaviour | DH2 behaviour |
|-----|-------------|---------------|
| Language filter | `badwordsInit()` + `_message_censor()` applied to all looked-up strings when `language_filter=1` | No filter; `Config.ui.languageFilter` is not declared or wired |
| Speech sound field | `sound` field in `.msg` entries resolved to `.acm` file for voice-over | Sound field not extracted or consumed; no speech audio path in DH2 |
| Persistent / temporary ID ranges | Engine tracks 0x2000–0x2FFF (persistent) and 0x3000–0x3FFF (temporary) lists separately | Not tracked; all message IDs treated uniformly |
| Path resolution | `_message_make_path` inserts language subdir automatically | Pipeline bakes messages at extraction time; runtime path is fixed |

---

## Known Gaps vs. CE

Re-audited 2026-10-17. Closed since the first version of this table: `gsay_option`, reaction storage / translation, talking heads and fidgets, `start_gdialog` head / mood / background, the review window (P17), the party-member control and customisation screens (P5), barter → talk (`_barter_end_to_talk_to` → `Scripting.reenterDialogue`: since 2026-10-24 the same reply and options come back, as CE `gdUnhide`, instead of re-running `talk_p_proc`; `gdialog_mod_barter` inside an option opens barter after the option's procedure has set up its node — known_bugs PA14), music at half volume without a head and stopped / restarted with one (`talkingHead.ts`), the language filter (AF17) and speech.

| Feature | CE | DH2 | Notes |
|---------|-----|-----|-------|
| `gsay_message` resume address | `script.offset` after the opcode | Script base | Functionally equivalent in practice (execution continues in the right call frame). |
| Persistent / temporary message-list IDs | 0x2000–0x2FFF / 0x3000–0x3FFF tracked separately | Not tracked | No script uses them in vanilla. |

<!-- audited: 2026-10-17 -->

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
