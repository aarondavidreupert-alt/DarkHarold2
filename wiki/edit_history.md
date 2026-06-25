# DarkHarold2 — Edit History

Session notes summarising what changed in each development sprint.
Ordered newest-first. Each entry covers one or more consecutive git sessions with a common theme.

---

## 2026-06-25 — Movemult picker, armor guard, drop-to-ground fix

**IDs closed:** P23 (FIXED 2026-06-24), P24 (FIXED 2026-06-25)

**Summary:**

- **P23 — Movemult dialog CE-accurate** (`src/ui_barter/swap.ts`): Rewrote the quantity-select
  modal to use `movemult.png` (FRM 305, 259×162) as the background, a canvas-rendered 5-digit
  BIGNUM counter (FRM 170, 14×24 px glyphs), item icon drawn aspect-ratio-preserving into the
  left panel slot, and correct click zones for Plus/Minus/Done/Cancel per
  `inventory.cc:5743 inventoryQuantityWindowInit`.

- **P24 — Three movemult follow-up bugs** (`src/ui_barter/swap.ts`, `src/ui_inventory/dragdrop.ts`):
  - Done/Cancel hit zones were too wide and overlapping; corrected to cover full text+dot area
    (Done x=5 w=120, Cancel x=133 w=122) per CE's actual button dot positions.
  - ALL button (120,80) 94×33 from `inventory.cc:5929` was missing a hit zone; wired to set count
    to max, "ALL" text drawn in palette gold (`#FCFC7C`).
  - Armor inventory slot accepted any item subtype; guard added in `dragdrop.ts:uiMoveSlot`:
    `if (target === 'armor' && obj.subtype !== 'armor') return`.

**Files changed:** `src/ui_barter/swap.ts`, `src/ui_inventory/dragdrop.ts`

---

## 2026-06-23–24 — Dialogue review window, dialogue highlights, barter portraits

**IDs closed:** P17 (ADDED), P18 (FIXED), P22 (FIXED), P21 (partial)

**Summary:**

- **P17/P18 — Dialogue review window** (`src/ui_dialogue_review.ts`, new): CE-accurate review log
  records every `gsay_reply`/`gsay_message` line and the player's chosen reply; modal opens via
  `#dialogueReviewButton` (di_rest1/di_rest2 FRMs, 13,154). Done button 82×46 di_done1/di_done2;
  scroll arrows di_bgup1/di_bgdn1; mounted inside `#uiStage` at (80,20) matching `#dialogueContainer`
  coordinates. Log resets on fresh `start_gdialog` only; reset-on-reenter was incorrect.

- **P22 — Dialogue highlight overlay** (`tools/export_mask_frms.py`, new): `hilight1.png` (white
  lightening at 426,15) and `hilight2.png` (warm amber at 129,81) composited over `#dialogueContainer`
  as permanent `<img>` children, matching CE `gameDialogRenderHighlight` (`game_dialog.cc:4526-4546`).
  `egg.png` also re-exported with correct gradient encoding. WebGL texture cache-busted via
  `?v=20260623b` in `src/render/webglContext.ts`.

- **P21 — Barter body-view portraits** (partial): CE research completed. Implementation deferred;
  canvas-based sprite extractor still needed.

---

## 2026-06-21–22 — Companion dialogue state machine overhaul

**IDs closed:** P6, P7, P8, P9, P10, P11, P12, P13, P14, P15, P16, P17 stub, P19, P20

**Summary:**

Major dialogue/companion plumbing sprint fixing a cascade of state-machine bugs surfaced by the
2026-06-18 companion screens:

- **Dialogue re-entry** (`scripting.ts:268-283`): `dialogueReply()` now exits early for any
  non-dialogue UIMode (not just barter), preventing `currentDialogueObject = null` while
  Control/Trade screens are open.
- **Double-animate on re-entry** (`ui_dialogue.ts:58`): `uiStartDialogue()` is now idempotent —
  skips reset+re-animate when `#dialogueBox` is already visible.
- **Barter→Talk return** (`ui_barter/screen.ts`, `ui_companion_trade.ts`): both now call
  `Scripting.reenterDialogue()` after restoring `#dialogueBox`, rebuilding the option list.
- **Companion/vendor barter branching** (`scripting.ts gsay_end`): `[Barter]` injected option
  branches on `isPartyMember(npc)` to call `uiCompanionTrade()` vs `uiBarterMode()`.
- **Real fixed-position buttons** (`play.html`, `ui_dialogue.ts`): `#dialogueBarterButton` and
  `#dialogueCombatControlButton` replace old synthesized text options; wired via
  `setupDialogueActionButtons()` called on every `uiStartDialogue()`.
- **Walk-before-talk** (`src/input.ts`, `ui_contextmenu.ts`): both Talk paths now wrap the call in
  `walkInFrontOf(critter.position, ...)` matching CE `actionTalk` walk-to-target distance check.
- **Barter body portrait backgrounds** (`ui_barter/screen.ts`, `ui_companion_trade.ts`): vendor
  uses `barter.png` (FRM 111), companion uses `trade.png` (FRM 420).
- **Barter scroll buttons** (P19/P20): outer-inventory arrows at CE (+80 offset) corrected positions
  (x=189/422); offer-table arrows added at (x=208/413). `invupout`/`invdnout`/`invupin`/`invdnin`
  art (FRM 49-52) for offer table.
- **Caps readout** (`#dialogueCapsDisplay`, P16): `updateDialogueCaps()` sums PID 41 inventory.
- **Rejection messages** (P13): `uiSetDialogueReply()` called from both offer() paths with
  `inventry.msg` strings 28/31/32.

