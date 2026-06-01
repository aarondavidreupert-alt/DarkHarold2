# Karma & Reputation System

CE refs: `game_vars.h` (GVAR constants), `character_editor.cc` (`karmaInit`,
`genericReputationInit`, `gTownReputationEntries`, `gKarmaEntries`, `gAddictionReputationVars`),
`stat.cc` (`gPcStatDescriptions`, `gPcStatValues`, `pcGetStat`, `pcSetStat`),
`game.cc` (`gameGetGlobalVar`, `gameSetGlobalVar`), `interpreter_extra.cc`
(`opGetGlobalVar`, `opSetGlobalVar`, `opGetPcStat`, `opReactionInfluence`),
`reaction.cc` (`reactionGetValue`, `reactionSetValue`, `reactionTranslateValue`)  
DH2 refs: `src/scripting.ts` (`global_var`, `set_global_var`, `get_pc_stat`,
`set_pc_stat`, `mod_pc_stat`), `src/ui_character.ts` (`KARMA_TITLES`, `TOWN_NAMES`,
`townStanding`), `src/skills.ts` (Karma/Reputation stat definitions),
`src/debug.ts` (`setKarma`)

---

## 1. Storage Model

### CE

CE has three distinct storage pools for karma/reputation values:

**`gGameGlobalVars[]`** — the primary store for all gameplay-visible karma/reputation.
Loaded at startup from `data/vault13.gam` (`gameLoadGlobalVars`,
`game.cc:1029`). All script reads/writes go through `gameGetGlobalVar` /
`gameSetGlobalVar`. Saved with the game in the main save slot.

**`gPcStatValues[PC_STAT_COUNT]`** — a separate 5-element array holding
skill points, level, XP, `PC_STAT_REPUTATION`, and `PC_STAT_KARMA`
(`stat.cc:99`). These are saved and loaded via `statsLoad`/`statsSave`.
Scripts can read them via `get_pc_stat`; there is no `set_pc_stat` opcode —
only the engine can write them via `pcSetStat`.

The relationship between `gGameGlobalVars` and `gPcStatValues` is important:
`GVAR_PLAYER_REPUTATION` (the main karma score) and `gPcStatValues[PC_STAT_KARMA]`
are **separate fields**. CE scripts never call `set_pc_stat`, so `PC_STAT_KARMA`
and `PC_STAT_REPUTATION` may only ever hold their default value of 0 in
normal gameplay. Their exact engine usage is **unclear** — they may be vestigial.

**NPC LVAR[0]** — per-NPC attitude toward the player. Not "reputation" in the
town sense; it is a critter-local signed integer modified by `reactionSetValue`.

### DH2

DH2 has three parallel stores, **none of which are connected to each other**:

1. `globalVars: any = {}` in `scripting.ts:51` — the GVAR pool used by scripts. 
   Keyed by integer GVAR index.
2. `player.stats` (`StatSet`) — contains named stats `'Karma'`, `'Reputation'`,
   and `'Rep_{town}'` used by the UI.
3. Save file `gvars` field in `SaveGame` — serializes the `globalVars` pool.

---

## 2. Global Karma (GVAR_PLAYER_REPUTATION)

### CE

`GVAR_PLAYER_REPUTATION = 0` (first entry in the `GameGlobalVar` enum,
`game_vars.h:7`). This is the canonical karma score — the single integer
displayed as "Karma: N" in the character editor, alongside the karma title.

Scripts read and write it via:
```
get_global_var(GVAR_PLAYER_REPUTATION)     // → gameGetGlobalVar(0)
set_global_var(GVAR_PLAYER_REPUTATION, N)  // → gameSetGlobalVar(0, N)
```

There is no dedicated `add_karma` or `modify_karma` opcode. All scripts use
the read-modify-write pattern on GVAR 0.

`gameSetGlobalVar` (`game.cc:995`) has a Sfall-specific hook that displays a
"You gained/lost N karma" message if `DISPLAY_KARMA_CHANGES` is enabled in the
Sfall config — this is a CE enhancement, not original FO2.

