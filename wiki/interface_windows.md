# Interface Windows — DarkHarold2 Reference

> Ground-truth: `raw/fallout2-ce/src/interface.cc` / `interface.h` (`interfaceInit`, `InterfaceItemState`, `indicatorBar*`), `raw/fallout2-ce/src/game_dialog.cc`, `raw/fallout2-ce/src/elevator.cc`, `raw/fallout2-ce/src/elevator.h`, `raw/fallout2-ce/src/skilldex.cc`
> DH2 impl: `src/ui_panels.ts` (`UIMode`, mutual exclusion), `src/ui_components.ts` (`WindowFrame`, `SmallButton`, `Label`, `List`), `src/ui_hud.ts` (HUD bar), `src/ui.ts` (init, button wiring), `src/ui_elevator.ts` (elevator panel), and the per-window modules below
> **Last audited:** 2026-06-13

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

### 4.5 Bitmap Font Rendering for UI (`src/ui/fontCore.ts`, `src/ui/foText.ts`)

DH2 UI uses AAF bitmap fonts via `FontRenderer` and the `FoText` wrapper. Key architectural facts:

**AAF sprite layout** (confirmed from `data/tools/fonts.py`):
- JSON `h` field = `cell_h` (the maximum glyph height for the font) for **all** glyphs — not the actual glyph pixel height.
- All glyphs are **top-aligned** in the sprite sheet: pixel data starts at row 0, empty rows are at the **bottom**.
- Actual rendered height must be computed by scanning the sprite pixels (`computeGlyphMetrics` in `fontCore.ts`).

**Baseline alignment algorithm** (`renderBitmapText`):
- `baselineH = actualH('A')` — use uppercase A as the baseline reference.
- Non-descender glyph (e.g., 'e', 'a'): `canvasY = baselineH - actualH` — pushed down so bottoms align.
- Descender glyph (e.g., 'g', 'p', where `actualH > baselineH`): `canvasY = 0` — body aligns with 'A', descender extends below.
- Canvas height = `baselineH + maxDescent` where `maxDescent = max(0, actualH - baselineH)` over all glyphs in the string.

**`FoText` class** (`src/ui/foText.ts`): standalone non-Widget wrapper. Exposes `.elem` (inline-block div), `.text`/`.color` setters, `.appendTo()`, and `.width`/`.height` getters. Use this (not `renderer.renderText()`) for pixel-accurate baseline alignment in positioned UI layouts.

**`FontRenderer.renderCanvas(text, color?)`**: canvas-based path; color applied via red-channel alpha compositing.

### 4.6 HUD Button Wiring (`ui.ts:110`)

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

Reload is handled inside the `attackButtonContainer` click: if `weapon.mode === 'reload'`, loads ammo from inventory. AP cost is computed by `weapon.getReloadAPCost()` (`src/critter/Weapon.ts:346`): returns 1 if weapon has perk 65 (Fast Reload), 0 for Solar Scorcher (PID 390), otherwise 2 — matching CE's `weaponGetActionPointCost` in `item.cc:1643`. After deducting AP, `drawAP()` is called immediately to sync the indicator lights.

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

### 9.2 Indicator Bar (CE → DH2)

CE displays a bar of status badges above the main HUD when relevant conditions are active. DH2 implements this via `updateIndicatorBar()` / `buildBadgeSrcCanvases()` in `src/ui_hud.ts`.

#### CE constants (`interface.h`, `interface.cc`)

| Indicator | CE constant | Active when |
|-----------|-------------|-------------|
| ADDICT | `INDICATOR_ADDICT` | drug addiction flag set |
| SNEAK | `INDICATOR_SNEAK` | sneak mode active |
| LEVEL UP | `INDICATOR_LEVEL` | unspent perk/level point |
| POISONED | `INDICATOR_POISONED` | `poisonLevel > 0` |
| RADIATED | `INDICATOR_RADIATED` | `critterGetRadiation(gDude) > 65` (**strictly** greater, not ≥) |

Up to `INDICATOR_SLOTS_COUNT = 6` shown simultaneously; CE renders them in `gIndicatorBarWindow`, a separate window above `gInterfaceBarWindow`.

