# CE parity audit — game loop, hotkeys, save/load, preferences, menus, endgame, movies, elevator, automap, skilldex, message log

Scope: CE `game.cc`, `main.cc`, `loadsave.cc`, `game_config.cc`, `settings.cc`, `config.cc`, `options.cc`,
`preferences.cc`, `mainmenu.cc`, `character_selector.cc`, `endgame.cc`, `credits.cc`, `game_movie.cc`,
`movie.cc` / `movie_effect.cc` (behaviour only), `elevator.cc`, `automap.cc`, `skilldex.cc`, `display_monitor.cc`
against DH2 `src/hotkeys.ts`, `src/input.ts`, `src/init.ts`, `src/gameReset.ts`, `src/gameTick.ts`, `src/saveload.ts`,
`src/ui_saveload.ts`, `src/config.ts`, `src/ui_options.ts`, `src/ui_options/*`, `src/ui_mainmenu.ts`,
`src/ui_charselect.ts`, `src/premade.ts`, `src/endgame.ts`, `src/endgame/*`, `src/gameMovie.ts`, `src/ui_elevator.ts`,
`src/elevatorUse.ts`, `src/ui_automap.ts`, `src/automap/*`, `src/ui_skilldex.ts`, `src/ui_hud.ts` (message log).
Audited 2026-10-24. Read-only audit — no source changed.

## Summary

Function-table rows (133; related CE functions share a row, pure helpers grouped): **✅ MATCH 58 · ⚠️ DIFFERS 21 · 🟡 PARTIAL 14 ·
❌ MISSING 9 · 🚫 N/A 31** — severity of the non-matching rows: HIGH 0 · MED 9 · LOW 35. Ten detailed MED findings below
(SAVE-01..03, OPT-01, MENU-01/02, END-01, PREF-01/02, AUTO-01); none are in `wiki/known_bugs.md` yet.

Top findings:

- **SAVE-01 (MED, NEW, wiki conflict)** — CE stores the 20 preferences *in every save* (`preferencesSave/Load`, handler 17 of
  `_master_save_list`); loading a save restores its game/combat difficulty, violence level etc. DH2 saves no preferences.
  `wiki/save_load.md` §9 says "preferences (CE keeps them in fallout2.cfg)" — that is wrong per `loadsave.cc` / `preferences.cc:823`.
- **SAVE-02 (MED, NEW)** — `combatSave/combatLoad` not ported: DH2 lets you save during your combat turn, but the save has no
  combat state, so loading it drops you out of combat (CE resumes the fight, turn order and AI memory).
- **SAVE-03 (MED, NEW)** — saved timed events are keyed by **PID** (`objPid`) and re-attached to the *first* current-map object
  with that PID; CE keys by object id. Timers of several same-PID critters (guards, villagers) all land on one object;
  timers whose owner isn't on the current map are dropped.
- **OPT-01 (MED, NEW)** — the Options window and the Skilldex don't set `uiMode`: the game keeps running behind them (CE: modal),
  and the map hotkeys still fire — in the Options window **S opens the Skilldex instead of SAVE GAME, P opens the Pip-Boy instead
  of PREFERENCES** (`input.ts:224` runs `gameHandleKey` first and its `closeAllPanels()` closes the options window).
- **MENU-01 (MED, NEW)** — main-menu OPTIONS opens the in-game options window (Save/Load/Preferences/Exit) instead of
  CE `doPreferences(true)`; it sits under the z-index 1000 menu overlay, and its S key can save the hidden background map.
- **MENU-02 (MED, NEW)** — main-menu LOAD GAME → CANCEL leaves the menu hidden and drops the player on the background
  `artemple` placeholder map (CE returns to the main menu).
- **END-01 (MED, NEW)** — `endgame_slideshow` should run `endgamePlaySlideshow()` **and then** `endgamePlayMovie()` (credits +
  akiss music + "Continue playing?") — `scripts.cc:1012`. DH2 plays the slides and asks "Continue playing?", but never rolls the credits.
- **PREF-01 (MED, NEW)** — the *running* preference: CE inverts it while Shift is held (`game_mouse.cc:937`); DH2 has no Shift-run.
- **PREF-02 (MED, NEW)** — *language filter* only answers metarule 10; CE also runs `messageListFilterBadwords` over script message
  lists and combatai.msg (`scripts.cc:2703`, `combat_ai.cc:3572`) — no badword filter in DH2.
- **AUTO-01 (MED, NEW)** — automap is a DH2 approximation: seen = radius-5 hexes around the player's path (CE: objects flagged seen
  on screen, `_obj_process_seen`), no scanner (Motion Sensor charge, critters in red), no High/Low detail switch; close keys differ.
  Not listed under README "Known approximations".

## Function table

