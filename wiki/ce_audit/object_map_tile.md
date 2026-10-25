# CE parity audit — object / map / tile / light / geometry

Scope: fallout2-ce `object.cc`, `map.cc`, `tile.cc`, `light.cc`, `geometry.cc` against DH2 `src/object/*.ts`, `src/map/GameMap.ts`, `src/map/mapLoader.ts`, `src/tile.ts`, `src/geometry/*.ts`, `src/lightmap.ts` + `src/lightmap/*`, `src/lighting.ts`, `src/render/camera.ts`, `src/renderer.ts` (roof / picking), `src/render/webglDraw.ts` (egg), `src/player.ts` (exit grids), `src/mapFade.ts`, `src/elevatorUse.ts`. `make_path` / `pathfinderFindPath` (animation.cc) and `_make_straight_path_func` belong to the animation/pathfinding auditor and are only cross-referenced. Audited 2026-10-24.

Method: every function in the five CE files was listed (grep of definitions) and matched to DH2. The integer formulas were checked numerically with throw-away node scripts (not committed):
- CE `tileDistanceBetween` (a greedy walk along `rotation_to_tile`) against DH2 cube `hexDistance`: 200k random tile pairs within ±30, 0 mismatches.
- CE `tileGetRotationTo` against DH2 `hexDirectionTo`: same 200k pairs, **488 mismatches (0.24 %)**. See TILE-01.
- `hexNeighbors` order against CE `_dir_tile[parity][rot]`: all 12 entries match.
- DH2 `hexToScreen` deltas against CE `tileToScreenXY` deltas: 10k random pairs, exact.
- DH2 `hexFromScreen` (the RD13 `_tile_mask` port) round trip on all 40 000 hexes, at anchor, anchor−1 and anchor−2 px: exact.
- The CE `_obj_adjust_light` 36-case shadow switch, transcribed mechanically from the C source into JS, against DH2's switch in `lightmap.ts`: 20k random `_light_blocked` states × 36 indices × 6 rotations, 0 mismatches.
- `_obj_light_table_init` offsets: DH2 table against a CE re-implementation for 3 seed centres, 0 mismatches.
- DH2 `hexToTile` / `tileFromScreen(hexToScreen(h))` against CE square `(x>>1, y>>1)`: **off by one row for every odd hex row**. See TILE-02.

## Summary

Counts are table rows. Some rows group several closely related CE functions; about 190 CE functions are covered.

| Status | Rows |
|---|---|
| ✅ MATCH | 45 |
| ⚠️ DIFFERS | 18 |
| 🟡 PARTIAL | 19 |
| ❌ MISSING | 7 |
| 🚫 N/A (C memory / file I/O / SDL blit / mapper) | 29 |

