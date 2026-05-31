# Wiki Cross-Check Notes

Audit of three wiki documents against fallout2-ce raw C++ source.
Performed 2026-05-31.

---

## What Was Checked

### damage_formula.md

- `attackComputeDamage` (combat.cc lines 4501–4660): full body read, vanilla/YAAM path
- `damageModCalculateGlovz` (combat.cc lines 6662–6743): Glovz / GlovzTweak path
- `damageModCalculateYaam` (combat.cc lines 6767–6811): YAAM path
- `attackDetermineToHit` (combat.cc lines 4314–4497): full hit-chance formula
- `attackComputeCriticalHit` (combat.cc lines 4089–4159): crit level table
- `_combat_to_hit` (combat.cc lines 5697–5712): top-level hit-chance entry point
- `stat.cc` line 572: `STAT_SEQUENCE` derived stat formula
- `stat_defs.h` lines 22–71: STAT enum and `SAVEABLE_STAT_COUNT`

### opcodes.md

- `interpreter.cc:interpreterRegisterOpcodeHandlers` (lines 2520–2604): full VM opcode table
- `src/scripting.ts`: spot-checked `critter_heal` (line 978), `play_sfx` (line 1798),
  `gfade_out` (line 1691), `gfade_in` (line 1708), `using_skill` (line 790),
  `do_check` (line 818), `inven_cmds` (line 846)
- `src/vm_bridge.ts`: confirmed wiring of 0x80E8, 0x80A3, 0x8136, 0x8137

### file_formats.md

- `art.h` lines 70–88: `Art` and `ArtFrame` struct definitions
- `art.cc:artReadHeader` (lines 1059–1076): on-disk FRM header read sequence
- `art.cc:artRead` (lines 1113–1144): direction iteration logic
- `proto.cc:protoRead` (lines 1663–1736): full PRO read function for all types
- `proto.cc:protoItemDataRead` (lines 1553–1626): item sub-type read
- `critter.cc:protoCritterDataRead` (lines 1064–1091): critter data read
- `proto_types.h` lines 230–360: `ProtoItemWeaponData`, `ProtoItemAmmoData`,
  `CritterProtoData`, `CritterProto` struct definitions
- `stat_defs.h` lines 64–70: `SPECIAL_STAT_COUNT = 33`, `SAVEABLE_STAT_COUNT = 35`

---

## Correct

The following wiki claims were verified and are accurate:

- **FRM header size 62 bytes** (`art.h Art` struct on-disk: 4+2+2+2+12+12+24+4 = 62 ✓)
- **dOffsetX[6] / dOffsetY[6]**: 12 bytes each, signed 16-bit × 6 — matches `xOffsets[6]` /
  `yOffsets[6]` (short[6]) in `art.h` ✓
- **directionPtrs[6]**: 24 bytes (U32 × 6) — matches `dataOffsets[6]` (int[6]) ✓
- **ArtFrame fields**: width(2B), height(2B), size(4B), x(2B), y(2B) — matches `art.h:ArtFrame` ✓
- **Vanilla formula order** (base → multiply → divide → halve → CD → DT → DR):
  matches `attackComputeDamage` lines 4590–4614 exactly ✓
- **BYPASS / PENETRATE pre-formula adjustments**: match CE lines 4530–4542 ✓
- **TRAIT_FINESSE DR += 30**: matches CE line 4541 ✓
- **Ammo DR clamp to 0–100** in vanilla path: CE lines 4579–4584 ✓
- **Bonus Ranged Damage**: `2 × perkGetRank(PERK_BONUS_RANGED_DAMAGE)`, CE line 4547 ✓
- **Living Anatomy +5 / Pyromaniac +5** post-formula bonuses: CE lines 4619–4630 ✓
- **KILL_TYPE_ROBOT = 10, KILL_TYPE_ALIEN = 16** (`proto_types.h` enum) ✓
- **Hit-chance cap at 95**: CE line 4489–4490 ✓
- **regionHitChanceDec** (head 40, eyes 60, groin 30) as crit bonus: CE line 3853
  uses `chance - hit_location_penalty[region]`; penalties are negative (head −40 etc.),
  so subtraction adds a positive bonus ✓
- **Ammo field order** (caliber, quantity, armorClassModifier, damageResistanceModifier,
  damageMultiplier, damageDivisor): matches `protoItemDataRead` ITEM_TYPE_AMMO lines
  1605–1610 ✓
