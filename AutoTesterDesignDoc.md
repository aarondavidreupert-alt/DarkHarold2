# DarkHarold2 — Automated Game Tester Design Document

## 1. Motivation

DarkHarold2 has no automated tests. All verification is manual: load the game
in a browser, walk around, click things, eyeball the result. This doesn't scale
— every combat tweak, scripting opcode, or UI change risks silent regressions.

This document lays out a phased roadmap to automated game testing, culminating
in an LLM-driven exploratory tester that can play the game, report bugs, and
verify quest logic end-to-end.

---

## 2. Current State & Existing Hooks

### What we can already reach

| Hook | Location | What it gives us |
|---|---|---|
| `globalState` | `src/globalState.ts`, on `window` | Player, map, combat, UI mode, inventory, dialogue state |
| `Config` | `src/config.ts`, on `window` | Debug flags, engine toggles |
| `heart` | `src/heart.ts`, on `window` | Frame loop, input injection (`keydown`, `mousepressed`, `mousemoved`) |
| `debug.*` | `src/debug.ts` | `teleport(map)`, `addXP()`, `setHP()`, `giveItem(pid)`, `combatLog()` |
| `gMap` | `globalState.gMap` | `loadMap()`, `getObjects()`, `objectsAtPosition()`, `critterAtPosition()` |
| Map events | `loadMapPre` / `loadMapPost` | Know when a map transition completes |
| Scripting | `src/scripting.ts` | `Scripting.talk()`, `Scripting.reenterDialogue()`, timed events |

### What's missing

- **No programmatic step function** — the 10 Hz game tick runs on a timer, can't
  be advanced on demand.
- **No headless mode** — WebGL canvas always renders; need a real browser context.
- **No test API surface** — no `window.__test` namespace for harness communication.
- **No quest/objective tracking** — scripts drive quest state but there's no
  queryable quest log.
- **No deterministic replay** — no input recording or seeded RNG.

---

## 3. Architecture Overview

```
 ┌─────────────────────────────────────────────────────┐
 │                  Test Runner (Node.js)               │
 │  ┌───────────┐  ┌────────────┐  ┌────────────────┐  │
 │  │ Playwright │  │ Assertions │  │ LLM Agent      │  │
 │  │ Browser    │  │ Library    │  │ (Phase 4)      │  │
 │  └─────┬─────┘  └─────┬──────┘  └───────┬────────┘  │
 │        │              │                  │           │
 │        ▼              ▼                  ▼           │
 │   page.evaluate() ← shared __test API → screenshot  │
 └────────────────────────┬────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │   play.html + engine  │
              │   window.__test       │
              │   globalState / gMap  │
              │   heart (input sim)   │
              └───────────────────────┘
```

---

## 4. Phased Roadmap

### Phase 1: Test Bridge (`window.__test` API)

**Goal:** Expose a stable API surface the test harness can call via
`page.evaluate()`.

**New file: `src/test_bridge.ts`** — loaded only when `Config.engine.debug`
is true.

```typescript
interface TestBridge {
  // --- State queries ---
  getPlayer(): {
    x: number; y: number; elevation: number;
    hp: number; maxHp: number;
    ap: number; maxAp: number;
    inventory: { pid: number; name: string; amount: number }[];
  };
  getMap(): { name: string; elevation: number; numObjects: number };
  getUIMode(): string;            // "none" | "inventory" | "dialogue" | "barter" | "combat" ...
  getCombatState(): { active: boolean; turn: number; whoseTurn: string } | null;
  getDialogueState(): { npcName: string; options: string[] } | null;
  getEventLog(last?: number): string[];

  // --- State mutations ---
  teleport(mapName: string, x?: number, y?: number): Promise<void>;
  giveItem(pid: number, amount?: number): void;
  setHP(hp: number): void;
  setStat(stat: string, value: number): void;
  setGVar(id: number, value: number): void;

  // --- Input simulation ---
  click(x: number, y: number): void;
  rightClick(x: number, y: number): void;
  pressKey(key: string): void;
  walkToHex(hex: number): Promise<void>;

  // --- Engine control ---
  step(ticks?: number): Promise<void>;    // advance N game ticks (default 1)
  waitForMapLoad(): Promise<string>;      // resolves with map name
  waitForCombatEnd(): Promise<void>;
  waitForDialogue(): Promise<void>;
  screenshot(): string;                   // returns data URL of canvas

  // --- Assertions (convenience) ---
  assertPlayerAt(mapName: string, x?: number, y?: number): void;
  assertHasItem(pid: number, minAmount?: number): void;
  assertUIMode(mode: string): void;
  assertGVar(id: number, expected: number): void;
}
```

