# Companion & Party System

CE refs: `party_member.cc`, `interpreter_extra.cc`, `combat_ai.cc`, `stat.cc`  
DH2 refs: `src/party.ts`, `src/scripting.ts`, `src/gameTick.ts`, `src/playerUse.ts`, `src/saveload.ts`

Cross-references: see `wiki/ai_behavior.md` for AI packet details and party-member
combat distance preferences; see `wiki/combat.md` for the combatant enrolment loop.

---

## 1. Party Membership

### CE: Adding and Removing Members

Opcodes live in `interpreter_extra.cc`.

**`party_add` (0x8124)** → `opPartyAdd` → `partyMemberAdd(object)`
(`interpreter_extra.cc:3945`, `party_member.cc:375`):

1. Rejects if `gPartyMembersLength >= gPartyMemberDescriptionsLength + 20` (engine ceiling, not CHA limit).
2. Skips silently if the object or its PID is already in the list.
3. Assigns `object->id = (object->pid & 0xFFFFFF) + 18000`.
4. Sets flags `OBJECT_NO_REMOVE | OBJECT_NO_SAVE` (prevents the critter from being
   serialized with the map or removed by normal object deletion).
5. Sets `SCRIPT_FLAG_0x08 | SCRIPT_FLAG_0x10` on the critter's script so the script
   travels with the party across map transitions.
6. Calls `critterSetTeam(object, 0)` — team 0 is always the player's team.
7. Clears timed script events (`queueRemoveEventsByType`).

**`party_remove` (0x8125)** → `opPartyRemove` → `partyMemberRemove(object)`
(`interpreter_extra.cc:3962`, `party_member.cc:426`):

1. Finds the object in the list by pointer.
2. Clears `OBJECT_NO_REMOVE | OBJECT_NO_SAVE` so the critter can be saved with the map.
3. Decrements `gPartyMembersLength`.
4. Clears the script travel flags.

### Max Party Size

The engine does **not** enforce a CHA-based limit. The `partyMemberAdd` ceiling is
`gPartyMemberDescriptionsLength + 20` (roughly 35), which is never the real constraint.

The real limit is enforced by each companion's dialogue script, which calls:

```
metarule(METARULE_PARTY_COUNT, 0)  // returns _getPartyMemberCount()
```

and compares it against `1 + floor(CHA / 2)`. The Magnetic Personality perk adds
+1 to this cap. `METARULE_PARTY_COUNT` (ID 16) → `_getPartyMemberCount()` in
`party_member.cc:900`, which counts living, non-hidden critters in `gPartyMembers`.

DH2 enforces the limit inside `Party.maxSize()` (`party.ts:29`):

```ts
return 1 + Math.floor(player.getStat('CHA') / 2)
```

This matches the CE formula but is enforced engine-side rather than script-side.
Magnetic Personality perk adjustment is absent.

### Serialization

**CE** (`partyMembersSave`, `party_member.cc:520`):

- Saves `gPartyMembersLength` and each non-player member's object ID (for re-linking
  after load via `objectFindFirst`).
- Saves `PartyMemberLevelUpInfo` per known companion PID: `level`, `numLevelUps`,
  `isEarly` — the three fields that drive the probabilistic level-up schedule.
- Script LVARs are saved and restored per member via `_partyMemberPrepLoad` /
  `_partyMemberRecoverLoad` — a two-phase snapshot/restore around the save-file
  write that preserves script state and inventory item scripts.

**DH2** (`saveload.ts:89`, `party.ts:74`):

- `party.serialize()` calls `obj.serialize()` on each member and stores the result
  in `SaveGame.party`.
- `party.deserialize()` reconstructs members via `deserializeObj()`.
- LVARs and script state are **not** saved with party members.
- Level-up tracking (`level`, `numLevelUps`, `isEarly`) is **not** implemented or
  persisted.

---

## 2. Follow Logic

### CE

CE does not have a per-tick follow loop for non-combat situations. Instead:

