# DarkHarold2 — Holodisk System

**Audited:** 2026-06-01  
**CE ref:** `raw/fallout2-ce/src/pipboy.cc` (`holodiskInit`, `holodiskFree`,
`pipboyRenderHolodiskText`, `pipboyWindowRenderHolodiskList`,
`pipboyWindowHandleStatus`),
`raw/fallout2-ce/src/proto_instance.cc` (`_obj_use_misc_item`, `_protinst_default_use_item`),
`raw/fallout2-ce/src/proto_types.h` (item type enum),
`raw/fallout2-ce/src/game_vars.h` (GVAR constants),
`raw/fallout2-ce/src/interpreter_extra.cc` (`opSetGlobalVar`, `opAddObjectToInventory`)  
**DH2 ref:** `src/ui_pipboy.ts` (ARCHIVES tab — quest log only; no holodisk section),
`src/object.ts` (`Obj.use()` — misc item use path),
`src/pro.ts` (`getPROSubTypeName` — misc subtype mapping),
`src/scripting.ts` (`add_obj_to_inven`, `obj_carrying_pid_obj`, `set_global_var`),
`src/questData.ts` (two quest entries referencing holodisks as quest items)

---

## 1. CE Holodisk Data Model

### 1.1 Item Classification

Holodisks are **not** a distinct item type in the proto system. They are
`ITEM_TYPE_MISC` (value 5, `proto_types.h:32`) items — the same type used for
Geiger Counters, Stealth Boys, and the Motion Sensor. The engine does not
distinguish holodisks from other misc items by type alone.

A holodisk item is identified by its individual PID (Prototype ID). Each
physical holodisk object in the game world has:
- A PRO file in `proto/items/` defining its FID, weight, and carry weight
- Optionally an attached script that runs `use_p_proc` when the item is used,
  which calls `set_global_var` to flip the holodisk's Pip-Boy GVAR

The physical item and the Pip-Boy display are **decoupled**: the Pip-Boy only
checks the GVAR — it never inspects the player's inventory. A holodisk can be
shown in the Pip-Boy without the player having the item, and a holodisk item
can be in inventory without showing in the Pip-Boy (if its GVAR is never set).

### 1.2 holodisk.txt — The Master Registry

`data\holodisk.txt` is the flat text file that tells the engine which holodisks
exist. Loaded once at Pip-Boy init by `holodiskInit()` (`pipboy.cc:2525`):

```
# Format: gvar_index  name_msg_id  description_msg_id_base
```

Each non-comment, non-blank line contains three whitespace/comma-delimited tokens:

| Token | Field | Meaning |
|---|---|---|
| 1 | `gvar` | Index into `gGameGlobalVars[]`; nonzero = holodisk acquired |
| 2 | `name` | Message ID in `pipboy.msg` — the display name |
| 3 | `description` | Base message ID in `pipboy.msg` for the text content |

The parsed result is stored in `gHolodiskDescriptions[gHolodisksCount]` as
`HolodiskDescription { int gvar; int name; int description; }` (`pipboy.cc:169`).

### 1.3 HolodiskDescription Struct

```c
typedef struct HolodiskDescription {
    int gvar;         // GVAR index (into gGameGlobalVars)
    int name;         // pipboy.msg ID for the holodisk name
    int description;  // pipboy.msg base ID for page 1 line 1
} HolodiskDescription;
```

(`pipboy.cc:169`)

### 1.4 Text Content Format

Text is stored as sequential message IDs in `pipboy.msg`, starting at
`holodisk->description`. Reading iterates forward one ID at a time until the
sentinel string `"**END-DISK**"` is found, or 500 IDs have been consumed
(`pipboy.cc:1286`). Each message ID is one line of rendered text.

Pagination:
- 35 lines per page (`PIPBOY_HOLODISK_LINES_MAX = 35`, `pipboy.cc:62`)
- Page 0 shows the holodisk name as an underlined centered header, then text
- Subsequent pages show the page indicator `"X of Y"` at top-right
- `gPipboyHolodiskLastPage` tracks the last page index

