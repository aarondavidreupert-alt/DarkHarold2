# Unofficial Patch (UPU) support — findings and plan

> Status: **plan, nothing implemented** (2026-10-22). DarkHarold2 plays the vanilla data of the
> user's install. This page records what the Unofficial Patch is, what it changes, what DH2 would need
> to run it, and the order to build that in. See also [lua_scripts.md](lua_scripts.md) ("Script fixes"),
> [known_bugs.md](known_bugs.md) L7.

## What it is

- **killap's Unofficial Fallout 2 Patch (UP)**, last release 1.02.31 (2014). Its script sources are
  already in the project as `data/scripts_src/` (`up-source-readme.txt`); `tools/int2lua.py` reads them
  for variable names only. The game data DH2 extracts is **not** patched (the bhrnddst bug L7, which UP
  fixes, is in the install's `.int`).
- **UPU, "Unofficial Patch, updated"** — the maintained successor, built on killap's UP:
  <https://github.com/BGforgeNet/Fallout2_Unofficial_Patch>. Release analysed: **v34** (2025-10-18),
  `upu_v34.zip` (57.6 MB). Installed on top of vanilla; it ships **sfall** (4.4.8: `ddraw.dll`, a
  patched `fallout2.exe`, `sfall.dat`) and the hi-res patch, and its content as **`mods/upu.dat`**
  (53.6 MB), loaded through sfall's `mods_order.txt`. Settings in `mods/upu.ini`, `ddraw.ini`,
  `mods/sfall-mods.ini`. No licence is stated on the repository.

A local copy for analysis is in **`third_party/upu_v34/`** (git-ignored): the release zip, and the
extracted contents of `mods/upu.dat` (`upu_dat/`) and `sfall.dat` (`sfall_dat/`). Nothing from it is
committed or run; the executables in the zip (`ddraw.dll`, `fallout2.exe`, …) stay packed.

## What `mods/upu.dat` contains

| Kind | Files | Notes |
|------|-------|-------|
| Scripts `.int` | 1244 | almost every script, recompiled with fixes; 6 sfall *global scripts* (`gl_*.int`) |
| Dialogue / text `.msg` | 833 | typo fixes, restored and added lines (English; translations in separate `.dat`s) |
| Other text `.txt` / `.sve` | 256 / 24 | data tables, movie subtitles |
| Maps `.map` / `.gam` | 122 / 5 | blockers, unreachable items, missing critter scripts, map borders |
| Protos `.pro` | 37 items, 34 critters | stats, flags, descriptions |
| Art `.frm` (+ `.fr0`–`.fr5`) | ~2500 | critter animations, inventory and interface art |
| Sound `.acm` | 439 | |

Changelog summary (`docs/changelog.md`): quest and dialogue fixes, restored content, map fixes, proto
corrections, mechanics changes (critical rolls on doors / containers / traps, lockpick XP, karma perks),
reworked encounters (Redding / NCR caravans), optional settings (merchant inventory wipe, critter walk
speed, Goris de-robing speed).

## What DH2 lacks to run it

The UPU scripts use **242 opcodes; 49 of them DH2 does not implement** (scan of all 1244 `.int`).
`int2lua.py` decompiles 767 of the 1244 today; the others stop at one of these opcodes.

| Group | Opcodes (CE name) | Scripts | In CE? |
|-------|-------------------|---------|--------|
| sfall arrays | `0x822D` create, `0x822E` set, `0x822F` get, `0x8231` len, `0x8232` resize, `0x8233` temp_array, `0x8239` scan, `0x8256` array_key, `0x8257` stack_array, `0x8236` list_as_array | ~130 (stack_array: 3022 uses) | yes, `sfall_arrays.cc`, `sfall_lists.cc` |
| math | `0x81ED` abs | 335 | yes |
| core | `0x8042` bitwise XOR (`OPCODE_BITWISE_XOR`) | 3 (craps) | yes — **a gap in DH2's VM** (vanilla scripts never use it) |
| ini settings | `0x81AC` get_ini_setting (`upu.ini` options; one `ddraw.ini` key) | 47 | yes, `sfall_ini.cc` |
| explosions | `0x8261` explosions_metarule | 62 | yes |
| object / critter | `0x8206` set_self, `0x8204` / `0x8205` get / set proto data, `0x8217`–`0x821A` weapon ammo pid / count, `0x815A`–`0x815D` pc base / bonus stats, `0x8271` party_member_list, `0x81F5` get_script | 1–7 each | yes |
| world | `0x8172` set_world_map_pos, `0x81B6` set_car_current_town | 1 each | yes |
| global scripts / vars | `0x8164` game_loaded, `0x816A` set_global_script_repeat, `0x819B` set_global_script_type, `0x819D` / `0x819E` sfall global vars, `0x81AF` game mode, `0x8162` tap_key | the 6 `gl_*` scripts | yes, `sfall_global_scripts.cc`, `sfall_global_vars.cc` |
| named functions | `0x8276`–`0x8278` sfall_func0–2 | 5 | yes, `sfall_metarules.cc` (by name) |
| not in CE | `0x815F`–`0x8161` (nhmyron), `0x81E4`, `0x81F4`, `0x81F8`, `0x81FB`, `0x8202`, `0x820A`, `0x8262` | killap's `gl_k_*` global scripts, nhmyron | no |

The data side: DH2's pipeline (`tools/setup.py extract_dats`) extracts only `master.dat` and
`critter.dat`. It reads neither the install's loose `data/` overrides nor `patch%03d.dat` (CE
`game.cc` loads those) nor sfall's `mods/*.dat` in `mods_order.txt` order (CE does not load those
either; sfall does).