- **Map transitions**: `_partyMemberSyncPosition()` (`party_member.cc:796`) is called
  when the player enters a new map. It places each visible party critter at an adjacent
  hex, alternating clockwise/counterclockwise from the player's facing, stepping out
  by 2 hexes for each successive member.
- **In combat**: `_cai_perform_distance_prefs()` (`combat_ai.cc:2968`) handles party
  member movement. With `DISTANCE_STAY_CLOSE`, a party member moves back toward the
  player if the hex distance exceeds `aiPartyMemberDistances[DISTANCE_STAY_CLOSE] = 5`.
  Out-of-combat patrol is handled by NPC scripts via `critter_p_proc` / timed events.

### DH2

`followPlayer()` (`party.ts:42`) is called every heartbeat tick when not in combat
(`main.ts:1124`):

```ts
if (hexDistance(member.position, player.position) > 5) {
    member.walkTo(player.position, false)
}
```

- Distance threshold: **5 hexes** — matches CE DISTANCE_STAY_CLOSE.
- `walkTo(player.position, false)` performs **immediate teleport**, not pathfinding.
  Companions can pass through walls, doors, and blocked tiles.

### Known Issues

- `walkTo()` with `immediate = false` in DH2's implementation still resolves to a
  direct position move without collision. True CE-style follow requires `_ai_move_steps_closer`
  via the pathfinder — not yet implemented. Tracked in ROADMAP.md Phase 5c.

### Edge Cases (CE behaviour, DH2 status unknown)

| Scenario | CE behaviour | DH2 status |
|---|---|---|
| Door in the way | AI pathfinder handles; party member queues open-door action | ❌ Not tested — teleport bypasses doors |
| Elevation change | `_partyMemberSyncPosition` places member at correct elevation on entry | ❌ Not implemented; elevation not checked in `followPlayer` |
| Combat active | AI distance loop in `_combat_ai`; follow loop suppressed | ✅ `followPlayer` skipped when `inCombat` |

---

## 3. Combat AI for Companions

### CE

CE uses a single flat `_combat_list` containing **every critter on the elevation**,
populated by `objectListCreate` at combat start (`combat.cc:2574`). The list is split
into two logical ranges within the same array:

- `_combat_list[0.._list_com-1]` — active combatants (take AI turns)
- `_combat_list[_list_com.._list_com+_list_noncom-1]` — non-combatants (wait to join)

Party members start in the non-combatant range. They are promoted to the combatant
range by `_combat_add_noncoms()` → `_combatai_want_to_join()` when:

- They are attacked by an enemy, or
- An enemy comes within perception range and the AI packet disposition triggers
  aggression.

Once promoted, a party member receives `_combat_turn()` → `_combat_ai()` calls,
identical to enemies (`combat_ai.cc:3053`). `_combat_ai` calls `aiGetPacket(a1)`
to load the critter's AI packet — there is no special companion code path; the same
packet-driven AI (weapon selection, distance prefs, flee threshold) runs for all
critters.

The one party-member-specific behaviour is in `_combat_ai` (`combat_ai.cc:3115`):
the `objectIsPartyMember(a1)` check suppresses the "wander away from dead friend"
logic that hostiles use.

### DH2

The combatants filter in `combat.ts`:

```ts
if (!obj.isPlayer && !triggerTeams.has(obj.teamNum) && !obj.hostile) return false
```

Party members have `teamNum = 0` (same as player) and are not marked `hostile`,
so they are **never enrolled** in the combatants array. They receive no AI turns
and cannot attack enemies or use items during combat.

There is no equivalent of `_combat_add_noncoms`, `_combatai_want_to_join`, or the
non-combatant promotion mechanism. Full implementation is tracked in ROADMAP.md Phase 4f.

---

## 4. XP Sharing and Level-Up

### CE

Companions do **not** receive XP directly. The mechanism is triggered by the player's
own level-up (`stat.cc:789`):

```c
if (a2) {
    _partyMemberIncLevels();   // fires on every player level-up
}
```