### DH2

The script path for karma writes (`set_global_var(0, N)`) goes to
`globalVars[0]` — a plain dictionary entry. The UI karma display reads
`player.stats.getBase('Karma')`. These are **never synchronized**.

| Code path | Storage | Used by |
|---|---|---|
| `set_global_var(0, val)` | `globalVars[0]` | CE scripts |
| `get_global_var(0)` | `globalVars[0]` | CE scripts |
| `get_pc_stat(4)` / `set_pc_stat(4, val)` | `player.stats.getBase('Karma')` | UI, debug |
| `debug.setKarma(n)` | `player.stats.setBase('Karma', n)` | Dev console |

The character sheet karma display reads `player.stats.getBase('Karma')`. A CE
script that does `set_global_var(GVAR_PLAYER_REPUTATION, 500)` has no effect on
the displayed karma value.

---

## 3. Karma Titles

### CE

Titles are loaded from `data/genrep.txt` at character editor open
(`genericReputationInit`, `character_editor.cc:7077`). The file contains
threshold–name pairs:

```
threshold  message_id
```

Entries are sorted in descending order. The character editor walks the list from
highest threshold and displays the first entry where
`gGameGlobalVars[GVAR_PLAYER_REPUTATION] >= threshold` (`character_editor.cc:4542`).

The `genrep.txt` data file is not present in the CE source repo; its values must
be inferred from DH2's `KARMA_TITLES` array, which likely mirrors the shipped
game data.

### DH2

Hardcoded in `ui_character.ts:581–591`:

```typescript
const KARMA_TITLES: Array<[number, string]> = [
    [750,      'Savior of the Damned'],
    [500,      'Guardian of the Wastes'],
    [250,      'Shield of Hope'],
    [100,      'Defender'],
    [0,        'Wanderer'],
    [-99,      'Betrayer'],
    [-249,     'Sword of Despair'],
    [-499,     'Scourge of the Wastes'],
    [-Infinity, 'Demon Spawn'],
]
```

Title lookup: `KARMA_TITLES.find(([threshold]) => karmaVal >= threshold)` — reads
`player.stats.getBase('Karma')`, NOT `globalVars[0]`.

The title thresholds likely match CE's `genrep.txt` defaults. The boundary at
0 (Wanderer) and the name progression match the in-game character editor.

**DH2 gap**: Title display uses `player.stats.getBase('Karma')` while scripts modify
`globalVars[0]` — the title will not update when CE scripts change karma.

---

## 4. Special Karma Flags

CE tracks several named reputations as binary GVARs (0 = not set, 1 = set).
These appear in the karma folder of the character editor when non-zero, as
separate entries loaded from `karmavar.txt`.

### GVAR indices (from `game_vars.h`)

| GVAR | Index | Meaning |
|---|---|---|
| `GVAR_PLAYER_REPUTATION` | 0 | Main karma score (signed integer) |
| `GVAR_CHILDKILLER_REPUTATION` | 1 | Set when player kills a child |
| `GVAR_CHAMPION_REPUTATION` | 2 | Set by specific quests |
| `GVAR_BERSERKER_REPUTATION` | 3 | Set when too many innocents killed |
| `GVAR_BAD_MONSTER` | 4 | Negative creature rep flag |
| `GVAR_GOOD_MONSTER` | 5 | Positive creature rep flag |
| `GVAR_PLAYER_MARRIED` | 6 | Marriage flag |
| `GVAR_ENEMY_ARROYO` | 7 | Arroyo hostility flag |
| `GVAR_REPUTATION_SLAVER` | 11 | Slaver reputation flag |
| `GVAR_REPUTATION_SLAVE_OWNER` | 12 | Slave owner reputation flag |
| `GVAR_KARMA_HOLY_WARRIOR` | 37 | Karma achievement: Holy Warrior |
| `GVAR_KARMA_GUARDIAN_OF_THE_WASTES` | 38 | Karma achievement: Guardian |
| `GVAR_KARMA_SHIELD_OF_HOPE` | 39 | Karma achievement: Shield of Hope |
| `GVAR_KARMA_DEFENDER` | 40 | Karma achievement: Defender |
| `GVAR_KARMA_WANDERER` | 41 | Karma achievement: Wanderer |
| `GVAR_KARMA_BETRAYER` | 42 | Karma achievement: Betrayer |
| `GVAR_KARMA_SWORD_OF_DESPAIR` | 43 | Karma achievement: Sword of Despair |
| `GVAR_KARMA_SCOURGE_OF_THE_WASTE` | 44 | Karma achievement: Scourge |
| `GVAR_KARMA_DEMON_SPAWN` | 45 | Karma achievement: Demon Spawn |

