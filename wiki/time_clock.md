# Time & Game Clock — CE Reference and DH2 Status

Fallout 2's time system is implemented in `scripts.cc` / `scripts.h`
(there is no separate `time.cc`). DH2 mirrors it in `src/gametime.ts`.

---

## 1. Tick Unit

One game tick = 1/10 of a real second of gameplay. All game state that varies
over time is measured in ticks. The tick counter starts at 302400 on game start
and counts upward without a hard ceiling (CE enforces an endgame cap only).

CE constant declarations (`scripts.h:18,21,24`):

```c
#define GAME_TIME_TICKS_PER_HOUR  36000       // 3600 s * 10 ticks/s
#define GAME_TIME_TICKS_PER_DAY   864000      // 24 * 36000
#define GAME_TIME_TICKS_PER_YEAR  315360000   // 365 * 864000
```

`TICKS_PER_SECOND` (10) and `TICKS_PER_MINUTE` (600) are not named in `scripts.h`
but follow from `gameTimeAddSeconds(n) = gameTimeAddTicks(n * 10)` (`scripts.cc:381`).

DH2 names all five in `gametime.ts:23-27`:

```typescript
export const TICKS_PER_SECOND = 10
export const TICKS_PER_MINUTE = 600
export const TICKS_PER_HOUR   = 36000
export const TICKS_PER_DAY    = 864000
export const TICKS_PER_YEAR   = 315360000
```

All five values match CE.

---

## 2. Starting Tick and Date

CE initialises `gGameTime = 302400` at `scripts.cc:130` (the compile-time static
default). `gameTimeSetTime(302400)` is also called explicitly during `scriptsInit`
at `scripts.cc:1597`. The start calendar date is loaded from Sfall config
(`sfall_config.cc:30-32`):

```c
StartYear  = 2241
StartMonth = 6      // 0-indexed → July
StartDay   = 24
```

Decoding tick 302400 via `gameTimeGetDate` (`scripts.cc:289`):
- total days elapsed: `302400 / 864000 = 0`
- raw day within year: `(0 + 24) % 365 = 24`
- month walk starts at `gStartMonth = 6` (July); 24 < 31 (July) → break
- returned day: `24 + 1 = 25`; returned month: `6 + 1 = 7` (1-indexed)

**CE canonical start: July 25, 2241, 8:24 AM.**

Time-of-day at tick 302400: `gameTimeGetHour()` = `100 * (504/60 % 24) + 504%60`
= `100 * 8 + 24 = 824` (military format).

**DH2 deviation**: `gametime.ts:34-37` sets `START_MONTH = 7` (0-indexed = August)
to preserve a pre-existing convention. DH2 starts on **August 25, 2241** — one
month late. This is a known accepted divergence noted in the source comment.

---

## 3. Calendar Conversion Formula

### CE (`scripts.cc:289–321`)

```c
void gameTimeGetDate(int* monthPtr, int* dayPtr, int* yearPtr) {
    int year = (gGameTime / GAME_TIME_TICKS_PER_DAY + gStartDay) / 365 + gStartYear;
    int month = gStartMonth;
    int day   = (gGameTime / GAME_TIME_TICKS_PER_DAY + gStartDay) % 365;

    while (1) {
        int daysInMonth = gGameTimeDaysPerMonth[month];
        if (day < daysInMonth) break;
        month++;
        day -= daysInMonth;
        if (month == 12) { year++; month = 0; }
    }
    *dayPtr   = day + 1;    // 1-indexed
    *monthPtr = month + 1;  // 1-indexed
    *yearPtr  = year;
}
```

Properties:
- Year is computed with a flat 365 days/year (no leap years).
- Day-within-year uses actual per-month lengths from `gGameTimeDaysPerMonth[12]`
  (`scripts.cc:133`, identical to `DAYS_IN_MONTH` in DH2).
- **Year formula simplification**: `(totalDays + gStartDay) / 365` — this adds
  `gStartDay = 24` to the day count before dividing, so the year rolls over 365 days
  from day 24 of the start year, not from day 0.