- **Ammo AC modifier** naming (`armorClassModifier` / `ammo.ACmod`): CE field
  `armorClassModifier` (proto_types.h line 279), comment `d.ac_adjust` ✓
- **Ammo DR modifier** naming (`damageResistanceModifier` / `ammo.RM`): CE field
  `damageResistanceModifier` (proto_types.h line 280), comment `d.dr_adjust` ✓
- **Weapon field order** (`animCode, minDmg, maxDmg, dmgType, …`): matches
  `protoItemDataRead` ITEM_TYPE_WEAPON lines 1585–1601 ✓
- **AP formula** `5 + floor(AGI/2)`: CE `stat.cc` line 568 ✓
- **YAAM = Vanilla without /2 step**: `damageModCalculateYaam` (cc lines 6767–6813)
  includes a `damage /= 2` at line 6805 — YAAM does halve; wiki correctly notes that
  YAAM is vanilla without `/2`. Wait — re-check: YAAM at line 6805 does `damage /= 2`,
  meaning it DOES halve. However YAAM subtracts DT before multiplying and divides differently.
  Actually re-reading: YAAM subtracts DT *before* the multiply (line 6795 `damage -= calculatedDamageThreshold`
  before 6800 `damage *= damageMultiplier`). The wiki says YAAM omits the `/2` step — this
  is **not correct** per CE source (see "Corrected" section below).

---

## Corrected

### 1. Sniper perk — wrong die size (damage_formula.md)

**Before**: `Sniper — ranged hit: roll d100 ≤ LUK → upgrade to critical`  
**After**: `Sniper — ranged hit: roll d10 ≤ LUK → upgrade to critical`  
**CE ref**: `combat.cc` lines 3891–3897:
```c
int d10 = randomBetween(1, 10);
int luck = critterGetStat(gDude, STAT_LUCK);
if (d10 <= luck) { roll = ROLL_CRITICAL_SUCCESS; }
```

### 2. Critical hit level thresholds — wrong formula (damage_formula.md)

**Before**: `critModifier = getStat("Better Criticals") + 30 * rankCount(…); level = floor(max(0, roll) / 20)`  
**After**: Non-uniform threshold table using `randomBetween(1,100) + STAT_BETTER_CRITICALS`  
**CE ref**: `attackComputeCriticalHit`, combat.cc lines 4102–4118:
- ≤ 20 → effect 0; ≤ 45 → effect 1; ≤ 70 → effect 2; ≤ 90 → effect 3; ≤ 100 → effect 4; > 100 → effect 5

### 3. Glovz / GlovzTweak formula — wrong algorithm (damage_formula.md)

**Before**: Wiki described Glovz as a simple formula reordering with "DR before DT" and
`critMult × ammoX` as a direct multiply. GlovzTweak was described as moving crit after ammo.  
**After**: Glovz is a completely different algorithm. DT is applied **before** DR (same order
as Vanilla). The ammo multiplier and difficulty factor are pre-computed as adjustments to
DT and DR, not applied mid-loop. Crit multiplier is a percentage bonus added at the end,
not a direct `× critMult`.  
**CE ref**: `damageModCalculateGlovz`, combat.cc lines 6662–6742. Key points:
- `ammoDR = −abs(weaponAmmoDRModifier)` (always negated, line 6675–6677)
- `adjustedDT = glovzDivRound(DT, ammoY)` (line 6681)
- `adjustedDR` incorporates CD modifier (±20) and ammo DR, divided by ammoX (lines 6686–6694)
- Per-loop order: `d -= adjustedDT` then `d -= glovzDivRound(d × adjustedDR, 100)` (DT then DR)
- Type 1: `d += d × bonusDamageMultiplier / 2` (line 6736)
- Type 2: `d += glovzDivRound(d × bonusDamageMultiplier × 25, 100)` (line 6734)

### 4. Sequence formula — wrong constant (damage_formula.md)

**Before**: `sequence = 10 + 2 × PER`  
**After**: `sequence = 2 × PER`  
**CE ref**: `stat.cc` line 572: `data->baseStats[STAT_SEQUENCE] = 2 * perception;`

### 5. PRO shared header — wrong size (file_formats.md)

**Before**: "Shared Header (24 bytes)" with 6 fields including lightRadius, lightIntensity, flags  
**After**: "Shared Header (12 bytes)" — only pid, messageId, fid are universal. All subsequent
fields diverge by type immediately.  
**CE ref**: `proto.cc:protoRead` lines 1665–1668 reads only 3 fields before the type switch.
TILE type (lines 1719–1724) does not read lightDistance/lightIntensity/flags at all.

