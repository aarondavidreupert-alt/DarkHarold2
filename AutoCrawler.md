# AutoCrawler — Design Document

**Status:** Implemented (`src/autocrawler.ts`)  
**Scope:** Automated testing harness for dialogue and combat systems  
**Author:** Claude (research pass + implementation, 2026-05-27)

---

## 1. Concept

Two standalone crawler modules that exercise the engine's dialogue and combat
systems without any manual input. Neither requires image comparison or LLMs.
All assertions are pure state checks.

### 1.1 NPC Dialogue Crawler

For every NPC on a given map that has a `talk_p_proc`:

1. Teleport the player to an adjacent hex.
2. Call `Scripting.talk(npc._script, npc)` to trigger the NPC's talk procedure.
3. Wait for `globalState.uiMode === UIMode.dialogue`.
4. Collect all visible dialogue option buttons from the DOM.
5. Click through every option (one at a time, re-entering dialogue if the NPC
   loops), recording each reply text and option label.
6. Verify `globalState.uiMode === UIMode.none` when done.
7. Log any stuck state (uiMode never returned to `none`) or thrown exception.
8. If `globalState.inCombat` becomes true at any point, abort gracefully:
   call `Combat.forceEnd()`, log the NPC as "combat-triggering", and continue
   to the next NPC.

### 1.2 Combat Crawler

For every critter on the map that is alive and flagged or presumed hostile:

1. Teleport the player to an adjacent hex.
2. Set `critter.hostile = true` and call `Combat.start()` to enter combat.
3. Wait for `globalState.inCombat === true` and
   `globalState.combat.inPlayerTurn === true`.
4. Call `globalState.combat.nextTurn()` — this is "End Turn".
5. Wait for the AI to finish all its turns (poll until `inPlayerTurn` is true
   again, with a timeout).
6. Verify that `globalState.combat` is still non-null and not stuck in an
   infinite loop (turn counter is advancing).
7. Call `Combat.forceEnd()` to abort the encounter.
8. Log any stuck state, uncaught exception, or AI recursion bail-out.

### 1.3 Engine-Speed Operation

Both crawlers must run at engine speed — not real time. This depends on a
`step()` shim that drives `heart._tick` without waiting for
`requestAnimationFrame`. See §3.1 for the exact approach.

---

## 2. Code Findings

### 2.1 `src/heart.ts` — Tick / rAF Loop

`heart.ts` is a Love 2D–style shell. The game loop lives in `Heart._tick(time)`:

```
_tick(time: number) {
    // frame-rate gate (target 30 FPS)
    if (frameAccum >= targetTickTime) {
        heart.update(dt)   // <-- all game logic
        heart.draw()       // <-- renderer
    }
    window.requestAnimationFrame(heart._tick)  // <-- always re-schedules
}
```

**Key observations:**
- `heart._tick` is a plain method — it can be called directly with a synthetic
  timestamp.
- It always appends a new rAF at the end, so repeated direct calls accumulate
  parallel rAF loops. **Implemented fix:** `heart._stepOnly(time)` was added;
  it runs the same update/draw logic without re-scheduling rAF. `debug.step()`
  and `autocrawler.stepEngine()` both call `_stepOnly` — not `_tick`.
- `debug.step()` is exported from `src/debug.ts` and available in DevTools via
  `const { debug } = await import('./js/debug.js')`.

### 2.2 `src/globalState.ts` — Queryable State

All state the crawler needs is directly readable:

| Field | Type | Relevant for |
|---|---|---|
| `globalState.uiMode` | `UIMode` | Dialogue crawler — assert `UIMode.none` |
| `globalState.inCombat` | `boolean` | Both crawlers |
| `globalState.combat` | `Combat \| null` | Combat crawler — `inPlayerTurn`, `nextTurn()`, `forceEnd()` |
| `globalState.gMap` | `GameMap` | Map scan — `getObjects()` |
| `globalState.player` | `Player` | Teleport — set `player.position` |
| `globalState.currentElevation` | `number` | Filter objects to current elevation |
| `globalState.eventLog` | `EventLogEntry[]` | Structured log for post-run analysis |