`_partyMemberIncLevels()` (`party_member.cc:1454`) iterates each party member that
has a `level_up_every` entry in `party.txt`. For each member:

1. Increments `numLevelUps` (count of player level-ups observed with this member).
2. Computes `levelMod = numLevelUps % level_up_every`.
3. If `levelMod == 0`: companion levels up (100% probability).
4. If `levelMod != 0`: companion levels up only if `random(0, 100) <= 100 * levelMod / level_up_every` (probabilistic "early" level-up).
5. If `isEarly` is set from a previous early level-up: skip until `levelMod` resets
   to 0, then clear `isEarly` and resume.

Level-up is performed by `_partyMemberCopyLevelInfo()` (`party_member.cc:1563`):
swaps the companion's proto data with the next entry in `level_pids[]` (the companion's
pre-authored stat-stage protos, up to `PARTY_MEMBER_MAX_LEVEL = 6`). This replaces
all SPECIAL stats, bonus stats, and skills wholesale — no per-level formula applies
to companions.

**Player** level-up formulas (for reference — not used by companions):

| Formula | CE source | Value |
|---|---|---|
| XP to reach level N | `stat.cc::pcGetExperienceForLevel` | `N * (N-1) / 2 * 1000` |
| HP per level | `stat.cc:771` | `floor(END / 2) + 2` (+ 4 per Lifegiver rank) |
| Skill points per level | character editor / skill system | `5 + 2 * INT` |

### DH2

No equivalent of `_partyMemberIncLevels` exists. Party members never level up.
Level-up tracking fields (`level`, `numLevelUps`, `isEarly`) are not stored or persisted.

---

## 5. Dismissal Hook

### CE

`opPartyRemove` (`interpreter_extra.cc:3962`) calls `partyMemberRemove()` directly —
**no script proc is fired by the opcode**.

The `talk_p_proc` fires during companion dismissal because the player enters
dialogue with the companion (via `game_dialog.cc:743`), which triggers `talk_p_proc`
as part of the standard dialogue-open sequence. Within that dialogue, the companion's
script decides to call `party_remove` as an opcode after the player selects "Leave".
The ordering is:

```
player talks to companion
  → talk_p_proc fires (dialogue system)
  → player picks "leave party" dialogue option
  → companion script calls party_remove opcode
  → partyMemberRemove() runs
```

The proc fires because of the dialogue open, not because `party_remove` triggers it.

### DH2

`party_remove` → `removePartyMember()` (`scripting.ts:1812`) — same engine behaviour,
no proc fired by the opcode. `talk_p_proc` is correctly fired by DH2's `talk()`
function (`scripting.ts:1974`) when dialogue opens.

**Actual DH2 gap**: No dismissal dialogue flow exists for any companion. There are
no companion dialogue scripts wired to a "leave party" node that would call
`party_remove`. Removal can only happen via engine-triggered `party_remove` opcode
calls. Tracked in ROADMAP.md Phase 5c ("dismissal dialogue hooks").

---

## 6. DH2 Implementation Status