### DH2 (`gametime.ts:115–129`)

DH2 uses an equivalent forward-walk from the start date:

```typescript
function getDate(): GameDate {
    const totalDays = getTotalDays()   // floor(ticks / TICKS_PER_DAY)
    let year = START_YEAR, month = START_MONTH
    let day = START_DAY + totalDays
    while (day > DAYS_IN_MONTH[month]) {
        day -= DAYS_IN_MONTH[month]
        month++
        if (month >= 12) { month = 0; year++ }
    }
    return { day, month, year, hours: getHour(), minutes: getMinute() }
}
```

Months are kept 0-indexed internally; `vm_bridge.ts:52` adds 1 before pushing
to the script stack.

---

## 4. Military-Format Hour (`game_time_hour`)

CE's `gameTimeGetHour()` (`scripts.cc:332`) returns a packed integer
`hhmm` (0–2359), where `hh` is the 24-hour clock value and `mm` is the minute:

```c
int gameTimeGetHour() {
    return 100 * ((gGameTime / 600) / 60 % 24) + (gGameTime / 600) % 60;
}
```

Examples: 8:24 AM → 824; 3:00 PM → 1500; 11:59 PM → 2359.

FO2 scripts compare against this format: `if (game_time_hour >= 800 and game_time_hour < 2000)`.

**DH2 opcode bug (GTC1)**: `vm_bridge.ts:53-54` implements opcodes 0x80F6 and
0x80a8 with the formula:

```typescript
Math.floor((globalState.gameTickTime / 600) % 24)
```

This returns `total_minutes % 24`, which is neither the hour of day (0-23) nor
the military format (0-2359). It produces nonsensical cycling values that bear no
relation to the in-game hour. Any script using `game_time_hour` in a comparison
gets incorrect data.

The correct formula is `GameTime.getHourMilitary()` (which already exists in
`gametime.ts:96` and IS used to populate `script.game_time_hour` at
`scripting.ts:2138,2189`). The opcode handler simply uses the wrong path.

---

## 5. CE Time API (`scripts.cc`)

| Function | Address | Description |
|----------|---------|-------------|
| `gameTimeGetTime()` | 0x4A3330 | Returns `gGameTime` in ticks |
| `gameTimeGetDate(month*, day*, year*)` | 0x4A3338 | Breaks down ticks to calendar date (1-indexed) |
| `gameTimeGetHour()` | 0x4A33C8 | Returns military-format integer hhmm |
| `gameTimeGetTimeString()` | 0x4A3420 | Returns `"h:mm"` string |
| `gameTimeSetTime(time)` | 0x4A347C | Sets `gGameTime`; clamps 0 → 1 |
| `gameTimeAddTicks(ticks)` | 0x4A34CC | Adds ticks; checks 13-year endgame cap |
| `gameTimeAddSeconds(seconds)` | 0x4A3518 | `gameTimeAddTicks(seconds * 10)` |
| `gameTimeScheduleUpdateEvent()` | 0x4A3570 | Queues EVENT_TYPE_GAME_TIME at next midnight; queues EVENT_TYPE_MAP_UPDATE_EVENT in 600 ticks |
| `gameTimeEventProcess(obj, data)` | 0x4A3620 | Midnight handler: unjam doors, check story events, radiation tick |

**Endgame timeout** (`scripts.cc:368-371`): `gameTimeAddTicks` checks
`gGameTime / TICKS_PER_YEAR`. If `year >= 13` (i.e., 13 years of game time have
elapsed from tick 0), `endgameSetupDeathEnding(TIMEOUT)` is called and the game
ends. DH2 does not implement this cap.

---

## 6. Midnight Queue Event (`gameTimeEventProcess`)

