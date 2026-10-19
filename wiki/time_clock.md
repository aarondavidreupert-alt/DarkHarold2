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

**DH2**: `gametime.ts` uses the same start (`START_TICKS = 302400`, `START_DAY = 25` 1-based, `START_MONTH = 6` July, 2241) — July 25, 2241, 8:24 AM.

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

**DH2**: `game_time_hour` (0x80F6) pushes `GameTime.getHourMilitary()` (100 × hour + minute), as CE.

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
ends. DH2: `gameTick.ts` makes the same check.

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

**DH2**: `processMidnightForDay` (`gameTick.ts`) runs for every crossed midnight — also inside a time jump (rest, travel, `game_time_advance`) — `objectUnjamAll()`, `scriptsCheckGameEvents()` (ARTIMER1–4 with the Arroyo → Destroyed Arroyo swap and the −15 town reputation, the AFAILED ending) and `checkRads(dude)`; a story movie stops a rest (CE returns 1). `map_update_p_proc` fires every 600 ticks.

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

**DH2**: `GameTime.advanceTicks` calls the time-jump hook (`gameTick.ts processTimeJump`), which runs each crossed midnight and fires the expired timed events in due order — the same result as CE's per-day `queueProcessEvents()`.

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

**DH2**: `GameTime.setLightLevelOverride` is the same piecewise mapping (no outdoor filter); `lightSetAmbientIntensity` adds the Night Vision bonus and clamps.

### `days_since_visited` (0x811B)

```c
days = (gameTimeGetTime() - gMapHeader.lastVisitTime) / TICKS_PER_DAY;
// returns -1 if never visited
```

**DH2**: wired (`days_since_visited`, `GameMap.lastVisitTime`, saved with the map).

---

## 8. Time-Advancing Events

### CE worldmap travel (`worldmap.cc:3103`)

Each worldmap step calls `wmGameTimeIncrement(18000)`:
- **18000 ticks = 30 minutes** per worldmap step.
- The **Pathfinder perk** reduces travel time: each rank reduces ticks by 25%
  (`worldmap.cc:4178-4182`): `ticksToAdd -= round(ticksToAdd * rank * 0.25)`.
- Queued events are processed mid-travel for each day crossed.

### DH2 worldmap travel (`src/worldmap/Worldmap.ts`)

The travel loop is CE's frame loop (60 frames a second): every walking frame adds 18000 ticks through `gameTimeIncrement` (Pathfinder −25 % per rank with the remainder carried, sfall fix) and the queued events fire as time passes — see `worldmap.md` §3.

### CE combat (`combat.cc`)

CE advances 5 seconds per combat round. In DH2 `src/combat/Combat.ts`:
`GameTime.advanceSeconds(5)` — matches CE.

### Rest / Wait (PipBoy)

CE: the `rest.cc` / `Rest` dialog advances time in fixed increments (1h, 2h, 3h,
etc.), calls `gameTimeAddTicks` and processes queue events per hour.

DH2 (`src/ui_pipboy/shell.ts pipboyRest`): CE's animated clock — `GameTime.setTime` steps through the time-jump hook, so midnights and timed events fire during the rest; an event that returns 1 in CE (poison at ≤ 5 HP, radiation, withdrawal, the midnight movie) or combat / dialogue ends it.

### Skill use

CE `skill.cc skillUse`: First Aid 1800 s, Doctor 3600 s per healing attempt, Repair 1800 s per attempt (dude only); books `3600 × (11 − INT)` s (`_obj_use_book`). See `skill_checks.md`.

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

### DH2 day/night curve (option)

`Config.engine.dayNightCycle` (fallout2.cfg `[dh2] day_night_cycle`, console `setDayNightCycle`) adds a clock-driven curve (`gametime.ts`): night floor 0.35 × MAX from 22:00 to 04:00, full light 08:00–18:00, linear ramps between; the shader uses the darker of the curve and the script-set ambient light. It is a DH2 addition (on by default); with it off, lighting is CE's (scripts only).

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

| Feature | CE | DH2 |
|---------|-----|-----|
| Tick constants, start date (July 25, 2241, 8:24) | `scripts.h`, `sfall_config.cc` | Same |
| Calendar (365-day years, no leap years) | `gameTimeGetDate` | Same |
| `game_time_hour` | Military 0–2359 | Same |
| `game_time_advance` | Per-day `queueProcessEvents` | Time-jump hook, same result |
| `set_light_level` | Piecewise, no outdoor filter | Same |
| `days_since_visited`, `game_time_in_seconds` | Implemented | Wired |
| Midnight event | Unjam, story events, rads | Same (also inside time jumps) |
| 13-year endgame timeout | `gameTimeAddTicks` | `gameTick.ts` |
| Worldmap time | 18000 ticks per frame, Pathfinder | Same (C55) |
| Combat round | 5 s (`combat.cc:3071`) | 5 s |
| `map_update_p_proc` cadence | 600 ticks | 600 ticks |
| Day/night light curve | None | DH2 option (default on) |

---

## 12. Known Gaps

| ID | Description | Status |
|----|-------------|--------|
| GTC10 | The day/night ambient-light curve is a DH2 addition, on by default (`[dh2] day_night_cycle=0` for CE lighting). | deviation (option) |

GTC1–GTC9 are fixed (military `game_time_hour`, queue processing on time jumps, piecewise `set_light_level`, `days_since_visited` / `game_time_in_seconds`, midnight events incl. ARTIMER and rads, July start, 13-year timeout, Pathfinder). <!-- audited: 2026-10-18 -->
