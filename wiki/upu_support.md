# Unofficial Patch (UPU) support — findings and plan

> Status: **implemented, not yet played through** (2026-10-22). The pipeline builds the install's
> mods (`mods/upu.dat`) into a mod folder `mods/upu/` that the engine loads over the untouched vanilla
> files while `upu` is listed in `mods/mods_order.txt`; the sfall script functions, global scripts and
> hooks UPU uses are ported (from CE where CE has them). Checked on a mock install with the real
> `upu.dat`, not yet on a real UPU install. See **Implementation** for what runs, what is skipped and
> why. See also [lua_scripts.md](lua_scripts.md) ("Script fixes", "Mods"), [known_bugs.md](known_bugs.md)
> section 32 (UP1–UP6).

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

## What DH2 lacked to run it (before 2026-10-22)

The UPU scripts use **242 opcodes; 49 of them DH2 did not implement** (scan of all 1244 `.int`).
`int2lua.py` decompiled 767 of the 1244; the others stopped at one of these opcodes. (Now: 1239 — see
Implementation.)

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

## Implementation (2026-10-22)

### Mod folders

UPU is a **mod folder**, `mods/upu/`, not a change to the vanilla files. The pipeline
(`tools/setup.py build_mods`, last stage; GUI "Build mod folders…") turns each archive or folder the
install's `mods/mods_order.txt` lists into `mods/<name>/`, laid out like the project root and
converted by the same converters as the vanilla data, and adds the name to the project's
`mods/mods_order.txt`. At start the engine reads `mods/<name>/manifest.json` of every listed mod
(`src/modAssets.ts`); from then on every asset load asks `assetUrl(path)` and gets the copy of the
highest-priority mod that has the file, else the vanilla one. Switching UPU off is a `;` in front of
its line (or `fallout2.cfg [dh2] mods=` / `play.html#mods=`); no pipeline re-run, the vanilla game
is untouched. A DH2 addition modelled on sfall's `mods/` (CE loads only `master.dat`, `critter.dat`
and `patchXXX.dat`).

    mods/upu/
      manifest.json          the files below; "merge": the two merged files
      art/**.png             the mod's images; art/imageMap.json lists only them (merged)
      proto/pro.json         the mod's protos only (merged per type and id)
      maps/*.json            the mod's maps (+ .images.json); vanilla maps the mod's .lst / proto
                             changes alter are re-converted and kept when they differ
      lut/lst/*.json         the mod's .lst files, each the whole list
      lut/endgame.json …     endgame / death slides when the mod changes them
      audio/sfx/*.wav        sound (ffmpeg, as the vanilla stages)
      data/scripts/*.int|lua scripts: the .int and its decompiled Lua
      data/text/**.msg, data/data/*.txt, data/gvars.json, data/maps/*.mvars.json
      data/mods/upu.ini      the install's mods/upu.ini (get_ini_setting)

Rules worth knowing:

- **Load order**: the install's `mods/mods_order.txt` top to bottom, a later line winning, a name
  listed twice counting at its last line (sfall `LoadOrder.cpp`). `sfall.dat` and `f2_res.dat` are
  skipped (Conflicts). The install's `patchXXX.dat` still go into the vanilla `data/` (CE `game.cc`;
  the UPU installer moves `patch000.dat` away, as UPU contains it).
- **Two merged files**: `art/imageMap.json` and `proto/pro.json` index every image / proto, so a mod
  ships only its own entries and `mergeModJSON` adds them on top of the vanilla file (the cached one).
- **Stylesheets**: `ui.css` rules whose `url()` a mod overrides are rewritten at start
  (`overrideStylesheets`); the interface code's own `url()` / `img.src` go through `assetUrl`.
- **Lookups during the build** fall back from the mod's files to earlier mods', then the vanilla
  `data/` (a map's protos and `.lst` files, a script's message texts, `fomap.dataFile`).
- **Scripts**: the mod's `.int` and its `.lua` come from the same layer; a script whose `.int` did not
  decompile (`mcjo`) runs as bytecode instead of a lower layer's `.lua` (`loadLuaScript` → `assetLayer`).
  Names come from UPU's own sources first (`int2lua.decompile_file(mod=True)`, `third_party/upu_src`),
  and the vanilla `.int`'s repairs (`SCRIPT_FIXES` L7, mitoilet's operand) are off. On v34: variables
  left as numbers drop from 5136 to 16; **1243 of 1244** scripts decompile.
- **Raw files** the conversion replaces (`.frm`, `.map`, `.acm`, `.pal`) are deleted after the build
  (as `--delete-originals`); `.pro`, `.lst`, `.gam` stay for a later mod's build. UPU v34: 5442 files,
  229 MB (mostly map JSON).
- **Bad references in UPU's maps** (`fomap`): two objects name a script past `scripts.lst`
  (gecksetl, vctyctyd) — no script, as CE; a Redding peasant (reddown) names critter art past
  `critters.lst` — CE draws nothing, DH2 takes the proto's art (a deliberate deviation, UP6).

To fetch UPU's sources (optional; without them UPU scripts get killap's names where they fit):

    git clone --depth 1 --filter=blob:none --sparse https://github.com/BGforgeNet/Fallout2_Unofficial_Patch.git third_party/upu_src
    git -C third_party/upu_src sparse-checkout set scripts_src

### Script functions

| Group | What | Where |
|-------|------|-------|
| XOR / NOT | `0x8042` / `0x8043` in the VM (CE `opBitwiseOperatorXor` / `Not`) | `src/vm.ts` |
| sfall arrays | port of CE `sfall_arrays.cc` / `sfall_lists.cc`: list and associative arrays, `CONSTVAL`, sort / rsort / reverse / shuffle, `string_split`, `list_as_array`, `stack_array`; temporary arrays freed per game tick (CE `scriptsHandleRequests`), all on a new game; **not saved** (as CE; sfall saves them) | `src/sfallArrays.ts` |
| CE sfall functions | `abs`, `get_ini_setting` (CE `sfall_ini.cc`: files under `data/`, through the mod overlay), `explosions_metarule` 6, `set_self`, `get/set_proto_data` (offsets 96 magazine size, 388 body type), weapon ammo pid / count, pc and critter base / bonus stats, `party_member_list`, `get_script`, `set_world_map_pos`, `set_car_current_town`, `sfall_func0-2` (`combat_data`, `get_object_data` on an Attack or an object — PID / SID / script index —, `dialog_obj`, `get_sfall_arg_at`, `set_ini_setting`) | `src/scripting.ts`, `src/sfallIni.ts` |
| global scripts | port of CE `sfall_global_scripts.cc`: the active mods' `data/scripts/gl*.int` (sfall's `GlobalScriptPaths` default) start after a new game's map loads and after a save loads; `game_loaded`, `set_global_script_repeat`, `set_global_script_type` (0 game loop + map procedures, 1 every frame also in dialogue / menus, 2 world map, 3 both) | `src/sfallGlobalScripts.ts`, `gameTick.ts`, `init.ts`, `saveload.ts` |
| global variables | port of CE `sfall_global_vars.cc`: an 8-character or numeric key, 0 removes; saved with the game (`SaveGame.sfallGlobals`) | `src/sfallGlobalScripts.ts` |
| hooks (not in CE) | after sfall `HookScripts.cpp`: `register_hook_proc` (0 unregisters; the last registered runs first), `get_sfall_arg`, `get_sfall_arg_at`, `get_sfall_args`, `set_sfall_arg`, `set_sfall_return`. Hook points that fire: `HOOK_INVENTORYMOVE` (24; the player moving an item between backpack, hands and armor slot, or reloading by dropping ammo on a weapon — slots 0–4; dropping, picking up and containers do not fire it), `HOOK_GAMEMODECHANGE` (31; `get_game_mode` flags from DH2's UI mode, combat and the player's turn, with sfall's `SPECIAL` pulse when a dialogue closes or a party member joins / leaves in it). Others can be registered and never run. | `src/sfallHooks.ts`, `ui_inventory/dragdrop.ts` |
| virtual files (not in CE) | after sfall `FileSystem.cpp`: `fs_copy`, `fs_find`, `fs_seek`, `fs_read_*`, `fs_write_*` (big-endian, as sfall), `fs_size`, `fs_pos`, `fs_resize`, `fs_delete`. An art FRM is a synthesized header (DH2 has PNGs); writing its fps / action frame updates the image's `imageMap` entry — what `gl_k_goris_derobing` (Goris's de-robing, `goris_derobing_speed`) and `gl_k_walking_speed` (slow walkers: fps = frame count, `critters_walk_faster`) do. They need the install's `ddraw.ini` with `UseFileSystemOverride=1` (UPU's default); `set_ini_setting` holds for the page load only (DH2 does not write the install's files). | `src/sfallFs.ts` |
| other | `set_script` (sfall `op_set_script`: script number, start, map_enter unless bit 31), `tap_key` (CE `op_tap_key`; Escape / Enter / Space dispatched to the page) | `src/scripting.ts` |

What UPU's four global scripts do in DH2 now: `gl_k_8ball` gives an unscripted Magic 8-Ball its script
when you first move it into a hand slot (until New Reno is known, it just marks itself done);
`gl_k_dogmeat_fix` corrects Dogmeat's AI packet after his dialogue; the two speed options above.

### Verified (2026-10-22)

`npx tsc` clean; `int2lua --check-bridge` passes; the vanilla decompile is byte-identical (1440 / 1443).
`build_mods` on a mock install with the real `upu.dat` / `upu.ini` (no tracebacks, 3½ min). In the
browser with `upu` listed: `arcaves` loads UPU's map, Lua and messages from `mods/upu/`, vanilla files
stay vanilla, the merged image map has UPU's art; the global scripts start (8-Ball marks itself done,
the Dogmeat fix registers its hook, Goris's animation goes 10 → 50 fps, a slow walker 15 → 11 fps);
hook order, return override and unregistering, game mode flags and the 8-character key rule checked.
With `#mods=` (UPU off): nothing is read from `mods/` but the order file, no global scripts, no
failed requests. **Not done:** a playtest, `luadiff` and the story crawler on UPU data (UP1).

### Conflicts with DH2 (checked)

- **`f2_res.dat`** (the hi-res patch's art: `hr_*.frm` interface backgrounds for larger resolutions,
  `.edg` map-edge files) — **skipped** by the pipeline (`SKIPPED_MOD_ARCHIVES`). DH2 draws the
  interface at the original size and scales / zooms the whole screen itself; CE does not read `.edg`
  files either.
- **`sfall.dat`** (sfall's own global scripts `gl_highlighting` / `gl_partycontrol` and replacement
  interface art for sfall's extra buttons) — **skipped**: they belong to sfall engine features DH2 does
  not have (item highlighting, controlling party members in combat), and the art would replace
  DH2's vanilla interface frames.
- **`gl_ammomod.int`**, which the UPU installer puts loose into the install's `data/scripts/` (sfall's
  optional ammo formulas, `mods/AmmoGlovz.ini` / `AmmoYAAM.ini`): not read — the pipeline does not
  read the install's loose `data/`, and it needs hooks DH2 does not fire.
- **sfall engine options in `ddraw.ini`** (speed, graphics, gameplay tweaks): not used. UPU's content
  does not depend on them; `ddraw.ini` is copied to `data/` so `get_ini_setting` can read it.
- **DH2's own Lua mods** share the project's `mods/mods_order.txt` with the built mod folders; a Lua
  mod's `scripts/<script>.lua` wins over UPU's script (Lua mods are looked up first).
- **Script fixes:** the L7 fix and mitoilet's restored operand apply only to the vanilla `.int`.

## Plan (as written before the implementation)

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
7. **Verify**: `tools/luadiff.html` over all 1244 UPU scripts (VM vs Lua, 0 differences); the story crawler
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

Open question before step 1 (answered: no — see Conflicts): whether UPU's content relies on sfall
engine options it configures in `ddraw.ini` (beyond the script functions). Redistribution is not an issue: DH2 ships nothing from UPU and
reads the user's own install, as for vanilla. Credits: [`CREDITS.md`](../CREDITS.md).
