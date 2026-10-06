# Faction, Reputation & Egg Group System

Merged from `karma_reputation.md` and `egg_system.md`. Covers:
1. Global karma score and titles
2. Town / faction reputation
3. NPC attitude (reaction system)
4. PC-stat karma/reputation fields
5. EGG group system — critter faction groupings for combat reactions (not yet
   separately documented; see §3 NPC Attitude for the reaction opcode details
   and cross-reference `wiki/combat.md` for combat initiation)
6. Visual egg transparency zone — the elliptical fade zone around the player
   that makes overlapping walls/roofs translucent

CE refs:
- `game_vars.h` (GVAR constants)
- `character_editor.cc` (`karmaInit`, `genericReputationInit`,
  `gTownReputationEntries`, `gKarmaEntries`, `gAddictionReputationVars`)
- `stat.cc` (`gPcStatDescriptions`, `gPcStatValues`, `pcGetStat`, `pcSetStat`)
- `game.cc` (`gameGetGlobalVar`, `gameSetGlobalVar`)
- `interpreter_extra.cc` (`opGetGlobalVar`, `opSetGlobalVar`, `opGetPcStat`,
  `opReactionInfluence`)
- `reaction.cc` (`reactionGetValue`, `reactionSetValue`, `reactionTranslateValue`)
- `object.cc` (`_obj_render_object`, `objectsInit`, `objectSetLocation`,
  `_obj_offset`, `_intensity_mask_buf_to_buf`, `_dark_trans_buf_to_buf`,
  `_dark_translucent_trans_buf_to_buf`)
- `tile.cc` (`tileRenderRoof`, `tileRenderRoofsInRect`, `tile_fill_roof`,
  `tileIsInFrontOf`, `tileIsToRightOf`)
- `obj_types.h` (`ObjectFlags` enum, `OBJECT_TRANS_*` constants)

DH2 refs:
- `src/scripting.ts` (`global_var`, `set_global_var`, `get_pc_stat`,
  `set_pc_stat`, `mod_pc_stat`, `set_obj_visibility`)
- `src/ui_character/viewer.ts` (`KARMA_TITLES`, `TOWN_NAMES`, `townStanding`)
- `src/skills.ts` (Karma/Reputation stat definitions)
- `src/debug.ts` (`setKarma`)
- `src/vm_bridge.ts` (opcode wiring)
- `src/render/webglDraw.ts` (`renderObject`), `src/render/webglContext.ts` (blend state)
- `src/renderer.ts` (`objectRenderInfo`)

Cross-references: `wiki/critter_stats.md`, `wiki/combat.md`,
`wiki/rendering.md` §3 (roof clipping), `wiki/lighting.md` §4 and §8
(wall orientation flags, draw order)

<!-- audited: 2026-06-02 -->

---

## 1. Karma System

### 1.1 Storage Model

#### CE

CE has three distinct storage pools for karma/reputation values:

**`gGameGlobalVars[]`** — the primary store for all gameplay-visible
karma/reputation. Loaded at startup from `data/vault13.gam`
(`gameLoadGlobalVars`, `game.cc:1029`). All script reads/writes go through
`gameGetGlobalVar` / `gameSetGlobalVar`. Saved with the game in the main save
slot.

**`gPcStatValues[PC_STAT_COUNT]`** — a separate 5-element array holding skill
points, level, XP, `PC_STAT_REPUTATION`, and `PC_STAT_KARMA` (`stat.cc:99`).
These are saved and loaded via `statsLoad`/`statsSave`. Scripts can read them
via `get_pc_stat`; there is no `set_pc_stat` opcode — only the engine can write
them via `pcSetStat`.

The relationship between `gGameGlobalVars` and `gPcStatValues` is important:
`GVAR_PLAYER_REPUTATION` (the main karma score) and
`gPcStatValues[PC_STAT_KARMA]` are **separate fields**. CE scripts never call
`set_pc_stat`, so `PC_STAT_KARMA` and `PC_STAT_REPUTATION` may only ever hold
their default value of 0 in normal gameplay. Their exact engine usage is
**unclear** — they may be vestigial.

**NPC LVAR[0]** — per-NPC attitude toward the player. Not "reputation" in the
town sense; it is a critter-local signed integer modified by `reactionSetValue`.

#### DH2