| Mechanic | CE source | DH2 status |
|---|---|---|
| `party_add` opcode | `interpreter_extra.cc:3945` | ✅ `scripting.ts:1808` → `party.ts:addPartyMember` |
| `party_remove` opcode | `interpreter_extra.cc:3962` | ✅ `scripting.ts:1812` → `party.ts:removePartyMember` |
| Max size enforcement | Script-side: `metarule(16)` vs CHA/2 | ✅ Engine-side `Party.maxSize()` (`party.ts:29`); Magnetic Personality perk missing |
| Party serialization | `party_member.cc:partyMembersSave` | 🟡 Object state saved via `obj.serialize()`; LVARs, script state, level-up tracking not saved |
| Follow (out-of-combat) | `party_member.cc:_partyMemberSyncPosition` | 🟡 Per-tick `followPlayer()` works; teleports instead of pathfinds |
| Combat AI turns | `combat_ai.cc:_combat_ai`, `combat.cc:_combat_sequence_init` | ❌ Not enrolled in combatants list (`combat.ts`) |
| Non-combatant promotion | `combat.cc:_combat_add_noncoms` | ❌ Not implemented |
| Companion level-up | `party_member.cc:_partyMemberIncLevels` | ❌ Not implemented |
| Dismissal dialogue flow | NPC scripts + `party_remove` opcode | ❌ No companion dismissal dialogue wired |
| Control screen (disposition presets) | `game_dialog.cc:3354 partyMemberControlWindowInit` | ✅ `ui_companion.ts:uiCompanionControl` — see §8 |
| Customize screen (6-category) | `game_dialog.cc:~3780 partyMemberCustomizationWindowInit` | ✅ `ui_companion.ts:uiCompanionCustomize` — see §8 |
| Weight-based party trade | `inventory.cc:5031 inventoryOpenTrade`, weight check `inventory.cc:4710-4722` | ✅ `ui_companion_trade.ts:uiCompanionTrade` — see §8 |
| Use Best Weapon/Armor buttons | `combat_ai.cc:_ai_search_inven_weap/_ai_search_inven_armor` | ❌ Buttons present (correct CE layout), no-op — see §8 |

---

## 7. Known Gaps and Issues

**`walkTo` teleports, does not pathfind** (`party.ts:48`): `member.walkTo(player.position, false)` resolves to an immediate position update in DH2, bypassing all collision and pathfinding. True CE-style follow uses `_ai_move_steps_closer` which respects the pathfinder.

**Max size perk not applied**: `Party.maxSize()` returns `1 + floor(CHA / 2)` but does not check for the Magnetic Personality perk (+1 follower). CE enforces this in NPC scripts.

**LVARs lost on reload**: Companion script local variables are not saved with party members. Quests that depend on a companion's LVAR state (e.g. Sulik's personal quest progress) silently reset on reload.

**Level-up tracking not persisted**: Even if `_partyMemberIncLevels` were implemented, the `level`/`numLevelUps`/`isEarly` fields per companion are not in `SaveGame`.

**Companion combat immunity**: Party members take damage from AoE attacks (they are on the map and can receive hits), but they never act — they neither defend nor counterattack.

**New as of §8 (2026-06-18): disposition/customize settings persist but have no combat effect yet.** The control/customization screens correctly read and write a companion's effective AI packet (disposition presets, area-attack/run-away/best-weapon/distance/attack-who/chem-use), and those settings are saved with the game. But per "Companion combat immunity" above, party members are never enrolled in the combatants list at all (`combat.ts`) — they take no AI turns, so none of these settings currently change anything observable in a fight. They become meaningful the moment Combat AI turns / non-combatant promotion (ROADMAP Phase 4f) is implemented. This is an honest scope boundary, not an oversight: implementing full combat AI enrollment for companions is a separate, substantial undertaking tracked on its own.

---

## 8. Party Member Control & Customization Screens

CE ref: `game_dialog.cc` `partyMemberControlWindowInit/Update/HandleEvents` (~line 3354) and
`partyMemberCustomizationWindowInit/Update/HandleEvents` (~line 3780). All positions and FRM IDs
below were read directly from this source file and cross-checked against `lut/lst/art_intrface.json`
and actual file dimensions in `art/intrface/` — not inferred from general knowledge.

### 8.1 Triggering the screen

CE opens this screen as a *dialogue state transition*: `gameDialogEnter()` (`game_dialog.cc:732`)
sets `gGameDialogSpeakerIsPartyMember = objectIsPartyMember(speaker)`, and the companion's own
dialogue script decides whether to branch into dialogue state 8 (`partyMemberControlWindowInit`)
instead of a normal conversation node.

DH2 has no companion dialogue scripts with that branching logic, so the check is done directly:
pressing the `talkTo` key (default `t`) on a critter for which `globalState.gParty.isPartyMember()`
is true opens `uiCompanionControl()` instead of the normal `Scripting.talk()` flow
(`input.ts`, near the existing `Config.controls.talkTo` handler).