CE fires `gameTimeEventProcess` at midnight each in-game day. Effects:
1. `objectUnjamAll()` — resets all jammed doors/containers.
2. `_scriptsCheckGameEvents()` — advances story timer movies (ARTIMER1-4), checks
   `GVAR_ENEMY_ARROYO` for the village-destroyed ending.
3. `_critter_check_rads(gDude)` — applies accumulated radiation damage.

`gameTimeScheduleUpdateEvent` (`scripts.cc:388-402`) re-queues the midnight event
each time it fires, calculating ticks until the next 00:00 with:
```c
v1 = 10 * (60 * (60 - current_minute - 1) + 3600 * (24 - current_hour - 1) + 60)
```

The `EVENT_TYPE_MAP_UPDATE_EVENT` queued at `600` ticks (60 seconds) fires
`mapUpdateEventProcess` which runs `map_update_p_proc` for all scripts on the
current map.

**DH2 gaps**: The midnight event (GTC5) is partial — `objectUnjamAll()` fires on
day transitions, but the ARTIMER threshold consequences (worldmap area swap +
town-rep penalty, independent of the out-of-scope movie playback) and radiation
tick do not. See `known_bugs.md` §GTC5 for the full investigation. `map_update_p_proc`
fires every 600 ticks via `nextMapUpdateTick` in `gameTick.ts:191-222`, which
matches CE's 60-second cadence.

---

## 7. Script Opcodes

### Opcode table

| Opcode | Name | CE handler | CE address | Return value |
|--------|------|-----------|-----------|--------------|
| 0x80E9 | `set_light_level(n)` | `opSetLightLevel` | 0x457934 | — |
| 0x80EA | `game_time` | `opGetGameTime` | 0x4579F4 | ticks (uint) |
| 0x80EB | `game_time_in_seconds` | `opGetGameTimeInSeconds` | 0x457A18 | ticks / 10 |
| 0x80F6 | `game_time_hour` | `opGameTimeHour` | 0x458438 | military hhmm 0-2359 |
| 0x80FC | `game_time_advance(n)` | `opGameTimeAdvance` | 0x4586C8 | — |
| 0x8118 | `get_month` | `opGetMonth` | 0x45A3E4 | month 1-indexed |
| 0x8119 | `get_day` | `opGetDay` | 0x45A43C | day 1-indexed |
| 0x811B | `days_since_visited` | `opGetDaysSinceLastVisit` | 0x45A4E4 | days or -1 |

### `game_time_advance` (0x80FC, `interpreter_extra.cc:2761`)

CE processes the queue per complete day advanced:

```c
void opGameTimeAdvance(Program* program) {
    int data = programStackPopInteger(program);
    int days = data / GAME_TIME_TICKS_PER_DAY;
    int remainder = data % GAME_TIME_TICKS_PER_DAY;
    for (int day = 0; day < days; day++) {
        gameTimeAddTicks(GAME_TIME_TICKS_PER_DAY);
        queueProcessEvents();   // fires midnight event per day skipped
    }
    gameTimeAddTicks(remainder);
    queueProcessEvents();
}
```

**DH2 gap (GTC2)**: `scripting.ts:1755-1759` calls `GameTime.advanceTicks(ticks)` 
directly — no queue processing. Midnight events (radiation, story timers, door
unjamming) are skipped even when advancing multiple in-game days.

### `set_light_level` (0x80E9, `interpreter_extra.cc:2233`)

CE maps input `0..100` to `LIGHT_INTENSITY_MIN..LIGHT_INTENSITY_MAX` via a
**two-segment piecewise linear** function with midpoint at `data == 50`:

```c
static const int intensities[3] = {
    LIGHT_INTENSITY_MIN,                          // 16384
    (LIGHT_INTENSITY_MIN + LIGHT_INTENSITY_MAX) / 2,  // 40960
    LIGHT_INTENSITY_MAX,                          // 65536
};
if (data == 50) { lightSetAmbientIntensity(intensities[1], true); return; }
if (data > 50)
    lightIntensity = intensities[1] + data * (intensities[2] - intensities[1]) / 100;
else
    lightIntensity = intensities[0] + data * (intensities[1] - intensities[0]) / 100;
```