---

## 2. CE Acquisition Flow

There is no single "holodisk acquisition" function. Scripts set the GVAR
directly using `set_global_var` (opcode `0x80C6`, `interpreter_extra.cc:1219`).
The physical item and the GVAR set are two separate acts that scripts perform
in the same procedure.

**Typical pattern in a map or NPC script:**

1. Player loots a container or has dialogue with an NPC.
2. Script calls `add_obj_to_inven(gDude, holodisk_item)` (opcode `0x80D8`) to
   put the item in the player's inventory.
3. Script calls `set_global_var(GVAR_HOLODISK_XXX, 1)` to mark it as available
   in the Pip-Boy.

Some holodisks are "virtual" — the GVAR is set but no item object is created;
the player gets the information without a physical holodisk. Some dialogue
scenes set the GVAR directly without giving an item (e.g. an NPC reads the disk
aloud and the Pip-Boy records the content).

### 2.1 What Happens When the Player Uses a Holodisk Item

Using a misc item dispatches to `_protinst_default_use_item()` in
`proto_instance.cc`, which for `ITEM_TYPE_MISC` calls the chain:

1. `_obj_use_book(item)` — checks if item is a readable book; returns -1 if not
2. `_obj_use_flare(critter, item)` — checks if item is a flare; returns -1 if not
3. **`_obj_use_misc_item(item)`** (`proto_instance.cc:986`) — hardcoded PID
   switch for a small set of misc items (Ramirez Box, Raiders Map, Cat's Paw
   Issue 5, Pip-Boy Enhancers, Survey Map). If the item's PID matches, it runs
   the item's `use_p_proc` script.
4. If none match: "That does nothing" message.

Holodisk items are **not** in the hardcoded PID switch inside `_obj_use_misc_item`.
Instead, they reach this function via `_protinst_default_use_item` → back to
using the item's attached script if it has one. An NPC or container script
typically sets the GVAR *before* the item even enters the inventory, so using
the item a second time would be redundant. In practice, holodisk items in
inventory are passive carry-weight items — their script fires on pickup/dialogue,
not on player use.

---

## 3. CE Pip-Boy Integration (STATUS Tab)

The holodisk list appears in the **DATA column** (right side) of the STATUS tab.
Quests appear in the QUESTS column (left side). Both share the same tab handler
`pipboyWindowHandleStatus()` at `pipboy.cc:874`.

### 3.1 Building the List

On STATUS tab entry (`a1 == 1024`):
1. `gPipboyWindowHolodisksCount` is reset to 0.
2. The engine scans `gHolodiskDescriptions[0..gHolodisksCount-1]`; for each
   where `gGameGlobalVars[holodisk->gvar] != 0`, increments the count
   (`pipboy.cc:894`).
3. `pipboyWindowRenderHolodiskList(-1)` renders all acquired holodisk names in
   the DATA column, using `pipboy.msg` ID `holodisk->name` for each
   (`pipboy.cc:1419`).
4. The function returns the count of rendered holodisks.
5. Buttons are created for: all quest locations + all holodisks + 1 (back
   button): `pipboyWindowCreateButtons(2, questCount + holodiskCount + 1, false)`
   (`pipboy.cc:912`).

### 3.2 Selecting a Holodisk

When the player clicks a holodisk name in the DATA column
(`gPipboyMouseX > 429`):
1. The engine searches `gHolodiskDescriptions` for the Nth acquired holodisk
   (matching by button click index), stores its array index in `_holodisk`
   (`pipboy.cc:934`).
2. `_holo_flag = 1` — marks that holodisk text view is active.
3. `_view_page = 0` — resets to page 1.
4. `pipboyRenderHolodiskText()` renders the text content (`pipboy.cc:961`).

### 3.3 Paging

Page Up / Page Down in the open Pip-Boy window (`pipboy.cc:470`):
- Page Up: decrements `_view_page` if `_view_page > 0`, calls `pipboyRenderHolodiskText()`
- Page Down: increments `_view_page` if `_view_page <= gPipboyHolodiskLastPage`,
  calls `pipboyRenderHolodiskText()`