#### CE badge geometry (`interface.cc indicatorBarRefresh`)

```
BADGE_W  = 130 px   (INDICATOR_BOX_WIDTH)
BADGE_H  =  21 px   (INDICATOR_BOX_HEIGHT)
BADGE_CW =   3 px   (connector overlap)

badge 0  : srcX = BADGE_CW (= 3), display width = BADGE_W - BADGE_CW (= 127)
badge i≥1: srcX = 0,               display width = BADGE_W          (= 130)
           left = i * (BADGE_W - BADGE_CW) - BADGE_CW  (= i*127 - 3)

container width = (BADGE_W - BADGE_CW) * count  (= 127 * count)
overflow:hidden clips the left connector on badge 0
```

CE badge colors from `_colorTable` (RGB565):
- Bad badges (ADDICT, POISONED, RADIATED): `_colorTable[31744]` = RGB565(31744) = `#f80000`
- Good badges (SNEAK, LEVEL): `_colorTable[992]` = RGB565(992) = `#00f800`

Text centering (CE `indicatorBarRefresh`):
```
textX = (BADGE_W - textWidth) / 2
textY = (BADGE_H - textHeight + BADGE_CW) / 2
```

#### DH2 implementation (`src/ui_hud.ts`)

`buildBadgeSrcCanvases()` — runs once on HUD init. Loads `art/intrface/warnbox.png` and `font1`, pre-renders one canvas per indicator type (5 total). Badge text is composited using `FoText`/`renderBitmapText` and color-matched to CE.

`updateIndicatorBar()` — called on any state change that can affect badge visibility:
- HP draw (`drawHP`)
- AP draw (`drawAP`) during combat init
- Sneak toggle (`src/skillUse.ts useSneak`)
- Character screen Done button (`src/ui_character/viewer.ts`)

`renderIndicatorBadges(activeSet)` — builds the container DOM element with `overflow:hidden`, appends badge `<canvas>` elements using CE geometry above.

---

## 10. Skilldex (`skilldex.cc` / `src/ui_skilldex.ts`)

> **Source anchor:** `raw/fallout2-ce/src/skilldex.cc` (`skilldexOpen`, `skilldexClose`, `gSkilldexSkills`)
> **DH2 impl:** `src/ui_skilldex.ts` (`showSkilldex`, `closeSkilldex`); `UIMode.skilldex = 8`

### 10.1 CE Implementation

`skilldexOpen()` — disables ISO mode, creates the Skilldex window using FRM art from the `intrface/` directory, and renders 10 skill buttons. Each button is labelled with the skill name and shows the player's current percentage for that skill.

The 10 skills shown, in order, are a fixed subset of CE's `Skill` enum:

| Index | CE Skill constant | Skill name |
|-------|------------------|------------|
| 0 | `SKILL_SMALL_GUNS` | Small Guns |
| 1 | `SKILL_BIG_GUNS` | Big Guns |
| 2 | `SKILL_ENERGY_WEAPONS` | Energy Weapons |
| 3 | `SKILL_MELEE_WEAPONS` | Melee Weapons |
| 4 | `SKILL_THROWING` | Throwing |
| 5 | `SKILL_FIRST_AID` | First Aid |
| 6 | `SKILL_DOCTOR` | Doctor |
| 7 | `SKILL_SNEAK` | Sneak |
| 8 | `SKILL_LOCKPICK` | Lockpick |
| 9 | `SKILL_STEAL` | Steal |

This intentionally omits the 8 remaining CE skills (Traps, Science, Repair, Speech, Barter, Gambling, Outdoorsman, and the combat-only unarmed skills). Clicking a skill button calls `actionUseSkill(gDude, target, skillId)` via a callback chain.

### 10.2 DH2 Implementation (`src/ui_skilldex.ts`)

`showSkilldex()` sets `globalState.uiMode = UIMode.skilldex` and renders the same 10-skill list as a `WindowFrame` overlay. Each skill entry is a clickable button. On click, `useSkill(skill, target)` is called, which defers to `main.ts:useSkill` for the actual skill-use logic.

`closeSkilldex()` closes the `WindowFrame` and resets `uiMode`.