### game.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| gameInitWithOptions | `src/init.ts:37` initGame, `src/main.ts` | 🟡 PARTIAL | LOW | Subsystem init is spread over main/init; no splash (`showSplash`), no `fallout2.cfg` command-line overrides (URL `?map` debug start is DH2-only). |
| gameReset | `src/gameReset.ts:32` | ✅ MATCH | — | Combat, scripts/GVARs/queue, movies, time, kills, skill use, party, worldmap, encounters, automap, sfall arrays, dude. Not cleared: the message log (CE neither, it is cleared by `interfaceReset`/map reset — unverified). |
| gameExit | — | 🚫 N/A | — | Page unload. |
| gameHandleKey | `src/hotkeys.ts:159` + `src/input.ts:224` | ⚠️ DIFFERS | LOW | All CE keys present (see hotkeys list in GAME-01). Diffs: `/` date uses 12-h "8:24 AM" (CE `gameTimeGetTimeString` "%d:%02d", 24-h, `scripts.cc:340`); wheel zooms (documented approximation); arrows pan 15 px instead of `mapScroll` one step; Space = DH2 item highlight sweep outside combat. |
| gameUiDisable / gameUiEnable | `src/scripting.ts:3187` game_ui_disable/enable | ⚠️ DIFFERS | LOW | CE `interfaceBarDisable` greys the bar's buttons and freezes the message log; DH2 **hides** the whole HUD bar (`visibility:hidden`). Input blocking matches (`input.ts:227`). |
| gameUiIsDisabled | `globalState.gameUIDisabled` | ✅ MATCH | — | |
| gameGetGlobalVar / gameSetGlobalVar | `Scripting.getGlobalVar/setGlobalVar` | ✅ MATCH | — | sfall "display karma changes" option not ported (sfall-only). |
| gameLoadGlobalVars / globalVarsRead | `Scripting.loadGlobalVars` (`scripting.ts:383`, `data/gvars.json`) | ✅ MATCH | — | vault13.gam pre-parsed by the pipeline. |
| gameGetState / gameRequestState / gameUpdateState | `Scripting.processDialogueRequest` (`gameTick.ts:127`) | 🚫 N/A | — | CE's state machine only defers dialogue entry (`_gdialogSystemEnter`); DH2 has its own request flag. |
| gameTakeScreenshot | — | ❌ MISSING | LOW | F12 screenshot in CE windows; browser has its own. |
| gameFreeGlobalVars | — | 🚫 N/A | — | |
| showHelp | `src/hotkeys.ts:55` | ✅ MATCH | — | helpscrn over black until any input. |
| showQuitConfirmationDialog | `src/ui_options.ts:672` quitConfirmation | ✅ FIXED (2026-10-26) | LOW | misc.msg 0 Yes/No ✓; Yes **reloads the page** (opening movies replay unless skipped) instead of `_game_user_wants_to_quit = 2` → main menu. — **2026-10-26:** Yes goes to the main menu (a fresh page, no opening movies). |
| gameDbInit | — | 🚫 N/A | — | DAT files unpacked by the pipeline. |
| showSplash | — | ❌ MISSING | LOW | Random `splash<n>.rix` before the intro movies. |
| gameShowDeathDialog | `src/radiation.ts:181` | ✅ FIXED (2026-10-26) | LOW | CE (sfall) shows misc.msg 1006 in a modal dialog box; DH2 logs it to the message log. — **2026-10-26:** misc.msg 1006 in a dialog box. |
| gameGetGlobalPointer / gameSetGlobalPointer | — | 🚫 N/A | — | sfall pointer vars, unused. |

### main.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| falloutMain | `src/init.ts:89-131`, `src/ui_mainmenu.ts:177` | ✅ FIXED (2026-10-25) | LOW | IPLOGO→INTRO→CREDITS (+ SkipOpeningMovies) ✓; NEW GAME → selector → ELDER → reseed → artemple ✓; menu INTRO/CREDITS ✓. Missing: main-menu music `07desert` (`main.cc:97`), QUOTES (Shift+C), screensaver/timeout → INTRO, return to the menu after death/quit (DH2 reloads). OPTIONS/LOAD issues: MENU-01/02. |
| falloutInit | `initGame` | ✅ MATCH | — | |
| main_reset_system | `initMainMenu(() => { gameReset(); … })` (`init.ts:107`) | ✅ MATCH | — | |
| main_exit_system | — | 🚫 N/A | — | |
| _main_load_new | `init.ts:89 startNewGame` | ✅ MATCH | — | ELDER (STOP_MUSIC), `randomSeedPrerandom(-1)`, map `artemple`; sfall StartingMap not ported. |
| main_loadgame_new | `ui_mainmenu.ts:192` | ✅ FIXED (MENU-02) | MED | See MENU-02 (cancel). |
| main_unload_new | — | 🚫 N/A | — | |
| mainLoop | `src/gameTick.ts` | ✅ MATCH | — | Death check incl. knocked-out-outside-combat (`gameTick.ts:232`), scripts' requests, map transitions. |
| showDeath | `src/endgame.ts:129` dudeDeathScene / playDeathEnding | 🟡 PARTLY FIXED (2026-10-26) | LOW | DEATH.FRM + narrator, any input/end of speech/3 s ✓. Diffs: subtitles shown whether or not the preference is on (CE only with `subtitles`), shown timed like slides rather than one word-wrapped block at the bottom; no death.pal; afterwards page reload (CE: main menu). — **2026-10-26:** subtitles only with the preference; their timing stays DH2's. |
| _main_death_voiceover_callback | `showStaticSlide` audio `ended` | ✅ MATCH | — | |
| _mainDeathGrabTextFile / _mainDeathWordWrap | `slideRender.ts:17 loadSubtitleLines` | 🟡 PARTIAL | LOW | See showDeath. |

