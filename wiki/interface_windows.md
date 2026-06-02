# Interface Windows — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/interface.cc` / `interface.h` (`interfaceInit`, `InterfaceItemState`, `indicatorBar*`), `raw/fallout2-ce/src/game_dialog.cc`  
> DH2 impl: `src/ui_panels.ts` (`UIMode`, mutual exclusion), `src/ui_components.ts` (`WindowFrame`, `SmallButton`, `Label`, `List`), `src/ui_hud.ts` (HUD bar), `src/ui.ts` (init, button wiring), and the per-window modules below

---

## 1. Architecture Overview

### CE Window Manager

CE uses a Win32-style software-rendered window manager (`window_manager.cc`):
- `windowCreate(x, y, w, h, color, flags)` → win ID
- `buttonCreate(win, x, y, w, h, ...)` → button ID with hotkey binding
- Pixel buffers blitted into each window; windows have Z-order
- `gInterfaceBarWindow` holds the main HUD bar's win ID

Key HUD constants (`interface.h`):
```c
#define INTERFACE_BAR_WIDTH   640
#define INTERFACE_BAR_HEIGHT  100
#define INDICATOR_BOX_WIDTH   130
#define INDICATOR_BOX_HEIGHT   21
```

### DH2 DOM Layer

DH2 replaces CE's window manager with HTML/CSS:
- Each panel is one or more DOM elements positioned absolutely over the canvas
- `#uiStage` (or `#game-container`) is the mount point for floating panels
- `UIMode` enum (owned by `ui_panels.ts`) enforces mutual exclusion — at most one major panel is open at a time
- `WindowFrame` class (`ui_components.ts`) is the DH2 equivalent of a CE `windowCreate` call

---

## 2. UIMode Enum (`ui_panels.ts:31`)

```typescript
export enum UIMode {
    none             = 0,
    dialogue         = 1,
    barter           = 2,
    loot             = 3,
    inventory        = 4,
    worldMap         = 5,
    elevator         = 6,
    calledShot       = 7,
    skilldex         = 8,
    useSkill         = 9,
    contextMenu      = 10,
    saveLoad         = 11,
    char             = 12,
    pipBoy           = 13,
    automap          = 14,
    options          = 15,
    mainMenu         = 16,
    characterCreator = 17,
}
```

`globalState.uiMode` is set by the open function of each panel and cleared (→ `UIMode.none`) by its close function.

---

## 3. Panel Inventory

| UIMode | Source file | Open function | Close / Done |
|--------|-------------|---------------|--------------|
| `none` | — | — | — |
| `dialogue` | `ui_dialogue.ts` | `uiStartDialogue(force, target?)` | `uiEndDialogue()` |
| `barter` | `ui_barter.ts` | `uiBarterMode(merchant)` | `uiEndBarterMode()` (internal) |
| `loot` | `ui_loot.ts` | `uiLoot(object)` | `uiEndLoot()` via Done button |
| `inventory` | `ui_inventory.ts` | `showInventory()` | `closeInventory()` |
| `worldMap` | `ui_worldmap.ts` | `uiWorldMap(onAreaMap?)` | `uiCloseWorldMap()` |
| `elevator` | `ui_elevator.ts` | `uiElevator(elevator)` | `uiElevatorDone()` on floor select |
| `calledShot` | `ui_calledshot.ts` | `uiCalledShot(art, target, cb?)` | `uiCloseCalledShot()` |
| `skilldex` | `ui_skilldex.ts` | `showSkilldex()` | `closeSkilldex()` |
| `useSkill` | `ui_skilldex.ts` | set internally after skill click | — |
| `contextMenu` | `ui_contextmenu.ts` | `uiContextMenu(obj, evt)` | `uiHideContextMenu()` |
| `saveLoad` | `ui_saveload.ts` | `uiSaveLoad(isSave)` | `done()` (internal) |
| `char` | `ui_character.ts` | `showCharacterScreen()` | `closeCharacterScreen()` |
| `pipBoy` | `ui_pipboy.ts` | `openPipBoy()` | `closePipBoy()` |
| `automap` | `ui_automap.ts` | `openAutomap()` | `closeAutomap()` |
| `options` | `ui_options.ts` | `showOptionsMenu()` | `closeOptionsMenu()` |
| `mainMenu` | `ui_mainmenu.ts` | `showMainMenu()` | `hideMainMenu()` |
| `characterCreator` | `ui_charactercreator.ts` | `initCharacterCreator()` | via onDone/onCancel callbacks |