### 8.2 Control window layout (verified against source)

Background: FRM ID 390 → `control.png` (`game_dialog.cc:3357`, confirmed via
`lut/lst/art_intrface.json[390] === "control"`), 640×190px.

**Main action buttons** — all 14×14, the generic dialogue red button (`di_rdbt2.png`=up,
`di_rdbt1.png`=down), `game_dialog.cc:3388-3418`:

| Button | x,y | Key | CE handler |
|---|---|---|---|
| Talk | 593,41 | Escape | re-enters companion dialogue (closes screen in DH2 — no dialogue re-entry hook exists) |
| Trade | 593,97 | D | `inventoryOpenTrade()` → DH2 `uiCompanionTrade()` |
| Use Best Weapon | 236,15 | W | `_ai_search_inven_weap` + `_inven_wield` — **not implemented in DH2** (see 8.5) |
| Use Best Armor | 235,46 | A | `_ai_search_inven_armor` + `_inven_wield` — **not implemented in DH2** |

**Disposition buttons** — 109×28 each, x=438, verified against `gGameDialogDispositionButtonsData`
(`game_dialog.cc:386-390`) and the `Disposition` enum (`combat_ai_defs.h:66`,
`ai->disposition = enumValue - 1`):

| y | Disposition | FRM up/down/disabled | Key | `aiSetDisposition` value |
|---|---|---|---|---|
| 37 | Berserk | berup/berdn/beroff | 2098 | 4 |
| 67 | Aggressive | aggup/aggdn/aggoff | 2103 | 3 |
| 96 | Defensive | defup/defdn/defoff | 2102 | 2 |
| 126 | Coward | cowup/cowdn/cowoff | 2111 | 1 |
| 156 | Custom | cusup/cusdn/cusoff | 2099 | 0 (opens §8.3) |

The currently-active disposition's button renders in its "down" (pressed) state
(`_win_set_button_rest_state`, `game_dialog.cc:3488`); a disposition with no sibling packet
authored for this companion (see 8.4) renders "disabled" and isn't clickable.

### 8.3 Customization window layout (verified against source)

Background: FRM ID 391 → `custom.png`, 640×190px. Message file: `game\custom.msg`
(`messageListLoad`, `game_dialog.cc:3790`).

**Six category buttons** — 109×28 each, verified against `_custom_button_info`
(`game_dialog.cc:446-452`):

| y | x | Category | FRM up/down | CE enum source |
|---|---|---|---|---|
| 9 | 95 | Area attack mode (burst safety) | burstup/burstdn | `AreaAttackMode` |
| 38 | 96 | Run away mode | runup/rundn | `RunAwayMode` |
| 68 | 96 | Best weapon | weapup/weapdn | `BestWeapon` |
| 98 | 96 | Distance | distup/distdn | `DistanceMode` |
| 127 | 96 | Attack who | attackup/attackdn | `AttackWho` |
| 157 | 96 | Chem use | chemup/chemdn | `ChemUse` |

Per-category value text options (5-6 each, `_custom_settings`, `game_dialog.cc:394-441`) are
reproduced verbatim from the CE source comments in `ui_companion.ts`'s `CUSTOM_OPTIONS` table.

CE presents the value picker by reusing the normal dialogue option-list rendering
(`_gdCustomSelect`, `game_dialog.cc:3966`). DH2 builds a small dedicated modal instead
(`uiCustomCategoryPicker` in `ui_companion.ts`), using the same `cussel.png` background
(FRM 419, 444×206px) CE uses for this sub-window — wiring the value picker through DH2's full
dialogue state machine for the same visual result would have been substantially more invasive.

### 8.4 Disposition switching mechanism

