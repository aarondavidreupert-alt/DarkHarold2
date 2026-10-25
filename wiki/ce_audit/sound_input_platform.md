# CE parity audit — sound, mouse/input, art, palette cycling, text/msg, dbox, platform

Scope: `game_sound.cc`, `sound.cc`, `audio*.cc`, `sound_decoder.cc`, `sound_effects_*.cc`, `game_mouse.cc`,
`kb.cc`/`input.cc`/`mouse.cc`/`mouse_manager.cc`/`dinput.cc`/`touch.cc`, `art.cc`, `cycle.cc`, `color.cc`/`palette.cc`,
`text_font.cc`/`font_manager.cc`/`text_object.cc`, `message.cc`, `dbox.cc`, `word_wrap.cc`, and the platform layer
(window/svga/draw/db/cache/…). Audited 2026-10-24 against `raw/fallout2-ce/src` and `src/**/*.ts`.

## Summary

Rows (one per CE function or grouped function family; platform files grouped per file set):
✅ MATCH 51 · ⚠️ DIFFERS 18 · ❌ MISSING 15 · 🟡 PARTIAL 10 · 🚫 N/A 50.
Severity of non-matching rows: 1 HIGH, 11 MED, the rest LOW. None of the HIGH/MED items is in `wiki/known_bugs.md` yet (all NEW); related closed entries: AU2, AU5, AU6, C42, C43, C56, C58, C60, CI7, CI18, L13.