---

## 4. HUD Bar (`ui_hud.ts`)

The always-visible bottom bar. DH2 equivalent of CE's `gInterfaceBarWindow`.

### 4.1 Stat Readouts

```typescript
drawHP(hp: number): void         // 3-digit readout, element id-prefix 'hp'
drawAC(ac: number): void         // 3-digit readout, element id-prefix 'ac'
drawAP(current, max, freeMove, isPlayerTurn): void  // AP dots / numbers
drawDigits(idPrefix, amount, maxDigits, hasSign): void  // generic digit sprite renderer
```

Digits are rendered as CSS background-position offsets on a sprite strip (9px per character, character 12 = negative sign).

### 4.2 Weapon Display

```typescript
uiDrawWeapon(): void           // draws active weapon art + ammo bar; calls uiUpdateAmmoBar
uiUpdateAmmoBar(weapon | null) // fills #ammoBarFill element proportionally to rounds/maxAmmo
```

Weapon image: loaded from `weapon.getSkin()` + `.png`. Unarmed displays current punch/kick mode name via `getActivePunchMode` / `getActiveKickMode`.

### 4.3 Combat State

```typescript
uiStartCombat(): void          // shows End Turn + End Combat buttons; redraws HP, AC, AP
uiEndCombat(): void            // hides End Turn + End Combat; CSS animation plays
uiEndCombatAnimationDone()     // called on 'animationiteration' event to finish cleanup
uiShowCombatHover(target, x, y) // shows HP/AC/name tooltip near cursor
uiHideCombatHover()
```

### 4.4 Message Log

```typescript
uiLog(msg: string): void       // appends line to #displayLog
initLogScrollZones()           // sets up wheel-scroll handlers on the log element
```

### 4.5 HUD Button Wiring (`ui.ts:110`)

Buttons are wired in `uiInit()` / `initUI()`:

| Button element | CE hotkey | DH2 key (config.ts) | Action |
|----------------|-----------|---------------------|--------|
| `inventoryButton` / 'b' key | KEY_LOWERCASE_I | `controls.inventory = 'b'` | Toggle inventory screen |
| `optionsButton` | KEY_LOWERCASE_O | click only | Toggle options menu |
| `skilldexButton` | KEY_LOWERCASE_S | click + `showSkilldex()` | Toggle skilldex |
| `mapButton` (automap) | KEY_TAB | automap module | Toggle local automap |
| `pipboyButton` | KEY_LOWERCASE_P | `controls.pipboy = 'p'` | Toggle Pip-Boy |
| `characterButton` | KEY_LOWERCASE_C | click | Toggle character screen |
| `handSwapButton` | KEY_LOWERCASE_B | click | Swap active hand; play swap anim |
| `attackButtonContainer` (left-click) | left mouse attack | `controls.attack = 'g'` | Start combat / attack; unarmed: cycle mode |
| `attackButtonContainer` (right-click) | right-click cycle | — | Cycle weapon mode; unarmed: open mode picker |
| `endTurnButton` | — | `combat.nextTurn()` | End player combat turn |
| `endCombatButton` | — | `combat.end()` | End combat entirely |

Reload is handled inside the `attackButtonContainer` click: if `weapon.mode === 'reload'`, loads ammo from inventory (AP cost hardcoded to 2; TODO comment in `ui.ts:323` to read from PRO `reloadAP`).

---

## 5. WindowFrame — Base Panel Component (`ui_components.ts:24`)

```typescript
class WindowFrame {
    constructor(background: string, position: Point, width: number, height: number, children?: Widget[])
    show(): this       // appends elem to getUiContainer(); sets showing = true
    close(): void      // removes from DOM; sets showing = false
    toggle(): this     // show if hidden, close if showing
    add(widget: Widget): this  // adds a child Widget
    showing: boolean
    elem: HTMLElement
}
```

