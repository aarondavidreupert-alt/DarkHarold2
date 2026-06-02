# Elevator System — DarkHarold2 Reference

> **Source anchor:** `raw/fallout2-ce/src/elevator.cc`, `elevator.h`
> **DH2 files:** `src/ui_elevator.ts`, `src/data.ts` (`Elevator` interface, `getElevator`), `src/main.ts:1160 useElevator`
> **Data:** `lut/elevators.json`
> **Last audited:** 2026-06-02

---

## 1. Overview

Elevators in Fallout 2 are multi-floor vertical travel points. A single elevator record spans up to 4 floors (levels), each mapping to a specific `(map, elevation, tile)` destination. The elevator UI presents floor-selection buttons overlaid on a background panel art; selecting a floor triggers a map load or elevation change.

CE supports up to 50 elevator definitions (`ELEVATORS_MAX = 50`), overridable via sfall config (`elevators.ini`). DH2 reads a pre-baked `lut/elevators.json` extracted by the asset pipeline.

---

## 2. CE Data Structures (`elevator.cc`)

### 2.1 `ElevatorDescription`

One record per floor slot (up to 4 per elevator):

```c
typedef struct ElevatorDescription {
    int map;        // target map ID
    int elevation;  // target elevation (0–2)
    int tile;       // target tile number (-1 = this floor unused)
} ElevatorDescription;
```

Static table `gElevatorDescriptions[50][4]` is compiled in from a large constant block at `elevator.cc:123`.

### 2.2 Art FRM IDs

Each elevator entry stores two FRM IDs:

```c
typedef struct ElevatorBackground {
    int backgroundFrmId;  // main panel art (from intrface/)
    int panelFrmId;       // button strip art
} ElevatorBackground;
```

`gElevatorLevels[50]` stores the actual floor count (2–4) for each elevator entry.

### 2.3 Level Labels

`gElevatorLevelLabels[50][4]` — character labels for each floor button (hotkey letters). Used by `elevatorGetLevelFromKeyCode` to map keyboard presses to floor indices.

### 2.4 Sound Effects

`gElevatorSoundEffects[3][4]` — SFX stem matrix indexed by `[levelsInElevator - 2][numberOfFloorsTravelled]`. Stems are single-letter codes producing names like `"elv1_1"`, `"elv1_2"`, `"elv1_3"` for a travel distance of 1, 2, or 3+ floors.

---

## 3. CE `elevatorSelectLevel` Flow (`elevator.cc:338`)

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

---

## 4. DH2 Implementation (`src/ui_elevator.ts`, `src/main.ts`)

### 4.1 Trigger

`main.ts:1160 useElevator()`:

1. Searches the 6 tiles adjacent to the player for a scenery object with `PID = 1293` (the Elevator Stub scenery)
2. Reads `elevatorStub.extra.type` and `elevatorStub.extra.level` to look up the elevator record
3. Calls `uiElevator(elevator)` with the JSON record

### 4.2 `uiElevator(elevator)` (`ui_elevator.ts:56`)

- Sets `globalState.uiMode = UIMode.elevator` (= 6)
- Shows `#elevatorBox` DOM element with the background FRM art as a CSS background image
- Optionally shows `#elevatorLabel` DOM element for the floor-label strip
- Wires `onclick` handlers for up to 4 `#elevatorButton{N}` elements

### 4.3 Button Handler Logic

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

### 4.4 `Elevator` JSON Interface (`src/data.ts:62`)

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

## 5. Known Gaps

| ID | Gap | CE ref | DH2 location | Sev | Status |
|----|-----|--------|--------------|-----|--------|
| EV1 | **No gauge animation.** CE smoothly scrolls a gauge pointer graphic as the player "travels" between floors. DH2 closes the panel and loads the destination immediately — no visual travel animation. | `elevator.cc:405 gauge interpolation loop` | `ui_elevator.ts:79` | low | missing |
| EV2 | **Sierra-2 / Military Base elevation remapping absent.** CE applies hardcoded offsets for elevators `ELEVATOR_SIERRA_2`, `ELEVATOR_MILITARY_BASE_LOWER`, `ELEVATOR_MILITARY_BASE_UPPER`. DH2 uses the raw `level` from the JSON record with no remapping. | `elevator.cc:354–375` | `ui_elevator.ts:84` | low | missing (unlikely to matter if `lut/elevators.json` pre-applies the offsets) |
| EV3 | **`use_elevator` scripting opcode not wired.** CE scripts can trigger an elevator programmatically via the `use_elevator` opcode (`0x80FD`). DH2 has no wiring for this opcode in `vm_bridge.ts`. | `elevator.cc` | — | minor | missing |
| EV4 | **`console.log` in production path.** `ui_elevator.ts:59–64` uses raw `console.log` instead of `dbg()`/`dbgWarn()` from `src/logger.ts`. | — | `ui_elevator.ts:59` | low | bug |

<!-- audited: 2026-06-02 -->