DH2 has three parallel stores, **none of which are connected to each other**:

1. `globalVars: any = {}` in `scripting.ts:51` — the GVAR pool used by scripts,
   keyed by integer GVAR index.
2. `player.stats` (`StatSet`) — contains named stats `'Karma'`, `'Reputation'`,
   and `'Rep_{town}'` used by the UI.
3. Save file `gvars` field in `SaveGame` — serializes the `globalVars` pool.

---

### 1.2 Global Karma (GVAR_PLAYER_REPUTATION)

#### CE

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

#### DH2

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

### 1.3 Karma Titles

#### CE

Titles are loaded from `data/genrep.txt` at character editor open
(`genericReputationInit`, `character_editor.cc:7077`). The file contains
threshold–name pairs:

```
threshold  message_id
```

Entries are sorted in descending order. The character editor walks the list from
highest threshold and displays the first entry where
`gGameGlobalVars[GVAR_PLAYER_REPUTATION] >= threshold`
(`character_editor.cc:4542`).

The `genrep.txt` data file is not present in the CE source repo; its values must
be inferred from DH2's `KARMA_TITLES` array, which likely mirrors the shipped
game data.

#### DH2

Hardcoded in `ui_character.ts–591`:

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

**DH2 gap**: Title display uses `player.stats.getBase('Karma')` while scripts
modify `globalVars[0]` — the title will not update when CE scripts change karma.

---

### 1.4 Special Karma Flags

CE tracks several named reputations as binary GVARs (0 = not set, 1 = set).
These appear in the karma folder of the character editor when non-zero, as
separate entries loaded from `karmavar.txt`.

#### GVAR indices (from `game_vars.h`)

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

#### DH2

These flags are stored in `globalVars[1]`, `globalVars[2]`, etc. Scripts that
call `set_global_var(GVAR_CHILDKILLER_REPUTATION, 1)` (= `set_global_var(1, 1)`)
will update `globalVars[1]` correctly. However, none of these flags are surfaced
in DH2's UI — the karma panel only shows the score/title and town reps; there is
no character-editor display of Childkiller, Berserker, etc.

---

## 2. Town / Faction Reputation

### 2.1 CE Storage

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
these — it only lists 19 towns for display (ending with Ghost Farm at index 315
in the separate enum entry; the array itself stops at 19 entries).

CE does not engine-enforce reputation tiers. Town hostility, dialogue options,
and services are gated by scripts that read the relevant GVAR directly and branch
on hard-coded thresholds per town.

### 2.2 DH2 Storage and UI

**FIXED 2026-07-04 (roadmap R2).** Town reputation used to be split across two
disconnected storage systems (GVAR pool vs. `player.stats`) with no sync path;
this has been closed on the write side.

**Script-side** (GVAR pool): `globalVars[47]` through `globalVars[66]` (and the
higher-index ones). Scripts read/write these correctly.

**UI-side** (player stats): `player.stats.getBase('Rep_Arroyo')` etc. The karma
panel iterates `TOWN_NAMES` (`ui_character.ts–597`) and reads `Rep_{town}`:

```typescript
const TOWN_NAMES = [
    'Arroyo', 'Klamath', 'The Den', 'Vault City', 'Gecko', 'Modoc',
    'Sierra Base', 'Broken Hills', 'New Reno', 'Redding', 'NCR',
    'Vault 13', 'San Francisco', 'Abbey', 'EPA', 'Primitive Tribe',
    'Raiders', 'Vault 15', 'Ghost Farm',
]
```

`Script.set_global_var()` (`scripting.ts:88-94, ~500-510`) now carries a
`TOWN_REP_GVARS` lookup table mapping each town's GVAR index (47-66, 294, 308)
to its `TOWN_NAMES` entry. Every `set_global_var(gvar, value)` call for a town
GVAR mirrors the write into `player.stats.setBase('Rep_' + townName, value)` in
the same call, the same way GVAR 0 already mirrored into `'Karma'`. This means
any script that updates a town's reputation now populates the stat key the
karma panel reads, so the town section is no longer permanently empty.