`background` is a path to a PNG art file used as the CSS `background-image` (usually from `art/intrface/`). CE equivalent: pixel-buffer window with a background FRM image blitted in.

Used by: character screen, skilldex, options panel.

Loot, barter, dialogue, and inventory panels use static HTML elements (hidden/shown via `visibility`) rather than `WindowFrame` — they were built before the `WindowFrame` abstraction existed.

---

## 6. Mutual Exclusion (`ui_panels.ts`)

```typescript
export function closeAllPanels(): void {
    if (isPipBoyOpen()) closePipBoy()
    if (isAutomapOpen()) closeAutomap()
    if (charW && charW.showing) charW.close()
    if (isInventoryOpen()) closeInventoryPanel()
    if (skillW && skillW.showing) skillW.close()
    if (optsW && optsW.showing) optsW.close()
}
```

`closeAllPanels()` is called by every panel-open path before opening its own panel (except dialogue and barter, which run as modal overlays). PipBoy and automap are independently close-able.

Panel visibility getters use lazy registration: each module calls `registerCharacterWindow/registerSkilldexWindow/registerOptionsWindow` at init time, breaking the circular import `ui_panels → ui_character → ui_components → ui_panels`.

---

## 7. Context Menu (`ui_contextmenu.ts:87`)

Right-click on any map object opens a context menu positioned at the cursor:

```
Living critter:   [Talk] (if talk_p_proc)  [Use] (if canUse)  [Look] [Inventory] [Skill] [Cancel]
Dead critter:     [Look] [Loot]  [Inventory] [Skill] [Cancel]
Scenery/misc:     [Use] [Look]  [Inventory] [Skill] [Cancel]
Container (item): [Use] [Look]  [Inventory] [Skill] [Cancel]
Item on ground:   [Pickup] [Look]  [Inventory] [Skill] [Cancel]
Fallback:         [Look]  [Inventory] [Skill] [Cancel]
```

Buttons are absolute-positioned `<div>` elements inside `#itemContextMenu`. Coords are translated from viewport to `#uiStage` local space to account for the CSS `transform: translate(-50%, -50%)` centering.

CE equivalent: `_win_show_context_menu` in `worldmap.cc`/`proto_instance.cc`; DH2 menu is a custom implementation with no direct CE counterpart.

---

## 8. Pip-Boy (`ui_pipboy.ts`)

Three tabs: **STATUS** (derived stats, health), **AUTOMAPS** (per-map canvas renders), **ARCHIVES** (holodisk text).

Automap rendering in the AUTOMAPS tab delegates to `ui_automap.ts`:
- `createAutomapCanvas(opts)` — renders a WebGL-based tile map
- Pan per map/elevation stored in `getAutomapPan/setAutomapPan`
- Zoom level global: `ZOOM_MIN` / `ZOOM_MAX` / `ZOOM_STEP`

Wait buttons ("+10m", "+30m", "+1h", "+6h") call `advanceTime(minutes)` which adds game ticks and re-renders the time bar.

CE equivalent: `pipboy.cc:pipboyOpen/Close`; DH2 re-implements in DOM rather than pixel-buffer rendering.

---

## 9. CE Concepts Not Mapped to DH2

### 9.1 `InterfaceItemState` (CE)

CE tracks per-hand weapon state in:
```c
typedef struct InterfaceItemState {
    Object* item;
    int     isDisabled;       // greys out buttons when AP < weapon AP cost
    int     isWeapon;
    int     primaryHitMode;   // attack mode for primary fire (left-click)
    int     secondaryHitMode; // attack mode for secondary fire
    int     action;           // one of InterfaceItemAction enum values
} InterfaceItemState;
```

`InterfaceItemAction` enum:
```c
INTERFACE_ITEM_ACTION_DEFAULT        = -1
INTERFACE_ITEM_ACTION_USE            =  0
INTERFACE_ITEM_ACTION_PRIMARY        =  1
INTERFACE_ITEM_ACTION_PRIMARY_AIMING =  2   // → triggers called shot
INTERFACE_ITEM_ACTION_SECONDARY      =  3
INTERFACE_ITEM_ACTION_SECONDARY_AIMING = 4  // → triggers called shot
INTERFACE_ITEM_ACTION_RELOAD         =  5
```