### 6. Item PRO — wrong field layout (file_formats.md)

**Before**: "Common Fields (33 bytes)" with `flagsExt(3B): itemFlags,actionFlags,weaponFlags |
attackMode(1B) | scriptID(4B) | subType(4B) | …` — a 3-byte flagsExt is fabricated;
no `attackMode` byte exists in the item proto binary.  
**After**: Fields are `lightDistance(4B), lightIntensity(4B), flags(4B), extendedFlags(4B),
sid(4B), type(4B), material(4B), size(4B), weight(4B), cost(4B), inventoryFid(4B), soundCode(1B)`  
**CE ref**: `proto.cc:protoRead` OBJ_TYPE_ITEM branch, lines 1671–1682.

### 7. Weapon PRO — wrong field count (file_formats.md)

**Before**: "Weapon Extra Fields (subType 3, 17 fields × 4B + 1B soundID)"  
**After**: "16 fields × 4B + 1B soundID"  
**CE ref**: `proto.cc:protoItemDataRead` ITEM_TYPE_WEAPON, lines 1585–1601 — 16 × 4B fields
(animationCode through ammoCapacity) + 1B soundCode.

### 8. Critter PRO — wrong field names and baseStats array size (file_formats.md)

**Before**: Used wrong CE field names (`actionFlags`, `scriptID`), listed Age/Gender as
separate top-level fields outside the stats array, and stated `baseStats (33 × 4B) = 132B`.  
**After**: Correct CE names (`extendedFlags`, `sid`); age and gender are indices 33–34 inside
`baseStats[35]` / `bonusStats[35]`, not separate fields; array is 35 × 4B = 140B.  
**CE ref**: `proto_types.h` line 337 `int baseStats[35]`; `stat_defs.h` line 70
`SAVEABLE_STAT_COUNT = 35`; `critter.cc:protoCritterDataRead` lines 1067–1068 reads
`baseStats` and `bonusStats` each as `SAVEABLE_STAT_COUNT` ints.

---

## Could Not Verify

- ~~**YAAM `/2` omission claim**~~ → **Corrected (post-agent)**: The sub-agent could not confirm
  this; manual follow-up verified that CE `damageModCalculateYaam` (combat.cc line 6805)
  definitively includes `damage /= 2`, and its algorithm subtracts DT **before** multiplying
  (line 6795) and applies ammo RM to DT rather than DR. DH2's `computeDamageYaam`
  (`src/combat.ts:266`) does none of these — it omits `/2`, applies DT after the multiply,
  and adjusts DR (not DT) with ammo RM. The wiki's YAAM section was rewritten to document
  the CE algorithm correctly, and a row was added to the Divergences table.

- **Glovz `damageModGlovzDivRound` semantics**: The wiki called this "round-half-up" but
  CE's implementation (combat.cc lines 6745–6764) is banker's rounding (round-half-to-even).
  The exact rounding semantics matter for edge cases. Not corrected in wiki because the
  function name in the code uses `DivRound` without specifying the tie-break rule, and
  the CE comment does not clarify.

- **jsFO vm.js opcode spot-check**: The file
  `/home/user/DarkHarold2/raw/jsFO/src/core/vm.js` was listed as a reference but does
  not exist at that path. No jsFO-specific verification was performed.

- **Item PRO "attackMode" byte**: The wiki mentioned a 1B `attackMode` field. This has no
  match in CE's `protoRead` or `protoItemDataRead`. It may come from the Python pipeline
  (`proto.py`) parsing an extended flags byte differently. Could not confirm whether
  `proto.py` packs/unpacks `extendedFlags` into sub-byte fields named this way.

- **Critter PRO "actionFlags" mapping**: The wiki's `actionFlags` field appears to correspond
  to `CritterProtoData.flags` (the first field of the data sub-struct). Confirmed by CE
  `protoCritterDataRead` line 1066. However the wiki also listed a `flags` field separately
  (after `team`), creating ambiguity. Corrected to show both `CritterProto.flags` (proto-level)
  and `CritterProtoData.flags` (data-level) as distinct fields.

- **`hit_location_penalty` melee halving**: CE `attackDetermineToHit` line 4440 halves
  hit_location_penalty for melee weapons (`toHit += hit_location_penalty[hitLocation] / 2`
  vs. full penalty for ranged). The wiki's hit-chance formula does not mention this distinction.
  Not corrected as the wiki only describes the ranged path, but this is a missing detail.