**REGRESSION found and fixed 2026-07-05** (user-reported crash on opening the
character screen after entering a town): `setBase()` writes unconditionally
with no validation, but `StatSet.getBase()` (`char.ts:268-275`) throws
`No dependencies for stat '<name>'` for any name not registered in
`statDependencies` (`skills.ts`) — none of the 19 `Rep_*` names were
registered, so the very first town-GVAR write from any script populated
`baseStats` (passing the panel's presence guard) but crashed the next
`getBase()` read, breaking the character screen. Fixed by registering all 19
`Rep_*` entries in `statDependencies` (wide range, default 0, no
dependencies, matching the pre-existing `Karma` entry).

The panel still only displays a town if the key exists in
`player.stats.baseStats` — a town whose GVAR a script never touches still
won't appear, matching CE's behavior of not showing towns the player hasn't
interacted with.

**Town standing labels** — DH2 uses 7 tiers (`ui_character/viewer.ts:374-388`,
`townStanding()`). **FIXED 2026-07-04**: the Antipathy/Hated/Vilified
boundaries were off by one (`-14`/`-29` instead of `-15`/`-30`), which
misclassified `val = -15` as Hated (should be Antipathy) and `val = -30` as
Vilified (should be Hated). Corrected against `character_editor.cc:4586-4599`:

| Range | Label |
|---|---|
| val ≥ 30 | Idolized |
| 15 ≤ val < 30 | Liked |
| 1 ≤ val < 15 | Accepted |
| val = 0 | Neutral |
| -15 ≤ val < 0 | Antipathy |
| -30 ≤ val < -15 | Hated |
| val < -30 | Vilified |

CE has no equivalent engine-enforced tier table — towns use these labels in
their own scripts via direct GVAR comparisons.

**Remaining gap**: `Player` initialization does not pre-seed `Rep_*` stat keys
at game start, and there is still no read-side sync (a `debug`-style direct
write via `player.stats.setBase('Rep_...', n)` — e.g. from a save-editor tool
— would not push back into `globalVars[gvar]`). CE has the same one-directional
model (GVAR is authoritative; the character editor is a read-only view), so
this asymmetry is intentional and not a bug.

---

## 3. NPC Attitude (Reaction System)

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

## 4. PC-Stat Karma/Reputation Fields

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

## 5. Scripting Interface

### CE opcodes for karma/reputation

| Opcode | Hex | CE function | Description |
|---|---|---|---|
| `get_global_var` | 0x80C5 | `opGetGlobalVar` → `gameGetGlobalVar` | Read any GVAR by index |
| `set_global_var` | 0x80C6 | `opSetGlobalVar` → `gameSetGlobalVar` | Write any GVAR by index |
| `get_pc_stat` | 0x80A6 | `opGetPcStat` → `pcGetStat` | Read PC stat (skill pts, level, XP, reputation, karma) |
| `reaction_influence` | 0x80B3 | stub → always returns 0 | Unused influence opcode |

**There are no dedicated karma or reputation opcodes.** All karma changes go
through `set_global_var(0, ...)` and all town reputation changes go through
`set_global_var(N, ...)` for the relevant GVAR index.

### DH2 wiring

| CE opcode | DH2 wired | DH2 method |
|---|---|---|
| `get_global_var` (0x80C5) | Yes — `vm_bridge.ts:92` | `scripting.ts:448` — reads `globalVars[N]` |
| `set_global_var` (0x80C6) | Yes — `vm_bridge.ts:93` | `scripting.ts:403` — writes `globalVars[N]` |
| `get_pc_stat` (0x80A6) | Yes (implicit via bridged map) | `scripting.ts:891` — cases 0–5 |
| `set_pc_stat` (none in CE) | n/a — not a CE opcode | `scripting.ts:910` — DH2 addition |
| `mod_pc_stat` (none in CE) | n/a — not a CE opcode | `scripting.ts:926` — DH2 addition |
| `reaction_influence` (0x80B3) | No — not in vm_bridge | Not implemented |

`reaction_influence` is missing from vm_bridge, but CE's implementation always
returns 0, so any script calling it would receive 0 in CE too. Low impact.

---

## 6. Visual Egg Transparency Zone

The "egg" is the elliptical alpha-gradient mask zone around the player that
makes overlapping walls, scenery, and roof tiles fade out so the player is
always visible.

CE refs: `object.cc`, `tile.cc`, `obj_types.h` (full list in file header above).

### 6.1 Egg Concept

The egg is a special pseudo-object (`gEgg`) that tracks the player's tile and
screen position. Its FRM is an elliptical alpha-gradient mask image. When a
wall or scenery object overlaps the egg's screen region **and** is geometrically
in front of or to the right of the player, CE splits the object's draw call:
the region inside the egg is blended using the gradient mask (player visible
through the wall), the region outside the egg is drawn normally.

The egg FRM is loaded in `objectsInit` (`object.cc:352`):

```cpp
int eggFid = buildFid(OBJ_TYPE_INTERFACE, 2, 0, 0, 0);
objectCreateWithFidPid(&gEgg, eggFid, -1);
gEgg->flags |= OBJECT_NO_REMOVE | OBJECT_NO_SAVE | OBJECT_HIDDEN | OBJECT_LIGHT_THRU;
```

`OBJ_TYPE_INTERFACE = 6`, index 2 → the second entry in `art/intrface/*.lst`,
which resolves to `egg.frm` in the original game data. The FRM is a
single-frame greyscale image; pixel value 0 = fully opaque wall (player NOT
visible), higher values = more of the player visible. The oval is roughly
80×60 screen pixels, matching the isometric tile footprint.

**Object types affected by the egg:**

| Type | Affected |
|------|---------|
| Scenery (OBJ_TYPE_SCENERY = 2) | Yes |
| Wall (OBJ_TYPE_WALL = 3) | Yes |
| Items (OBJ_TYPE_ITEM = 0) | No |
| Critters (OBJ_TYPE_CRITTER = 1) | No |
| Tiles (OBJ_TYPE_TILE = 4) | No |
| Misc/exit grids (OBJ_TYPE_MISC = 5) | No |
| Roofs (OBJ_TYPE_TILE, rendered separately) | Yes — handled in `tileRenderRoof` |

### 6.2 Egg Position Tracking

`gEgg` is a permanent invisible object that always occupies the same tile as
the player. CE synchronises it on every player move:

| Event | CE call |
|-------|---------|
| Player moves to new tile | `objectSetLocation(gEgg, tile, elevation, ...)` inside `objectSetLocation(gDude, ...)` — `object.cc:1476-1481` |
| Player pixel-offsets (sliding) | `_obj_offset(gEgg, x, y, ...)` inside `_obj_offset(gDude, ...)` — `object.cc:1173, 1195` |
| Player moves one step | `_obj_move(gEgg, a2, a3, elevation, ...)` inside the player move path — `object.cc:1343-1346` |
| Elevation change | `objectSetLocation(gEgg, tile, newElevation, ...)` — same as tile move |

`gEgg->tile` and `gEgg->x/y` (pixel sub-tile offsets) thus match `gDude`
exactly. The egg FRM screen position is computed on each render call from
`gEgg->tile`:

```cpp
int eggScreenX, eggScreenY;
tileToScreenXY(gEgg->tile, &eggScreenX, &eggScreenY, gEgg->elevation);
eggScreenX += 16;                 // centre tile horizontally
eggScreenY += 8;                  // centre tile vertically
eggScreenX += egg->xOffsets[0];   // FRM art offset
eggScreenY += egg->yOffsets[0];
eggScreenX += gEgg->x;            // pixel sub-tile offset
eggScreenY += gEgg->y;
```

The resulting `eggRect` (`object.cc:5005-5009`):
```
eggRect.left  = eggScreenX - eggWidth / 2
eggRect.top   = eggScreenY - (eggHeight - 1)
eggRect.right = eggRect.left + eggWidth - 1
eggRect.bottom = eggScreenY
```

There is no hex-grid radius constant — the egg boundary is purely the
screen-space bounding box of the egg FRM. Any wall/scenery whose screen rect
intersects this box (and passes the positional check, §6.3) is partially faded.

### 6.3 Positional Condition for Egg Activation

The egg masking is only applied if the wall/scenery is geometrically in front
of or to the right of the player (i.e. obscuring the player's body in the
isometric view). CE uses `tileIsInFrontOf` and `tileIsToRightOf`
(`tile.cc:854-888`) to classify the relative position.

#### `tileIsInFrontOf(tile1, tile2)` (`tile.cc:854`)

```
dx = screenX(tile2) − screenX(tile1)
dy = screenY(tile2) − screenY(tile1)
return dx ≤ dy × −4.0
```

`dbl_50E7C7 = −4.0` (`tile.cc:69`). Returns true when tile2 is significantly
higher on screen than tile1 — the "this object is visually in front of the
player" check.

#### `tileIsToRightOf(tile1, tile2)` (`tile.cc:871`)

```
dx = screenX(tile2) − screenX(tile1)
dy = screenY(tile2) − screenY(tile1)
return dx ≤ dy × 1.3333333333333335
```

Returns true when tile2 is isometrically to the right of tile1.

#### Per-wall-orientation condition (`object.cc:4954-4980`)

CE reads the wall proto's `extendedFlags` (same flags used for light-blocker
orientation — see `wiki/lighting.md` §4):