The `GVAR_KARMA_*` entries (37–45) are set by game scripts (not engine events)
to flag that the player reached specific karma thresholds at some point. They
are separate from the numeric score in `GVAR_PLAYER_REPUTATION`.

The character editor display (`karmaInit`, `character_editor.cc:6978`) reads
entries from `karmavar.txt`. Each entry specifies a GVAR, an art number, and
message IDs. If the entry references `GVAR_PLAYER_REPUTATION`, it shows the
numeric score + genrep.txt title; otherwise it shows the entry's name only if
the GVAR is non-zero.

### DH2

These flags are stored in `globalVars[1]`, `globalVars[2]`, etc. Scripts that
call `set_global_var(GVAR_CHILDKILLER_REPUTATION, 1)` (= `set_global_var(1, 1)`)
will update `globalVars[1]` correctly. However, none of these flags are
surfaced in DH2's UI — the karma panel only shows the score/title and town
reps; there is no character-editor display of Childkiller, Berserker, etc.

---

## 5. Town Reputation

### CE

Each town has a GVAR storing its reputation score (a signed integer). Scripts
modify these directly:

```
set_global_var(GVAR_TOWN_REP_KLAMATH, get_global_var(GVAR_TOWN_REP_KLAMATH) + delta)
```

The 19 towns in `gTownReputationEntries` (`character_editor.cc:517`):

| Town | GVAR constant | Index |
|---|---|---|
| Arroyo | `GVAR_TOWN_REP_ARROYO` | 47 |
| Klamath | `GVAR_TOWN_REP_KLAMATH` | 48 |
| The Den | `GVAR_TOWN_REP_THE_DEN` | 49 |
| Vault City | `GVAR_TOWN_REP_VAULT_CITY` | 50 |
| Gecko | `GVAR_TOWN_REP_GECKO` | 51 |
| Modoc | `GVAR_TOWN_REP_MODOC` | 52 |
| Sierra Army Base | `GVAR_TOWN_REP_SIERRA_BASE` | 53 |
| Broken Hills | `GVAR_TOWN_REP_BROKEN_HILLS` | 54 |
| New Reno | `GVAR_TOWN_REP_NEW_RENO` | 55 |
| Redding | `GVAR_TOWN_REP_REDDING` | 56 |
| NCR | `GVAR_TOWN_REP_NCR` | 57 |
| (Buried Vault) | `GVAR_TOWN_REP_BURIED_VAULT` | 58 |
| Vault 13 | `GVAR_TOWN_REP_VAULT_13` | 59 |
| (Colusa) | `GVAR_TOWN_REP_COLUSA` | 60 |
| San Francisco | `GVAR_TOWN_REP_SAN_FRANCISCO` | 61 |
| (Enclave) | `GVAR_TOWN_REP_ENCLAVE` | 62 |
| Abbey | `GVAR_TOWN_REP_ABBEY` | 63 |
| EPA | `GVAR_TOWN_REP_EPA` | 64 |
| Primitive Tribe | `GVAR_TOWN_REP_PRIMITIVE_TRIBE` | 65 |
| Raiders | `GVAR_TOWN_REP_RAIDERS` | 66 |
| Vault 15 | `GVAR_TOWN_REP_VAULT_15` | 301 |
| Ghost Farm (Modoc) | `GVAR_TOWN_REP_GHOST_FARM` | 315 |
| Navarro | `GVAR_TOWN_REP_NAVARRO` | 635 |