**Implementation notes:**
- `step()` pauses `heart`'s normal timer, manually calls `heart.update()` N
  times with synthetic dt, then resumes. This is the single most important
  addition — it makes tests deterministic.
- `waitFor*()` methods return Promises that resolve by polling state every tick.
- `screenshot()` calls `canvas.toDataURL()` on the WebGL canvas.

**Deliverables:**
- [ ] `src/test_bridge.ts` implementing the interface above
- [ ] Conditional init in `src/main.ts`: `if (Config.engine.debug) initTestBridge()`
- [ ] `window.__test` typed declaration in a `.d.ts`

---

### Phase 2: Playwright Harness & Unit-Level Scenarios

**Goal:** Run deterministic scenario tests from Node.js via Playwright.

**New directory: `tests/`**

```
tests/
  harness.ts          — Playwright setup, loads play.html, waits for init
  helpers.ts          — wrappers: t.step(), t.getPlayer(), t.assertHasItem()
  scenarios/
    smoke.test.ts     — game boots, player exists, HP > 0
    movement.test.ts  — walkToHex, verify position changed
    combat.test.ts    — teleport to hostile map, verify combat triggers
    inventory.test.ts — giveItem, open inventory, verify item visible
    dialogue.test.ts  — talk to NPC, select option, verify GVAR set
    barter.test.ts    — enter barter, move item, verify offer
    save_load.test.ts — save state, modify, load, verify restoration
    movemult.test.ts  — open qty dialog on stack, verify drum counter
```

**Harness lifecycle:**
1. `beforeAll`: Launch Playwright Chromium (headless, `--use-gl=angle` for
   WebGL), navigate to `play.html`, wait for `window.__test` to exist.
2. Each test: `teleport()` to a known map, set up state, run scenario,
   assert outcomes.
3. `afterAll`: Close browser.

**Test runner:** Vitest or plain Node test runner (`node --test`). No heavy
framework needed — Playwright does the heavy lifting.

**Deliverables:**
- [ ] `tests/harness.ts` with Playwright lifecycle
- [ ] `tests/helpers.ts` wrapping `page.evaluate()`
- [ ] 8+ scenario files covering core systems
- [ ] `package.json` script: `"test": "npx playwright test tests/"`
- [ ] CI note: needs a pre-extracted asset set or a minimal fixture set

---

### Phase 3: Regression & Visual Snapshot Testing

**Goal:** Catch rendering regressions and UI layout breakage.

**Approach:**
- After each scenario reaches a known state, call `screenshot()` and compare
  against a golden baseline using pixelmatch or Playwright's built-in
  `expect(page).toHaveScreenshot()`.
- Store baselines in `tests/snapshots/` (git-tracked).
- Tolerate small diffs (anti-aliasing, font rendering) with a pixel threshold.

**Key snapshots:**
- HUD bar with weapon equipped
- Inventory panel open with items
- Movemult quantity dialog
- Dialogue screen with NPC
- Barter screen with items on both sides
- Character sheet
- World map with known areas revealed
- Combat: player's turn, action points visible

**Deliverables:**
- [ ] Snapshot capture in each scenario test
- [ ] `tests/snapshots/` baseline directory
- [ ] Pixel-diff threshold configuration
- [ ] Update script: `"test:update-snapshots"`

---

### Phase 4: LLM-Driven Exploratory Tester

**Goal:** Let an LLM play the game, discover bugs, verify quest sequences,
and test paths no human wrote a script for.