### loadsave.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| _InitLoadSave | `ui_saveload.ts:89` (`quickDone = false`) | ✅ MATCH | — | `_quick_done` survives NEW GAME in both. sfall AutoQuickSave not ported. |
| _ResetLoadSave | — | 🚫 N/A | — | Deletes MAPS/*.SAV temp files. |
| lsgSaveGame | `ui_saveload.ts:93 uiQuickSave`, `:111 uiSaveLoad(true)` | 🟡 PARTIAL | LOW | Snapshot, overwrite confirm (lsgame 131), quick-slot reuse + misc.msg 5 ✓. Diffs: description dialog not pre-filled with the slot's old text and not capped at 29 chars; options window closed before the save screen opens (CE returns to it on cancel); unlimited slots + DELETE (DH2 additions). |
| _QuickSnapShot | `saveload.ts:144 takeSaveSnapshot` | ✅ MATCH | — | 640×380 centre → 224×133. |
| lsgLoadGame | `ui_saveload.ts:102 uiQuickLoad`, `uiSaveLoad(false)` | ✅ MATCH | — | Quick load + misc.msg 4 ✓. |
| lsgWindowInit / lsgWindowFree | `ui_saveload.ts:111-337` | ✅ MATCH | — | Layout per U18/U19. |
| lsgPerformSaveGame | `saveload.ts:288 save` + `:176 gatherSaveData` | ✅ FIXED (SAVE-01, SAVE-02) | MED | No "Game saved." (lsgame 140) message; preferences and combat state not saved (SAVE-01, SAVE-02). |
| _isLoadingGame | `Scripting.setLoadingGame` (C61) | ✅ MATCH | — | |
| lsgLoadGameInSlot | `saveload.ts:318 load` | ✅ FIXED (SAVE-02, SAVE-03) | MED | gameReset, map, procs with `_loadingGame`, `_proto_dude_update_gender` ✓. Missing "Game loaded." (lsgame 141) message; combat not restored (SAVE-02); timers by PID (SAVE-03). |
| lsgSaveHeaderInSlot / lsgLoadHeaderInSlot | `SaveGame` fields (`name`, `timestamp`, `gameTickTime`, `currentMap`, `currentElevation`, `playerState.name`) | ✅ MATCH | — | |
| _GetSlotList | `saveLoad` / `saveList` (`saveload.ts:267`) | ⚠️ DIFFERS | LOW | DH2-only: unlimited slots (IndexedDB), scroll bar. |
| _ShowSlotList / _DrawInfoBox / _LoadTumbSlot | `ui_saveload.ts:177/194` | ✅ MATCH | — | |
| _GetComment / _get_input_str2 | `ui_dialog.ts:230 showInput` | 🟡 PARTLY FIXED (2026-10-26) | LOW | Generic input box: no default text, no 29-char limit, not lsgame `BOX` art. — **2026-10-26:** the old description, 29 characters; the input is still DH2's. |
| _DummyFunc / _PrepLoad | `gameReset()` in `load` (`saveload.ts:342`) | ✅ MATCH | — | |
| _EndLoad | `saveload.ts:478-487` | ✅ MATCH | — | HUD redraw; music via `runLoadGameProcs`. |
| _GameMap2Slot / _SlotMap2Game | `savedMaps` = current + `dirtyMapCache` | ✅ MATCH | — | Modified party/item protos (`proto/critters`, `proto/items` copies) not saved — DH2 never writes protos (unverified for sfall `set_proto_data`). |
| _mygets / _copy_file / MapDirErase / _MapDirEraseFile_ / lsgInit | — | 🚫 N/A | — | File helpers. |
| _SaveBackup / _RestoreSave | IndexedDB transaction | 🚫 N/A | — | A failed put aborts the transaction; no partial save. |
| _LoadObjDudeCid / _SaveObjDudeCid | — | 🚫 N/A | — | |
| _EraseSave | `saveload.ts:312 deleteSave` | 🚫 N/A | — | DH2 delete is a DH2-only feature. |

### game_config.cc / settings.cc / config.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| gameConfigInit (game_config) | `ui_options/fallout2Cfg.ts:185 loadFallout2Cfg` | ✅ MATCH | — | Missing file = defaults, as CE. |
| gameConfigSave / gameConfigExit | localStorage `dh2_preferences` | 🚫 N/A | — | Documented (CI5). |
| gameConfigResolvePath | — | 🚫 N/A | — | |
| settingsInit (settings) | `loadFallout2Cfg` + `loadPreferences` | ✅ MATCH | — | |
| settingsFromConfig | `fallout2Cfg.ts:65 applyCfg` | 🟡 PARTIAL | LOW | All [preferences]/[sound] keys DH2 uses ✓ (+ color_cycling, cycle_speed_factor). `text_line_delay` not read (DH2 derives it from base delay like `_JustUpdate_`); `language`, `scroll_lock`, `interrupt_walk`, debug keys ignored. |
| settingsSave / settingsExit / settingsToConfig | `savePreferences` (localStorage) | 🚫 N/A | — | CI5. |
| settingsRead / settingsWrite (×4 each) | — | 🚫 N/A | — | Typed helpers. |
| configInit / configFree / configGet*/configSet* (config) | `CfgSections` object | 🚫 N/A | — | |
| configParseCommandLineArguments | — | 🚫 N/A | — | |
| configRead | `getFileText` + `parseCfg` | ✅ MATCH | — | |
| configWrite | — | 🚫 N/A | — | Browser can't write. |
| configParseLine / configParseKeyValue / configEnsureSectionExists / configTrimString | `fallout2Cfg.ts:35 parseCfg` | ✅ MATCH | — | `;` comments, `[section]`, trimmed key=value, "unknown" default section. |

### options.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| showOptions | `ui_options.ts:680 initOptionsMenu`, `:759 showOptionsMenu` | ✅ FIXED (OPT-01) | MED | Layout/keys per options.cc ✓, but not modal: OPT-01. |
| optionsWindowInit / optionsWindowFree | `ui_options.ts:680` | ✅ MATCH | — | |
| showPause | `hotkeys.ts:78` | 🟡 PARTIAL | LOW | charwin + PAUSED/DONE, +/- brightness, any key closes, game paused ✓; no `_ShadeScreen` darkening. |
| _ShadeScreen | — | ❌ MISSING | LOW | |
| _init_options_menu | — | 🚫 N/A | — | |

### preferences.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| preferencesInit / _SetSystemPrefs | `ui_options/preferences.ts:50 loadPreferences` | ✅ MATCH | — | |
| _SaveSettings / _RestoreSettings | `ui_options.ts:608 snapshotPrefs` (CANCEL) | ✅ MATCH | — | |
| preferencesSetDefaults | DEFAULT button `ui_options.ts:401` | ✅ FIXED (2026-10-26) | LOW | DEFAULT button = CE values ✓; but DH2 *initial* defaults differ: `playerSpeedup: true` (`config.ts:160`, CE `false`), volumes 100 % (CE 22281/32767 ≈ 68 %). — **2026-10-26:** player speedup off, volumes 22281 / 32767. |
| _JustUpdate_ | applied ad hoc on change | ✅ FIXED (2026-10-25) | LOW | `aiMessageListReloadIfNeeded` (badword reload) missing — see PREF-02. |
| _UpdateThing / preferencesWindowInit / preferencesWindowFree / _DoThing | `ui_options.ts:58 buildPrefsPanel` | ✅ MATCH | — | Knobs, sliders, checkbox (rendering not pixel-verified). |
| _SavePrefs | `preferences.ts:102 savePreferences` | ✅ MATCH | — | |
| preferencesSave / preferencesLoad | — | ✅ FIXED (SAVE-01) | MED | SAVE-01. |
| brightnessIncrease / brightnessDecrease | `ui_options.ts:663 changeBrightness` | ✅ MATCH | — | Step 0.01124…, max 1.17999…, persisted; gamma via SVG filter (`applyBrightness`). |
| doPreferences | `openPrefsPanel` (`ui_options.ts:630`) | ✅ MATCH | — | From the options window. From the main menu: MENU-01. |