| `extendedFlags` bits | Condition to activate egg |
|---|---|
| `0x8000000` or `0x80000000` | `tileIsInFrontOf(object, gDude)` — but negated if also `tileIsToRightOf` and `OBJECT_WALL_TRANS_END` |
| `0x10000000` | `tileIsInFrontOf(object, gDude) OR tileIsToRightOf(gDude, object)` (bitwise OR — both evaluated) |
| `0x20000000` | `tileIsInFrontOf(object, gDude) AND tileIsToRightOf(gDude, object)` |
| None (default) | `tileIsToRightOf(gDude, object)` — negated if also `tileIsInFrontOf(gDude, object)` and `OBJECT_WALL_TRANS_END` |

The same logic is duplicated in the click-intersection function
`_obj_create_intersect_list` (`object.cc:2944-2966`).

#### Full egg-activation check

```
if type ∈ {scenery, wall}
AND gDude not hidden
AND object has no permanent OBJECT_TRANS_* flag (OBJECT_FLAG_0xFC000 == 0)
AND positionalCheck(object.tile, gDude.tile, object.extendedFlags) is true
AND rectIntersection(eggRect, objectScreenRect) succeeds (non-empty intersection)
    → render with egg masking
```

If any condition fails the object is rendered normally (or with its own
permanent translucency if `OBJECT_FLAG_0xFC000 != 0`).