Top findings:
- **SND-01 (HIGH)** — only map music exists: the world map (`23world` / `20car`), the main menu (`07desert`) and the `wind2` fallback for maps without `music=` never play.
- **SND-02 (MED)** — no `_gsound_compute_relative_volume`: off-screen sounds are not attenuated by distance vs. the player's Perception.
- **SND-05 (MED)** — combat weapon sounds bypass `sfxBuildWeaponName` (hit variant always 1, material always flesh, no `X` for plasma/EMP/explosive), plus DH2-invented fallbacks; the opcode version is correct.
- **MOUSE-01 / MOUSE-02 (MED)** — move-mode clicks use/attack objects (CE always walks; no Shift run toggle); command-mode click always opens the action menu instead of doing the primary action, and the cursor drops back to move mode afterwards (README describes this as "right-click", which doesn't match the code).
- **MOUSE-03 / 04 / 05 (MED)** — hover feedback: always the look icon (CE: the primary-action icon after 250 ms), "You see …" repeats on every hover pause (CE: once per object), and no AP-cost / red X readout on the hex cursor.
- **MOUSE-06 (MED)** — `getObjectUnderCursor` ignores roofs and corpses-on-top, and never tests `objects[0]`.
- **MSG-01 (MED)** — the language filter preference masks nothing (`badwords.txt` / `messageListFilterBadwords` not ported).
- Ported well: `sfxBuildCharName` / `sfxBuildOpenName` and the human fallback, ambient sfx timing (C58), all sfx name opcodes, `_art_get_code` / `artAliasFid`, palette cycling (exact groups, periods, colours, direction), the text-object system (placement, timing, cap, outline), and the .msg parser.

## Function table

### game_sound.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| gameSoundInit | `main.ts:246` `new HTMLAudioEngine()` | 🚫 N/A | — | Web Audio / `<audio>` replaces DirectSound init, cache, file IO procs. `[sound] initialize/sounds/music/speech` enable flags not read (only volumes, CI1). |
| gameSoundReset | `audio.ts:293` `stopAll` | 🟡 PARTIAL | LOW | stops music + ambient schedule; speech is stopped separately (talkingHead). No effect counter to reset. |
| gameSoundExit | — | 🚫 N/A | — | page unload. |
| soundEffectsEnable / Disable / IsEnabled | — | ❌ MISSING | LOW | No "sounds on/off" switch (`[sound] sounds=0`); sfx volume 0 is the only way to mute. |
| gameSoundSetMasterVolume / Get | `audio.ts:261` `setVolume('master')` | ⚠️ DIFFERS | LOW | CE: master 0 disables music (`_gsound_background_df_vol`) and re-enables it (restarting the track) when raised. DH2 just scales volume (music keeps playing silently, resumes mid-track). |
| soundEffectsSetVolume / Get | `audio.ts:261` (sfx branch) | ⚠️ DIFFERS | LOW | CE sets volume at allocation (`_gsound_get_sound_ready_for_effect`), so already-playing sfx keep the old volume; DH2 gain node changes live. Inaudible in practice. |
| backgroundSoundDisable / Enable / IsEnabled | — | ❌ MISSING | LOW | No music on/off (`[sound] music=0`). Movie volume coupling (`movieSetVolume(music×0.94)`) not ported (gameMovie volume is independent — unverified beyond grep). |
| backgroundSoundSetVolume / Get / _gsound_background_volume_get_set | `audio.ts:261` (music branch) | ⚠️ DIFFERS | LOW | CE plays music at `musicVolume × 0.94` and disables music at volume 0 (restart on raise). DH2 uses `music × master` with no 0.94 factor and never disables. |
| backgroundSoundSetEndCallback / GetDuration | — | 🚫 N/A | — | no CE callers set an end callback for map music in vanilla flow (endgame uses it; DH2 endgame drives its own timing). |
| backgroundSoundLoad (+ `_gsound_background_play_level_music`) | `audio.ts:168` `playMusic`, `GameMap.ts:475` `playMapMusic` | 🟡 PARTIAL | HIGH | Map music matches (`wmMapMusicStart`, loop). But the other CE callers are absent — see SND-01 (worldmap `23world`/`20car`, main-menu `07desert`, map-load `wind2`). No `_gsound_background_fade` (CE leaves it 0 in vanilla, so no fade — match). CE restarts the same track on every map load (backgroundSoundDelete + load); DH2 also restarts (`stopAll` + `playMusic`) — match. |
| backgroundSoundDelete | `audio.ts:284` `stopMusic` | ✅ MATCH | — | L13 (drops the stream). |
| backgroundSoundRestart | `talkingHead.ts:410` (dialog end) | 🟡 PARTIAL | LOW | only the dialogue restart (`game_dialog.cc:999`) is ported; master/music re-enable restart is not (see above). |
| backgroundSoundPause / Resume | — | ❌ MISSING | LOW | CE pauses music during save/load screens (`loadsave.cc:1537`) and non-stopping movies (`game_movie.cc:189/298`). DH2 keeps playing under the save/load screen; `gameMovie.ts:294` only implements the STOP flag. |
| speechDisable / Enable / IsEnabled | — | ❌ MISSING | LOW | `[sound] speech=0` not honoured. |
| speechSetVolume / Get / _gsound_speech_volume_get_set | `audio.ts:261` (speech branch), `talkingHead.ts:280` | ✅ MATCH | — | speech at `speech × master × 0.69` (lips). Volume change during playback not applied live (CE applies it) — trivial. |
| speechSetEndCallback / GetDuration | `talkingHead.ts` | 🚫 N/A | — | handled by `<audio>` events. |
| speechLoad / _gsound_speech_play_preloaded / speechPlay / speechDelete / Pause / Resume | `talkingHead.ts:262`, `endgame/slideRender.ts:52` | ✅ MATCH | — | dialogue speech, endgame narrator. Death narration (`main.cc:440`) is the endgame/main auditor's scope. `preferences.cc:1502` "narrator\options" not checked here. |
| _gsound_play_sfx_file_volume | — | ❌ MISSING | LOW | used by combat_ai.cc (2741–2934) for AI combat sounds with relative volume; see SND-02. |
| soundEffectLoad (incl. human `H?XXXX` fallback, `MALIEU`/`MAMTN2`→`MAMTNT`) | `sfxNames.ts:83` `playCharSfx`, `audio.ts:108` `loadSfx` | ⚠️ DIFFERS | LOW | Human fallback matches (AU5). Missing: the `MALIEU*`/`MAMTN2*` → `MAMTNT*` fallback (Lieutenant / mutant critters with no own sound file use the generic mutant sounds in CE; silent in DH2) — SND-04. Missing: `SOUND_EFFECTS_MAX_COUNT` (4) concurrent-effect cap — SND-03. |
| soundEffectLoadWithVolume | — | ❌ MISSING | MED | see SND-02 (distance attenuation). |
| soundEffectDelete / _gsnd_anim_sound / soundEffectPlay / soundEffectCallback | `audio.ts:142` `playBuffer` | 🚫 N/A | — | fire-and-forget BufferSource. |
| _gsound_compute_relative_volume | — | ❌ MISSING | MED | SND-02. |
| sfxBuildCharName | `sfxNames.ts:53` | ✅ MATCH | — | AU6. Base = first 6 chars of art name, art code via `artGetCode`, Y/Z overrides identical. |
| gameSoundBuildAmbientSoundEffectName | `scripting.ts:2598` `sfx_build_ambient_name` | ✅ MATCH | — | `A%6s1` (padStart = right-aligned `%6s`). |
| gameSoundBuildInterfaceName | `scripting.ts:2603` | ✅ MATCH | — | `N%6s1`; item name builder also uses it (CE). |
| sfxBuildWeaponName | opcode: `scripting.ts:2610`; engine: `soundMap.ts:110` `getWeaponSounds` + `audio.ts:222` `playWeaponSfx` | ⚠️ DIFFERS | MED | Opcode port matches. The engine path does not use it: hit sound variant always `1` (CE `2` for non-primary hit modes, e.g. burst), material always flesh (`F`), never `X` for plasma/EMP/explosive damage, and the DH2-only fallbacks (burst→single, material→`xxx`). SND-05. |
| sfxBuildSceneryName | `scripting.ts:2624` | ✅ MATCH | — | `S%c%c%4s1`. |
| sfxBuildOpenName | `sfxNames.ts:32` | ✅ MATCH | — | AU5; `A` only when no proto, byte 0 → no file. |
| _gsound_red/med/lrg_butt_press/release, _gsound_toggle_butt_press_ | per-UI calls, e.g. `ui_inventory/panel.ts:70`, `hotkeys.ts:41` | 🟡 PARTIAL | LOW | Names identical (`ib1p1xx1`/`ib1lu1x1`/`ib2…`/`ib3…`/`toggle`); wired per screen by hand. Coverage per screen belongs to the UI auditors. Release sounds are wired only where DH2 added mouseup handlers (inventory, pipboy). |
| soundPlayFile | `audio.ts:211` `playSfxByName` | ✅ MATCH | — | looks the stem up in sndlist first (CE: load fails silently). |
| _gsound_bkg_proc | — | 🚫 N/A | — | browser audio needs no pump. |
| gameSoundFileOpen/Read/Write/Seek/Tell/GetSize/Close, gameSoundIsCompressed, _gsound_file_exists_f, _gsound_setup_paths | — | 🚫 N/A | — | fetch() of pre-converted WAV/MP3. |
| _gsound_background_allocate, _gsound_get_sound_ready_for_effect | — | 🚫 N/A | — | |
| gameSoundFindBackgroundSoundPathWithCopy / FindBackgroundSoundPath / gameSoundDeleteOldMusicFile, _gsound_get_music_path | `audio.ts:168` (`audio/music/`) | 🚫 N/A | — | `[sound] music_path1/2` (CD copy) has no browser meaning. |
| gameSoundFindSpeechSoundPath | `talkingHead.ts:262` | 🚫 N/A | — | `audio/speech/<head>/<name>.mp3`. |
| backgroundSoundCallback / speechCallback | `<audio>` events | 🚫 N/A | — | |
| _gsound_sfx_q_start / ambientSoundEffectEventProcess | `audio.ts:321` `tick` | ✅ MATCH | — | C58 port. Checked: (a) CE returns without scheduling when `gMapHeader.name` is empty and schedules only when `wmSfxMaxCount() > 0` — same effect. (b) CE drops the queued event on map change (`_queue_clear_type`), and the event lives in the save queue; DH2 keeps `nextSfxTime` until `stopAll` (called on map music start) — equivalent. (c) the event fires with the sfx index rolled at *schedule* time, plays it, and rolls the next — DH2 same. Also CE's event is a game-time queue event, so it does not advance while the game is paused in menus; DH2 uses `gameTickTime` — match. |

### sound.cc / audio.cc / audio_file.cc / audio_engine.cc / sound_decoder.cc / sound_effects_cache.cc / sound_effects_list.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| sound.cc (soundInit…soundSetDefaultFileIO, ~50 fns: allocate/load/play/stop/pause/loop/fade/volume/channels/read-limit) | `audio.ts` `HTMLAudioEngine` (Web Audio BufferSource for sfx, `<audio>` for music/speech) | 🚫 N/A | — | Volume is linear in both (CE `_soundVolumeHMItoDirectSound`: 0–32767 → 0–128 linear; DH2 gain 0–1). `_soundFade` unused in vanilla flows (`_gsound_background_fade` stays 0). Looping music = `loop=true`. |
| sound_decoder.cc (ACM subband DPCM decoder) | pipeline `tools/acmMono.py` / `convertAudio.py` | 🚫 N/A | — | offline; mono fix AU2. |
| audio.cc / audio_file.cc (compressed/uncompressed file wrappers) | fetch() | 🚫 N/A | — | |
| audio_engine.cc (SDL backend) | Web Audio | 🚫 N/A | — | |
| sound_effects_cache.cc (LRU cache of decoded sfx) | `audio.ts:82` `sfxCache` + `sfxMissing` | 🚫 N/A | — | DH2 cache is unbounded (fine in browser). |
| sound_effects_list.cc (`SNDLIST.LST` index, `soundEffectsListGetTag/FileSize`) | `audio.ts:204` `hasSfx` (`lut/lst/sound_sfx_sndlist.json`) | ✅ MATCH | — | Same existence test; names are upper-cased. |

### game_mouse.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| gameMouseInit / Reset / Exit | `mapLoader.ts:383` (cursor art preload) | 🚫 N/A | — | |
| _gmouse_enable / _gmouse_disable | `globalState.gameUIDisabled` checks in `input.ts` | ✅ MATCH | — | |
| _gmouse_enable_scrolling / _gmouse_disable_scrolling / gmouse_scrolling_is_enabled / _gmouse_is_scrolling / _gmouse_get_click_to_scroll | `gameTick.ts:155` (`gameHasFocus`) | 🟡 PARTIAL | LOW | No explicit scroll enable flag (CE disables it on worldmap / map load); DH2 gates on focus and UI mode. `click_to_scroll` not ported. |
| gameMouseHandleScrolling (+ map.cc mapScroll) | `gameTick.ts:162`, `input.ts:344` (scroll cursor), `renderer.ts:357` | ⚠️ DIFFERS | LOW | CE: only on the exact screen-edge pixel, steps 32 px (x) / 24 px (y) every ≥33 ms, and shows the `*_INVALID` (red, "blocked") scroll cursor when `mapScroll` fails. DH2: `[dh2] scroll_edge` zone (default 10 px, documented), 15 px/tick both axes (~900 px/s vs CE ~970/727), no blocked-scroll cursor. MOUSE-07. |
| gameMouseRefresh (hover logic) | `input.ts:294` `mousemoved`, `gameTick.ts:180`, `renderer.ts:318` | ⚠️ DIFFERS | MED | see MOUSE-03 (primary-action icon), MOUSE-04 (repeated look message), MOUSE-05 (AP readout on hex cursor), item outline timing. |
| gameMouseClickOnInterfaceBar | DOM `#bar` swallows clicks | 🚫 N/A | — | |
| _gmouse_handle_event — right button | `input.ts:283` → `cycleMouseMode` | ✅ MATCH | — | |
| _gmouse_handle_event — left up, MOVE mode | `input.ts:269` → `playerUse(getObjectUnderCursor(isSelectable))` | ⚠️ DIFFERS | MED | MOUSE-01: CE always walks/runs to the hex in move mode (Shift inverts `running`); DH2 uses/attacks/talks to the clicked object and has no Shift toggle. |
| _gmouse_handle_event — left up, ARROW mode (primary action) | `input.ts:258` (opens action menu) | ⚠️ DIFFERS | MED | MOUSE-02: CE click = primary action (pick up / talk / use / look / loot / rotate dude), hold = action menu. DH2: every click opens the menu; menu closing resets to move mode (`ui_contextmenu.ts:41`), CE stays in arrow mode. Partially documented (README "Known approximations": says "right-click", the code uses left-click in command mode). |
| _gmouse_handle_event — left up, CROSSHAIR | `input.ts:264` | 🟡 PARTIAL | LOW | DH2 attacks any object under the cursor except the dude; CE picks a critter first, else only a door (`objectIsDoor`), and re-arms the hover readout. Attacking scenery other than doors is possible in DH2 (playerUse decides). |
| _gmouse_handle_event — USE_CROSSHAIR (item on object) | `input.ts:253` `usePendingItemOn` | ✅ MATCH | — | AP cost in combat handled in `useItemOn.ts` (not re-verified here). |
| _gmouse_handle_event — skill crosshairs | `input.ts:267` → `playerUse` (useSkill) | ✅ MATCH | — | CE: clicking empty ground keeps the mode only when actionUseSkill fails; DH2 First Aid/Doctor on empty ground → self (CE: `object == nullptr` → leaves mode, no self-use). ⚠️ LOW, see MOUSE-08. |
| _gmouse_handle_event — action menu (left-hold) | `ui_contextmenu.ts:45` `uiContextMenu` | ✅ MATCH (content) | — | C42: menu items per type match CE; opening gesture differs (documented). |
| gameMouseSetCursor / GetCursor (incl. animated wait cursor) | `renderer.ts:318-372` canvas-drawn cursors, CSS on DOM | 🟡 PARTIAL | LOW | Hotspot: CE `offsetX = w/2 - ox`, `offsetY = h-1-oy` (FRM offsets); DH2 uses top-left for arrows and centre for crosshairs (approximate). Animated `wait` cursor (`MOUSE_CURSOR_WAIT_PLANET/WATCH`) not used. |
| gmouse_set_mapper_mode / _gmouse_3d_enable_modes | — | 🚫 N/A | — | mapper only. |
| gameMouseSetMode / GetMode | `globalState.cursorMode` | ✅ MATCH | — | mode change re-runs `refreshHighlights` (CE `_combat_outline_on/off` when entering/leaving crosshair). |
| gameMouseCycleMode | `input.ts:181` `cycleMouseMode` | ✅ MATCH | — | crosshair skipped outside combat and with a non-weapon active item (C43). |
| _gmouse_3d_refresh / gameMouseRefreshImmediately | — | 🚫 N/A | — | redraw every frame. |
| gameMouseSetBouncingCursorFid / ResetBouncingCursorFid | — | 🚫 N/A | — | the "bouncing" cursor is the flat hex overlay. |
| gameMouseObjectsShow / Hide / IsVisible | `Config.ui.showCursor`, cursorMode checks | ✅ MATCH | — | |
| gameMouseGetObjectUnderCursor | `renderer.ts:611` `getObjectUnderCursor` | ⚠️ DIFFERS | MED | MOUSE-06: no roof test (CE returns nothing for objects under a visible roof unless the egg covers the mouse); does not skip dead / knocked-out critters in favour of what lies under them; loop `i > 0` never tests `objects[0]`. |
| gameMouseRenderPrimaryAction / _gmouse_3d_pick_frame_hot | `renderer.ts:327` (always `lookn`) | ⚠️ DIFFERS | MED | MOUSE-03. |
| gameMouseRenderActionMenuItems / HighlightActionMenuItemAtIndex | `ui_contextmenu.ts` (DOM buttons) | 🚫 N/A (deliberate) | — | DOM menu, click instead of drag-select (C42). |
| gameMouseRenderAccuracy | `ui_hud.ts:594` `uiShowCombatHover` (via `gameTick.ts:189`) | ✅ MATCH | — | CI18: "NN%" / " X ", `_colorTable` team colours. DOM overlay, refreshed every 750 ms vs CE 250 ms hover (documented: README "Hover readout"). Only for critters (CE also doors). |
| gameMouseRenderActionPoints | — | ❌ MISSING | MED | MOUSE-05. |
| gameMouseLoadItemHighlight | `Config.ui.itemHighlight` (CI7) | ✅ MATCH | — | |
| gameMouseObjectsInit / Reset / Free, gameMouseActionMenuInit / Free, customMouseModeFrmsInit | `mapLoader.ts:383` art preload | 🚫 N/A | — | |
| gmouse_3d_set_flat_fid / gameMouseUpdateHexCursorFid / _gmouse_3d_move_to | `renderer.ts:221` (hex outline at `hexCellTopLeft`) | ✅ MATCH | — | hex cursor drawn post-roof (`object.cc _obj_render_post_roof`). |
| _gmouse_remove_item_outline | `input.ts:302` | ⚠️ DIFFERS | LOW | CE outlines the hovered item only in ARROW mode and only after the 250 ms hover; DH2 outlines it in every mode immediately on mouse move. |
| objectIsDoor | `Obj.isDoor` | ✅ MATCH | — | |
| gmouse_get_outlined_object | `globalState.hoveredItem` | ✅ MATCH | — | |

### art.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| artInit (lst load, critter alias + run column, head fidget counts, sfall native-look names) | `tools/convertLST.py` → `lut/lst/art_*.json`; `pro.ts:93` | 🟡 PARTIAL | LOW | Lists, alias (`walk` field) and run column are exported. ART-01: a critters.lst line without an alias falls back to `hmjmps` in DH2; CE uses `_art_vault_guy_num` = the **tribal male** (`hmwarr`, sfall `DudeNativeLook` configurable). DH2 also ignores an alias of 0 (`alias > 0`); CE uses it. Neither case is expected in vanilla critters.lst (unverified against a live install). sfall native-look keys not read. |
| artReset / artExit / artCacheFlush / artLock / artLockFrameData* / artUnlock, artCacheGetFileSizeImpl / ReadDataImpl / FreeImpl | `images.ts`, `idbcache.ts` | 🚫 N/A | — | browser image cache. |
| artGetObjectTypeName / artIsObjectTypeHidden | — | 🚫 N/A | — | mapper-only hide flags. |
| artGetFidgetCount | `talkingHead.ts` (heads.lst good/neutral/bad counts) | ✅ MATCH | — | P4. |
| artRender | — | 🚫 N/A | — | WebGL. |
| art_list_str / artCopyFileName | `getLstJson` (`data.ts`) | ✅ MATCH | — | |
| _art_get_code | `pro.ts:64` `artGetCode` | ✅ MATCH | — | identical branch order and letters (take-out range, prone/back-to-standing, called-shot pic, SF deaths `r`, knockdown/deaths `b`, throw, dodge, stand/walk weapon prefix). |
| artBuildFilePath (critters, heads, rotation `.fr0–5`, alias) | `pro.ts:93` `getCritterArtPath`, `lookupArt` | ✅ MATCH | — | per-direction `.frN` handled by the pipeline. Language-specific art folders (`gArtLanguage`) not supported (english only) — LOW. |
| artReadList | `tools/convertLST.py` | 🚫 N/A | — | |
| artGetFramesPerSecond | `critterAnimation.ts:294/351` | ✅ MATCH | — | 0 → 10. |
| artGetActionFrame | `imageMap.json` `actionFrame` (FA3) | ✅ MATCH | — | |
| artGetFrameCount / Width / Height / Size / FrameOffsets / RotationOffsets / FrameData / Frame | `imageMap.json` (frmpixels.py) | ✅ MATCH | — | |
| artExists / _art_fid_valid | `Critter.hasAnimation` | ✅ MATCH | — | |
| _art_alias_num | `pro.ts:97`, `Combat.ts:1157` (hit-location msg) | ✅ MATCH | — | |
| artCritterFidShouldRun | `Critter.ts:304` `canRun()` = has `run` art | ⚠️ DIFFERS | LOW | ART-02: CE reads critters.lst column 3 (the AI runs only if it is set, `combat_ai.cc:2424`); DH2 runs whenever a run FRM exists. The column is exported but unused. |
| artAliasFid | `pro.ts:61` `ALIASED_CRITTER_ANIMS` | ✅ MATCH | — | same 8 anims (27, 29, 30, 33, 55, 57, 58, 64). |
| buildFid / buildFidInternal | `scripting.ts:1964` (art_change_fid etc.) | ✅ MATCH | — | |
| artReadFrameData / ReadHeader / artLoad / artRead / artWrite* / artGetDataSize / paddingForSize, FrmImage | `tools/frmpixels.py` | 🚫 N/A | — | offline FRM decode. |

### cycle.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| colorCycleInit / Reset / Free | `colorCycle.ts:15` `cycleTime`, `parsePNGCycleMask` | ✅ MATCH | — | `[system] color_cycling` / `cycle_speed_factor` read (C60). |
| colorCycleTicker | `shaders/fragment.glsl:263` `cycleColor` | ✅ MATCH | — | Same 6 groups and ranges (slime 229–232 @200 ms, monitors 233–237 @100 ms, fire_slow 238–242 @200 ms, fire_fast 243–247 @142 ms, shoreline 248–253 @200 ms, bobber 254 @33 ms), same 6-bit colours ×4, same rotation direction (`ci = (k − f) mod N`), bobber 0→60→0 step 4 (DH2: continuous triangle, 1 s period — same envelope, not stepped). |
| colorCycleDisable / Enable / Enabled | — | ❌ MISSING | LOW | CE freezes cycling while dialogue, Pip-Boy, skilldex, char editor, worldmap, options, save/load, elevator, movies are open, and during palette fades. DH2 keeps animating the map behind DOM windows. Mostly invisible (map covered). |
| cycleSetSpeedFactor | `Config.ui.cycleSpeedFactor` | ✅ MATCH | — | |

### color.cc / palette.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| colorPaletteLoad, _initColors, _setIntensityTables, _setMixTableColor, _buildBlendTable, _getColorBlendTable, _calculateColor, Color2RGB, _setSystemPalette*, _getSystemPalette | pipeline (palette baked into PNGs), `FLOAT_MSG_COLOR` / `CE_COLOR` tables | 🚫 N/A | — | Colour-table indices (`_colorTable[n]`) are hand-converted per call site; spot-checked float / dbox / accuracy colours match. |
| colorSetBrightness | SVG component-transfer filter (CI18) | ✅ MATCH | — | |
| colorPaletteFadeBetween / paletteFadeTo / paletteInit (fade-step calibration) | `mapFade.ts:31` | ⚠️ DIFFERS | LOW | PAL-01: CE fades over ~700 ms (`gPaletteFadeSteps = 60·700/measured`), both to and from black; DH2 cuts to black instantly and fades in over 250 ms. |
| paletteReset / paletteExit / paletteSetEntries / InRange | — | 🚫 N/A | — | |

### message.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| badwordsInit / badwordsExit | — | ❌ MISSING | MED | MSG-01. |
| messageListInit / Free | `globalState.messageFiles`, `scriptMessages` | 🚫 N/A | — | |
| messageListLoad / _message_load_field | `data.ts:189` `parseMsgFile` | ✅ MATCH | — | brace fields, newlines dropped, stops at the first malformed entry, later duplicates replace earlier ones. Small differences (LOW): no 1024-char field limit, path hard-coded to `text/english/` (CE `settings.system.language` with the sfall English fallback), `�` → `'` (encoding hack). |
| messageListGetItem / _message_find / _message_add | `util.ts:204` `getMessage` | ✅ MATCH | — | |
| getmsg (`"Error"` on a missing id) | `getMessage` returns `null` | ⚠️ DIFFERS | LOW | CE prints the string `Error`; DH2 callers substitute `''`, a fallback, or skip. Script `message_str` behaviour belongs to the interpreter audit. |
| _message_make_path | — | 🟡 PARTIAL | LOW | english only. |
| _message_parse_number | `Number(num.trim())` | ⚠️ DIFFERS | LOW | DH2 trims the number field; CE rejects leading/trailing blanks and ends the load there. DH2 is more lenient. |
| messageListFilterBadwords | — | ❌ MISSING | MED | MSG-01. |
| messageListFilterGenderWords (sfall `GameDialogGenderWords`, `<male^female>`) | — | ❌ MISSING | LOW | sfall option, off by default; vanilla .msg files don't use it. |
| messageListRepositoryInit / Reset / Exit / SetStandardMessageList / SetProtoMessageList / AddExtra / GetMsg / Load | `getMessage(name, id)` by file name | 🚫 N/A | — | sfall `add_extra_msg_file` / `message_str_game` — sfall auditor's scope. |

### text_object.cc (floating text)

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| textObjectsInit / Reset / Free | `globalState.floatMessages` | ✅ MATCH | — | |
| textObjectsDisable / Enable | — | ❌ MISSING | LOW | CE stops expiring text while disabled; impact unverified. |
| textObjectsSetBaseDelay / SetLineDelay | `gameTick.ts:207` (`textBaseDelay`, `(base−1)·0.4`) | ✅ MATCH | — | C56; CE clamps the line delay to 0–2 s, which the 1–6 base range never exceeds. |
| textObjectAdd | `floatText.ts:34` `addFloatMessage` + `buildCanvas` | ✅ MATCH | — | 20-object cap, empty string refused, one per owner, fixed tile (does not follow the owner), centred lines `lineHeight+1` apart, black fill + `bufferOutline`, font 101/103. Word wrap differs slightly — WRAP-01. |
| textObjectsRenderInRect | `floatText.ts:199` `updateFloatText` (DOM canvases) | ✅ MATCH | — | text is not scaled by zoom (deliberate fixed text size); offsets are scaled. |
| textObjectsGetCount | `floatMessages.length` | ✅ MATCH | — | |
| textObjectsTicker | `gameTick.ts:201` | ✅ MATCH | — | real-time expiry `lineDelay·lines + baseDelay`. |
| textObjectFindPlacement | `floatText.ts:179` `findPlacement` | ✅ MATCH | — | same 8 candidate spots and final fallback. |
| textObjectsRemoveByOwner | `floatText.ts:38` | ✅ MATCH | — | |

### word_wrap.cc / text_font.cc / font_manager.cc / fon

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| wordWrap | `floatText.ts:78` (float text); CSS wrapping elsewhere | ⚠️ DIFFERS | LOW | WRAP-01: CE breaks after a space **or hyphen**, character-wraps a word wider than the line, and treats `\n` as an ordinary break candidate; DH2 breaks only at spaces, never splits a long word (the line overflows), and forces a break at `\n`. |
| interfaceFontGetStringWidthImpl (font_manager.cc) | `fontCore.ts:166` `measureText` | ⚠️ DIFFERS | LOW | CE adds letterSpacing after every glyph incl. the last one and uses the font's `wordSpacing` for spaces; DH2 drops the trailing spacing and uses the atlas space glyph (4 px fallback). ±1 px in centring and wrap points. |
| interfaceFontsInit / Draw / LineHeight / CharacterWidth / Monospaced* / LetterSpacing / BufferSize (AAF) | `fontCore.ts` `FontRenderer`, `renderBitmapText`; `tools/exportFonts.py` | ✅ MATCH | — | line height = maxHeight + lineSpacing. |
| text_font.cc (FON bitmap fonts: fontInit, fontSetCurrent, fontDrawText, …) | `formats/fon.ts` `fonUnpack`, `ui_font.ts` | ✅ MATCH | — | bit-packed glyph decode. |

### dbox.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| showDialogBox | `ui_dialog.ts:155` `showDialog` | 🟡 PARTIAL | LOW | DBOX-01: only the LARGE layout; CE picks MEDIUM (`medialog`) when there is no 2nd button, width ≤ 168 px and ≤ 5 lines. Keys: CE Return (plays `ib1p1xx1`) = yes, Esc = no, Y/N only with flag 0x10 (YES_NO); DH2 always accepts Y/N. Colours / fonts / positions match. |
| showLoadFileDialog / showSaveFileDialog / fileDialogRenderFileList | — | 🚫 N/A | — | character-editor `.gcd` load/save dialog (chareditor auditor); the browser has no file system. |

### kb.cc / input.cc / mouse.cc / mouse_manager.cc / dinput.cc / touch.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| input.cc inputInit/Exit/GetInput, event queue, `_GNW95_process_message/key`, focus loss | `heart.ts`, `input.ts:224` (DOM events) | 🚫 N/A | — | |
| input.cc tickersExecute/Add/Remove/Enable/Disable | `heart.ts` loop, `gameTick.ts` | 🚫 N/A | — | |
| input.cc getTicks / getTicksSince / getTicksBetween / _get_bk_time / inputPauseForTocks / inputBlockForTocks | `performance.now()` | 🚫 N/A | — | |
| input.cc takeScreenshot / screenshotHandler* (F12 → `scrNNNNN.bmp`) | — | ❌ MISSING | LOW | browser screenshot instead. |
| input.cc buildNormalizedQwertyKeys, beginTextInput/endTextInput | DOM `KeyboardEvent.key` | 🚫 N/A | — | |
| kb.cc keyboardInit…keyboardPeekEvent, layouts (QWERTY/AZERTY/QWERTZ/IT/ES), `_kb_simulate_key` | `hotkeys.ts` on `KeyboardEvent.key` | 🚫 N/A | — | the browser handles layouts; the game key map itself is `game.cc gameHandleKey` (other auditor, C43). |
| mouse.cc mouseInit…mouse_get_last_buttons (cursor blit, `_mouse_info`, click-in tests, sensitivity) | `heart.ts`, `renderer.ts:318` | 🚫 N/A | — | sensitivity stored only (documented). |
| mouse.cc mouseGetWheel / convertMouseWheelToArrowKey | `main.ts:178` (wheel zoom) | 🚫 N/A (documented) | — | README "Known approximations": the wheel zooms instead of scrolling (C43). Wheel list scrolling exists per window (inventory, save/load, automap, worldmap). |
| mouse_manager.cc (animated cursor cache, used by interpreter_lib) | — | 🚫 N/A | — | |
| dinput.cc | — | 🚫 N/A | — | |
| touch.cc (gesture → mouse) | — | ❌ MISSING | LOW | no touch input (desktop browser target). |

### Platform / infrastructure (grouped)

| CE file(s) | DH2 counterpart | Status | Notes |
|---|---|---|---|
| window.cc, window_manager.cc, window_manager_private.cc, svga.cc, draw.cc, region.cc, widget.cc, graph_lib.cc | DOM windows (`ui_*.ts`, `ui_widget.ts`, `ui_components.ts`, `ui_dom.ts`), WebGL (`webglrenderer.ts`, `render/*`) | 🚫 N/A | `draw.cc bufferOutline` is ported for float text (`floatText.ts:130`). Window drag is a DH2 option (`[dh2] drag_windows`). |
| heap.cc, memory.cc, memory_manager.cc, pointer_registry.cc | JS GC | 🚫 N/A | |
| db.cc, dfile.cc, xfile.cc, datafile.cc, cache.cc, file_find.cc, file_utils.cc, pcx.cc | pre-baked JSON/PNG, `util.ts getFileText/getFileJSON`, `idbcache.ts` | 🚫 N/A | no runtime DAT parsing, by design (CLAUDE.md). |
| platform_compat.cc, win32.cc, autorun.cc, version.cc, debug.cc | — | 🚫 N/A | |
| delay.cc, fps_limiter.cc | `heart.ts` 60 Hz loop | 🚫 N/A | |
| string_parsers.cc | `ui_options/fallout2Cfg.ts`, `sfallIni.ts` | 🚫 N/A | |
| select_file_list.cc | — | 🚫 N/A | |
| movie_lib.cc (MVE decoder) | pipeline → video, `gameMovie.ts` | 🚫 N/A | movie auditor. |

## Detailed findings

### SND-01 — Worldmap, main-menu and fallback music never play (HIGH, NEW) — **FIXED 2026-10-24 (PA23)**
- **CE:** `worldmap.cc wmInterfaceInit` (4447, call at 4461): `_gsound_background_play_level_music(isInCar ? "20car" : "23world", 12)` when the world map opens; `main.cc:97` plays `07desert` behind the main menu (and `backgroundSoundDelete` on exit, `main.cc:214/255`); `map.cc mapLoad:819` starts the looping `wind2` while a map loads, and `wmMapMusicStart` (`worldmap.cc:6489`) replaces it only when the map's `music=` in maps.txt is set — a map without music keeps `wind2`.
- **DH2:** only `GameMap.playMapMusic` (`src/map/GameMap.ts:475`) calls `playMusic`, and only with `curMapInfo.music`. `src/ui_worldmap.ts`, `src/worldmap/`, `src/ui_mainmenu.ts` contain no audio calls (grep), so the previous town's track keeps playing on the world map (nothing stops or replaces it; not checked in the browser), the main menu is silent, and maps without a `music=` entry are silent instead of playing `wind2`.
- **Impact:** audible on every world-map trip and at every start.
- **Fix:** add `playMusic(inCar ? '20car' : '23world')` in the worldmap open path and restart the map music on worldmap exit via the existing map-load path; `playMusic('07desert')` when the main menu is shown (not under the intro movies, C64); in `playMapMusic`, fall back to `wind2` when `curMapInfo.music` is empty.

### SND-02 — No distance attenuation of off-screen sounds (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `game_sound.cc _gsound_compute_relative_volume` — for an item/critter/scenery source (its owner if carried): full volume when its rect intersects the iso window; when off screen, full up to `distance ≤ PE`, linear `0x7FFF − 0x5554·(d−PE)/PE` between PE and 2·PE, and `0x2AAA` (⅓) beyond 2·PE. Used for every animation-registered sound (`animation.cc:1276`: weapon fire/hit, character sounds, `reg_anim_play_sfx`) and AI combat sounds (`combat_ai.cc:2741-2934` via `_gsound_play_sfx_file_volume`). The result scales `gSoundEffectsVolume` (`soundEffectLoadWithVolume`).
- **DH2:** `HTMLAudioEngine.playSfx` (`src/audio.ts`) plays every sfx at `sfxVolume × master`; no position input.
- **Impact:** off-screen fights, doors and NPC sounds are as loud as on-screen ones; the player's Perception has no effect.
- **Fix:** add an optional source object to `playSfx` / `playCharSfx` / `playWeaponSfx` / `playOpenSfx`, compute the CE factor (screen-rect test against the camera view, `hexDistance` to the player, PE), and feed it to a per-source `GainNode`.

### SND-05 — Engine weapon sounds don't use `sfxBuildWeaponName` rules (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `game_sound.cc sfxBuildWeaponName` → `W<type><id><variant><material>XX1`: variant `2` for any hit mode other than left/right primary and punch (burst, secondary melee modes, …) for ATTACK and HIT; material `X` when not a hit, no target, or damage type explosion/plasma/EMP; otherwise `M`/`W`/`S` from the item/scenery/wall material, `F` for critters (material −1). A missing file is silent (`soundEffectLoad` fails).
- **DH2:** `soundMap.ts:110 getWeaponSounds` + `audio.ts:222 playWeaponSfx`, called from `Combat.ts:831/912`: attack variant 2 only when `isBurst()` (not for other secondary modes); the HIT sound is always variant 1 and always `F` (`material` default 'flesh'; Combat never passes one); plasma / EMP / explosive weapons ask for `WH<id>1FXX1` first; DH2-only fallbacks: a missing burst sound plays the single-shot one, a missing material hit plays `…1XXX1`. The `sfx_build_weapon_name` opcode (`scripting.ts:2610`) is correct.
- **Impact:** wrong or missing hit sample for burst hits and secondary attacks; plasma/EMP/explosive hits may play a flesh sample where the file exists.
- **Fix:** route the combat calls through one `sfxBuildWeaponName(effect, weapon, hitMode, target)` (move the opcode body to `sfxNames.ts`) and drop the invented fallbacks (or keep them behind a `[dh2]` switch as a documented deviation).

### MOUSE-01 — Move-mode click acts on objects (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `game_mouse.cc _gmouse_handle_event` (left up, `GAME_MOUSE_MODE_MOVE`): always `_dude_move` / `_dude_run` to the hex under the cursor (in combat with `free_move + AP`); Shift inverts the `running` preference. Objects are only used from the arrow (command) or crosshair cursors.
- **DH2:** `input.ts:269` → `playerUse(getObjectUnderCursor(isSelectable))` (`playerUse.ts:168`): clicking a critter in combat attacks it, clicking a usable object uses it, even with the hex cursor. No Shift run/walk toggle (only `doAlwaysRun`).
- **Impact:** CE players' muscle memory (walk next to a critter by clicking it) triggers attacks/uses; no quick walk/run toggle.
- **Fix:** in move mode, always walk to `mouseHex`; read `e.shiftKey` to invert `Config.engine.doAlwaysRun`. (DarkFO legacy; could be a `[dh2]` option if kept.)
- **Fixed 2026-10-25:** as an option: `[dh2] mouse_mode=ce` makes a move-cursor click always walk / run to the hex (Shift inverts running, PREF-01). The default `dh2` keeps DH2's click-to-use.

### MOUSE-02 — Arrow-mode click opens the action menu instead of the primary action; mode resets (MED, partly documented C42) — **FIXED 2026-10-25**
- **CE:** a click in ARROW mode does the primary action (item: pick up; dude: rotate; talkable critter: talk, or examine in combat; other critter: loot; usable scenery: use; else examine — `game_mouse.cc:942-990`); only holding the button opens the action menu (`MOUSE_EVENT_LEFT_BUTTON_DOWN_REPEAT`). The mode stays ARROW afterwards.
- **DH2:** `input.ts:258` opens `uiContextMenu` on every left click in command mode; `uiHideContextMenu` (`ui_contextmenu.ts:41`) sets `cursorMode = 'move'`, so after any action the player has to right-click back to the arrow.
- **Doc mismatch:** README "Known approximations" says the action menu opens on *right-click*; the code opens it on left-click in command mode and uses right-click to cycle modes (as CE).
- **Fix:** left-click = CE primary action; open the menu after a ~250 ms hold (or keep click-opens-menu but as documented); keep `cursorMode = 'command'` after the menu closes. Update the README line.
- **Fixed 2026-10-25:** as an option: with `[dh2] mouse_mode=ce` an arrow click does CE's primary action (`ui_contextmenu.ts uiPrimaryAction`), holding the button 250 ms (`BUTTON_REPEAT_TIME`) opens the action menu and the release picks the icon under the pointer, and the cursor stays an arrow. Default `dh2` unchanged.

### MOUSE-03 — Hover icon is always the look icon (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `gameMouseRefresh` + `gameMouseRenderPrimaryAction`: after the mouse rests 250 ms in ARROW mode over an object, the cursor shows the arrow plus the icon of the object's *primary action* (USE for items and usable scenery, TALK for talkable critters out of combat, LOOK in combat / for walls / non-usable scenery / no-steal critters, ROTATE for the dude; flipped to the left near the right edge, fid 285). Nothing over empty ground.
- **DH2:** `input.ts:187` and `input.ts:319` (look timers) + `renderer.ts:327`: after 1000 ms always draws `lookn` beside the arrow, also over empty ground.
- **Fix:** compute the CE primary action for the hovered object and draw its `*n` icon (the same icons the action menu already uses), 250 ms delay.

### MOUSE-04 — "You see …" repeats on every hover pause (MED, NEW) — **FIXED 2026-10-25**
- **CE:** in ARROW mode, `_obj_look_at(gDude, obj)` runs only when the pointed object *changes* (`gGameMousePointedObject`, `game_mouse.cc:713`).
- **DH2:** `input.ts` mousemoved timer: every time the mouse stops for 1 s over an object it prints `objLookAt` again (and re-runs its `look_at_p_proc`), so wiggling over one NPC fills the message window with duplicates.
- **Fix:** remember the last looked-at object (reset when the pointer leaves objects or the mode changes) and only call `objLookAt` on change; use 250 ms.

### MOUSE-05 — No AP cost / "X" on the hex cursor (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `gameMouseRefresh` (move mode, 250 ms rest): `_make_path` from the dude; in combat draws the AP the move costs (`max(0, cost − free_move)`, white) or a red `X` when it exceeds the dude's AP; out of combat a red `X` when there is no path (`gameMouseRenderActionPoints`, font 101 on the hex cursor).
- **DH2:** `renderer.ts:221` draws only `hex_outline`; no path/AP readout. Players only learn the cost after clicking.
- **Fix:** on a 250 ms rest compute `recalcPath` length and the CE AP cost (crippled-leg adjustment via the existing movement-cost helper) and render the number / `X` centred in the hex cursor.

### MOUSE-06 — Object picking ignores roofs and corpses; skips objects[0] (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `gameMouseGetObjectUnderCursor`: with `objectType == -1`, nothing is picked when the mouse is over a visible roof outside the egg (`_square_roof_intersect` / `_obj_intersects_with(gEgg)`); walking the intersect list top-down it skips dead or knocked-out critters (and translucent hits) in favour of something underneath, falling back to the lowest candidate; the dude is excluded unless asked for.
- **DH2:** `renderer.ts:611 getObjectUnderCursor`: no roof test (objects inside roofed buildings can be clicked/looked at from outside), the topmost opaque hit wins even if it is a corpse lying on an item, and the loop `for (i = objects.length − 1; i > 0; i--)` never tests `objects[0]`.
- **Fix:** add the roof/egg test, the dead/KO skip, and `i >= 0`.

### MSG-01 — Language filter does not mask words (MED, NEW) — **FIXED 2026-10-25**
- **CE:** `message.cc badwordsInit` reads `data/badwords.txt`; `messageListFilterBadwords` replaces whole-word matches (case-insensitive, word boundary = non-alpha) with characters cycled from `!@#$%&*@#*!&$%#&%#*%!$&%@*$@&` in script dialogue messages (`scripts.cc:2703`) and AI combat taunts (`combat_ai.cc:3572/3602`) when `language_filter` is on.
- **DH2:** `Config.ui.languageFilter` is saved, shown in Preferences and returned by metarule 47 `METARULE_LANGUAGE_FILTER` (`scripting.ts:857`), but no text is filtered.
- **Fix:** export `badwords.txt` in the pipeline, apply the CE filter in `Scripting.loadMessageFile` (`scripting.ts:3234`) and the AI message loader when the preference is on (CE reloads the AI list on change, `aiMessageListReloadIfNeeded`).

### LOW findings (one line each)
- **SND-03** — no 4-effect concurrency cap (`SOUND_EFFECTS_MAX_COUNT`); CE drops a 5th simultaneous sfx. `audio.ts`.
- **SND-04** — `soundEffectLoad` fallback `MALIEU*` / `MAMTN2*` → `MAMTNT*` (generic mutant sounds) missing in `sfxNames.ts:83 playCharSfx`; those critters are silent where CE plays the mutant set.
- **SND-06** — music volume: no `× 0.94`, master/music 0 does not stop the track (CE `_gsound_background_df_vol`, restart on raise); music not paused under save/load (`loadsave.cc:1537`) or non-stopping movies (`game_movie.cc:189`); `[sound] sounds/music/speech=0` switches not read.
- **MOUSE-07** — edge scroll: CE 32×24 px steps every 33 ms at the exact edge pixel, red "blocked" scroll cursors when `mapScroll` fails; DH2 15 px/tick in a 10 px zone (`[dh2] scroll_edge`, documented), no blocked cursor.
- **MOUSE-09** — hovered-item outline in every mode and without the 250 ms rest (CE: ARROW mode only).
- **MOUSE-10** — crosshair click attacks any non-dude object (CE: critters, else doors only) — `input.ts:264`.
- **ART-01** — critters.lst entry without alias → `hmjmps` (CE tribal male `hmwarr`); alias 0 ignored. `pro.ts:97`.
- **ART-02** — `artCritterFidShouldRun` = critters.lst column 3 not used; DH2 AI runs whenever run art exists. `Critter.ts:304`.
- **PAL-01** — map fade 250 ms in, instant out (CE ≈700 ms both ways). `mapFade.ts:31`.
- **CYC-01** — palette cycling is not frozen while CE disables it (dialogue, Pip-Boy, menus, fades).
- **WRAP-01** — word wrap: no hyphen breaks, no character wrap of long words, `\n` forced. `floatText.ts:78`.
- **FONT-01** — string width ±1 px (trailing letter spacing, `wordSpacing`). `fontCore.ts:166`.
- **DBOX-01** — only the LARGE message box; Y/N accepted without the YES_NO flag. `ui_dialog.ts:155`.
- **MSG-02** — `.msg` loader english-only, lenient number field, no 1024-char limit; missing id → `null` (CE `"Error"`).

## DH2-only behaviour

- **Weapon sound fallbacks** (`audio.ts:222`): burst → single-shot sample when no burst file; material hit → `WH<id>1XXX1` when no material file. CE plays nothing.
- **Edge-scroll zone** `[dh2] scroll_edge` (default 10 px; CE: the edge pixel) — documented in `fallout2Cfg.ts:141`.
- **Mouse wheel zoom** (`main.ts:178`) — documented (README / C43).
- **Click-opens action menu** in command mode (C42; README wording says right-click — see MOUSE-02).
- **First Aid / Doctor on empty ground → self** (`playerUse.ts:182`); CE leaves the skill cursor without using it (self-use needs a click on the dude).
- **Move-mode object interaction** (MOUSE-01) — DarkFO legacy, undocumented.
- **Pointer CSS cursor** over selectable objects every 750 ms (`gameTick.ts:180`), the HUD-bar scroll-arrow mirror (`input.ts:341`).
- **Developer keys** behind `Config.engine.devKeys`: tile inspector, elevation/roof/floor/wall toggles, teleport, kill, raycast, inventory peek (`input.ts`); the `highlightItems` hold-key that outlines all items.
- **Float text is not scaled with zoom** (fixed pixel size; offsets scale) — `floatText.ts:199`.
- **Ambient sfx / music wait for a user gesture** (browser autoplay policy, `audio.ts:26`); music started before it begins on the first click/key.
- **sfx/missing-file negative cache** and `AUDIO_ASSET_QUERY` cache busting (`audio.ts`).