The Skilldex is opened from:
- The `skilldexButton` HUD button (see §4.5)
- The `[Skill]` entry in the context menu (`ui_contextmenu.ts`)

### 10.3 Known Gaps vs CE

No functional gap in the skill list itself — DH2 shows the same 10 skills as CE. Gaps exist in the downstream skill-use system documented in `wiki/skill_checks.md`, not in the Skilldex window itself.

| Item | CE | DH2 | Status |
|------|-----|-----|--------|
| Skill percentage display | Each button shows current skill % | Shown | ✅ |
| 10-skill subset | Fixed `gSkilldexSkills[10]` | Same fixed list | ✅ |
| `actionUseSkill` callback chain | CE routes through `actions.cc` | DH2 calls `main.ts:useSkill` | Functional; detail gaps in skill_checks.md |
| Window FRM art | `intrface/skldxbox.frm` etc. | DH2 uses equivalent PNG art | ✅ |

---

## 11. Elevator (`elevator.cc` / `elevator.h` / `src/ui_elevator.ts`)

> **Source anchor:** `raw/fallout2-ce/src/elevator.cc`, `raw/fallout2-ce/src/elevator.h`
> **DH2 files:** `src/ui_elevator.ts`, `src/data.ts` (`Elevator` interface, `getElevator`), `src/main.ts` (`useElevator`)
> **Data:** `lut/elevators.json`
> `UIMode.elevator = 6`

### 11.1 Overview

Elevators in Fallout 2 are multi-floor vertical travel points. A single elevator record spans up to 4 floors (levels), each mapping to a specific `(map, elevation, tile)` destination. The elevator UI presents floor-selection buttons overlaid on a background panel art; selecting a floor triggers a map load or elevation change.

CE supports up to 50 elevator definitions (`ELEVATORS_MAX = 50`), overridable via sfall config (`elevators.ini`). DH2 reads a pre-baked `lut/elevators.json` extracted by the asset pipeline.

### 11.2 CE Data Structures (`elevator.cc`)

#### `ElevatorDescription`

One record per floor slot (up to 4 per elevator):

```c
typedef struct ElevatorDescription {
    int map;        // target map ID
    int elevation;  // target elevation (0–2)
    int tile;       // target tile number (-1 = this floor unused)
} ElevatorDescription;
```

Static table `gElevatorDescriptions[50][4]` is compiled in from a large constant block at `elevator.cc:123`.

#### Art FRM IDs

Each elevator entry stores two FRM IDs:

```c
typedef struct ElevatorBackground {
    int backgroundFrmId;  // main panel art (from intrface/)
    int panelFrmId;       // button strip art
} ElevatorBackground;
```

`gElevatorLevels[50]` stores the actual floor count (2–4) for each elevator entry.

#### Level Labels

`gElevatorLevelLabels[50][4]` — character labels for each floor button (hotkey letters). Used by `elevatorGetLevelFromKeyCode` to map keyboard presses to floor indices.

#### Sound Effects

`gElevatorSoundEffects[3][4]` — SFX stem matrix indexed by `[levelsInElevator - 2][numberOfFloorsTravelled]`. Stems are single-letter codes producing names like `"elv1_1"`, `"elv1_2"`, `"elv1_3"` for a travel distance of 1, 2, or 3+ floors.

### 11.3 CE `elevatorSelectLevel` Flow (`elevator.cc:338`)

```
Player steps on elevator tile
  → useElevator / elevator scripting opcode
      → elevatorSelectLevel(elevatorIndex, &map, &elevation, &tile)
          → elevatorWindowInit(elevator)        // create fullscreen window, blit art
          → display initial gauge position      // shows current floor
          → input loop: wait for button press or Escape
          → on floor button:
              → animate gauge to new position
              → soundPlayFile(gElevatorSoundEffects[...])
              → elevatorWindowFree()
              → *mapPtr = new map, *elevationPtr = new elev, *tilePtr = new tile
  → mapLoadById(*mapPtr, *elevationPtr, *tilePtr)
```

The CE window is software-rendered pixel blitting; the gauge position is interpolated frame-by-frame using a float step, creating a smooth scrolling animation.