### mainmenu.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| mainMenuWindowInit | `ui_mainmenu.ts:61 initMainMenu` | ⚠️ DIFFERS | LOW | Buttons at (30, 19+41i) ✓. Labels hard-coded English, left-aligned at x 65 (CE misc.msg 9–14, font 104, centred on x 126, y+1); footer hard-coded "© 1998 Interplay Productions" in font4 (CE misc.msg 20 at (15,460) font 100 + version string right-aligned at 615). |
| mainMenuWindowFree / Hide / Unhide | `hideMainMenu` / `showMainMenu` | ✅ MATCH | — | No fade. |
| _main_menu_is_enabled | — | 🚫 N/A | — | |
| mainMenuWindowHandleEvents | `ui_mainmenu.ts:163 handleKey`, `:177 handleButton` | ✅ FIXED (MENU-01) | MED | i/n/l/o/c/e/Esc ✓. Missing: nmselec0/1 sounds, Shift+C quotes, D screensaver, idle timeout → INTRO, +/- brightness, Ctrl+R selfrun (N/A). OPTIONS/LOAD: MENU-01/02. EXIT = `window.close()` (no-op for normal tabs). |
| main_menu_fatal_error | — | 🚫 N/A | — | |
| main_menu_play_sound | — | ❌ MISSING | LOW | nmselec0 (press) / nmselec1 (select). |

### character_selector.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| characterSelectorOpen | `ui_charselect.ts:100 onKey`, `:116 showCharacterSelector` | ✅ MATCH | — | ←/→ (ib2p1xx1), T, M, C (_ResetPlayer), B/Esc ✓ (U9). Missing +/- brightness and F10 quit (LOW). |
| characterSelectorWindowInit / Free / Refresh / RenderFace / RenderStats / RenderBio | `ui_charselect.ts:66 build`, `:153 draw`, `:161 drawPage` | ✅ MATCH | — | Per U9. |
| characterSelectorWindowFatalError | — | 🚫 N/A | — | |
| premadeCharactersInit | `src/premade.ts` | ✅ MATCH | — | Narg/Mingan/Chitsa; sfall custom premade list not ported. |
| premadeCharactersExit / premadeCharactersLocalizePath | — | 🚫 N/A | — | English only. |

### endgame.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| endgamePlaySlideshow | `endgame.ts:62 playSlideshow` | ✅ FIXED (END-01) | MED | END-01. |
| endgamePlayMovie | `endgame.ts:99 playMovie` | ✅ MATCH | — | akiss, 3 s, credits, continue (EG4). |
| endgameEndingHandleContinuePlaying | `endgame.ts:52 showContinueDialog` | ✅ FIXED (2026-10-26) | LOW | misc.msg 30 ✓; "No" reloads the page (CE back to the main menu). — **2026-10-26:** "No" goes to the main menu. |
| endgameEndingRenderPanningScene | `slideRender.ts showPanningSlide` | ✅ MATCH | — | EG3 timing. |
| endgameEndingRenderStaticScene | `slideRender.ts:250 showStaticSlide` | ✅ MATCH | — | |
| endgameEndingSlideshowWindowInit / Free | `createOverlay` / `removeOverlay` | ✅ MATCH | — | |
| endgameEndingVoiceOverInit / Reset / Free / _endgame_voiceover_callback | `playNarratorAudio`, `ended` | ✅ MATCH | — | |
| endgameEndingLoadPalette | — | 🚫 N/A | — | Pre-baked PNG slides. |
| endgameEndingSubtitlesLoad / Refresh / Free | `slideRender.ts:17 loadSubtitleLines`, `scheduleSubtitles` | ✅ FIXED (2026-10-26) | LOW | Shown regardless of the subtitles preference (CE `endgame.cc:595` `gEndgameEndingSubtitlesEnabled = settings.preferences.subtitles`). — **2026-10-26:** only with the subtitles preference. |
| _endgame_movie_callback / _endgame_movie_bk_process | `music` pause at end | ✅ MATCH | — | |
| endgameEndingInit / endgameEndingFree | `lut/endgame.json` | ✅ MATCH | — | |
| endgameDeathEndingInit / Exit | `deathEndings.ts:41` (`lut/enddeath.json`, default nar_5) | ✅ MATCH | — | |
| endgameSetupDeathEnding | `deathEndings.ts:78` | ⚠️ DIFFERS | LOW | Selection incl. Modoc index 12 ✓. TIMEOUT reason doesn't play `MOVIE_TIMEOUT` (FADE_IN\|FADE_OUT\|PAUSE_MUSIC) before quitting (`gameTick.ts:224` reloads at once). |
| endgameDeathEndingValidate | `deathEndings.ts:61` | ✅ MATCH | — | |
| endgameDeathEndingGetFileName | `deathEndings.ts:116` | ✅ MATCH | — | CE falls back to nar_4 if the table is empty; DH2 keeps nar_5 (LOW). |
| endgameEndingUpdateOverlay | — | 🚫 N/A | — | |

### credits.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| creditsOpen | `slideRender.ts:168 showCredits` | ⚠️ DIFFERS | LOW | 20 ms/px (CE `CREDITS_WINDOW_SCROLLING_DELAY` 38 ms), browser monospace in invented colours (CE title/name fonts, `_colorTable[18917]/[13673]/[17969]`); no reversed style (quotes.txt), no background fid. |
| creditsFileParseNextLine | inline in `showCredits` | ✅ MATCH | — | `;` skip, `@` title, `#` highlighted name. |