### 6.4 Transparency Flags — OBJECT_TRANS_*

These flags are set from the PRO at map load time (`object.cc:943-956`). They
control how an object is permanently rendered, independent of the egg.

#### Constants (`raw/fallout2-ce/src/obj_types.h:72-88`)

| Flag | Value | PRO bit | Render blit function | Effect |
|------|-------|---------|---------------------|--------|
| `OBJECT_TRANS_RED` | `0x4000` | `0x4000` | `_dark_translucent_trans_buf_to_buf` + `_redBlendTable` | Red-tinted translucency |
| `OBJECT_TRANS_NONE` | `0x8000` | `0x8000` | `_dark_trans_buf_to_buf` (default branch) | Fully opaque draw (palette-0 skip) |
| `OBJECT_TRANS_WALL` | `0x10000` | `0x10000` | `_dark_translucent_trans_buf_to_buf` + `_wallBlendTable` | Wall-tinted translucency |
| `OBJECT_TRANS_GLASS` | `0x20000` | `0x20000` | `_dark_translucent_trans_buf_to_buf` + `_glassBlendTable` | Glass translucency |
| `OBJECT_TRANS_STEAM` | `0x40000` | `0x40000` | `_dark_translucent_trans_buf_to_buf` + `_steamBlendTable` | Steam translucency |
| `OBJECT_TRANS_ENERGY` | `0x80000` | `0x80000` | `_dark_translucent_trans_buf_to_buf` + `_energyBlendTable` | Energy translucency |
| `OBJECT_FLAG_0xFC000` | `0xFC000` | (mask) | Combined mask of all 6 flags above | |

`OBJECT_WALL_TRANS_END` (`0x10000000`) — a separate flag indicating the wall
ends a transparent run; it modifies the positional condition (§6.3), not
rendering.

#### Relationship to the egg

**Objects with any `OBJECT_FLAG_0xFC000` bit set bypass the egg entirely.** The
conditional in `_obj_render_object` checks
`(object->flags & OBJECT_FLAG_0xFC000) != 0` first; if true, the positional and
intersection checks are skipped. Steam vents, glass windows, energy barriers,
and other permanently-translucent scenery always render with their colour-blend
table regardless of player position.