Key values:
- `set_light_level(0)` → 16384 (25% max, never true darkness)
- `set_light_level(50)` → 40960 (62.5% max, "cavern" lighting)
- `set_light_level(100)` → 65536 + 65536*100/100 = 65536 (capped to MAX)

Note: `data > 50` branch uses a percentage of `intensities[2] - intensities[1]` that
is **not** centred around the midpoint — the full range 51..100 only covers
`intensities[1]..intensities[2]`, making the upper half brighter relative to the
lower half. The function is non-symmetric around 50.

**DH2 gap (GTC3)**: `gametime.ts:234-247` uses a simple linear interpolation from
`LIGHT_INTENSITY_MIN` to `LIGHT_INTENSITY_MAX` — a single segment, not two. At
`level = 50`, CE returns 40960 (62.5%); DH2 returns `16384 + 0.5 * (65536 - 16384)`
= `40960`. The midpoint coincidentally matches, but values away from 50 diverge.
DH2 also ignores the call on outdoor maps — CE does not have this filter.

### `days_since_visited` (0x811B)

```c
days = (gameTimeGetTime() - gMapHeader.lastVisitTime) / TICKS_PER_DAY;
// returns -1 if never visited
```

**DH2 gap (GTC4)**: opcode 0x811B is not registered in `vm_bridge.ts`. Any script
calling `days_since_visited` will fault.

---

## 8. Time-Advancing Events

### CE worldmap travel (`worldmap.cc:3103`)

Each worldmap step calls `wmGameTimeIncrement(18000)`:
- **18000 ticks = 30 minutes** per worldmap step.
- The **Pathfinder perk** reduces travel time: each rank reduces ticks by 25%
  (`worldmap.cc:4178-4182`): `ticksToAdd -= round(ticksToAdd * rank * 0.25)`.
- Queued events are processed mid-travel for each day crossed.

### DH2 worldmap travel (`src/worldmap/Worldmap.ts`)

```typescript
GameTime.advanceMinutes(Math.max(1, Math.round(2 * travelScale)))
```

- Fires every ~75ms wall-time worldmap animation tick.
- `travelScale = 1 / terrainSpeed` — 2 minutes per tick on normal terrain.
- **No Pathfinder perk reduction.**
- **No queue processing during travel.**

The time-per-unit-distance is not directly comparable between CE and DH2 because
CE has discrete steps and DH2 has continuous motion. Travel time in DH2 is
configurable via `terrainSpeed` in the worldmap config.

### CE combat (`combat.cc`)

CE advances 5 seconds per combat round. In DH2 `src/combat/Combat.ts`:
`GameTime.advanceSeconds(5)` — matches CE.

### Rest / Wait (PipBoy)

CE: the `rest.cc` / `Rest` dialog advances time in fixed increments (1h, 2h, 3h,
etc.), calls `gameTimeAddTicks` and processes queue events per hour.

DH2 (`src/ui_pipboy/shell.ts`): `advanceTime(minutes)` calls
`GameTime.advanceMinutes(minutes)` — direct tick add, no queue processing.

### Skill use (`skillUse.ts:219`)

`GameTime.advanceMinutes(30)` — 30 minutes per active skill use (Doctor, First Aid,
etc.). No CE reference found for exact value; appears to match original.

### Script `game_time_advance`

Scripts can call `game_time_advance(game_ticks(n))` to advance by `n * 10` ticks.
`game_ticks(seconds)` (`scripting.ts:1752`) returns `seconds * 10`, matching CE.

---

## 9. Ambient Light: CE vs DH2

### CE behaviour

CE has **no automatic day/night cycle**. Maps load at `LIGHT_INTENSITY_MAX`
(`map.cc:927`). Scripts call `set_light_level(n)` in `map_enter_p_proc` to set
indoor/outdoor ambiance for that map. Outdoor maps typically pin a moderate level
(e.g., 40) for atmosphere; interior maps pin low values for dungeons/caves.
CE's `lightGetAmbientIntensity` simply returns the last value set by a script or
the per-tile average of object lights — there is no clock-driven curve.