## Plan

Vanilla stays the default; UPU is opt-in, detected from the install (`mods/upu.dat`) or chosen in the
pipeline. Everything that CE implements is ported from CE with the `.cc` / function cited; what CE lacks
follows sfall and is marked as a DH2 addition.

1. **Pipeline: the install's whole file system.** Extract in CE / sfall priority: `master.dat`,
   `critter.dat`, `patch%03d.dat`, loose `data/` files, then the `mods/*.dat` named in `mods_order.txt`
   (verify sfall's priority order first). Record which archive each file came from. Flag:
   `setup.py --mods` / pipeline GUI checkbox. Re-run all later stages on the result.
2. **Core gap: `0x8042` XOR** in `src/vm.ts` (CE `interpreter.cc`), and in `int2lua.py` (`~`).
3. **sfall arrays** — the biggest piece and used by ~130 scripts: port CE `sfall_arrays.cc` /
   `sfall_lists.cc` (temporary arrays freed at the end of the frame, permanent ones saved with the
   game, `stack_array` building literals) to the `Script` class; Lua: arrays as the same host objects
   (prelude), so both backends share one implementation.
4. **The other sfall opcodes CE has** (table above): `abs`, `get_ini_setting` (a `[upu]` section in
   `fallout2.cfg` with `upu.ini`'s defaults, read-only), explosions metarule, `set_self`, proto data,
   weapon ammo, pc stats, party list, `get_script`, world-map position, car town, sfall global vars,
   `sfall_func0-2` with the names the scripts use. Wire each in `vm_bridge.ts`, add it to
   `int2lua.py INTRINSICS`.
5. **Global scripts** (`gl_*.int`): port CE `sfall_global_scripts.cc` (run at game start / every N
   ticks / hooks per `set_global_script_type`). The 4 killap `gl_k_*` scripts use opcodes CE lacks;
   decide per script (implement from sfall's documentation or leave those QoL scripts off).
6. **Decompiler names for UPU**: read the UPU repository's own `scripts_src` (it matches the v34 `.int`
   better than killap's 1.02.31) as an SSL tree; `SCRIPT_FIXES` entries that UPU already fixes are
   switched off for UPU scripts (their `.int` no longer has the bug).
7. **Verify**: `luadiff.html` over all 1244 UPU scripts (VM vs Lua, 0 differences); the story crawler
   on UPU data (VM, VM, Lua, Lua); a playtest of the changed areas (Redding / NCR caravans, Arroyo).
8. **Docs**: this page becomes the reference; `lua_scripts.md`, `known_bugs.md` (new UP section),
   README ("UPU supported, optional"), `CODEBASE.md`.

### Load order (settled)

sfall reads `<GameRoot>/mods/mods_order.txt` top to bottom and **a later line takes priority**
(`LoadOrder.cpp`: "patches at the back of the vector take priority"). Its whole search order, per its
`ddraw.ini`: master_patches > critter_patches > mods_order.txt > PatchFileXX > patchXXX.dat > sfall.dat
> critter.dat > f2_res > master.dat. The pipeline (step 1) follows that. DarkHarold2's own
`mods/mods_order.txt` uses the same format for its Lua mods ([lua_scripts.md](lua_scripts.md) → Mods).

### sfall in DarkHarold2

sfall itself is a Windows DLL that patches `fallout2.exe`; nothing of it can run in a browser. What DH2
can have is what fallout2-ce has: CE reimplements a part of sfall in its own source (`sfall_opcodes.cc`,
`sfall_arrays.cc`, `sfall_global_scripts.cc`, `sfall_global_vars.cc`, `sfall_ini.cc`, `sfall_lists.cc`,
`sfall_metarules.cc`, `sfall_config.cc`, `sfall_kb_helpers.cc`). Today DH2 has two of those opcodes
(`make_straight_path`, `obj_blocking_at`). Steps 2–5 port the rest that UPU needs.

**Optional, in two layers:** the sfall *script functions* are always available — vanilla scripts never
call them, so they change nothing for the vanilla game (as in CE). What sfall changes in the *engine*
(its `ddraw.ini` options: speed, graphics, gameplay tweaks) is not part of this plan; any such feature
DH2 adopts later gets a `[dh2]` / `[sfall]` switch in `fallout2.cfg`, off by default. UPU as a whole is
optional: the pipeline only reads it when it is installed and chosen.

Open question before step 1: whether UPU's content relies on sfall engine options it configures in
`ddraw.ini` (beyond the script functions). Redistribution is not an issue: DH2 ships nothing from UPU and
reads the user's own install, as for vanilla. Credits: [`CREDITS.md`](../CREDITS.md).