**`OBJECT_TRANS_NONE` is not "invisible"** — it means "use simple palette
rendering (`_dark_trans_buf_to_buf`), skip colour blending." It is the default
case in the translucency switch and is used for opaque-but-depth-sorted walls
that still count as in the TRANS group.

#### Palette index 0 = transparent

All CE blit functions (`_dark_trans_buf_to_buf` and
`_dark_translucent_trans_buf_to_buf`) skip source pixels where the colour byte
is `0` (`color != 0` guard, `object.cc:2769,2798`). Palette index 0 is the
transparent colour. The egg FRM itself uses non-zero pixel values as an alpha
mask (0=opaque wall region, higher=more player visible); those pixels are never
skipped.

### 6.5 Roof Egg

Roofs are rendered by `tileRenderRoofsInRect` (`tile.cc:1221`), which calls
`tileRenderRoof` (`tile.cc:1328`) for each visible roof tile.

`tileRenderRoof` applies the same egg-mask technique as wall rendering:
1. Compute the egg's current screen rect from `gEgg->tile` and the FRM offsets.
2. Compute `rectIntersection(&eggRect, &tileRect, &intersectedRect)`.
3. If intersection found: draw the four non-overlapping quadrants of the tile
   with `_dark_trans_buf_to_buf`, then draw the overlapping region with
   `_intensity_mask_buf_to_buf` using the egg FRM as the alpha mask.
4. If no intersection: draw the whole tile with `_dark_trans_buf_to_buf`.

The roof tile is also subject to `tile_fill_roof` visibility: if bit 0 of the
roof tile's flag nibble is set (`(frmId & 0xF000) >> 12) & 0x01 != 0`), the
tile is skipped entirely regardless of the egg. The flag is cleared when the
player enters a building's square and set when the player leaves
(`object.cc:1447-1463` — the `_obj_last_roof_x/y` system). See
`wiki/rendering.md` §3 for the full roof-clipping system.

CE therefore has two separate mechanisms for roofs above the player:
- **`tile_fill_roof` skip** — hides the entire roof tile so the room interior
  is visible from above. Triggered once per square-tile entry.
- **Egg mask on roof** — fades the roof tile edges where they overlap the egg
  ellipse, creating a soft circular window.

**DH2 status**: Neither mechanism is implemented. DH2's `renderRoof` draws all
roof tiles without any player position check or egg masking.

### 6.6 Render Pipeline Integration

#### CE — software palette blitter

CE renders scenery and walls inline with the normal tile-ordered render pass
(`_obj_render_pre_roof`, `_obj_render_post_roof`). Each object's draw call ends
in one of three blit paths:

1. **Egg-masked region** (`_intensity_mask_buf_to_buf`, `object.cc:2815`):
   - `src` = object FRM pixels (lit, palette-indexed)
   - `mask` = egg FRM pixel (0 = destination opaque, 128 = 50% mix, 255 = object fully visible)
   - Algorithm: `v1 = intensityColorTable[dest][128 − mask]`, `v2 = intensityColorTable[color][mask]`, `*dest = colorMixAddTable[v2][v1]`
   - `color = 0` pixels still skipped (transparent shape).

2. **Non-egg region of same object** (`_dark_trans_buf_to_buf`): normal lit
   blit, palette-0 transparent.

3. **Permanent translucency** (`_dark_translucent_trans_buf_to_buf`):
   colour-blend table lookup through a greyscale conversion step, applied to
   the whole object regardless of egg or player position.

CE has no per-object alpha channel — transparency is entirely palette-based.
All blending happens in software at 8-bit indexed colour depth.

#### DH2 — WebGL shader

DH2's `renderObject` (`webglrenderer.ts`) calls `renderFrame` for every
object unconditionally. No egg mask, no `OBJECT_TRANS_*` flag check, no
positional condition.

WebGL alpha blending is globally enabled at init:
```typescript
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
gl.enable(gl.BLEND)   // webglrenderer.ts
```

This respects the alpha channel of the sprite PNG (palette-0 pixels become
`a=0` in the exporter), so sprite shapes are correct. However:
- No egg transparency zone.
- No wall fade-out based on player position.
- No `OBJECT_TRANS_*` colouration (glass, steam, energy, etc.).
- No roof egg masking.