### game_movie.cc, movie.cc, movie_effect.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| gameMoviesInit / gameMoviesReset | `globalState.seenMovies`, `gameReset.ts:39` | ✅ MATCH | — | |
| gameMoviesLoad / gameMoviesSave | `SaveGame.seenMovies` | ✅ MATCH | — | |
| gameMoviePlay | `gameMovie.ts:206` | ✅ MATCH | — | Flags, skip on key/click, seen-set, VSUIT look, subtitles only with pref + .sve. Subtitles in 12 px monospace (CE font 101 on subtitle palette) — LOW. Movie volume follows *music* volume (unverified vs CE). |
| gameMovieFadeOut | — | ❌ MISSING | LOW | CE restores the palette after a FADE_IN-only movie (DERRICK) on the next map load; DH2's fade layer is simply removed. |
| gameMovieIsSeen / gameMovieIsPlaying | `gameMovie.ts:94/89` | ✅ MATCH | — | |
| gameMovieBuildSubtitlesFilePath | `loadSubtitles` (`data/text/english/cuts/*.sve`) | ✅ MATCH | — | English only. |
| movie.cc / movie_effect.cc (MVE decoder, `_movieRun`, `movieEffectsLoad`, subtitles) | `<video>` WebM + `loadEffects` + `loadSubtitles` | 🚫 N/A | — | Behaviour ported: .cfg fades, .sve frame timing at MVE timer fps. |

### elevator.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| elevatorSelectLevel | `ui_elevator.ts:76 uiElevator` | 🟡 PARTLY FIXED (2026-10-26) | LOW | Gauge start/animation timing ✓ (EV1/EV2), door reset ✓. Diffs: no Esc cancel and no floor keys (CE `gElevatorLevelLabels`, e.g. G/1, 3/4/6) — the panel only closes by picking a floor; sound = `selevdx1` on map change / `elv1_<dist>` on same map, played after the gauge (CE `gElevatorSoundEffects[levels-2][dist]`, e.g. ELV2_3 for 2 floors of a 4-level car, played before the gauge). — **2026-10-26:** Esc and the floor keys. |
| elevatorWindowInit / elevatorWindowFree | `uiElevator` / `uiElevatorDone` | ✅ MATCH | — | |
| elevatorGetLevelFromKeyCode | — | ✅ FIXED (2026-10-26) | LOW | See above. — **2026-10-26:** the labels as typed. |
| elevatorsInit | `lut/elevators.json` | 🚫 N/A | — | sfall elevators.ini not ported. |

### automap.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| automapInit / automapReset / automapExit | `automap/tracking.ts:127`, `storage.ts:238 resetAutomap` | ✅ MATCH | — | |
| automapLoad / automapSave | `SaveGame.automap` (`storage.ts:249/258`) | ✅ MATCH | — | CE saves the flags in SAVE.DAT and AUTOMAP.DB in the slot; DH2 saves the seen data. |
| _automapDisplayMap / automapSetDisplayMap | — | ✅ FIXED (2026-10-25) | LOW | maps.txt `automap=no` maps should not be listed in the Pip-Boy AUTOMAPS tab (`pipboy.cc:1604`). — **Fixed 2026-10-25:** the Pip-Boy list hides them (PIP-01). |
| automapShow | `ui_automap.ts:146 openAutomap`, `input.ts:161` | ✅ FIXED | MED | AUTO-01 (fixed 2026-10-25). |
| automapRenderInMapWindow | `automap/render.ts:48 drawAutomapInto` | ✅ FIXED | MED | AUTO-01 (fixed 2026-10-25): CE colours and detail levels. |
| automapRenderInPipboyWindow | `ui_pipboy` AUTOMAPS → `drawAutomapInto` | 🟡 PARTIAL | LOW | Same renderer. |
| automapSaveCurrent / automapSaveEntry / automapLoadEntry / automapSaveHeader / automapLoadHeader / _decode_map_data / automapCreate / _copy_file_data | `automap/storage.ts` (IndexedDB) | 🚫 N/A | — | |
| automapGetHeader | `tracking.ts:90 getArchivedMaps` | 🟡 PARTIAL | LOW | |

### skilldex.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| skilldexOpen | `ui_skilldex.ts:210 showSkilldex` + key handler | ✅ FIXED (2026-10-25) | LOW | Not modal (OPT-01: game keeps running); S and Return don't close it (CE + sfall do); 1–8 pick a skill (DH2-only — CE's buttons have no key binding; 1–8 on the map go straight to targeting). |
| skilldexWindowInit / skilldexWindowFree | `ui_skilldex.ts:41 initSkilldex` | ✅ MATCH | — | Layout per U18. |

### display_monitor.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| displayMonitorInit | `#displayLog` (`play.html:152`) | ✅ MATCH | — | |
| displayMonitorReset | — | ⚠️ DIFFERS | LOW | Never cleared (unverified when CE clears it: `interfaceReset` from `map.cc:258`). |
| displayMonitorExit / display_clear | — | 🚫 N/A | — | |
| displayMonitorAddMessage | `ui_hud.ts:346 uiLog` | ⚠️ DIFFERS | LOW | No `\x95` bullet per message, no `monitor` beep (≥500 ms apart, not in combat), no 100-line ring buffer (DOM grows without bound), CSS word wrap instead of CE's, text inserted as **HTML** (`insertAdjacentHTML`) — a `<` in a message breaks it. Colour #00FF00 (CE green 992). |
| displayMonitorRefresh | DOM | ✅ MATCH | — | |
| displayMonitorScrollUpOnMouseDown / …DownOnMouseDown | `ui_hud.ts:352 initLogScrollZones` | ✅ MATCH | — | One line per click (no auto-repeat). |
| displayMonitorScrollUp/DownOnMouseEnter / OnMouseExit | — | ❌ MISSING | LOW | Up/down arrow cursors over the log. |
| displayMonitorDisable / displayMonitorEnable | `game_ui_disable` hides the bar | ⚠️ DIFFERS | LOW | See gameUiDisable. |
| consoleFileInit / Reset / Exit / AddMessage / Flush | `eventLog` (DH2-only structured log) | 🚫 N/A | — | sfall console log file. |

### Game keys (gameHandleKey) — GAME-01 detail