Vault 15, Ghost Farm, and Navarro have non-contiguous indices (301, 315, 635)
because they were added later in the GVAR enum. The 19-entry
`gTownReputationEntries` array in `character_editor.cc` does not include all of
these — it only lists 19 towns for display (ending with Ghost Farm at index 315 in
the separate enum entry at line 315; the array itself stops at 19 entries).

CE does not engine-enforce reputation tiers. Town hostility, dialogue options, and
services are gated by scripts that read the relevant GVAR directly and branch on
hard-coded thresholds per town.

### DH2

Town reputation is **split across two disconnected storage systems**:

**Script-side** (GVAR pool): `globalVars[47]` through `globalVars[66]` (and the
higher-index ones). Scripts read/write these correctly.

**UI-side** (player stats): `player.stats.getBase('Rep_Arroyo')` etc. The karma
panel iterates `TOWN_NAMES` (`ui_character.ts:593–597`) and reads `Rep_{town}`:

```typescript
const TOWN_NAMES = [
    'Arroyo', 'Klamath', 'The Den', 'Vault City', 'Gecko', 'Modoc',
    'Sierra Base', 'Broken Hills', 'New Reno', 'Redding', 'NCR',
    'Vault 13', 'San Francisco', 'Abbey', 'EPA', 'Primitive Tribe',
    'Raiders', 'Vault 15', 'Ghost Farm',
]
```

The panel only displays a town if the key exists in `player.stats.baseStats`
(`ui_character.ts:632`). Neither Player initialization nor any script sets these
stat keys, so the town section of the karma panel is always empty unless added
manually.

**Town standing labels** — DH2 uses 7 tiers (`ui_character.ts:600–608`):

| Range | Label |
|---|---|
| val ≥ 30 | Idolized |
| 15 ≤ val < 30 | Liked |
| 1 ≤ val < 15 | Accepted |
| val = 0 | Neutral |
| -14 ≤ val < 0 | Antipathy |
| -29 ≤ val < -14 | Hated |
| val < -29 | Vilified |

CE has no equivalent engine-enforced tier table — towns use these labels
in their own scripts via direct GVAR comparisons.

---

## 6. NPC Attitude (Reaction System)

### CE

Each NPC critter has LVAR[0] as its attitude toward the player. Range is a
signed integer; the display system maps it to three buckets
(`reaction.cc:18`, `reactionTranslateValue`):

```c
if (a1 > 10)   return NPC_REACTION_GOOD;
if (a1 > -10)  return NPC_REACTION_NEUTRAL;
else           return NPC_REACTION_BAD;
```

`reactionSetValue(critter, value)` writes directly to LVAR[0] via
`scriptSetLocalVar`. `reactionGetValue(critter)` reads it.

The engine calls `reactionSetValue(critter, -3)` in `_critter_set_who_hit_me`
(`critter.cc:1296`) when the player attacks a critter — making NPC attitude
worsen on hostile action.

The `reaction_influence` opcode (0x80B3, `interpreter_extra.cc:760`) always
returns 0; the function `_reaction_influence_()` in `reaction.cc:36` is a stub.

Town reputation GVARs are consulted by individual NPC scripts — there is no
engine hook between a town GVAR change and automatic NPC attitude updates. Each
town's scripts decide when to turn hostile.

### DH2

DH2 scripts can read/write LVARs correctly; LVAR[0]-based attitude would
function if scripts use it. The `reaction_influence` opcode (0x80B3) is not
wired in `vm_bridge.ts` — but since CE's implementation always returns 0, this
is low-impact.

---

## 7. PC Stat Karma/Reputation (get_pc_stat)

### CE

`pcGetStat(pcStat)` reads from `gPcStatValues[]`:

| pcStat | Constant | CE range | CE notes |
|---|---|---|---|
| 3 | `PC_STAT_REPUTATION` | −20 to 20 | Default 0; no set opcode |
| 4 | `PC_STAT_KARMA` | 0 to INT_MAX | Default 0; no set opcode |