DH2 tracks weapon mode as `weapon.mode` (string: `'single'` / `'burst'` / `'reload'`) and has no `isDisabled` state.

### 9.2 Indicator Bar (CE)

CE displays a bar of status badges above the main HUD when relevant conditions are active:

| Indicator | CE constant | Threshold |
|-----------|-------------|-----------|
| ADDICT | `INDICATOR_ADDICT` | drug addiction flag set |
| SNEAK | `INDICATOR_SNEAK` | sneak mode active |
| LEVEL UP | `INDICATOR_LEVEL` | unspent level-up point |
| POISONED | `INDICATOR_POISONED` | `poisonLevel > 0` |
| RADIATED | `INDICATOR_RADIATED` | radiation ≥ 65 |

Up to 6 indicators per `INDICATOR_SLOTS_COUNT`. Rendered in its own `gIndicatorBarWindow` above the main HUD. DH2 has no indicator bar.

---

## 10. Known Gaps vs CE

| # | Feature | CE Behavior | DH2 Status | Impact |
|---|---------|-------------|------------|--------|
| 1 | Indicator bar | 5 indicator types shown above HUD (ADDICT/SNEAK/LEVEL/POISONED/RADIATED) | MISSING — no indicator bar element or rendering | Player gets no HUD feedback for poison, radiation, sneak, addiction, or level-up pending |
| 2 | `InterfaceItemState.isDisabled` | Weapon buttons grey-out when player has insufficient AP for the attack | MISSING — DH2 does not grey the attack button | Player can click attack with 0 AP; engine silently rejects the attack |
| 3 | `InterfaceItemAction` aiming states | Right-click cycles through DEFAULT→USE→PRIMARY→PRIMARY_AIMING→SECONDARY→SECONDARY_AIMING→RELOAD; aiming states open the called-shot panel automatically | PARTIAL — DH2 only cycles `'single'`/`'burst'`/`'reload'`; called shot is opened via separate hotkey (`controls.calledShot = 'z'`) | Aiming modes are not linked to weapon action cycling |
| 4 | HUD bar hide/show | `interfaceBarHide/Show` + `gInterfaceBarMode` allow scripts/transitions to toggle the entire bar | MISSING — DH2 has no hide/show for the HUD element | Scripts calling `hide_window(IFACE_WIN)` have no effect |
| 5 | Active hand persistence in save | CE `interfaceSave` serializes `gInterfaceCurrentHand` | MISSING — DH2 save/load does not persist `player.activeHand` | Active hand always resets to default on load |
| 6 | AP readout animation | `interfaceRenderActionPoints(animate=true)` plays frame-by-frame AP loss/gain anim | MISSING — `drawAP` updates immediately, no animation | Minor visual fidelity gap |
| 7 | Reload AP cost from PRO | CE reads `reloadAP` from weapon PRO | STUB — DH2 `ui.ts:323` hardcodes `reloadAP = 2` | Reload AP cost incorrect for weapons with non-standard reload cost |
| 8 | Dialogue `_dialogue_state` machine | `game_dialog.cc` runs a multi-state machine with barter, trade, and other sub-modes reachable from dialogue | PARTIAL — DH2 transitions `UIMode.dialogue` → `UIMode.barter` manually; complex sub-mode transitions are not replicated | Dialogue-driven barter (`StartTrading`) works; other sub-mode transitions may not |
| 9 | Perk selection UI | CE `character_editor.cc` opens a perk-selection screen on level-up | STUB — `pendingPerkPick` flag exists in `player.ts`; no selection screen renders | Player cannot choose a perk on level-up; perk points accumulate silently |
| 10 | CE context menu via cursor mode | CE selects verb (look/talk/use/pickup) by cursor icon; right-click re-targets the verb | DH2 uses an inline menu with explicit buttons; no cursor verb system | Functional difference but no gameplay gap |
| 11 | Character editor in-game | CE allows stat/skill re-editing via options during character creation | DH2 `ui_charactercreator.ts` has limited re-entry support | Minor; only affects new game flow |