| Key (CE) | DH2 | Status |
|---|---|---|
| Ctrl+Q / Ctrl+X / F10 quit | ✓ | ⚠️ reload instead of main menu |
| Tab automap | ✓ (bar enabled, no Alt) | ✅ |
| Ctrl+P pause | ✓ | 🟡 no shading |
| A combat | ✓ | ✅ |
| N cycle item action, M mouse mode, B swap hands | ✓ | ✅ |
| C character, I inventory, Esc/O options | ✓ | ✅ |
| P Pip-Boy / Z rest (misc.msg 7 in combat) | ✓ | ✅ |
| S skilldex → skill or targeting cursor | ✓ | ✅ |
| Home centre on dude (+ elevation) | ✓ | ✅ |
| 1–8 (and !@#$%^&*) skills | ✓ by physical key | ✅ |
| -/_ and =/+ brightness | ✓ | ✅ |
| , < / . > rotate dude | ✓ (only while idle) | ✅ |
| / ? date and time | ✓ | ⚠️ 12-h time |
| F1 help | ✓ | ✅ |
| F2 / F3 master volume ∓2047 | ✓ (also persisted — DH2) | ✅ |
| Ctrl+S / F4 save, Ctrl+L / F5 load, F6 / F7 quick | ✓ | ✅ |
| Ctrl+V version | ✓ "FALLOUT II 1.02d" + build date | ✅ |
| Arrows scroll | ✓ via `Config.controls.camera*` (15 px) | ✅ |
| Wheel scroll | zoom | ⚠️ documented |
| Space / Return in combat (combat.cc) | ✓ | ✅ |

## Preferences matrix

| Preference | CE effect | DH2 implemented? | Notes |
|---|---|---|---|
| Game difficulty | Non-combat skills +20 easy / −10 hard (`skill.cc:1129`); encounter frequency ±freq/15, avoidance ±5, encounter setup (`worldmap.cc:3406/3604/3676`); `game_difficulty` opcode | ✅ | `skills.ts:214`, `worldmap/encounters.ts:69`, `scripting.ts:2542`. Not saved with the game (SAVE-01). |
| Combat difficulty | Non-team attackers to-hit −20/+20 (`combat.cc:4479`), damage ×75 %/×125 % (`combat.cc:4554`); AI called-shot INT 7/5/3 (`combat_ai.cc:2643`); `combat_difficulty` opcode | ✅ | `hitChance.ts:203`, `Combat.ts:219/2278`, `scripting.ts:2670`. |
| Violence level | Death anims capped (`actions.cc:159-264`), blood death anims replaced (`object.cc:5101`), metarule 11, `anim` guard (`interpreter_extra.cc:3484`) | ✅ | `critter/deathAnim.ts`. Interpreter checks not re-verified here. |
| Target highlight | Off / On / Targeting only outlines (`combat.cc:5819/5880`) | ✅ | `Combat.ts:3114`. |
| Combat looks | Look at the attack-cursor target (`game_mouse.cc:745`) | ✅ | `ui_hud.ts:600` (DOM readout, documented). |
| Combat messages | Verbose adds critical-hit text (`combat.cc:5085`) | ✅ | `Combat.ts:1084`. |
| Combat taunts | AI float taunts on/off (`combat_ai.cc:3308`) | ✅ | `Combat.ts:1741`. |
| Language filter | Badword replacement in script msg lists and combatai.msg; metarule | 🟡 | PREF-02: metarule only (`scripting.ts:857`). |
| Running | Walk/run by default; **Shift inverts** (`game_mouse.cc:937`) | 🟡 | PREF-01: no Shift inversion. Run-by-default ✓ (`playerUse.ts:224/248/266`). |
| Subtitles | Movies (`game_movie.cc:194`), endgame slides (`endgame.cc:595`), death screen (`main.cc:412`) | 🟡 | Movies ✓; slides and death screen always show text (LOW). |
| Item highlight | Hovered item outline (`game_mouse.cc:1951`) | ✅ | `input.ts:302`. |
| Combat speed | In combat, ANIM_WALK fps += combat_speed (dude only with player speedup) (`animation.cc:3299`) | ⚠️ | `critterAnimation.ts:404` ✓; DH2 also speeds **projectiles** in combat (`Combat.ts:1627`) — CE adds it only to walk frames (LOW). |
| Text delay | Float text base delay + line delay `(base−1)·0.4` (`text_object.cc:85`) | ✅ | `gameTick.ts:206` (CI9). |
| Player speed (Affect player speed) | See combat speed | ✅ | Default `true` in DH2 vs CE `false` (`config.ts:160`) — LOW. |
| Brightness | Gamma `i^b` on the palette, 1.0–1.18 | ✅ | SVG gamma filter. |
| Mouse sensitivity | Mouse speed | 🚫 | Stored only — documented browser limit. |
| Master / music / SFX / speech volume | Mixer volumes 0–32767 | ✅ | 0–100 linear; initial default 100 % vs CE 22281 (≈68 %) — LOW. |

## Save-state matrix

| CE saved subsystem (loadsave.cc order) | DH2 saved? | Notes |
|---|---|---|
| 0 `_DummyFunc` / `_PrepLoad` (gameReset, time from header) | ✅ | `gameReset()` + `gameTickTime`. |
| 1 `_SaveObjDudeCid` | 🚫 | No cids. |
| 2 `scriptsSaveGameGlobalVars` (GVARs) | ✅ | `playerState.gvars`. |
| 3 `_GameMap2Slot` (current map + every visited .SAV, modified protos) | ✅ | `savedMaps` (current + `dirtyMapCache`, incl. LVARs/spatials); MVARs separately in `mvars`. Modified protos: N/A. |
| 4 GVARs again (skipped on load) | 🚫 | |
| 5 `_obj_save_dude` (dude object, inventory, flags) | ✅ | `player.*`, hands, armor, `condition` (crippled, blind, poison, radiation, addicted). |
| 6 `critterSave` (`_sneak_working` + dude proto data) | ✅ | `sneakWorking`, stats/skills. |
| 7 `killsSave` | ✅ | `kills`. |
| 8 `skillsSave` (tagged skills) | ✅ | `SkillSet.serialize().tagged`. |
| 9 `randomSave` (roll counter reset only) | 🚫 | Nothing to save. |
| 10 `perksSave` (ranks for every party-member description) | 🟡 | Dude `perks` ✓; party members' perks only as far as their serialized objects carry them (unverified). |
| 11 `combatSave` (state, turn order, AI info) | ❌ | SAVE-02. |
| 12 `aiSave` (party members' edited AI packets) | 🟡 | Party member disposition presumably in `customAiOverrides` on the critter (`Critter.ts:68`) — unverified. |
| 13 `statsSave` (PC stats: level, XP, unspent points, reputation, karma) | ✅ | Level/Experience in `stats`, skill points in `skills`, karma/reputation are GVARs. |
| 14 `itemsSave` | 🚫 | CE no-op. |
| 15 `traitsSave` | ✅ | `traits`. |
| 16 `automapSave` | ✅ | `automap`. |
| 17 `preferencesSave` | ❌ | SAVE-01 (wiki save_load.md §9 claims CE doesn't — conflict). |
| 18 `characterEditorSave` (last level, free perk pending) | 🟡 | `pendingPerkPick` ✓; `gCharacterEditorLastLevel` has no explicit field (presumably derived — unverified). |
| 19 `wmWorldMap_save` | ✅ | `knownAreas`, `areaStates`, `worldPos`, `subtiles`, `currentAreaId`, car, `encounters`. |
| 20 `pipboySave` | ✅ | CE writes nothing (`_save_pipboy` returns 0). |
| 21 `gameMoviesSave` | ✅ | `seenMovies`. |
| 22 `skillsUsageSave` | ✅ | `skillUsage`. |
| 23 `partyMembersSave` (members + level-up info) | ✅ | `party`, `partyLevels`. |
| 24 `queueSave` (event queue) | 🟡 | `timedEvents` — SAVE-03 (PID keying). |
| 25 `interfaceSave` (bar enabled/hidden, current hand, end buttons) | 🟡 | `activeHand` ✓; bar enabled/hidden not saved (a save made under `game_ui_disable` loads with the UI enabled — LOW). |
| 26 `_DummyFunc` / `_EndLoad` | ✅ | HUD redraw, music. |
| sfall `sfallgv.sav` (sfall globals) | 🚫 | sfall global vars not implemented in DH2; sfall arrays not saved (as CE). |

## Detailed findings

### SAVE-01 — Preferences are part of a CE save — **FIXED 2026-10-25**
- **CE:** `loadsave.cc:240` `_master_load_list[17] = preferencesLoad`; `preferences.cc:823 preferencesSave` writes game/combat
  difficulty, violence, target highlight, combat looks/messages/taunts, language filter, running, subtitles, item highlight,
  combat speed, player speedup, text delay, four volumes, brightness, mouse sensitivity; `preferencesLoad` (`:860`) reads them,
  `_JustUpdate_()` applies them and `_SavePrefs(0)` copies them to the settings (not written to disk).
- **DH2:** `src/saveload.ts:176 gatherSaveData` has no preferences; they live only in localStorage (`ui_options/preferences.ts`).
- **Impact:** a save made on Hard loads on whatever difficulty the browser has; sharing a save between profiles changes difficulty.
- **Fix:** add `preferences: SavedPreferences` to `SaveGame` (reuse `savePreferences`' object), apply it in `applyState` like
  `loadPreferences` and then `savePreferences()` (= `_SavePrefs`).
- **Wiki conflict:** `wiki/save_load.md` §9 "Not saved, as in CE …: preferences (CE keeps them in fallout2.cfg …)" contradicts
  CE source — flag for the save_load.md owner. NEW.

### SAVE-02 — Combat state not saved — **FIXED 2026-10-25**
- **CE:** `combat.cc:2214 combatSave` (state, `_combat_turn_running`, free move, XP, combatant list by cid, AI info);
  `lsgLoadGameInSlot` (`loadsave.cc:1703`) ends a running fight with `_combat_over_from_load`, then `combatLoad` resumes the saved one.
- **DH2:** `uiSaveLoad` has no combat check; `gatherSaveData` stores no combat; `load` (`saveload.ts:336`) force-ends combat.
- **Impact:** save-scumming mid-fight puts you out of combat with hostiles around, with free movement/AP (exploitable, and a
  mismatch with CE behaviour). MED.
- **Fix:** either serialize `Combat` (turn order by object id, current index, AP, `free_move`) or, minimally, refuse saving
  while `inCombat` with a message (not CE, but honest). NEW.

### SAVE-03 — Timed events keyed by PID — **FIXED 2026-10-25**
- **CE:** `queue.cc:191 queueSave` writes the owner's **object id**; `queueLoad` resolves it with `objectFindById`.
- **DH2:** `scripting.ts:375 getTimedEventsSerialized` writes `objPid`; `saveload.ts:422` re-attaches with
  `mapObjects.find(o => o.pid === ev.objPid)`.
- **Impact:** with two or more objects of one PID (common: guards, generic villagers, doors) every timer goes to the first one;
  the others never fire after a load. Timers whose owner isn't on the current map are silently dropped.
- **Fix:** give objects a persistent id (they're serialized per map) and key on it; fall back to PID+position. NEW (refines U7).

### OPT-01 — Options window and Skilldex are not modal — **FIXED 2026-10-25**
- **CE:** `showOptions` / `skilldexOpen` run their own input loop; the map is frozen and no game key reaches `gameHandleKey`.
- **DH2:** `ui_options.ts:759 showOptionsMenu` and `ui_skilldex.ts:210 showSkilldex` only show a `WindowFrame`; `uiMode` stays
  `none` (no code sets `UIMode.options` or `UIMode.skilldex`), so `gameTick.ts:132` keeps the world running and
  `input.ts:224` hands keys to `gameHandleKey` first. In the options window, **S** runs `hotkeys.ts:224` → `closeAllPanels()`
  (closes the options window) → Skilldex; **P** opens the Pip-Boy instead of Preferences; **I/C/Z/Tab** open other windows.
- **Impact:** game time, NPC movement and timers advance while the player reads Options/Skilldex; two documented option keys misfire. MED.
- **Fix:** set `globalState.uiMode = UIMode.options` / `UIMode.skilldex` on show and restore on close (the enums exist).
  (The character screen appears to have the same gap — outside this scope, unverified.) NEW.

### MENU-01 — Main-menu OPTIONS — **FIXED 2026-10-25**
- **CE:** `main.cc:196` `MAIN_MENU_OPTIONS` → `doPreferences(true)` (the preferences screen only).
- **DH2:** `ui_mainmenu.ts:197` → `showOptionsMenu()` (Save/Load/Preferences/Exit window, `z-index:20`) while the main-menu overlay
  (`z-index:1000`) stays visible — the window is most likely hidden behind it (render unverified), and its key handler is live:
  **S** opens the save screen for the hidden background map.
- **Fix:** call `openPrefsPanel()` (export it) above the menu overlay. NEW.

### MENU-02 — Cancel on main-menu LOAD GAME — **FIXED 2026-10-25**
- **CE:** `main.cc:151-186` — whether the load succeeds or not, the menu loop resumes (`mainMenuWindowInit`).
- **DH2:** `ui_mainmenu.ts:192` hides the menu, `ui_saveload.ts:269 close()` sets `uiMode = none` and nothing re-shows the menu:
  the player is dropped onto the background `artemple` map with the placeholder character. MED.
- **Fix:** pass an `onCancel` to `uiSaveLoad` from the main menu that calls `showMainMenu()`. NEW.

### END-01 — `endgame_slideshow` skips the credits — **FIXED 2026-10-25**
- **CE:** `interpreter_extra.cc:4573 opEndgameSlideshow` → `scriptsRequestEndgame()`; `scripts.cc:1012` runs
  `endgamePlaySlideshow(); endgamePlayMovie();` — the slideshow has no continue dialog of its own; `endgamePlayMovie` plays akiss,
  the credits and then asks "Continue playing?" (`endgame.cc:234-258`).
- **DH2:** `scripting.ts:3145` → `endgame.ts:62 playSlideshow` plays the slides then `showContinueDialog()`; `playMovie` is only
  reached through the separate `endgame_movie` opcode.
- **Impact:** finishing the game shows the slides but never the end credits. (`wiki/endgame.md` §1 documents the CE chain correctly.)
- **Fix:** at the end of `playSlideshow`, `await playMovie()` instead of the continue dialog. NEW.

### PREF-01 — Shift doesn't invert running — **FIXED 2026-10-25**
- **CE:** `game_mouse.cc:936-948` — in move mode, Shift held walks when "running" is on and runs when it is off.
- **DH2:** `playerUse.ts:248/266` use `Config.engine.doAlwaysRun` only; no `shiftKey` test anywhere in `src/` except the camera debug.
- **Impact:** with the CE default (walk), there is no way to run with a single click — a core control. MED.
- **Fix:** pass `e.shiftKey` from the map click into `playerUse` and XOR it with `doAlwaysRun`. NEW.

### PREF-02 — Language filter has no filtering — **FIXED 2026-10-25**
- **CE:** `message.cc:552 messageListFilterBadwords` on every script message list (`scripts.cc:2703`) and on combatai.msg
  (`combat_ai.cc:3572`, reloaded by `aiMessageListReloadIfNeeded` when the preference changes); `badwords.txt`.
- **DH2:** `Config.ui.languageFilter` is read only by metarule 10 (`scripting.ts:857`); no `badwords` code exists.
- **Impact:** the option is visible but does nothing for dialogue/taunt text. MED (AF17 only wired the metarule).
- **Fix:** load `data/badwords.txt` and replace matches with `gBadwordsReplacements` chars when building msg lists. NEW.

### AUTO-01 — Automap is a DH2 approximation — **FIXED 2026-10-25**
- **CE:** `automap.cc:298 automapShow` — `_obj_process_seen()` marks objects seen; walls (green 992) and, in High detail, scenery
  (480) on seen tiles; dude red; **S** (scanner button) needs a Motion Sensor in a hand with charges, consumes one and shows
  critters (misc.msg 17/18 otherwise); **H/L** and the switch toggle detail; Tab/Esc/A close; Ctrl+Q/Alt+X/F10 quit.
- **DH2:** `ui_automap.ts:146` + `automap/render.ts:48` — seen = hexes within 5 of every hex the player walked
  (`tracking.ts:106`); scanner button just redraws; no detail switch; closes on Esc/Tab/**Enter**, not **A** (`input.ts:161`);
  DH2 zoom/pan added.
- **Impact:** what the automap reveals differs from CE (rooms seen through doors/across the screen are not shown); Motion Sensor
  has no automap use. MED, not in README "Known approximations".
- **Fix:** mark seen from on-screen objects as `_obj_process_seen`; port the scanner and detail flags; fix close keys. NEW.
- **Fixed 2026-10-25:** the seen band is CE's (OBJ-04); the scanner needs a charged Motion Sensor in a hand; walls green, scenery only in High detail, the dude red, items not drawn; the LOW / HIGH switch (autoup / autodwn) and H / L; Tab / Esc / A close, S presses the scanner. DH2 keeps zoom / pan, and the switch art follows the keys (CE's doesn't).

## DH2-only behaviour

- Unlimited save slots, scroll bar, mouse wheel, **DELETE** button / Del key with confirmation (`ui_saveload.ts:125/302`);
  IndexedDB storage (`saveload.ts:542`), not file-compatible with CE saves.
- `eventLog` (structured event log) saved with the game; "Welcome to DarkHarold2" log line at start (`init.ts:47`).
- Automap zoom (+/− buttons, wheel) and drag-pan; IndexedDB automap cache across sessions.
- Skilldex 1–8 keys; Space held = highlight all items (sfall-like, `input.ts:389`); F2/F3 volume persisted.
- Developer keys behind `Config.engine.devKeys` (`input.ts:168`); URL `?map` debug start; story crawler movie skip.
- `[dh2]` cfg section (day/night, script backend, pixel font, elevator use, drag windows, walk model …) (`fallout2Cfg.ts:120-171`).
- Quit / "Continue playing? No" / death / 13-year timeout reload the page instead of returning to the main menu.
- Elevator door scenery reset done inline in the elevator UI (CE: `scriptsHandleRequests`).