#### 4a. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    LLM Test Agent                         │
│                                                          │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │ Planner  │──▶│ Action Queue │──▶│ Executor         │ │
│  │ (LLM)    │   │              │   │ (calls __test)   │ │
│  └────▲─────┘   └──────────────┘   └────────┬─────────┘ │
│       │                                      │           │
│       │         ┌──────────────┐             │           │
│       └─────────│ Observer     │◀────────────┘           │
│                 │ (state diff) │                          │
│                 └──────────────┘                          │
└──────────────────────────────────────────────────────────┘
```

**Components:**

1. **Observer** — after every action, snapshots game state (player stats,
   position, inventory, UI mode, event log, combat state) and computes a
   diff from the previous snapshot. Also captures a screenshot.

2. **Planner (LLM)** — receives the state diff, screenshot, and a text
   description of the current situation. Decides the next action(s). Uses a
   system prompt describing the game mechanics, available actions, and current
   test objective.

3. **Action Queue** — the LLM's output is parsed into a sequence of
   `__test` API calls (walk, click, use item, select dialogue option, etc.).

4. **Executor** — runs each action via Playwright `page.evaluate()`, waits
   for completion, hands results back to the Observer.

#### 4b. LLM Action Space

The LLM chooses from a constrained action set (tool-use style):

```typescript
type LLMAction =
  | { action: "walk_to"; hex: number }
  | { action: "use_object"; objectId: number }
  | { action: "talk_to"; objectId: number }
  | { action: "select_dialogue"; optionIndex: number }
  | { action: "use_item"; pid: number; target?: number }
  | { action: "open_inventory" }
  | { action: "equip_item"; pid: number; slot: "leftHand" | "rightHand" | "armor" }
  | { action: "attack"; targetId: number }
  | { action: "end_combat_turn" }
  | { action: "barter_move"; itemPid: number; direction: "offer" | "retract" }
  | { action: "barter_confirm" }
  | { action: "pick_quantity"; amount: number }    // movemult dialog
  | { action: "travel_worldmap"; areaId: number }
  | { action: "save_game"; slot: number }
  | { action: "load_game"; slot: number }
  | { action: "wait"; ticks: number }
  | { action: "screenshot" }                       // request visual inspection
```

#### 4c. Test Modes

| Mode | Description | LLM Prompt Strategy |
|---|---|---|
| **Free Explore** | Wander, interact with everything, report anomalies | "Explore this map. Try every door, container, NPC. Report anything that looks broken." |
| **Quest Playthrough** | Follow a specific quest line | "Complete the quest: [description]. Expected steps: [list]. Report deviations." |
| **Stress Test** | Deliberately try to break things | "Try to break the game. Stack overflow inventories, walk into walls, spam dialogue, interrupt combat." |
| **Regression Guard** | Replay a recorded action sequence, verify same outcomes | "Execute this sequence and verify each checkpoint matches expected state." |
| **Combat Drill** | Fight specific encounters, evaluate balance | "Fight [enemies] using [loadout]. Report: did you win? How many stimpaks used? Any animation glitches?" |

#### 4d. Bug Detection Heuristics

The LLM doesn't just play — it watches for:

- **Stuck states**: player can't move, UI won't close, dialogue has no options
- **State inconsistencies**: HP > maxHP, negative inventory amounts, combat
  active but no enemies
- **Visual anomalies**: screenshot shows black screen, UI elements overlapping,
  missing sprites (via image comparison or LLM vision)
- **Script errors**: `console.error` / `console.warn` captured by Playwright
- **Performance**: frame time spikes (heart.ts timing data)
- **Unreachable content**: doors that don't open, NPCs that don't respond,
  containers that can't be looted

#### 4e. Output Format

Each test session produces:

```
test-results/
  session-2026-05-27T14-30/
    report.json          — structured bug reports
    timeline.json        — action log with timestamps and state diffs
    screenshots/         — numbered PNGs at each observation step
    console.log          — captured browser console output
    summary.md           — LLM-written human-readable summary