Special elevation remapping is applied for two hardcoded elevators:
- `ELEVATOR_SIERRA_2` — elevation offset −2 or −3
- `ELEVATOR_MILITARY_BASE_LOWER` — elevation offset −2 when ≥ 2
- `ELEVATOR_MILITARY_BASE_UPPER` — offset −2 when elevation = 4

### 11.4 DH2 Implementation (`src/ui_elevator.ts`, `src/main.ts`)

#### Trigger

`main.ts:1160 useElevator()`:

1. Searches the 6 tiles adjacent to the player for a scenery object with `PID = 1293` (the Elevator Stub scenery)
2. Reads `elevatorStub.extra.type` and `elevatorStub.extra.level` to look up the elevator record
3. Calls `uiElevator(elevator)` with the JSON record

#### `uiElevator(elevator)` (`ui_elevator.ts:56`)

- Sets `globalState.uiMode = UIMode.elevator` (= 6)
- Shows `#elevatorBox` DOM element with the background FRM art as a CSS background image
- Optionally shows `#elevatorLabel` DOM element for the floor-label strip
- Wires `onclick` handlers for up to 4 `#elevatorButton{N}` elements

#### Button Handler Logic

```typescript
const mapID = elevator.buttons[i - 1].mapID
const level  = elevator.buttons[i - 1].level
const pos    = fromTileNum(elevator.buttons[i - 1].tileNum)

if (mapID !== gMap.mapID) {
    // cross-map travel
    audioEngine.playSfxByName('selevdx1')
    gMap.loadMapByID(mapID, pos, level)
} else if (level !== currentElevation) {
    // same map, elevation change
    const dist = Math.abs(level - currentElevation)
    const sfx  = dist === 1 ? 'elv1_1' : dist === 2 ? 'elv1_2' : 'elv1_3'
    audioEngine.playSfxByName(sfx)
    player.move(pos)
    gMap.changeElevation(level, true)
}
uiElevatorDone()
```

Distance-based SFX selection matches CE's `gElevatorSoundEffects` logic.

#### `Elevator` JSON Interface (`src/data.ts:62`)

```typescript
export interface Elevator {
    type: number          // FRM art ID for the panel background
    labels: number        // FRM art ID for the floor label strip (−1 = no labels)
    buttonCount: number   // number of floors (2–4)
    buttons: { tileNum: number; mapID: number; level: number }[]
}
```

Loaded lazily from `lut/elevators.json` via `getElevator(type)`.

---

## 12. Known Gaps vs CE