`window.globalState` is available in the browser console.
`window.exportEventLog()` can dump the event log as JSON after a run.

### 2.3 `src/scripting.ts` — Dialogue Internals

The exported surface the crawler uses:

- `Scripting.talk(script, obj)` — sets `self_obj`, calls `script.talk_p_proc()`.
  Safe to call directly if (and only if) the object has `_script.talk_p_proc`.
- `Scripting.dialogueReply(id)` — fires option proc at index `id`, then either
  loops or calls `dialogueExit()`.
- `Scripting.dialogueEnd()` — equivalent to clicking [Done]; calls
  `dialogueExit()`.
- `Scripting.reenterDialogue()` — replays the current NPC's talk proc for
  NPCs that re-enter.

The VM halt cycle: `gsay_end()` sets `vm.halted = true`. `dialogueExit()`
resumes via `vm.pc = vm.popAddr(); vm.run()`. This means **dialogue is
asynchronous** — the VM pauses mid-execution and waits for `dialogueReply` or
`dialogueEnd` to be called from outside. The crawler must poll `uiMode` after
triggering talk, not assume synchronous completion.

Dialogue option accumulation: option procs live in the module-private array
`dialogueOptionProcs`. The DOM is the only public surface for reading options
— the crawler queries `#dialogueBoxTextArea` children and calls `.click()` on
them directly (no `data-id` attributes; each child element is a clickable div).

### 2.4 `src/debug.ts` — Existing Hooks

The `debug` object (available in DevTools via `import('./js/debug.js')`) offers:

- `debug.teleport(mapName)` — loads a new map.
- `debug.addXP`, `debug.setHP`, `debug.setKarma` — stat manipulation.
- `debug.combatLog()` — returns `globalState.eventLog`.
- `debug.giveItem(pid)` — inventory injection.

**What is missing for the crawler:**
- No "move player to tile" (must set `globalState.player.position` directly).
- No "trigger dialogue on object" (must call `Scripting.talk` directly).
- No "start combat against specific critter" (must set `.hostile` and call
  `Combat.start()`).
- No `step()` function.

All of these can be added to `debug.ts` without touching engine code.

### 2.5 `src/combat.ts` — Combat Start / End

- `Combat.start(forceTurn?)` — static factory. Guards against re-entry via the
  module-private `combatActive` bool; ignores a second call if already active.
  Builds the combatant list from `gMap.getObjects()`, enrolling all non-dead
  critters with a valid `teamNum`.
- `combat.end()` — only terminates if `numActive === 0`. The crawler should
  not rely on this; use `forceEnd()` instead.
- `combat.forceEnd()` — force-terminates regardless of active combatants.
  Resets `globalState.inCombat`, nulls `globalState.combat`, defers
  `combatActive = false` via `Promise.resolve().then(...)`.
- `combat.nextTurn()` — the "End Turn" action. When called on the player's
  turn, advances to the next critter and executes AI turns.
- `combat.inPlayerTurn` — true when it is the player's turn.
- `isCombatActive()` (exported) — safe external re-entry check.

The AI (`doAITurn`) is deeply callback-based: it fires walk animations that
call `doAITurn(depth+1)` on completion. **The AI turn does not complete
synchronously.** The crawler must poll `combat.inPlayerTurn` after calling
`nextTurn()`.

---

## 3. Feasibility Analysis

### 3.1 Is `step()` Feasible?

Yes, with caveats.

**Implemented `step()` approach (uses `_stepOnly`, not `_tick`):**

```typescript
// In debug.ts
function step(dtMs: number = (heart._targetTickTime ?? 33) + 1): void {
    if (!Config.engine.debug) return
    if (heart._lastTick === undefined) return
    heart._stepOnly(heart._lastTick + dtMs)
}
```