`set_pc_stat` and `mod_pc_stat` opcodes do not exist in CE's
`interpreter_extra.cc`. Only `get_pc_stat` (0x80A6) is registered. The
`gPcStatValues[PC_STAT_REPUTATION]` and `gPcStatValues[PC_STAT_KARMA]` fields
are saved/loaded with the character but there is no code path found that sets
them from gameplay events. **Status: likely vestigial or reserved fields.**

### DH2

DH2 implements `set_pc_stat` and `mod_pc_stat` for pcstat cases 3 and 4:

```typescript
get_pc_stat(3)         → player.stats.getBase('Reputation')  // −20..20
get_pc_stat(4)         → player.stats.getBase('Karma')       // unclamped
set_pc_stat(3, val)    → player.stats.setBase('Reputation', clamp(-20, 20, val))
set_pc_stat(4, val)    → player.stats.setBase('Karma', clamp(-99999999, 99999999, val))
mod_pc_stat(3, delta)  → additive on Reputation, clamped
mod_pc_stat(4, delta)  → additive on Karma
```

`Reputation: new Stat(-20, 20, 0, [])` (`skills.ts:153`) — matches CE's
`gPcStatDescriptions[3]` range exactly.

`Karma: new Stat(-99999999, 99999999, 0, [])` (`skills.ts:154`) — DH2 allows
negative karma here; CE's `gPcStatDescriptions[4]` has `min=0, max=INT_MAX`.

Since CE never exposes `set_pc_stat`, no CE scripts will call it. DH2's
implementation adds write access that CE scripts don't use.

---

## 8. Scripting Interface

### CE opcodes for karma/reputation

| Opcode | Hex | CE function | Description |
|---|---|---|---|
| `get_global_var` | 0x80C5 | `opGetGlobalVar` → `gameGetGlobalVar` | Read any GVAR by index |
| `set_global_var` | 0x80C6 | `opSetGlobalVar` → `gameSetGlobalVar` | Write any GVAR by index |
| `get_pc_stat` | 0x80A6 | `opGetPcStat` → `pcGetStat` | Read PC stat (skill pts, level, XP, reputation, karma) |
| `reaction_influence` | 0x80B3 | stub → always returns 0 | Unused influence opcode |

**There are no dedicated karma or reputation opcodes.** All karma changes
go through `set_global_var(0, ...)` and all town reputation changes go through
`set_global_var(N, ...)` for the relevant GVAR index.

### DH2 wiring

| CE opcode | DH2 wired | DH2 method |
|---|---|---|
| `get_global_var` (0x80C5) | ✅ `vm_bridge.ts:92` | `scripting.ts:448` — reads `globalVars[N]` |
| `set_global_var` (0x80C6) | ✅ `vm_bridge.ts:93` | `scripting.ts:403` — writes `globalVars[N]` |
| `get_pc_stat` (0x80A6) | ✅ (implicit via bridged map) | `scripting.ts:891` — cases 0–5 |
| `set_pc_stat` (none in CE) | n/a — not a CE opcode | `scripting.ts:910` — DH2 addition |
| `mod_pc_stat` (none in CE) | n/a — not a CE opcode | `scripting.ts:926` — DH2 addition |
| `reaction_influence` (0x80B3) | ❌ Not in vm_bridge | Not implemented |

`reaction_influence` is missing from vm_bridge, but CE's implementation always
returns 0, so any script calling it would receive 0 in CE too. Low impact.

---

## 9. DH2 Implementation Status