```

**Bug report schema:**
```json
{
  "id": "BUG-042",
  "severity": "medium",
  "category": "stuck_state",
  "map": "arroyo_village",
  "position": { "x": 120, "y": 85 },
  "description": "After talking to Mynoc and selecting option 3, dialogue closes but player cannot move. UIMode stuck on 'dialogue'.",
  "reproduction": ["teleport('arroyo_village')", "talk_to(mynoc)", "select_dialogue(3)"],
  "screenshot": "screenshots/step-047.png",
  "state_dump": { "uiMode": "dialogue", "combatActive": false }
}
```

#### 4f. Implementation Plan

| Step | Work | Depends On |
|---|---|---|
| 4f-1 | Observer module: state snapshot + diff | Phase 1 (test bridge) |
| 4f-2 | Action executor with error handling | Phase 2 (harness) |
| 4f-3 | LLM integration (Claude API, tool_use) | 4f-1, 4f-2 |
| 4f-4 | Free Explore mode | 4f-3 |
| 4f-5 | Quest Playthrough mode | 4f-4 + quest data files |
| 4f-6 | Bug report generator | 4f-4 |
| 4f-7 | Stress Test mode | 4f-4 |
| 4f-8 | CI integration (nightly LLM test runs) | All above |

---

## 5. Minimal Asset Fixtures

Tests need game assets but the full Fallout 2 data set is copyrighted and
can't be committed. Solution:

- **Fixture maps**: hand-craft 2-3 tiny test maps (JSON) with known object
  placements. Store in `tests/fixtures/maps/`.
- **Fixture protos**: minimal proto JSON for a few items (stimpak, 10mm pistol,
  bottle caps, leather armor). Store in `tests/fixtures/proto/`.
- **Fixture art**: 1x1 px placeholder PNGs for required FIDs. The renderer
  won't look pretty but it'll run.
- **Test config**: `tests/fixtures/test_config.json` pointing asset paths at
  the fixture directory.

This gives us a self-contained test environment that runs in CI without
copyrighted data.

---

## 6. Rough Effort Estimates

| Phase | Effort | Priority |
|---|---|---|
| **Phase 1**: Test Bridge | 2-3 days | High — everything depends on this |
| **Phase 2**: Playwright Harness + Scenarios | 3-5 days | High |
| **Phase 3**: Visual Snapshots | 1-2 days | Medium |
| **Phase 4a-4c**: LLM Agent (core) | 5-7 days | Medium |
| **Phase 4d-4f**: Bug detection + reporting | 3-4 days | Medium |
| **Fixture maps** | 1-2 days | High (needed for Phase 2) |
| **CI integration** | 1 day | Low (after everything works locally) |

**Total: ~16-24 days of focused work.**

---

## 7. Technology Choices

| Component | Choice | Rationale |
|---|---|---|
| Browser automation | **Playwright** | Built-in Chromium with WebGL, screenshot comparison, good TypeScript support |
| Test runner | **Vitest** or `node --test` | Lightweight, no config overhead |
| LLM | **Claude API** (tool_use) | Structured action output via tool_use, vision for screenshots |
| Screenshot diff | **pixelmatch** or Playwright built-in | Industry standard, sub-pixel tolerance |
| CI | **GitHub Actions** | Already hosted on GitHub; Playwright has official GH Action |

---

## 8. Open Questions

1. **Deterministic RNG** — should we seed `Math.random()` for reproducible
   combat rolls? (Probably yes for Phase 2, not needed for Phase 4.)
2. **Animation waiting** — many actions trigger animations. How long should
   `step()` wait? Need a "wait for idle" primitive that detects when all
   animations and walk paths have completed.
3. **Script execution visibility** — can we hook into the VM to log which
   opcodes fire during a test? Would help debug quest logic failures.
4. **Cost control for LLM testing** — a single free-explore session could
   generate hundreds of API calls. Need token budgets and session time limits.
5. **Multi-elevation testing** — some maps have 3 elevations. Does the test
   bridge need elevation-aware position queries? (Yes.)