`heart._stepOnly` runs update/draw for one logical frame without calling
`requestAnimationFrame`, so repeated calls never spawn extra rAF loops.
Adding 1 ms over `_targetTickTime` guarantees the frame-rate accumulator
crosses the threshold on every call. `_dt` is clamped to `Math.max(0, ...)`
so synthetic steps that run ahead of real rAF timestamps cannot produce a
negative frame accumulator.

**The deeper catch — async operations:**  
Neither dialogue nor combat is synchronous. Walk animations, VM halts, and AI
turns all complete via callbacks or `setTimeout`. A single `step()` call only
advances the engine clock by one frame. For the crawler to observe state
changes from async operations (e.g., "wait until dialogue options appear"),
it must poll in a loop. The recommended pattern:

```typescript
async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = performance.now() + timeoutMs
    while (!pred()) {
        step()
        await new Promise(r => setTimeout(r, 0))  // yield to microtask queue
        if (performance.now() > deadline) return false
    }
    return true
}
```

This advances the engine one frame per iteration while yielding to let
callbacks fire. It is not "instant" (limited by event loop), but it is far
faster than real-time and does not depend on visual rendering.

### 3.2 Which Existing Hooks Are Reusable?

| Hook | Reuse as-is | Needs addition |
|---|---|---|
| `globalState.uiMode` | Yes — read directly | — |
| `globalState.inCombat` | Yes | — |
| `globalState.gMap.getObjects()` | Yes | — |
| `globalState.eventLog` | Yes | — |
| `window.exportEventLog()` | Yes | — |
| `Scripting.talk()` | Yes | — |
| `Scripting.dialogueReply()` | Yes | — |
| `Combat.start()` / `forceEnd()` | Yes | — |
| `debug.teleport()` | Yes | — |
| `debug.ts` — `step()` | No | Must add |
| `debug.ts` — `movePlayer(tileNum)` | No | Must add |
| `debug.ts` — `listTalkableNPCs()` | No | Must add |
| `debug.ts` — `runDialogueCrawler(mapName)` | No | Must add |
| `debug.ts` — `runCombatCrawler(mapName)` | No | Must add |

---

## 4. Edge Cases

### 4.1 NPC List Edge Cases

- **No `talk_p_proc`**: `Scripting.talk` calls `script.talk_p_proc()` directly.
  If the function is undefined, this will throw. Always guard:
  `if (!obj._script?.talk_p_proc) skip`.
- **Dead critters** (`critter.dead === true`): skip.
- **Player object** (`critter.isPlayer`): skip.
- **Wrong elevation**: `gMap.getObjects()` without arguments defaults to
  `this.currentElevation` (see `src/map.ts:85-87`), so only objects on the
  active elevation are returned — no extra elevation filter needed.
- **Missing `_script`**: objects without a script cannot talk.
- **Critters that go hostile on `talk_p_proc`**: some NPCs call
  `attack_complex` from their talk proc (e.g., territorial critters). Detect
  via `globalState.inCombat` immediately after calling `talk()`.
- **Infinite dialogue loops**: some NPCs' scripts never exhaust their option
  list. Track visited `(npcUID, optionLabel)` pairs and skip already-visited
  options. Apply a hard limit (e.g., 50 option-clicks per NPC).
- **INT-gated options** (`giq_option`): options only appear if player INT meets
  the threshold. The crawler should test with a known player INT value, not
  test exhaustively across all INT values.
- **Barter mode**: `gdialog_mod_barter` switches `uiMode` to `UIMode.barter`.
  The crawler should treat this as a valid terminal state (not a stuck state)
  and call `uiEndDialogue()` to exit.
- **Critters with no AI packet**: some critters have an `aiNum` that maps to
  nothing in `AI.TXT`. `new AI(critter)` throws. The combat crawler must
  catch this — such critters are not valid combat targets.

### 4.2 Combat Crawler Edge Cases