### 3.4 DATA Column Header

Rendered only when at least one holodisk is acquired, using pipboy.msg ID 211
("DATA") as an underlined, centered column header (`pipboy.cc:1432`).

---

## 4. Known Holodisks in Fallout 2

GVAR constants from `game_vars.h` that correspond to holodisk entries in
`holodisk.txt`:

| GVAR constant | Location | Description |
|---|---|---|
| `GVAR_HOLODISK_SIERRA_EVACUATION` | Sierra Army Depot | Evacuation orders |
| `GVAR_HOLODISK_SIERRA_MED_LOG` | Sierra Army Depot | Medical log |
| `GVAR_HOLODISK_SIERRA_EXP_LOG` | Sierra Army Depot | Experiment log |
| `GVAR_SIERRA_GNN_HOLODISK` | Sierra Army Depot | GNN broadcast |
| `GVAR_SIERRA_MISSION_HOLODISK` | Sierra Army Depot | Mission briefing |
| `GVAR_NCR_FAKE_VAULT13_HOLODISK` | NCR | Fake Vault 13 map |
| `GVAR_HOLODISK_MB_OUTSIDE` | Military Base | Level 0 (surface) |
| `GVAR_HOLODISK_MB_LEVEL_1` | Military Base | Level 1 |
| `GVAR_HOLODISK_MB_LEVEL_2` | Military Base | Level 2 |
| `GVAR_HOLODISK_MB_LEVEL_3` | Military Base | Level 3 |
| `GVAR_HOLODISK_MB_LEVEL_4` | Military Base | Level 4 |
| `GVAR_ELRON_HOLODISK` | San Francisco | Shi-related |
| `GVAR_HOLODISK_ENCLAVE_SECURITY` | Enclave Oil Rig | Security protocol |
| `GVAR_HOLODISK_ENCLAVE_STATE` | Enclave Oil Rig | State department |
| `GVAR_HOLODISK_ENCLAVE_WORD` | Enclave Oil Rig | Codebook |
| `GVAR_HOLODISK_ENCLAVE_CHEMICAL` | Enclave Oil Rig | Chemical formula |
| `GVAR_HOLODISK_ENCLAVE_ATOMIC` | Enclave Oil Rig | Atomic protocols |
| `GVAR_VAULT_CITY_DESIGNER_NOTES` | Vault City | Designer notes |

Quest-related (holodisk as a carried quest item, not Pip-Boy readable):

| GVAR constant | Description |
|---|---|
| `GVAR_VAULT_DELIVER_HOLODISK` | Vault City delivery quest — tracking GVAR |
| `GVAR_QUEST_DELIVER_HOLODISK` | Vault City delivery quest — Pip-Boy quest entry |

---

## 5. DH2 Implementation Status

### 5.1 Item Prototype (pro.ts)

`pro.ts:getPROSubTypeName()` maps item subtype 5 to `'misc'` (matching CE's
`ITEM_TYPE_MISC = 5`). Holodisk items in `proto/items/` load correctly as misc
items with `obj.subtype = 'misc'`. No crash, no gap here — the proto layer
works. ✅

### 5.2 Inventory Addition (scripting.ts)

`add_obj_to_inven` (scripting.ts:734, vm_bridge.ts wired at `0x80D8`) adds items
to `obj.inventory`. Scripts that call `add_obj_to_inven(gDude, holodisk_item)`
will place the holodisk item in the player's inventory correctly. ✅

`obj_carrying_pid_obj` (scripting.ts:740, wired at `0x810D`) checks whether an
object carries an item with a given PID. This works for holodisk items. ✅

`set_global_var` (scripting.ts, wired at `0x80C6`) sets GVARs. Scripts that
call `set_global_var(GVAR_HOLODISK_XXX, 1)` will set the GVAR correctly. ✅

### 5.3 Misc Item Use (object.ts)