Top findings:
- **OBJ-01 (HIGH, NEW)**: an open door is still a blocker for every flag-based query. DH2 keeps door state only in `Obj.open`; it never sets CE `OBJECT_OPEN_DOOR` (`SHOOT_THRU | LIGHT_THRU | NO_BLOCK`). So `blockingObjectAt` (all five block types), `straightPathObstacle` → `combatIsShotBlocked` (you can't shoot through an open doorway), shoot-mode pathfinding, placement and explosions, and the lightmap all treat it as closed. The light isn't rebuilt on open/close either.
- **OBJ-02 (HIGH, NEW)**: door `open` / `locked` / `jammed` are never serialized, and `tools/fomap.py` drops the map's door `openFlags`. An opened or script-locked door comes back closed and unlocked after save/load and on every map revisit (dirty-map cache).
- **MAP-01 (MED, NEW)**: `map_update_p_proc` runs twice on every map load (fresh and revisit): once in `doEnterNewMap`, then again in `changeElevation(…, true)`. CE runs it once (`mapLoad` → `scriptsExecMapUpdateProc`).
- **MAP-02 (MED, NEW)**: exit grids. CE's `map == -1` (town map) opens the world view, the transition's rotation is ignored (the player faces the header's `startOrientation`), CE's same-map/same-elevation reload rule is absent, and so are the Modoc B&B / Squat A exceptions.
- **TILE-02 (MED, NEW)**: `hexToTile` (roof flood-fill start, `hasRoofAt`) puts an odd-row hex in square row `(y+1)/2`. CE uses `y/2` (`objectSetLocation`: `roofY = tile/200/2`). Half the time the wrong roof section is hidden, or none is.
- **TILE-03 (MED, NEW)**: CE scroll limiting is missing. CE `tileSetCenter` refuses a centre ≥ 480 px horizontally or ≥ 400 px vertically from the dude, if it moves farther away. DH2 lets you scroll anywhere inside the map bounds and scout enemies far away. The rest of the scroll clamp is a documented deviation (`scroll_clamping.md`).
- **OBJ-03 (MED, NEW)**: `Obj.fromPID` (runtime `create_object`) never applies the proto's `lightDistance` / `lightIntensity`. CE `objectCreateWithFidPid` → `objectSetLight`. Light-emitting protos created by scripts stay dark.
- **OBJ-04 (MED, NEW)**: automap "seen" marking. CE `_obj_process_seen` flags `OBJECT_SEEN` on objects in a ±16-row × ±16..23-column band around each seen tile. DH2 `markSeenAt` uses a 5-hex radius, so the automap reveals far less.
- **OBJ-05 (MED, cross-ref scripting)**: `obj_can_see_obj` uses `GameMap.hexLinecast` (greedy hex line, shoot-type rules, any blocker). CE uses `_make_straight_path(…, 16)` + `_obj_blocking_at`, where target-first-obstacle means "seen", plus a same-elevation check, and `isWithinPerception` for non-critter targets too.
- **TILE-01 (LOW, NEW)**: `hexDirectionTo` truncates `90 − angle` instead of `90 − trunc(angle)`, so atan2 angles in (30°, 31°) give rotation 0 instead of 1 (0.24 % of pairs). Used for knockback, facing, perception and pushing.

## Function table

### object.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| objectsInit | `player.ts:67` (dude LIGHT_THRU); map arrays in GameMap | 🚫 N/A | — | Allocation and egg/dude creation. The dude's `OBJECT_LIGHT_THRU` is ported (C46). The egg is a shader mask (`webglDraw.ts`). |
| objectsReset / objectsExit | `mapLoader.ts:221` (objects = null) | 🚫 N/A | — | Memory. |
| objectRead | `Obj.fromMapObject_` `Obj.ts:627` (data from `tools/fomap.py`) | 🟡 PARTIAL | HIGH | The exit-grid fid fixup isn't needed. **The door `openFlags` are discarded by the pipeline** (OBJ-02). The light fields are read from the map ✓. |
| objectLoadAll / objectLoadAllInternal | `mapLoader.ts:221` loadNewMap | 🚫 N/A | — | JSON. |
| _object_fix_weapon_ammo | `initWeaponAmmo` (`weaponAmmo.ts`, via `Obj.ts`) | ✅ MATCH | — | LE12 (not re-verified in depth). |
| objectWrite / objectSaveAll / _obj_save_obj / _obj_load_obj / _obj_save_dude / _obj_load_dude | `Obj.serialize` `Obj.ts:1404`, `GameMap.serialize` `GameMap.ts:683` | 🟡 PARTIAL | HIGH | JSON replaces the binary format. `open` / `locked` / `jammed` are **not** saved (OBJ-02). The party is excluded from map snapshots as in CE (M10). |
| _obj_render_pre_roof / _obj_render_post_roof | `renderer.ts` renderObjects / `renderOutlinePass` | 🚫 N/A | — | Blit order replaced by WebGL. The post-roof outline pass exists. |
| objectCreateWithFidPid | `Obj.fromPID_` `Obj.ts:587` | ⚠️ DIFFERS | MED | The proto light is not applied (OBJ-03). `flags = pro.flags` is copied raw, whereas CE maps selected bits (0x08/0x10/0x800/trans/0x20000000/0x80000000/0x10000000/0x1000). The bit positions coincide, so this is LOW. |
| objectCreateWithPid | `createObjectWithPID` (`object/factories.ts`) | ⚠️ DIFFERS | MED | As above. |
| _obj_copy | — (inventory cloning in item code) | 🚫 N/A | — | Not audited here. |
| _obj_connect / _obj_disconnect / _obj_connect_to_tile / _obj_insert / _obj_remove / objectGetListNode | `GameMap.addObject` `:112`, `removeObject`/`drainRemovalQueue` `:126`; z-order `Obj.ts zsortMap` | 🚫 N/A | — | Linked per-tile lists replaced by per-elevation arrays. The deferred removal is a DH2 design (documented in code). |
| _obj_offset | `Obj.shift` / `artOffset` / `ceOff` | 🚫 N/A | — | Animation auditor. |
| _obj_move | `Obj.move` `Obj.ts:793` | 🟡 PARTIAL | LOW | Static light rebake on a non-critter move ✓. Critters are dynamic per frame. |
| objectSetLocation | `Obj.move` `Obj.ts:793` + `Player.move` `player.ts:368` | 🟡 PARTIAL | MED | The exit-grid check exists (MAP-02 differences). The roof flood uses the wrong square row (TILE-02). Combat ends on an elevation change ✓ (`changeElevation`). There is no `_combat_delete_critter` when an NPC changes elevation (unverified elsewhere). |
| _obj_reset_roof | `renderer.ts` per-frame `roofFloodFill` | ✅ MATCH | — | Recomputed each frame. |
| objectSetFid / objectSetFrame / objectSetNextFrame / objectSetPrevFrame | `Obj.art` / `Obj.frame` assignments | 🚫 N/A | — | Dirty rects. Animation auditor. |
| objectSetRotation / objectRotateClockwise / objectRotateCounterClockwise | `obj.orientation = …` | ✅ MATCH | — | Trivial. |
| _obj_rebuild_all_light | `Lightmap.rebuildLight` → `bakeStaticLight` `lightmap.ts:414` + `rebuildDynamicLight` `:454` | 🟡 PARTIAL | MED | Static/dynamic split (DH2). Not called on door open/close (CE `_check_door_state` does). Not called on `destroyObject`, except for flares. |
| objectSetLight | `scripting.ts:2073` obj_set_light_level; `Obj.ts:258` | ✅ MATCH | — | Distance clamped to 8 (C46). |
| objectGetLightIntensity | `getObjectLightIntensity` (`combat/hitChance.ts`) | ✅ MATCH | — | C46. |
| _obj_turn_on_light / _obj_turn_off_light | via `rebuildLight` | ✅ MATCH | — | Full rebuild instead of add/subtract. Same result. |
| objectShow / objectHide | `set_obj_visibility` (`visible`), LD4 rebuild | 🟡 PARTIAL | LOW | DH2 uses `visible === false` beside `flags & 1`. `lightmap.ts` blocker loop checks only `flags & 1`, the source check only `visible`. |
| objectEnableOutline / objectDisableOutline / objectSetOutline / objectClearOutline | `Obj.outline`, `renderOutlinePass` | ✅ MATCH | — | CI11–CI15 (not re-verified). |
| _obj_toggle_flat | `OBJECT_FLAT` in `zsortMap` (`Obj.ts:397`) | 🟡 PARTIAL | LOW | Flat objects are sorted. There is no runtime toggle API. |
| objectDestroy | `GameMap.destroyObject` `:148` | 🟡 PARTIAL | LOW | No light rebuild (a scenery light stays until the next rebake). Removal is deferred. |
| _obj_inven_free | — | 🚫 N/A | — | Memory. |
| _obj_action_can_use / _obj_action_can_talk_to | `Obj.canUse` `Obj.ts:1119` | ✅ MATCH | — | Actions auditor. |
| _obj_portal_is_walk_thru | `pathfinder.ts canUseDoor` | ✅ MATCH | — | C45. |
| objectFindById / objectTypedFindById | scripting lookups by uid | ✅ MATCH | — | |
| objectGetOwner | `itemOwner` (`Obj.ts`) | ✅ MATCH | — | |
| _obj_remove_all | `mapLoader.ts:248` (`objects = null`) | ✅ MATCH | — | |
| objectFindFirst/Next, …AtElevation, …AtLocation | `getObjects(level)`, `objectsAtPosition` `GameMap.ts:492` | ✅ MATCH | — | Array scans. The tile order within a tile differs (array order, not the CE sorted list), which matters for "first opaque object" in light. LOW. |
| objectGetRect | `objectBoundingBox` `renderer.ts:574` | ✅ MATCH | — | Anchor offsets per RD13 notes. |
| _obj_occupied | — | ❌ MISSING | LOW | No direct callers needed. `objectsAtPosition().length` is equivalent. |
| _obj_blocking_at | `GameMap.blockingObjectAt` type 0 `GameMap.ts:515` | ⚠️ DIFFERS | HIGH | Logic matches CE (type set, HIDDEN/NO_BLOCK, multihex neighbours). Open doors still block because the flags are never updated (OBJ-01). |
| _obj_shoot_blocking_at | type 1 | ⚠️ DIFFERS | HIGH | `(NO_BLOCK==0 || SHOOT_THRU==0)` centre rule and corpse fix ✓. Open doors block (OBJ-01). |
| _obj_ai_blocking_at | type 2 | ✅ MATCH | — | `moveBlockObj` state ✓ (the open-door caveat applies). |
| _obj_scroll_blocking_at | `clampCameraPosition` `camera.ts:430` | 🟡 PARTIAL | LOW | DH2 tests the hex under the pixel centre, CE the candidate centre tile. CE also excludes tile 0. Documented in `scroll_clamping.md`. |
| _obj_sight_blocking_at | type 3 | ✅ MATCH | — | LIGHT_THRU / scenery+wall only. Not used by `obj_can_see_obj` (OBJ-05). |
| objectGetDistanceBetween / …Tiles | `objectDistance` `combat/hitChance.ts:68` | ✅ MATCH | — | The multihex −1 each ✓. A null object returns 0 in CE, which is not modelled (LOW). `tile_distance_objs` uses the raw `tileDistanceBetween` in both ✓. |
| objectListCreate / objectListFree | `objectsAtPosition` / filters | ✅ MATCH | — | |
| _translucent_trans_buf_to_buf, _dark_trans_buf_to_buf, _dark_translucent_trans_buf_to_buf, _intensity_mask_buf_to_buf | WebGL shaders (`webglLighting.ts`, `webglDraw.ts`) | 🚫 N/A | — | Blit helpers. |
| _obj_intersects_with | `getObjectUnderCursor` / `objectTransparentAt` `renderer.ts:611` | 🟡 PARTIAL | MED | Pixel test ✓. There is no egg flag (0x04), so you can't click through an egg-transparent wall (game_mouse uses it). The translucency flag (0x02) is ignored. Hidden objects aren't excluded unless the predicate does it. **The loop is `i > 0`, so objects[0] is never pickable.** |
| _obj_create_intersect_list / _obj_delete_intersect_list | `getObjectUnderCursor` | 🟡 PARTIAL | LOW | Returns the first hit only, not the list with flags. |
| obj_set_seen / _obj_clear_seen / _obj_process_seen | `automap/tracking.ts markSeenAt` (radius 5) | ⚠️ DIFFERS | MED | OBJ-04. |
| objectGetName / objectGetDescription | `Obj.name`, examine (`examine.ts`) | ✅ MATCH | — | |
| _obj_preload_art_cache / _obj_preload_sort | `maps/*.images.json` preload in `loadNewMap` | 🚫 N/A | — | Asset cache. |
| _obj_offset_table_init/exit, _obj_order_table_init/exit, _obj_order_comp_func_even/odd, _obj_render_table_init/exit | `zsortMap` (`Obj.ts`) | 🚫 N/A | — | Draw-order tables replaced by a sort (RD09, `[dh2] object_sort`). |
| _obj_light_table_init | `obj_light_table_init` `lightmap/lightTable.ts` | ✅ MATCH | — | Numerically identical offsets. |
| _obj_blend_table_init/exit | shaders | 🚫 N/A | — | |
| objectAllocate / objectDeallocate / objectListNodeCreate / objectListNodeDestroy | `new Obj` | 🚫 N/A | — | |
| _obj_adjust_light | `obj_adjust_light` `lightmap.ts:76` | 🟡 PARTIAL | LOW | Falloff, 36-cell table, shadow switch and wall branches all match. Differences: it bails on `lightIntensity <= 655` (CE `<= 0`) and needs `lightRadius > 0` (CE: the OBJECT_LIGHTING flag). `lightRadius > 8` isn't clamped before the `(I−655)/(r+1)` step. Smooth player light / `derived` / `naive` modes are DH2 options. The open-door case is OBJ-01. |
| objectDrawOutline | `renderOutlinePass` | 🚫 N/A | — | Rendering. |
| _obj_render_object (egg occlusion test) | `isCEOccludingWall` / `isCEOccludingWallLiteral` `webglDraw.ts` | ⚠️ DIFFERS | LOW | Deliberate: the default `eggMode='dh2-egg'` is hand-tuned. `'ce-egg'` is the literal port, minus CE's `gDude HIDDEN` and `OBJECT_FLAG_0xFC000` (translucent) skips. Documented in `wiki/extended_flags.md` §8 / RD16. |
| _obj_fix_violence_settings | — (grep: none in object code) | ❌ MISSING | LOW | Unverified whether death anims are remapped by the violence level elsewhere (animation auditor). |
| isExitGridAt | `critter/lifecycle.ts:249` | ⚠️ DIFFERS | LOW | DH2: any misc with `extra.exitMapID`. CE: pid range 0x5000010–17 and not HIDDEN. |

### map.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| isoInit / isoReset / isoExit / _map_init / _map_exit | `main.ts` init, `gameReset.ts` | 🚫 N/A | — | Window/subsystem setup. Note: `isoInit` enables scroll limiting (TILE-03). |
| isoEnable / isoDisable / isoIsDisabled | `mapFade.ts` black overlay | ✅ MATCH | — | The DH2 fade-in replaces the instant enable (documented in the file header). |
| mapSetElevation | `GameMap.changeElevation` `GameMap.ts:218` | 🟡 PARTIAL | LOW | reg_anim_clear ✓ (`clearAnim`), party sync ✓, map_update only when `updateScripts`, or explicitly by stairs/ladders ✓. Ends combat (CE: `objectSetLocation` → `_game_user_wants_to_quit`) ✓. `wmMapMarkMapEntranceState` on elevation change not seen (worldmap auditor). `changeElevationFaded` fades, CE has no fade there (its comment mis-cites `mapSetElevation`). |
| mapSetGlobalVar / mapGetGlobalVar / mapSetLocalVar / mapGetLocalVar / _map_malloc_local_var | `Scripting` mapVars, `loadMapVars` | ✅ MATCH | — | M8 (scripting auditor). |
| mapSetStart | `override_map_start` → `doEnterNewMap` `GameMap.ts:425` | ✅ MATCH | — | Elevation validated. |
| mapGetName / mapGetCityName / _map_get_description_idx_ / _is_map_idx_same / _get_map_idx_same / mapGetCurrentMap | `data.ts lookupMapName`, `getCurrentMapInfo` | ✅ MATCH | — | Not re-verified (maps.txt parser). |
| mapScroll | `input.ts:404–416` + `clampCameraPosition` | ⚠️ DIFFERS | LOW | DH2 scrolls per pixel with no 33 ms gate, CE in 32×24 px tile steps via `tileSetCenter`. Documented presentation deviation. |
| mapBuildPath / mapMakeMapsDirectory | — | 🚫 N/A | — | File I/O. |
| mapSetEnteringLocation | `loadMap(…, startingPosition, startingElevation)` | 🟡 PARTIAL | LOW | No rotation parameter (MAP-02). |
| mapNewMap | — | 🚫 N/A | — | Mapper / error path. |
| mapLoadByName / mapLoadById | `loadMap` `mapLoader.ts:126` / `loadMapByID` | ✅ MATCH | — | |
| mapLoad | `loadNewMap` `mapLoader.ts:221` + `doEnterNewMap` | ⚠️ DIFFERS | MED | Ambient reset ✓. Map script map_enter → object map_enter → map_update ✓. **map_update runs twice** (MAP-01). Object `start` procs run at object creation, before the map script's map_enter (CE: map_enter of the map script first, then `scriptsExecStartProc`); scripting auditor. `_map_fix_critter_combat_data` not present (LOW). |
| mapLoadSaved | dirty-cache branch of `loadMap` + `mapLoadSavedAging` `mapLoader.ts:64` | ⚠️ DIFFERS | MED | Unjam after 24 h ✓ and aging ✓. map_update runs twice (MAP-01). Door state lost (OBJ-02). The random-encounter map erase is handled by the worldmap code (not verified). |
| _map_age_dead_critters | `mapAgeDeadCritters` `mapLoader.ts:78` | ✅ MATCH | — | Flee clear, 14 HP per 3 h, > 6 days → drop + blood frame (rat/mantis/flat rules) ✓. The unreachable > 14-day branch is noted. |
| _map_target_load_area | worldmap `currentAreaId` | ✅ MATCH | — | C55. |
| mapSetTransition | `Player.move` exit-grid branch `player.ts:368` | ⚠️ DIFFERS | MED | MAP-02. Fleeing mid-combat ends combat ✓ (`loadMap` forceEnd). |
| mapHandleTransition | `Player.move` → `loadMapByID` / `uiWorldMap` | ⚠️ DIFFERS | MED | MAP-02. `wmTeleportToArea` ✓ (`mapTransition` event). |
| _map_fix_critter_combat_data | — | ❌ MISSING | LOW | Clears stale `whoHitMe` ids on fresh maps. Usually a no-op in JSON. |
| _map_save / _map_save_file / _map_save_in_game | `loadMap` top: queueLeavingMap, map_exit procs, `drainRemovalQueue`, `serialize` | ✅ MATCH | — | M9/M10. `lastVisitTime` recorded ✓. |
| isoWindowRefreshRect / …Game / …Mapper | — | 🚫 N/A | — | |
| mapGlobalVariablesInit/Free/Load, mapLocalVariablesInit/Free/Load | `loadMapVars` | 🚫 N/A | — | Storage. |
| _map_place_dude_and_mouse | `centerCamera` on load | ✅ MATCH | — | |
| square_init / _square_reset / _square_load | map JSON `tiles.floor/roof` | 🟡 PARTIAL | LOW | The roof flag nibble (bits 12–15, used by `tile_fill_roof` `flag & 0x03` and the render skip `flag & 1`) is dropped by the pipeline (names only). |
| mapHeaderWrite / mapHeaderRead | `tools/fomap.py` | 🚫 N/A | — | |

### tile.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| tileInit | constants `hexScreen.ts`, TILE_MASK `:205` | ✅ MATCH | — | `_dir_tile` = `hexNeighbors`. `_tile_mask` ported (RD13). `_dir_tile2` (square grid) unused. |
| tileSetBorder | `CE_CENTER_BOUNDS` / `getActiveScrollLimits` `camera.ts` | ⚠️ DIFFERS | LOW | Documented deviation (`scroll_clamping.md`). |
| _tile_reset_ / tileReset / tileExit / tileDisable / tileEnable | — | 🚫 N/A | — | |
| tileWindowRefreshRect / tileWindowRefresh / tileRefreshMapper / tileRefreshGame | WebGL frame loop | 🚫 N/A | — | |
| tileSetCenter | `centerCamera` / `clampCameraPosition` `camera.ts:430,470`; `setCenterTile` `tile.ts:73` | ⚠️ DIFFERS | MED | Scroll limiting (480/400 from the dude) is missing (TILE-03). The border and blocker rules are documented deviations. |
| tile_toggle_roof / tileRoofIsVisible | `Config.ui.showRoof` | ✅ MATCH | — | |
| tileToScreenXY | `hexToScreen` `hexScreen.ts:44` | ✅ MATCH | — | Deltas identical (numeric). |
| tileFromScreenXY | `hexFromScreen` → `tileFromScreenXY` `hexScreen.ts:191,227` | ✅ MATCH | — | Exact round trip, `_tile_mask` port. |
| tileDistanceBetween | `hexDistance` `hexGrid.ts:102` | ✅ MATCH | — | 200k pairs equal. CE returns 9999 for tile −1; DH2 has no sentinel (LOW). |
| tileIsInFrontOf | `hexIsInFrontOf` `hexScreen.ts:88` | ✅ MATCH | — | `dx <= dy*-4`. |
| tileIsToRightOf | `hexIsToRightOf` `hexScreen.ts:98` | ✅ MATCH | — | Same 1.3333333333333335 constant. |
| tileGetTileInDirection | `hexInDirectionDistance` `hexGrid.ts:72` | ⚠️ DIFFERS | LOW | CE tests `tileIsEdge` before **every** step. DH2 always takes the first step, so from an edge tile CE stays put and DH2 moves one. |
| tileGetRotationTo | `hexDirectionTo` `hexGrid.ts:112` | ⚠️ DIFFERS | LOW | TILE-01. |
| _tile_num_beyond | `hexLineBeyond` `hexGrid.ts:169` | ✅ MATCH | — | Line-for-line port. |
| tileIsEdge | `hexIsEdge` `hexGrid.ts:68` | ✅ MATCH | — | |
| tileScrollBlockingEnable/Disable/IsEnabled | — (always on) | ❌ MISSING | LOW | No toggle. CE disables it during `move_to(dude)`. DH2 `centerCamera` still clamps. |
| tileScrollLimitingEnable/Disable/IsEnabled | — | ❌ MISSING | MED | TILE-03. |
| squareTileToScreenXY / squareTileToRoofScreenXY | `tileToScreen` `tile.ts:30` (+96 roof offset in renderer) | ✅ MATCH | — | |
| squareTileFromScreenXY / squareTileScreenToCoord / …Roof | `tileFromScreen` `tile.ts:38` | ⚠️ DIFFERS | MED | As a hex→square mapping it is off by a row for odd hex rows (TILE-02). Picking squares from screen pixels is not used for gameplay. |
| tileRenderRoofsInRect / tileRenderRoof | `renderRoof` (`renderer.ts`/`webglDraw.ts`) | 🟡 PARTIAL | LOW | Roofs are lit by ambient ✓ (unverified in shader). The per-square "hidden" flag bit is replaced by `hideSet`. |
| roof_fill_push_task_if_in_bounds / roof_fill_off_process_task / tile_fill_roof | `roofFloodFill` `renderer.ts:67` | 🟡 PARTIAL | MED | The 4-neighbour flood stopping at empty ✓. No `flag & 0x02` stop (data dropped). Start square wrong for odd rows (TILE-02). The `roofPeek` second flood is a DH2 extension (`Config.ui.roofPeek`). |
| tileRenderFloorsInRect / tileRenderFloor (+ triangle lighting tables) | `lighting.ts` (CPU), `webglLighting.ts` (GPU) | 🚫 N/A | — | Rendering. The vertex/triangle tables are ported in `lighting.ts`. The GPU path is a shader. |
| _square_roof_intersect | — | ❌ MISSING | LOW | Used by game_mouse for roof hit tests. DH2 picking ignores roofs. |
| _grid_render / _draw_grid | debug overlay (`webglDebugOverlay.ts`) | 🚫 N/A | — | |
| _tile_make_line | — | 🚫 N/A | — | Only used by `_tile_scroll_to`. |
| _tile_scroll_to | — (`centerCamera` jumps) | 🟡 PARTIAL | LOW | CE scrolls tile by tile and stops at the first refused centre. DH2 jumps and clamps. |

### light.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| lightInit / lightReset / lightExit / lightResetTileIntensity | `Lightmap.light_reset` `lightmap.ts:45` (fill 655) | ✅ MATCH | — | One elevation only (rebuilt on elevation change). |
| lightGetAmbientIntensity / lightSetAmbientIntensity | `GameTime.getAmbientLight`, Night Vision `gametime.ts:210–215` | ✅ MATCH | — | The day/night curve is a documented `[dh2]` option (GTC10). |
| lightGetTileIntensity | `Lighting.light_get_tile` `lighting.ts` (min 65536) | ✅ MATCH | — | |
| lightGetTrueTileIntensity | `Lightmap.tile_intensity[]` | ✅ MATCH | — | |
| lightSetTileIntensity / lightIncreaseTileIntensity / lightDecreaseTileIntensity | `light_add_to_tile` / `light_subtract_from_tile` | ✅ MATCH | — | The bounds check sits in the caller. |

### geometry.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| _GNW_rect_exit / _rect_malloc / _rect_free | — | 🚫 N/A | — | Rect free-list memory. |
| _rect_clip_list / rect_clip | — | 🚫 N/A | — | Dirty-rect clipping, not needed with full-frame WebGL. |
| rectUnion / rectIntersection | `pointInBoundingBox` `hexGrid.ts:230`, inline overlap tests | 🚫 N/A | — | Inclusive-right CE rects vs DH2 x+w. No gameplay use. |



## Detailed findings

### OBJ-01 — Open doors keep blocking movement queries, shots and light — **FIXED 2026-10-24 (PA19)**
- CE: `proto_instance.cc _check_door_state` sets `door->flags |= OBJECT_OPEN_DOOR` (= `OBJECT_SHOOT_THRU | OBJECT_LIGHT_THRU | OBJECT_NO_BLOCK`, `obj_types.h:89`) when opened, clears it when closed, and calls `_obj_rebuild_all_light()`. Every blocking query (`object.cc _obj_blocking_at`, `_obj_shoot_blocking_at`, `_obj_ai_blocking_at`, `_obj_sight_blocking_at`) and `_obj_adjust_light` then see an open door as passable or transparent.
- DH2: `setObjectOpen` (`src/object/Obj.ts:326`) only sets `obj.open`. `Obj.blocks()` (`Obj.ts:848`) honours `open`, so the walk pathfinder is right. But `GameMap.blockingObjectAt` (`GameMap.ts:515`), `straightPathObstacle` (`:595`), `pathfinder.ts blockingMap` in shoot mode, and `lightmap.ts obj_adjust_light` (`:76`) read `flags`, which never change. Nothing rebuilds light on open/close.
- Impact: in combat you can't shoot through an open doorway (`combatIsShotBlocked` sees the door as a non-critter obstacle), and the AI's shoot paths fail the same way. `critter_attempt_placement`, explosions, knockback, `obj_blocking_tile` / `obj_blocking_line` (sfall), worldmap encounter placement and `ui_contextmenu` push all treat the open-door tile as blocked. Light never spills through an opened door.
- Fix: in `setObjectOpen`, for doors (CE `_obj_is_portal`), set or clear `flags` bits `0xA0000010` and call `Lightmap.rebuildLight()` when `doFloorLighting`. Also set them when restoring state (see OBJ-02).
- Ref: NEW (P4 / C45 fixed only the pathfinder side).

### OBJ-02 — Door open / locked / jammed state is lost on save, load and map revisit — **FIXED 2026-10-24 (PA1)**
- CE: the state lives in `obj->data.scenery.door.openFlags` (`0x01` open, `OBJ_LOCKED 0x02000000`, `OBJ_JAMMED 0x04000000`). It is read from the .map (`proto.cc objectDataRead`) and saved with the object (`_obj_save_obj`).
- DH2: `tools/fomap.py` door branch reads the 4-byte field and throws it away (`f.read(4) # unknown?`). `Obj.serialize` (`Obj.ts:1404`) writes neither `open` nor `locked` nor `jammed`. `fromMapObject_` (`Obj.ts:627`) restores none of them. `GameMap.serialize`, used both for the dirty-map cache and for saves, goes through `Obj.serialize`.
- Impact: a door the player opened is closed again after leaving and re-entering a map, or after a save/load. A door locked by `obj_lock` comes back unlocked unless its script re-locks it in `map_enter_p_proc`. Doors locked in the map data itself are never locked. The jam timer (`objectUnjamAll` after 24 h) has nothing to work on after a reload.
- Fix: serialize `open` / `locked` / `jammed` (and container equivalents) in `Obj.serialize` / `fromMapObject_`. Re-apply the OBJ-01 flags on load. Pipeline: emit `openFlags` for doors (and containers' `openFlags`). This needs an asset re-export, so get the user's approval per CLAUDE.md.
- Ref: NEW.

### OBJ-03 — Runtime-created objects ignore the proto light — **FIXED 2026-10-25**
- CE: `object.cc objectCreateWithFidPid` → `objectSetLight(obj, proto->lightDistance, proto->lightIntensity)`.
- DH2: `Obj.fromPID_` (`Obj.ts:587`) never touches `lightRadius` / `lightIntensity`, so they stay 0 / 655. Only map-placed objects get light (from the map record, `Obj.ts:642`), and flares are special-cased (`Obj.ts:258–302`).
- Impact: `create_object` of any light-emitting scenery, misc or item (glowing goo, lamps, burning barrels spawned by scripts) produces no light.
- Fix: in `fromPID_`, set `lightRadius = min(pro.lightDistance, 8)` and `lightIntensity = pro.lightIntensity` (0 = none), then rebuild the light if it is placed on the map.
- Ref: NEW (C46 covered `obj_set_light_level` and flares only).

### OBJ-04 — Automap "seen" area is much smaller than CE's — **FIXED 2026-10-25**
- CE: `objectSetLocation(gDude)` → `obj_set_seen(tile)`. `_obj_process_seen` (`object.cc:3054`) expands each seen bitmap byte to ±16 byte-rows (step 25 bytes = 1 hex row) × ±2 bytes (8 hexes each), so roughly ±16 rows × ±16–23 columns. It sets `OBJECT_SEEN` on every object there, and the automap draws walls/scenery with `OBJECT_SEEN` (`automap.cc:1077`).
- DH2: `automap/tracking.ts markSeenAt` marks hexes within `REVEAL_RADIUS = 5` of the player.
- Impact: the automap reveals about a third of the area CE does per step. Walls just off-screen stay unmapped.
- Fix: mark using CE's band (or port `_obj_process_seen` on the 5001-byte bitmap).
- Ref: NEW (the automap auditor may also report this).

### OBJ-05 — `obj_can_see_obj` uses a different line and blocker rule (cross-ref) — **FIXED 2026-10-25**
- CE: `interpreter_extra.cc opObjectCanSeeObject`: same elevation, both tiles valid, `isWithinPerception(obj1, obj2)` for **any** obj2, then `_make_straight_path(obj1, from, to, nullptr, &obstacle, 16)` with `_obj_blocking_at`. It returns true only if the first obstacle **is** obj2.
- DH2: `scripting.ts:585 objCanSeeObj` skips perception for non-critters and has no elevation check. It calls `GameMap.hexLinecast` (`GameMap.ts:649`), which walks `hexLine` (greedy nearest-neighbour, not CE's screen Bresenham) and returns the first object that `blocks()`, skipping SHOOT_THRU and dead critters (shoot semantics). Any blocker means not seen.
- Impact: NPC sight checks differ near corners and through glass/shoot-thru objects. A dead critter in the way blocks in CE but not in DH2. Two critters in a row: CE says not seen (the first one is the obstacle), DH2 says seen if the front one doesn't `blocks()`.
- Fix: implement it with `straightPathObstacle(obj1, obj1.position, obj2.position, 0, null) === obj2`, plus the elevation and perception checks.
- Ref: NEW. Scripting auditor owns the opcode.

### MAP-01 — `map_update_p_proc` runs twice per map load — **FIXED 2026-10-25**
- CE: `map.cc mapLoad`: `mapSetElevation` runs while `gMapSid == -1` (no update), the map script's `map_enter` runs, then `scriptsExecStartProc` → `scriptsExecMapEnterProc` → **one** `scriptsExecMapUpdateProc`.
- DH2: `loadNewMap` (`mapLoader.ts:221`) → `doEnterNewMap` (`GameMap.ts:425`) ends with `Scripting.updateMap(…)` (`:471`). Then `changeElevation(this.currentElevation, true, true)` (`mapLoader.ts:367`) calls `Scripting.updateMap` again (`GameMap.ts:277`). The dirty-cache path does the same (`mapLoader.ts:205`).
- Impact: every map/object `map_update_p_proc` runs twice on entry. Scripts that count, roll random events, advance state or spawn things in `map_update_p_proc` do it twice.
- Fix: pass `updateScripts=false` to the second `changeElevation` (or drop that call).
- Ref: NEW.

### MAP-02 — Exit-grid transition semantics — **FIXED 2026-10-25**
- CE: `object.cc objectSetLocation(gDude)` → `mapSetTransition` (map 0 → −2). `map.cc mapHandleTransition`: `map == -1` → `wmTownMap()`, `-2` → `wmWorldMap()`. Otherwise it reloads when `map != current || elevation == current elevation`. It then places the dude on the transition tile and elevation unless tile is −1/0 or the map is MODOC_BEDNBREAKFAST / THE_SQUAT_A, and **sets `gDude` rotation = transition.rotation**.
- DH2: `player.ts:368 Player.move` treats `exitMapID < 0` (and map 0, via `Number(x) || -1`) or tile −1 as `uiWorldMap()` (world view, never the town view). `startingOrientation` is never used, so `loadMap` sets the orientation to the header's `startOrientation`. The same map at the same elevation just moves the player, with no reload. There are no B&B / Squat exceptions. `set_exit_grids` (`scripting.ts:2131`) doesn't update the rotation either.
- Impact: walking out of a multi-map town through a `-1` grid shows the world map instead of the town map. The player faces the wrong way on arrival. The two maps with special dude placement put the player on the grid's tile instead of letting their scripts place him.
- Fix: map −1 → `uiWorldMap(true)` (area view of the current area), −2/0 → world view. Pass and apply `startingOrientation`. Add the two map-index exceptions.
- Ref: NEW.

### TILE-02 — Hex→roof square mapping is off by one row for odd hex rows — **FIXED 2026-10-25**
- CE: `object.cc objectSetLocation`: `roofX = tile % 200 / 2; roofY = tile / 200 / 2`, which is square `(x>>1, y>>1)` (DH2 roof arrays are mirrored to `[y][99-x]` by `fomap.py:78`).
- DH2: `tile.ts:53 hexToTile` and `renderer.ts:189` use `tileFromScreen(hexToScreen(h))`. Numerically, for all 40 000 hexes: x = `99-(x>>1)` (199/200 columns ✓), but **y = `(y+1)>>1` for every odd hex y** (19 900 of 40 000 hexes).
- Impact: on odd rows the roof flood starts one square south of CE's. Standing just inside a building's north edge reveals nothing, or standing just outside a southern edge reveals the roof. `GameMap.hasRoofAt` is off the same way.
- Fix: `hexToTile = { x: 99 - (pos.x >> 1), y: pos.y >> 1 }`. Check it against the `roofPeek` heuristic, which was tuned on top of the old mapping.
- Ref: NEW. RD06 claims "exactly matching CE"; that holds for the flood algorithm, not for the start square.

### TILE-03 — Scroll limiting around the dude is missing — **already in the code (camera.ts playerLimitRefuses)**
- CE: `tile.cc tileSetCenter`, with `gTileScrollLimitingEnabled` (on: `map.cc:225 isoInit`): if the new centre is farther from the dude than the current one and `dx >= 480 || dy >= 400` (screen px), the scroll is refused. `move_to(dude)` temporarily disables it (`interpreter_extra.cc:805`).
- DH2: `camera.ts:430 clampCameraPosition` only clamps to the map bounds and the scroll-blocker hex.
- Impact: the player can scroll to any part of a large map (e.g. see guards or encounter critters far away) where CE stops the view at about one screen from the character.
- Fix: in `clampCameraPosition`, compute the new centre's screen delta from `hexToScreen(player)` and refuse the move with CE's rule. Use 480/400 in world px (zoom-independent), and skip it during scripted moves.
- Ref: NEW. `scroll_clamping.md` doesn't mention it.

### OBJ-06 — `getObjectUnderCursor` never picks `objects[0]` and ignores the egg (MED) — **FIXED 2026-10-25**
- CE: `object.cc _obj_intersects_with` returns flag 0x04 when a wall/scenery pixel lies inside the egg and the object qualifies for egg transparency. `game_mouse.cc` uses that to skip the wall. Hidden objects never intersect.
- DH2: `renderer.ts:611` loops `for (let i = objects.length - 1; i > 0; i--)`, so the first array entry can never be picked. There is no egg skip: clicking a critter through the egg-transparent part of a wall picks the wall. Hidden objects are only filtered if the caller's predicate does it.
- Fix: `i >= 0`. Skip `GameMap.isHiddenObj`. When `isEggObject(obj)` and the egg mask covers the pixel, continue.
- Ref: NEW.

## DH2-only behaviour

- `GameMap.isOutdoor()` (`GameMap.ts:175`): a roof-coverage heuristic for the lighting / day-night curve. CE has no indoor/outdoor concept.
- Static/dynamic light split (`bakeStaticLight` / `rebuildDynamicLight`), smooth moving-light modes (`playerLightSmooth`: `blend`, `egg-split`), and the `derived` / `naive` propagation modes (`Config.engine.lightPropagationMode`). In CE other lights' shadows from a moving critter are only recomputed on `_obj_rebuild_all_light`; DH2 recomputes critter lights every frame.
- `changeElevationFaded` (`GameMap.ts:294`): a black overlay fade on stairs, ladders and elevators. CE `mapSetElevation` has no fade, though the code comment cites it.
- `mapFade.ts`: holds a black screen until assets settle (replaces CE's synchronous `isoDisable` / `isoEnable`).
- Scroll bounds: auto bounds from the scroll-blocker bbox / floor bbox, per-map bar table, black edge overlay, `blackBar()` editor, mouse-wheel zoom. Documented in `scroll_clamping.md` and README "Known approximations".
- `roofPeek` second roof flood (`renderer.ts:198`, `Config.ui.roofPeek`).
- Egg modes `dh2-egg` (default, hand-tuned), `alpha`, `bbox`, `beta` (`webglDraw.ts`). `ce-egg` is the literal CE test.
- Deferred object removal (`removeObject` → `drainRemovalQueue` per tick). CE `objectDestroy` is immediate.
- `GameMap.attemptPlacement` / `placeParty` are CE ports from `proto_instance.cc` / `party_member.cc` (out of this scope; C6/P1/P3).
- Unused DarkFO leftovers: `pixelToCube` / `cubeRound` / `сubeRoundToHex` (the first letter of the last one is Cyrillic), `tile_in_tile_rect`, `pointIntersectsCircle` (square, not circle), and `hexesInRadius` (scans all 40 000 hexes; used by the elevator and debug overlay).

## Wiki corrections noticed
- `wiki/lighting.md` §6 says CE's non-wall blocker rule is `rotation >= 2 && rotation <= 4`. CE (`object.cc:4590`) is `ROTATION_E..ROTATION_SW` = **1..3**, and the DH2 code (1..3) is correct.
- `wiki/known_bugs.md` RD06 says the roof clipping exactly matches CE `tile_fill_roof`. True for the flood, not for the start square (TILE-02).
- `wiki/scroll_clamping.md` "no shipped DH2 map uses [scroll blockers]" contradicts `camera.ts computeScrollBlockerBounds`, which relies on blocker rings being present.