- **`combatActive` re-entry guard**: `Combat.start()` is a no-op if called
  while `combatActive === true`. The crawler must ensure `isCombatActive()`
  is false before starting a new encounter (i.e., the previous `forceEnd()`
  has settled — the `Promise.resolve().then(...)` deferred reset means there
  is a one-tick delay).
- **AI recursion bail-out**: `doAITurn` bails out at `Config.combat.maxAIDepth`
  and calls `nextTurn()`. This is already logged in `eventLog` with
  `action: 'ai-bailout'`. The crawler should check for bail-outs in the log.
- **Critters that die before attacking**: if a critter is at 1 HP and the
  player is adjacent, combat may end immediately. `combat.end()` checks
  `numActive === 0`; if true, it cleans up before `forceEnd()` is needed.
- **Team enrollment**: `Combat.start()` (player-initiated) enrolls all NPC
  teams on the map. A crawler triggering combat on critter A may pull
  critter B into the fight. The crawler should reset critter `.hostile` flags
  to false on non-target critters before calling `Combat.start()`.
- **Player death**: if player HP reaches 0 during a crawler combat, the engine
  will fire `critterDamage` on the player. There is no "respawn" hook. The
  crawler should run with player HP set to max via `debug.setHP()`.
- **Walk callbacks in `doAITurn`**: AI movement uses `walkTo(target, ...,
  callback)` where the callback fires after the animation completes. These
  animations are time-based. During crawler steps, they may not complete
  between `step()` calls. The poll-and-wait pattern handles this, but the
  timeout must be generous (recommend 10 s per AI turn).

---

## 5. Suggestions

### 5.1 Crawler Log Format

Each crawl run should produce a structured JSON report, parallel to
`globalState.eventLog` but crawler-specific:

```json
{
  "map": "artemple",
  "type": "dialogue",
  "timestamp": 1716777600000,
  "npcs": [
    {
      "uid": 42,
      "name": "Acolyte",
      "tileNum": 18040,
      "status": "ok",
      "optionsSeen": 3,
      "optionLabels": ["Tell me about the Overseer.", "Goodbye.", "[Done]"],
      "replies": ["The Overseer? He's..."],
      "durationMs": 210
    },
    {
      "uid": 77,
      "name": "Guard",
      "status": "combat-triggered",
      "durationMs": 44
    }
  ]
}
```

This can be downloaded as a file via the same Blob-URL trick used by
`window.exportEventLog()`.

### 5.2 Teleport Approach for Player Positioning

Rather than using `debug.teleport()` (which loads a whole new map), the
crawler should move the player within the loaded map by setting
`globalState.player.position` directly:

```typescript
globalState.player.position = fromTileNum(adjacentTile)
centerCamera(globalState.player.position)
```

`fromTileNum` is in `src/tile.ts`; `centerCamera` is in `src/renderer.ts`.

### 5.3 Dialogue Option Discovery

The crawler does not need to parse `dialogueOptionProcs` (module-private).
It can query DOM option buttons:

```typescript
const buttons = document.querySelectorAll('#dialogueOptions .dialogueOption')
// Each button has an onclick that calls Scripting.dialogueReply(id)
```

Alternatively, add a `Scripting.getDialogueOptionCount(): number` export that
returns `dialogueOptionProcs.length` — this avoids DOM coupling entirely.

### 5.4 Deterministic Random for Reproducibility

`src/scripting.ts` exports `Scripting.seed(n)` (module-private, not exported).
For reproducible crawler runs, expose `Scripting.setSeed(n)` and call it before
each crawl. This ensures combat outcomes (hit rolls, critical rolls) are
identical across runs, making regressions detectable.

### 5.5 Config Flags to Silence During Crawl

These `Config` flags reduce noise during a crawl run:

```typescript
Config.scripting.debugLogShowType.stub = false
Config.scripting.debugLogShowType.dialogue = false
Config.combat.difficultyModifier = 100   // neutral
```

Add a `crawlerMode: boolean` flag in `Config` that sets all of these in one
call.

---

## 6. Open Questions