`Obj.use()` (`object.ts:725`) dispatches based on `this.subtype`. Misc items
(`subtype === 'misc'`) fall through to the default `this.singleAnimation()` path
— they play their idle animation and do nothing else at the engine level.
For holodisk items that have a script with `use_p_proc`, the script fires first
(line 731). If the script calls `set_global_var`, the GVAR is set. This
mirrors CE's behaviour (CE holodisk use also goes to the item's script). ✅

### 5.4 Pip-Boy DATA Column (ui_pipboy.ts)

**Not implemented.** `ui_pipboy.ts` has no holodisk data, no `holodisk.txt`
loading, no GVAR scan for holodisk visibility, and no DATA column renderer.

The ARCHIVES tab (`renderArchivesTab()`, `ui_pipboy.ts:548`) renders the quest
log — it is a remap of CE's VIDEO ARCHIVES tab, not CE's STATUS DATA column.
There is no equivalent to CE's STATUS tab DATA column in DH2. ❌

### 5.5 Text Content (pipboy.msg)

`pipboy.msg` (or its DH2 equivalent) is not loaded anywhere in DH2. The
holodisk text content stored as sequential entries in `pipboy.msg` is not
accessible. ❌

---

## 6. Known Gaps

### Gap #1 — No holodisk.txt loading

CE loads `data\holodisk.txt` at Pip-Boy init (`holodiskInit()`). DH2 has no
equivalent. The `HolodiskDescription` registry (GVAR index → name msg ID →
text base msg ID) does not exist in DH2. To implement: load `data/holodisk.txt`
(or its JSON equivalent) at startup; populate a holodisk registry.

### Gap #2 — No pipboy.msg text store

CE renders holodisk text by reading `pipboy.msg` entries
`holodisk->description` through `"**END-DISK**"`. DH2 does not load `pipboy.msg`.
To implement: load `pipboy.msg` and make it queryable by message ID
(same infrastructure needed for quest/holodisk display in CE STATUS tab).

### Gap #3 — No Pip-Boy DATA column

The CE STATUS tab has a two-column layout: QUESTS (left) and DATA (right). DH2's
ARCHIVES tab shows only the quest log (CE VIDEO ARCHIVES mapping) with no DATA
column. Holodisks have no display surface in DH2 at all.

### Gap #4 — GVAR → holodisk visibility never checked

Even if GVARs are correctly set by map scripts, nothing in DH2 reads them to
determine holodisk availability. The scan loop in `pipboyWindowHandleStatus()`
(`gGameGlobalVars[holodisk->gvar] != 0`) has no DH2 equivalent.

### Gap #5 — Holodisk text pagination not implemented

CE paginates holodisk text at 35 lines per page and supports Page Up / Page Down
within the Pip-Boy. DH2 has no pagination infrastructure for Pip-Boy content.

### Gap #6 — No holodisk data in DH2 source

There are no holodisk-related constants, data structures, or rendering paths
anywhere in DH2's TypeScript source. All five gaps above would need to be built
from scratch.

---

## 7. Implementation Notes (if adding holodisk support)

Minimum viable path following CE architecture:

1. **Data file**: Ship `data/holodisk.json` (converted from `holodisk.txt` by the
   asset pipeline) with entries `[gvar, nameId, descBase]`.
2. **Text file**: Load `pipboy.msg` entries into a `Map<number, string>` at
   startup — same map used for quest names and holodisk text.
3. **Registry**: On Pip-Boy open, scan holodisk entries where
   `globalState.gvars[entry.gvar] !== 0` to build the visible list.
4. **ui_pipboy.ts**: Add DATA column to `renderStatusTab()` (currently renders
   HP/conditions, which is itself a gap from CE — see wiki/pipboy.md §6 Gap #1).
   Alternatively add a new HOLODISKS tab.
5. **Text view**: Add a holodisk reader sub-screen to ui_pipboy.ts with
   pagination at 35 lines per page, navigable via button clicks or keyboard.

<!-- audited: 2026-06-01 -->