### DH2 day/night curve

DH2 invents an automatic day/night curve in `gametime.ts:181-188`:

```
Hour  0  → LIGHT_CURVE_NIGHT_FLOOR  (0.35 × MAX = 22938)
Hour  4  → LIGHT_CURVE_NIGHT_FLOOR
Hour  8  → LIGHT_INTENSITY_MAX      (65536)
Hour 18  → LIGHT_INTENSITY_MAX
Hour 22  → LIGHT_CURVE_NIGHT_FLOOR
Hour 24  → LIGHT_CURVE_NIGHT_FLOOR
```

Piecewise-linear interpolation between stops. The curve is applied on outdoor maps
to create a dawn/dusk feel. On indoor maps (detected via `gMap.isOutdoor()`),
`set_light_level` script calls override the curve.

**The curve is a DH2 invention** — not present in CE and will produce visual
differences from the original.

---

## 10. DH2 Tick Loop (`main.ts:1018-1021`)

```typescript
const didTick = time - globalState.lastGameTick >= 1000 / 10  // 10 Hz
if (didTick) {
    globalState.lastGameTick = time
    globalState.gameTickTime++
    // timed events, map_update_p_proc, poison, radiation ...
}
```

Game time advances at a real-time 10 Hz rate (one tick per 100ms wall time),
matching `TICKS_PER_SECOND = 10`. `map_update_p_proc` fires every 600 ticks
(`nextMapUpdateTick`, `main.ts:1059`), matching CE's 60-second cadence.

Save/load (`saveload.ts:83,202`) persists and restores `gameTickTime` directly.

---

## 11. DH2 vs CE Comparison

| Feature | CE | DH2 | Status |
|---------|-----|-----|--------|
| Tick constants | `scripts.h:18-24` | `gametime.ts:23-27` | ✅ Match |
| Starting ticks | 302400 (8:24 AM) | 302400 (8:24 AM) | ✅ Match |
| Starting year | 2241 | 2241 | ✅ Match |
| Starting month | 6 (0-indexed, July) | 7 (0-indexed, August) | ❌ Off by 1 month |
| Calendar formula | 365-day flat year + real month lengths | Same | ✅ Match |
| Leap years | None (ignored) | None (ignored) | ✅ Match |
| `game_time_hour` return | Military format 0-2359 | Wrong: `total_minutes % 24` | ❌ Bug |
| `game_time_advance` queue | Fires queue per day | Skips queue | ❌ Gap |
| `set_light_level` mapping | Piecewise 2-segment | Single linear segment | ❌ Differs at extremes |
| `set_light_level` outdoor | Allowed | Silently ignored | ❌ Gap |
| `days_since_visited` (0x811B) | Implemented | Not wired | ❌ Missing |
| `game_time_in_seconds` (0x80EB) | Implemented | Not wired | ❌ Missing |
| Day/night light curve | None — scripts only | Automatic piecewise ramp | ❌ Invented |
| Midnight queue event | ✅ Unjam + story + rads | Not implemented | ❌ Missing |
| Endgame 13-year timeout | ✅ `gameTimeAddTicks` check | Not implemented | ❌ Missing |
| Worldmap ticks/step | 18000 (30 min) | ~2 min/frame (varies) | ❌ Different model |
| Pathfinder perk time reduction | ✅ 25% per rank | Not implemented | ❌ Missing |
| Combat round time | 5 seconds | 5 seconds | ✅ Match |
| map_update_p_proc cadence | 600 ticks (60s) | 600 ticks (60s) | ✅ Match |
| Save/load tick persistence | Queue-aware | Direct field | ✅ Functional |

---

## 12. Known Gaps