| # | Feature | CE Behavior | DH2 Status | Impact |
|---|---------|-------------|------------|--------|
| IW1 | Indicator bar | 5 indicator types shown above HUD (ADDICT/SNEAK/LEVEL/POISONED/RADIATED) | **FIXED 2026-06-13** — implemented in `src/ui_hud.ts`; see §9.2 for geometry/color details | — |
| IW2 | `InterfaceItemState.isDisabled` | Weapon buttons grey-out when player has insufficient AP for the attack | MISSING — DH2 does not grey the attack button | Player can click attack with 0 AP; engine silently rejects the attack |
| IW3 | `InterfaceItemAction` aiming states | Right-click cycles through DEFAULT→USE→PRIMARY→PRIMARY_AIMING→SECONDARY→SECONDARY_AIMING→RELOAD; aiming states open the called-shot panel automatically | PARTIAL — DH2 only cycles `'single'`/`'burst'`/`'reload'`; called shot is opened via separate hotkey (`controls.calledShot = 'z'`) | Aiming modes are not linked to weapon action cycling |
| IW4 | HUD bar hide/show | `interfaceBarHide/Show` + `gInterfaceBarMode` allow scripts/transitions to toggle the entire bar | MISSING — DH2 has no hide/show for the HUD element | Scripts calling `hide_window(IFACE_WIN)` have no effect |
| IW5 | Active hand persistence in save | CE `interfaceSave` serializes `gInterfaceCurrentHand` | MISSING — DH2 save/load does not persist `player.activeHand` | Active hand always resets to default on load |
| IW6 | AP readout animation | `interfaceRenderActionPoints(animate=true)` plays frame-by-frame AP loss/gain anim | MISSING — `drawAP` updates immediately, no animation | Minor visual fidelity gap |
| IW7 | Reload AP cost / AP sync | CE: `weaponGetActionPointCost` (`item.cc:1643`) returns 1 (Fast Reload perk), 0 (Solar Scorcher), else 2. CE calls `interfaceRenderActionPoints` after deduction. | **FIXED 2026-06-13** — DH2 `getReloadAPCost()` (`src/critter/Weapon.ts:346`) matches CE logic; `drawAP()` called immediately after deduction in `ui.ts`. Note: CE reload AP is hardcoded logic (not from PRO data), so no PRO field read is needed. | — |
| IW8 | Dialogue `_dialogue_state` machine | `game_dialog.cc` runs a multi-state machine with barter, trade, and other sub-modes reachable from dialogue | PARTIAL — DH2 transitions `UIMode.dialogue` → `UIMode.barter` manually; complex sub-mode transitions are not replicated | Dialogue-driven barter (`StartTrading`) works; other sub-mode transitions may not |
| IW9 | Perk selection UI | CE `character_editor.cc` opens a perk-selection screen on level-up | STUB — `pendingPerkPick` flag exists in `player.ts`; no selection screen renders | Player cannot choose a perk on level-up; perk points accumulate silently |
| IW10 | CE context menu via cursor mode | CE selects verb (look/talk/use/pickup) by cursor icon; right-click re-targets the verb | DH2 uses an inline menu with explicit buttons; no cursor verb system | Functional difference but no gameplay gap |
| IW11 | Character editor in-game | CE allows stat/skill re-editing via options during character creation | DH2 `ui_charactercreator.ts` has limited re-entry support | Minor; only affects new game flow |
| EV1 | ✅ FIXED (stale claim corrected 2026-07-04) | Already implemented: `animateGauge()`/`setGaugeFrame()`/`gaugeFrameForFloor()` in `ui_elevator.ts` interpolate the gauge needle frame-by-frame before travel, matching CE's `elevator.cc:405` float-step loop (`GAUGE_FRAME_MS=276`). | FIXED — `ui_elevator.ts:37-62` | low severity |
| EV2 | Sierra-2 / Military Base elevation remapping absent | CE applies hardcoded offsets for elevators `ELEVATOR_SIERRA_2`, `ELEVATOR_MILITARY_BASE_LOWER`, `ELEVATOR_MILITARY_BASE_UPPER` — but only to pick which floor the gauge needle starts at when the panel opens; travel destinations always come straight from the button table either way. Investigated 2026-07-04: DH2's `uiElevator()` finds the current floor via a `(mapID, level)` linear search rather than CE's index-arithmetic, so the offsets don't port as a literal patch, and DH2 doesn't thread the elevator's identity index (0-23) into `uiElevator()` to condition on it. Confirming real impact needs the actual `lut/elevators.json` button data (git-ignored). (`elevator.cc:354–378`) | MISSING — `ui_elevator.ts:76-104` — cosmetic only, zero gameplay impact | low severity |
| EV3 | `use_elevator` scripting opcode not wired | CE scripts can trigger an elevator programmatically via the `use_elevator` opcode (`0x80FD`). DH2 has no wiring for this opcode in `vm_bridge.ts`. (`elevator.cc`) | MISSING | minor severity |
| EV4 | `console.log` in production path | `ui_elevator.ts:59–64` uses raw `console.log` instead of `dbg()`/`dbgWarn()` from `src/logger.ts`. | BUG — `ui_elevator.ts:59` | low severity |

| IW12 | Inventory AP cost | CE `inventoryOpen()` (`inventory.cc:570`): deducts `4 - 2 * quickPocketsRank` AP on open in combat; calls `interfaceRenderActionPoints()` to sync display. | **FIXED 2026-06-13** — `showInventory()` in `src/ui_inventory/panel.ts` deducts AP and calls `drawAP()` on first open during combat. Quick Pockets perk (`hasPerk('Quick Pockets')`) reduces cost by 2. | — |

<!-- audited: 2026-06-13 -->