| Mechanic | CE source | DH2 status |
|---|---|---|
| Main karma score storage | `gGameGlobalVars[0]` (GVAR_PLAYER_REPUTATION) | 🟡 Stored in `globalVars[0]`; correct for scripts but disconnected from UI |
| Karma UI display | `gGameGlobalVars[GVAR_PLAYER_REPUTATION]` + genrep.txt | 🟡 `player.stats.getBase('Karma')`; correct display but reads different field than scripts write |
| Karma title thresholds | `data/genrep.txt` (data-driven) | 🟡 Hardcoded in `ui_character.ts:581`; values likely match CE defaults |
| Special karma flags (Childkiller etc.) | `gGameGlobalVars[1–3, 37–45]` | 🟡 Stored in `globalVars[1–3, 37–45]`; correct for script reads/writes but no UI display |
| Town reputation storage | `gGameGlobalVars[47–66, 301, 315, 635]` per town | 🟡 Stored in `globalVars[N]`; correct for script reads/writes but disconnected from UI |
| Town reputation UI display | `gTownReputationEntries` + character editor | ❌ Reads `Rep_{town}` from player.stats; never populated; always empty |
| Town standing tiers (Idolized etc.) | Script-specific per-town thresholds | 🟡 Hardcoded 7-tier table in `ui_character.ts`; CE has no equivalent engine table |
| `PC_STAT_REPUTATION` (pcstat 3) | `gPcStatValues[3]`, range [−20, 20] | 🟡 `player.stats.getBase('Reputation')`; range matches CE; likely vestigial in CE anyway |
| `PC_STAT_KARMA` (pcstat 4) | `gPcStatValues[4]`, range [0, INT_MAX] | 🟡 `player.stats.getBase('Karma')`; DH2 allows negatives (CE doesn't) |
| `set_pc_stat` / `mod_pc_stat` | No CE opcode | ✅ DH2 addition; no CE scripts will call it |
| NPC attitude (LVAR[0]) | `reactionSetValue` / `reactionGetValue` | 🟡 LVARs work; `_critter_set_who_hit_me` calling `reactionSetValue` not ported |
| `reaction_influence` opcode | 0x80B3 (CE stub, always returns 0) | ❌ Not wired in vm_bridge; CE stub returns 0 anyway |
| `gvars.json` initial values | `data/vault13.gam` | 🟡 Loaded from `data/gvars.json` if present; absent by default |

---

## 10. Known Issues and Flags

**Script karma writes don't update the UI**: CE scripts do
`set_global_var(GVAR_PLAYER_REPUTATION, N)` which writes `globalVars[0]`. The
karma panel reads `player.stats.getBase('Karma')`. These are never synchronized.
Any CE script that adjusts karma will have no visible effect on the character
sheet. To fix: either route `set_global_var(0, N)` to also set
`player.stats.setBase('Karma', N)`, or change the UI to read `globalVars[0]`.

**Town reputation panel always empty**: `Rep_{town}` stat keys are never written
anywhere — not by player initialization, not by scripts. The karma panel's town
section will show nothing. To fix: either populate `Rep_*` stats from
`globalVars[47–66]` on UI render, or rewrite the panel to read directly from
`globalVars`.

**`PC_STAT_REPUTATION` and `PC_STAT_KARMA` in CE are vestigial**: No CE code
path was found that sets `gPcStatValues[3]` or `gPcStatValues[4]` from gameplay.
They default to 0 and remain 0. Scripts using `get_pc_stat(3)` or
`get_pc_stat(4)` in CE will always receive 0. DH2's implementation adds
write access (set_pc_stat / mod_pc_stat) but no CE script uses these.

**`gvars.json` typically absent**: `loadGlobalVars` loads from `data/gvars.json`
on startup. If the file doesn't exist (the common case), all GVARs start at 0.
CE loads initial values from `data/vault13.gam` which sets non-zero defaults for
many GVARs. Without an equivalent `gvars.json`, scripts that check initial GVAR
values may behave differently than CE. The asset pipeline would need to extract
`vault13.gam` initial values to `gvars.json`.

**Town reputation GVAR indices for Vault 15, Ghost Farm, Navarro**: These use
non-contiguous indices (301, 315, 635). `globalVars[301]` and `globalVars[315]`
will work correctly for script access but neither appears in DH2's `TOWN_NAMES`
list for UI display.

**`reaction_influence` not wired**: Opcode 0x80B3 missing from `vm_bridge.ts`.
CE's implementation always returned 0 and was documented as unused, so this is
low-impact. Scripts calling it in DH2 will hit a missing-opcode error rather
than silently getting 0.