---

## 2026-06-18 — Companion screens, egg refinements, outline system, map crash fix

**IDs closed:** CI11, CI12, CI13, CI14, CI15, M5, P5 (corrected), RD16 (refined)

**Summary:**

- **CI11 — Combat outlines implemented** (`src/render/webglDraw.ts`, `shaders/fragment.glsl`):
  `u_outlineMode`/`u_outlineColor` shader uniforms; `renderOutlinePass()` stamps each outlined
  object's silhouette at 4 cardinal offsets; called after `renderRoof()`.
- **CI12 — Item highlight CE-accurate** (`src/input.ts`): hover-tracking in `mousemoved` sets
  persistent `obj.outline = 'yellow'` on hovered items; Spacebar sweep gets its own runtime-only
  `highlightItemsKeyHeld` flag.
- **CI13/CI14 — Fill/border alpha independent** (`webglDraw.ts`): three-layer draw (border stamps
  → normal-sprite punch-out → fill stamp) makes the two alpha values genuinely independent.
- **CI15 — Neutral critter blue outline** (`Combat.refreshHighlights()`): single classification
  pass over all live critters; hostile=red, same-team=green, else=blue.
- **M5 — Missing main map JSON handled** (`src/map/mapLoader.ts`): `loadNewMap` now wraps the
  main JSON fetch in try/catch, resets `isLoading=false` and shows `showAlert()` on parse error.
- **P5 corrected** (`src/input.ts`, `ui_contextmenu.ts`): Talk no longer bypasses `talk_p_proc`;
  companion `[Combat Control]` injected as dialogue option in `gsay_end()`.
- **RD16 egg fixes** (`src/render/webglDraw.ts`, `tools/proto.py`): `extendedFlags` parsed for
  walls and scenery; `isCEOccludingWall()` implements all 4 CE branch cases; `'alpha'` mode
  switched to `hexDistance` radial check for symmetric transparency.

---

## 2026-06-15 — Worldmap pan, Pip-Boy rest, roof clipping, egg transparency

**IDs closed:** W11, W12, IW10, IW11, RD06, RD16 (initial)

**Summary:**

- **W11/W12** — Worldmap label list CE-accurate filter+sort; `#worldmap` panned via
  `transform: translate` with arrow/WASD/mouse-edge input and player auto-track during travel.
- **IW10/IW11** — Pip-Boy month sprite stride corrected (15 px); alarm button position corrected;
  rest/wait menu renders inside `#pipboyScreen` with all 13 CE options.
- **RD06** — Per-building roof clipping via `roofFloodFill` BFS each frame from player tile.
- **RD16** — Egg transparency initial implementation; `egg.png` sourced from jsFO, alpha-channel
  sampling. Subsequent fixes 2026-06-17/18 refined the per-wall CE branch and `'alpha'` mode.

---

## 2026-06-11–13 — HUD/preferences audit, interface gaps

**IDs closed:** CI3, CI6, CI8, CI9, CI10, IW1 (updated), IW3, IW9

**Summary:**

- Preferences panel: `combatSpeed` range 0–50, `speechVolume` wired, `text_base_delay` slider,
  `player_speedup` checkbox; `target_highlight` full 3-state enum; `item_highlight` persisted.
- IW3: weapon mode cycle `single → called → burst → reload`; called mode auto-opens
  `uiCalledShot()`.
- IW9: inventory AP deduction on combat open (`4 - 2×quickPocketsRank`).
- AF audit findings documented in ROADMAP.md.

---

## 2026-06-03–04 — Animation pipeline fixes, Phase 3/4/5/8/9 sprint

**IDs closed:** FA2, FA7, FA8, FA9, FA10, FA11, FA12, C8, C13, T1, U3, S2, S3, S5, S11,
EL3, RD09, RD11, RD12, FA4, LE1, LE4, LE6, LE7, LE11, IW1, IW2, IW4, IW7, P3 (partial),
P4 (partial), P5/P6/P7 pathfinding, CI4, CI7, CI8

**Summary:**

36-item sprint closing Phases 3–5, 8c/e, and 9a/b/d/f. Key fixes: `artOffset` zero-jump model
(FA7), walk-cycle symmetry (FA10), animation start timing (FA9/FA11), weapon-draw drift (FA12),
carry-weight enforcement (LE1), ammo stack identity (LE4), depth sort (RD09), scroll blocking
(RD11/RD12), wander radius types (C8), STAY_CLOSE (C13), save thumbnails (U3).

---

## 2026-06-02 — Major scripting/combat/map sprint (36 closures)

**IDs closed:** S1–S13, S21–S25, C1–C7, C9, C11–C12, M0, M0b, M1, M3, M4, W1–W7, K1, K3,
K5, D1–D3, P1, R1, Q1–Q4, GTC1–GTC9, EL0–EL2, EL5, TS1–TS4, RN1, RN2, RN4, LE2, LE3,
LE8, IU1–IU4, IW5, AU1, EG6, PS1, PS5, FA0–FA1, FA5, GTC3, GTC4, GTC6, GTC7, GTC8,
AC1, AC7

**Summary:**

Foundational sprint connecting script hooks, wiring 40+ opcodes, fixing combat formulas (YAAM,
crit breakpoints, Sniper d10), repairing map crash bugs (M0/M0b), save/load completeness
(MVARs, knownAreas, timed events), and closing most of the June roadmap Phase 1/2/3 items.
<!-- audited: 2026-06-25 -->