Implementing the egg in DH2 would require:
1. Adding `tileIsInFrontOf` / `tileIsToRightOf` geometric helpers (equivalent
   formulas using DH2's `hexToScreen`).
2. Maintaining a player-centred screen rect for the egg boundary.
3. For walls/scenery in the egg zone: either a per-object custom blend weight
   (clip the object and draw with reduced alpha), or a stencil/mask texture
   pass.
4. Roof tiles at the player's square: suppressing the draw or applying a
   circular alpha cutout.

### 6.7 `set_obj_visibility` Opcode

There is **no `set_obj_transparency` opcode** in CE. The two existing
visibility/transparency-adjacent opcodes are:

| Opcode | Name | Args | CE handler | DH2 method | DH2 wired |
|--------|------|------|-----------|-----------|-----------|
| `0x80E3` | `set_obj_visibility` | `obj, invisible` (0=show, 1=hide) | `opSetObjectVisibility` `interpreter_extra.cc:2080` | `Script.set_obj_visibility` `scripting.ts:1213` | Yes — `vm_bridge.ts:133` |

`set_obj_visibility` sets or clears the `OBJECT_HIDDEN` flag
(`object.cc:2096`). In combat it also clears any outline on the object. It has
nothing to do with translucency — hidden objects are simply skipped by the
render loop.

`OBJECT_TRANS_*` flags are set at load time from the PRO file and are **not
directly settable by script** in CE. Translucency type is a property of the
prototype, not runtime-scriptable.

DH2 `set_obj_visibility` (`scripting.ts:1213`):
```typescript
set_obj_visibility(obj: Obj, visibility: number) {
    obj.visible = !visibility   // 0 = show, 1 = hide
}
```

DH2's `visible` field (`object.ts`) is checked in `objectRenderInfo`
(`renderer.ts:286`) and propagates to WebGL via `renderInfo.visible`. The
semantics match CE's `OBJECT_HIDDEN` behaviour.

### 6.8 Edge Cases (CE Behaviour)

| Scenario | CE behaviour |
|---|---|
| Multiple overlapping walls | Each wall is independently checked; egg masking applied to each whose screen rect intersects the egg. Can produce additive fade if several walls overlap. |
| Critter inside egg zone | Critters are not affected — `type == 2 || type == 3` check excludes type 1 (critters). Friendly NPCs standing in front of the player are drawn fully opaque. |
| Items on ground inside egg | Items (type 0) not affected. Dropped items near the player render opaque. |
| Objects with `OBJECT_FLAG_0xFC000` inside egg zone | Their permanent TRANS flag takes priority; egg mask is NOT applied. A glass window (`OBJECT_TRANS_GLASS`) in front of the player shows as glass-blended, not egg-masked. |
| Elevation change | `gEgg` is moved to the new elevation in the same `objectSetLocation` call that moves `gDude`. The roof `tile_fill_roof` system also resets on elevation change (`_obj_last_roof_x/y/elev` tracking). |
| During combat | No special handling — egg renders normally during combat turns. |
| `OBJECT_WALL_TRANS_END` flag | Modifies the wall-orientation condition: a wall with this flag at the "end" of a transparent run suppresses the egg for certain rotations, allowing the run to end cleanly at a corner. |
| Player hidden (`OBJECT_HIDDEN`) | Egg masking is suppressed — `(gDude->flags & OBJECT_HIDDEN) == 0` guard (`object.cc:4950`). |

### 6.9 DH2 Current Status (Visual Egg)

The egg system is **completely absent** from DH2. No component has been
implemented.

| Component | DH2 status |
|---|---|
| `gEgg` pseudo-object | Not created |
| Egg FRM loading (`OBJ_TYPE_INTERFACE` index 2) | Not loaded |
| Egg position tracking (follows player) | Not implemented |
| `tileIsInFrontOf` / `tileIsToRightOf` | Not implemented |
| Wall/scenery positional check | Not implemented |
| Egg screen-rect intersection test | Not implemented |
| `_intensity_mask_buf_to_buf` equivalent (WebGL) | Not implemented |
| `OBJECT_TRANS_*` flag rendering (glass, steam, etc.) | Not implemented (all objects drawn opaque) |
| `tile_fill_roof` roof skip | Not implemented (see `wiki/rendering.md` §3) |
| Egg masking on roof tiles | Not implemented |
| `set_obj_visibility` opcode | **Implemented** — `scripting.ts:1213`, `vm_bridge.ts:133` |

**Visual symptom**: Walls and large scenery objects in front of the player are
drawn fully opaque. The player character can be completely hidden behind a wall
with no transparency to indicate their position.

---

## 7. Known Gaps (Unified)

### 7.1 Karma / Reputation Gaps

| # | CE behaviour | DH2 status |
|---|---|---|
| K1 | Script karma writes (`set_global_var(0, N)`) should update the displayed karma score | **Fixed** (pre-existing, prior to this audit) — `set_global_var(0, N)` syncs into `player.stats` |
| K2 | Town reputation UI reads from `gGameGlobalVars[47-66]` via character editor | **FIXED 2026-07-04 (R2), regression fixed 2026-07-05** — `set_global_var()` now syncs town-rep GVAR writes (indices 47-66, 294, 308) into `player.stats.setBase('Rep_' + town, ...)` via `TOWN_REP_GVARS`, so the town section populates once a script touches that GVAR. The 19 `Rep_*` names weren't registered in `statDependencies`, so the panel's `getBase()` read-back crashed the character screen — fixed by registering them in `skills.ts`. |
| K3 | Special karma flags (Childkiller, Berserker, etc.) shown in character editor karma panel | **Gap** — stored correctly in `globalVars[1-3, 37-45]` by scripts but no UI display |
| K4 | Town standing tier labels are per-town-script thresholds in CE | **Gap** — DH2 uses a hardcoded 7-tier table; not incorrect per se, but CE has no engine table |
| K5 | `PC_STAT_REPUTATION` (pcstat 3) and `PC_STAT_KARMA` (pcstat 4) are vestigial in CE — always 0 | **Info** — DH2 adds `set_pc_stat`/`mod_pc_stat` for these; no CE script uses them |
| K6 | `gvars.json` initial values match `data/vault13.gam` non-zero defaults | **Gap** — `gvars.json` typically absent; all GVARs start at 0 rather than CE defaults |
| K7 | Town GVAR indices for Vault 15 (301), Ghost Farm (315), Navarro (635) are non-contiguous | **Info** — script access works; none appear in DH2's `TOWN_NAMES` UI list |
| K8 | `reaction_influence` opcode (0x80B3) returns 0 in CE (stub) | **Gap** — not wired in `vm_bridge.ts`; scripts calling it will hit a missing-opcode error instead of silently getting 0 |
| K9 | `_critter_set_who_hit_me` calls `reactionSetValue(critter, -3)` on player attack | **Gap** — not ported; NPC attitude (LVAR[0]) does not automatically worsen when player attacks |

### 7.2 Visual Egg Gaps

| # | CE behaviour | DH2 status |
|---|---|---|
| E1 | Walls/scenery in front of player fade using egg FRM gradient mask | **Not implemented** — walls always opaque |
| E2 | Roof tiles at player's square rendered with egg circle cutout | **Not implemented** — roofs drawn fully opaque |
| E3 | `tile_fill_roof` skips interior roof tiles when player enters building | **Not implemented** (see `wiki/rendering.md` §3) |
| E4 | `OBJECT_TRANS_GLASS` objects render with glass blend table (~50% alpha) | **Not implemented** — no blend table; all objects render with standard `SRC_ALPHA` |
| E5 | `OBJECT_TRANS_STEAM`, `_ENERGY`, `_RED`, `_WALL` — each uses its own palette blend table | **Not implemented** |
| E6 | `OBJECT_TRANS_NONE` objects respect palette-index-0 transparency but are otherwise opaque | Partial — PNG alpha channel handles this correctly, but `OBJECT_TRANS_NONE` flag is never read |
| E7 | Critters inside the egg zone are still drawn opaque (intentional exclusion) | Correctly excluded by type check (moot since egg itself is missing) |
| E8 | `set_obj_transparency` as a script opcode | Does not exist in CE — `set_obj_visibility` is the real opcode and **is** implemented in DH2 |
| E9 | `tileIsInFrontOf` / `tileIsToRightOf` geometry functions | Not present in DH2; needed for egg and also for correct combat sight-line logic |
| E10 | Egg is reset / repositioned on elevation change synchronously with player | N/A (egg not present), but elevation change is handled in `changeElevation` (`map.ts`) |

<!-- audited: 2026-07-05 — R2 regression fixed (Rep_* stats now registered in statDependencies, skills.ts) -->