| ID | Description | DH2 Location | CE Reference | Sev | Status |
|----|-------------|--------------|--------------|-----|--------|
| GTC1 | **`game_time_hour` opcode returns wrong value.** Opcodes 0x80F6 and 0x80a8 use `floor((ticks/600)%24)` instead of military format `100*hour+minute`. Scripts checking hours like `game_time_hour >= 800` will never match. | `vm_bridge.ts:53-54` | `scripts.cc:332 gameTimeGetHour()` | major | bug |
| GTC2 | **`game_time_advance` skips queue processing.** CE fires `queueProcessEvents()` per day advanced, triggering midnight events (door unjam, story timers, radiation). DH2 directly adds ticks. | `scripting.ts:1755` | `interpreter_extra.cc:2761 opGameTimeAdvance` | minor | missing |
| GTC3 | **`set_light_level` uses linear mapping, not CE piecewise.** CE maps 0-50 and 51-100 as separate segments with midpoint at 40960. DH2 uses one linear segment. Levels near 0 or 100 differ slightly. Also: DH2 silently ignores the call on outdoor maps; CE applies it globally. | `gametime.ts:234`, `scripting.ts:1255` | `interpreter_extra.cc:2233 opSetLightLevel` | minor | bug |
| GTC4 | ✅ Stale claim, corrected 2026-07-05 — `days_since_visited` (0x811B) **is** wired (`vm_bridge.ts`: `bridged("days_since_visited", 0)`). | `vm_bridge.ts` | `interpreter_extra.cc:3734 opGetDaysSinceLastVisit` | minor | fixed |
| GTC5 | 🟡 Partial, investigated 2026-07-05 — `gameTick.ts` fires `objectUnjamAll()` on the in-game midnight transition. `_scriptsCheckGameEvents()` (ARTIMER1-4) turned out to be more than a movie trigger: crossing a day threshold applies a real worldmap area swap (Arroyo → Destroyed Arroyo) and a `GVAR_TOWN_REP_ARROYO -= 15` penalty, independent of the (correctly out-of-scope) movie playback. Left unimplemented pending two unknowns: the true vanilla day thresholds (Sfall-config-only in CE source, no in-source default) and whether DH2's `city.txt` has a "Destroyed Arroyo" area entry. Radiation damage deferred separately (project scope). | `gameTick.ts:161` | `scripts.cc:405,438-490 gameTimeEventProcess/_scriptsCheckGameEvents` | minor | partial |
| GTC6 | **Starting month is August (DH2) instead of July (CE).** `START_MONTH = 7` (0-indexed August) vs CE `gStartMonth = 6` (0-indexed July). `get_month` returns 8 in DH2 where CE returns 7. | `gametime.ts:36` | `sfall_config.cc:31` | minor | bug |
| GTC7 | **No 13-year endgame timeout.** CE's `gameTimeAddTicks` ends the game if the year counter reaches 13. | `gametime.ts` / `scripting.ts:1755` | `scripts.cc:368` | minor | missing |
| GTC8 | **Pathfinder perk does not reduce worldmap travel time.** CE reduces ticks by 25% per Pathfinder perk rank during worldmap travel. | `src/worldmap/Worldmap.ts` | `worldmap.cc:4178` | minor | missing |
| GTC9 | **`game_time_in_seconds` (0x80EB) not wired in `vm_bridge.ts`.** | `vm_bridge.ts` | `interpreter_extra.cc:2277 opGetGameTimeInSeconds` | low | missing |
| GTC10 | **Day/night ambient light curve is a DH2 invention.** CE has no automatic clock-driven ambient light change; only script-controlled `set_light_level` calls. DH2's piecewise ramp (`gametime.ts:181`) produces a sunrise/sunset effect not present in the original. | `gametime.ts:181` | `light.cc`, `map.cc:927` | low | deviation |

<!-- audited: 2026-07-05 — GTC4 corrected (already wired), GTC5 investigated (ARTIMER consequence system scoped, blocked on unknown day-threshold defaults) -->