1. **Frame-rate gating during `waitFor`**: `heart._tick` only calls
   `heart.update(dt)` if `_frameAccum >= _targetTickTime`. With `step()` always
   passing `_targetTickTime` as `dtMs`, this always opens the gate — but should
   the crawler care about the FPS counter being corrupted? (Probably not.)

2. **DOM availability**: `uiStartDialogue` and `uiEndDialogue` manipulate
   `document.getElementById('dialogueContainer')`. In a headless test context
   (no real browser), these will throw. The crawler as designed is
   **browser-only**. Is that acceptable, or should we add a headless mode with
   DOM stubs?

3. **Multi-elevation maps**: `gMap.getObjects()` appears to return all objects
   across all elevations. Should the crawler crawl all elevations, or only the
   current one? Changing elevation via `gMap.changeElevation(n, true)` is
   possible but may trigger map scripts.

4. **Scripted teleports / `move_to` during talk**: some NPCs call `move_to` on
   the player during their talk proc (e.g., escort scripts). This could move
   the player mid-crawl. Should the crawler save and restore player position
   after each NPC?

5. **Stuck VM detection**: the VM halts with `vm.halted = true` and only
   resumes when `dialogueReply` or `dialogueEnd` is called. If a script
   crashes before calling `gsay_end`, `uiMode` may be stuck at `UIMode.dialogue`
   with no options visible. The `waitFor` timeout covers this — but should we
   also check for `halted` with zero options as a distinct "no-options" stuck
   state?

6. **Spatial scripts**: some scripted triggers (spatial_p_proc) fire when the
   player enters a tile. Teleporting the player to an NPC's adjacent hex might
   trip spatial triggers. Should the crawler disable spatial scripts during a
   run?

---

## 7. Implementation Order

### Phase 0 — Infrastructure (no engine changes)

1. Add `step(dtMs?)` to `debug.ts` — calls `heart._tick` with a synthetic
   timestamp.
2. Add `movePlayer(tileNum: number)` to `debug.ts` — sets player position and
   centers camera.
3. Add `crawlerMode(on: boolean)` to `debug.ts` — sets Config flags to silence
   noise.
4. Write `waitFor(pred, timeoutMs)` as a local helper in the crawler module.

### Phase 1 — Map Scanner

5. Write `listTalkableNPCs(): Critter[]` — filters `gMap.getObjects()` for
   critters with `_script.talk_p_proc`, excluding dead, player, and
   wrong-elevation objects.
6. Write `listHostileCritters(): Critter[]` — same filter but for critters
   with a valid `aiNum` and no `talk_p_proc` (or explicitly flagged hostile).

### Phase 2 — NPC Dialogue Crawler

7. Implement the dialogue crawl loop: for each NPC, move player adjacent,
   call `Scripting.talk`, poll for `UIMode.dialogue`, drain options, verify
   `UIMode.none`.
8. Add structured logging to the crawler report format.
9. Handle barter-mode exit, combat-triggered NPCs, and looping dialogues.

### Phase 3 — Combat Crawler

10. Implement the combat crawl loop: for each target critter, move player
    adjacent, call `Combat.start()`, wait for player turn, call `nextTurn()`,
    poll for AI completion, call `forceEnd()`.
11. Add structured logging.
12. Handle `combatActive` re-entry delay, critter death, and bail-out
    detection.

### Phase 4 — Report Output

13. Implement JSON report serialization and download (reuse
    `exportEventLog`'s Blob-URL pattern).
14. Add a summary to the browser console: N NPCs tested, M stuck, K
    combat-triggered, etc.

---

## 8. Reference Points in fallout2-ce

- `src/game/dialog.cc` — `gDialogSayMessage`, `gDialogEnter`, `gDialogExit`:
  confirms the halt/resume pattern implemented in `gsay_end` / `dialogueExit`.
- `src/game/combat.cc` — `_combat`, `_combat_turn`, `_combat_input`:
  confirms the turn-based loop where player input is polled between turns;
  our `nextTurn()` maps to `_combat_turn_run`.