CE's `aiSetDisposition()` (`combat_ai.cc:903`) switches a critter's active AI packet via **packet-
number arithmetic**: `newPacketNum = currentPacketNum - (targetDispositionOffset -
currentDispositionOffset)`. This only produces correct results if a companion's 5 disposition-variant
packets are laid out in `ai.txt` with a perfectly consistent relative offset matching the
`Disposition` enum's numeric deltas.

Inspecting `data/data/ai.txt` directly (e.g. the "PARTY BESS" block starting ~line 2625) shows the
on-disk packet order is **AGGRESSIVE, BERSERK, COWARD, CUSTOM, DEFENSIVE** — which does *not* line up
arithmetically with the enum deltas (verified by hand: the formula gives the wrong packet for at
least the BERSERK↔COWARD pair). Whether this is a genuine quirk of the original data or a
misreading of `packet_num` semantics wasn't fully resolved — but rather than depend on it, DH2 uses
a more robust mechanism the data already supports directly: **every companion disposition packet's
section header is literally named `PARTY <NAME> <DISPOSITION>`** (e.g. `[PARTY BESS AGGRESSIVE]`,
`[PARTY BESS BERSERK]`, ...). `findCompanionPacketForDisposition()` (`aiPackets.ts`) finds the
sibling packet for a different disposition by swapping the trailing word in the current packet's
name and looking up the exact match — correct regardless of on-disk packet ordering.

`setCompanionDisposition()` (`party.ts`) calls this, then re-points `critter.aiNum` at the new
packet and (if an `AI` instance already exists for this critter) immediately updates
`critter.ai.packet` too, so the change takes effect without waiting for the critter to next enter
combat. Switching to anything other than `'custom'` clears `critter.customAiOverrides`.

`setCompanionCustomSetting()` applies one field override on top of the companion's `'custom'`
packet (cloned, never mutating the shared canonical packet object keyed by `packetNum` in
`aiPackets.ts`'s module-level map). Overrides are stored on `Critter.customAiOverrides` (added to
`SERIALIZED_CRITTER_PROPS` so they persist with the save) and merged onto the base packet by `AI`'s
constructor (`combat/AI.ts`) — so a Custom session's chosen values survive the `AI` instance being
torn down and recreated across multiple combats.

### 8.5 Known simplifications

- **Use Best Weapon / Use Best Armor are not implemented.** CE's `_ai_search_inven_weap`/
  `_ai_search_inven_armor` (`combat_ai.cc`) compare every weapon/armor in the companion's inventory
  by AP cost, ammo availability, and damage output to pick the best one — a substantial heuristic
  sub-system of its own. The buttons exist in the UI (correct CE position/art) but currently just
  log a console notice rather than silently do nothing or guess at a half-correct heuristic.
- **CE's palette-shade button "shimmer" / dialogue-window scroll-in animation are not replicated** —
  DH2's screens are static panels, consistent with the simplification already applied to the combat
  outline effect (`wiki/rendering.md` "Combat Outline Effect").
- **Talk button doesn't re-enter dialogue.** CE's Talk button returns to the companion's normal
  dialogue node; DH2 just closes the control screen, since there's no companion dialogue tree to
  return to in the first place (see §6 "Dismissal dialogue flow" gap).
- **Weight-based trade reuses the shop barter screen's DOM/CSS** (`#barterBox`, background
  `barter.png`) rather than a dedicated companion-trade panel — this is actually consistent with CE,
  which uses the *same* `inventoryOpenTrade()` function for both shops and party members, just with
  a different accept-check (weight vs. money fairness — see `inventory.cc:4710-4722`).

### 8.6 Files

`src/ui_companion.ts` (control + customize screens), `src/ui_companion_trade.ts` (weight-based
trade), `src/party.ts` (`setCompanionDisposition`, `setCompanionCustomSetting`,
`getCompanionEffectivePacket`), `src/aiPackets.ts` (`findCompanionPacketForDisposition`),
`src/object/Critter.ts` (`customAiOverrides` field), `src/combat/AI.ts` (override merge in
constructor), `src/ui_panels.ts` (`UIMode.companionControl`), `src/input.ts` (trigger).
