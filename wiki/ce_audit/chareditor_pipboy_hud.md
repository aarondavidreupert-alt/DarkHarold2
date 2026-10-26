# CE parity audit — Character editor, Pip-Boy, main interface bar

Scope: fallout2-ce `character_editor.cc`, `pipboy.cc`, `interface.cc`, compared with DH2 `src/ui_character/*` (creator, viewer, perkModal, folders, statPanels, descriptions), `src/ui_pipboy/shell.ts` + `tabs/*`, `src/questLog.ts`, `src/questData.ts`, `src/ui_hud.ts`, `src/ui.ts`, `src/player.ts`, `src/char.ts`, `src/perks/perks.ts`, `src/input.ts`, `src/hotkeys.ts`. Audited 2026-10-24.

Earlier audits this builds on: known_bugs C35 (character_stats), C40 (pipboy), C42 (interface), C51 (perks), C53 (rest bail), C57 (character folders).

## Summary

Counts are table rows; some rows group several CE functions.

| Status | Rows |
|---|---|
| ✅ MATCH | 60 |
| ⚠️ DIFFERS | 23 |
| 🟡 PARTIAL | 11 |
| ❌ MISSING | 8 |
| 🚫 N/A (SDL drawing / sfall hi-res / window plumbing) | 15 |

Top findings:

- **CHAR-01 (HIGH, NEW)**: the level-up perk picker runs after the character screen has cloned the skills. Pressing DONE writes that stale clone back. **Educated** (+2 SP), **Tag!** (`hasTagPerk`) and the skill points from a **Here and Now** level-up are all lost. On top of that, DH2 has no "PICK A NEW TAG SKILL" step at all (CE `perkDialogHandleTagPerk`), so Tag! does nothing.
- **CHAR-02 (HIGH, NEW, the wiki is wrong too)**: after creation, trait skill modifiers are never applied. `Critter.getSkill` and the character screen don't pass `traits` to `SkillSet.get`, so Gifted's −10 % to every skill and Good Natured's ±10/15 vanish once the game starts. Skill checks use those inflated values. `wiki/perks_traits.md` §1 says "skills read the traits live", which the code does not do.
- **CHAR-03 (MED, NEW)**: the in-game character screen is not modal. `uiMode` stays `none`, so game ticks, map input and hotkeys keep running behind it. It also has no keyboard handling (CE: D/Return = done, ESC/C = cancel, P = print, arrows/Tab to move the selection).
- **CHAR-04 (MED, NEW)**: CANCEL on the character screen does not undo a perk you took. CE `characterEditorRestorePlayer` → `_pop_perks` restores the perks and the free-perk flag, so you can pick again.
- **CHAR-05 (MED, NEW)**: in the creator, the derived stats and skill percentages ignore the traits' SPECIAL bonuses (Gifted, Bruiser, Small Frame) and their derived effects (Bruiser AP, Kamikaze, Small Frame carry weight…). Also, "+" checks only the base stat (CE: base + trait + bonus < 10), so Gifted lets you raise a stat to a displayed 11, which only DONE then refuses.
- **HUD-01 (MED, NEW)**: the LEVEL indicator lights whenever unspent skill points > 0. CE lights it from `DUDE_STATE_LEVEL_UP_AVAILABLE`: set on level-up, cleared when the character editor closes. In DH2 a player who banks skill points sees LEVEL forever.
- **HUD-02 (MED, NEW)**: reloading from the HUD in combat costs AP even when nothing was loaded. CE `_intface_use_item` charges AP only when `_intface_item_reload()` succeeded. DH2 also logs an invented "You don't have enough action points." and doesn't play the weapon's ready sound.
- **PIP-01 (MED, NEW)**: the AUTOMAPS tab is a DH2 design. CE lists cities (current city first, sorted), then that city's maps by map.msg name, hides maps per `_displayMapList` (encounter maps, etc.) and draws a static map. DH2 groups maps by worldmap entrance (anything else goes under "Unknown"), lists raw file names with "L1/L2", adds zoom and pan, and uses invented strings.
- **CHAR-06 (LOW–MED, NEW)**: PRINT on the character screen does nothing (`characterPrintToFile`), and the creator has no OPTIONS (save/load/print/erase .GCD, `characterEditorShowOptions`).
- Rest/healing (`pipboyRest`, `_Check4Health`, `_ClacTime`, the rest option count, `_critter_can_obj_dude_rest`), the quest and holodisk lists, the video archive, the karma/kills/perks folders, the HP/AC/AP counters, item-action cycling and the ammo bar all match CE.

## Function table

### character_editor.cc

| CE function | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| characterEditorShow (main loop) | `ui_character/viewer.ts:71` showCharacterScreen, `creator.ts:59` showCharacterCreator | ✅ FIXED (CHAR-03, CHAR-04) | MED | No keyboard (CHAR-03); not modal (CHAR-03); CANCEL doesn't restore (CHAR-04). |
| characterEditorShow — creation DONE checks (118/119, 142/143, 157/158, 160/161) | `creator.ts:865` | ✅ | — | Messages, error sound, Yes/No on "None". |
| characterEditorShow — CANCEL / ESC → rc 1 → restore | `creator.ts:891`, `viewer.ts:159` | ✅ FIXED (CHAR-04) | MED | Creator: cancel goes back to the menu ✅. Viewer: perk changes are not restored (CHAR-04). |
| characterEditorShow — end: `dudeDisableState(LEVEL_UP_AVAILABLE)` | — | ✅ FIXED (HUD-01) | MED | No level-up state; the indicator uses skill points instead (HUD-01). |
| characterEditorShow — `_proto_dude_update_gender` on creation done | `player.ts:353` updateNativeLook | ✅ | — | |
| characterEditorWindowInit / WindowFree | viewer/creator WindowFrame build | 🚫 | — | Layout coordinates follow CE. |
| characterEditorInit / Reset (5 char points, last level 1) | `creator.ts:67` pool = 5 | ✅ | — | |
| _get_input_str / _isdoschar | `creator.ts:428` `<input maxLength=11>` | ✅ FIXED (2026-10-26) | LOW | Any Unicode accepted (CE: DOS charset only). Field shows "none" where CE starts empty for "None". — **2026-10-26:** the name field takes space..'z' (KEY_FIRST/LAST_INPUT_CHARACTER, flags 0 — the DOS filter is only for file names), 11 at most; "None" starts empty. |
| _strmfe | — | 🚫 | — | Filename helper for print/save. |
| characterEditorDrawFolders | `folders.ts:187` draw | ✅ | — | C57. |
| characterEditorDrawPerksFolder | `folders.ts:63` | ✅ | — | Traits heading 156, perks 109, "(rank)", fallback card 71/124/127. |
| characterEditorKillsCompare / DrawKillsFolder | `folders.ts:146` | ✅ | — | proto.msg 1450+ / 1469+, sorted by name. |
| characterEditorDrawBigNumber | `ui_font.ts renderBignum` | ✅ FIXED (2026-10-26) | LOW | Static; CE animates the digits counting up or down. — **2026-10-26:** a changed digit shows glyph 11 for 123 ms, ones then tens (setBignum); out of 0..99 shows 99. |
| characterEditorDrawPcStats | `viewer.ts:165-182` | ✅ FIXED (2026-10-26) | LOW | XP has no thousands separators (`_itostndn`); at max level CE leaves "Next Level" blank (msg 175 above 999,999); the lines can't be selected for their cards. — **2026-10-26:** thousands commas; "Next Level" blank at level 99, editor.msg 175 above 999,999; the three lines open their cards. |
| characterEditorDrawPrimaryStat | `viewer.ts:530`, `creator.ts:842` | ✅ | — | Value and stat.msg 301-310 comment (clamped). |
| characterEditorDrawGender / Age / Name | `creator.ts:530-612`, `viewer.ts:204-265` | ✅ | — | |
| characterEditorDrawDerivedStats | `statPanels.ts:84` renderStatPanels | ✅ FIXED (CHAR-05) | MED | Labels, order and formats match CE. The creator feeds it a bare StatSet without trait effects (CHAR-05). |
| characterEditorDrawSkills | `viewer.ts:498`, `creator.ts:783` | ✅ FIXED (CHAR-02) | HIGH | Colours ✅. Values leave out trait modifiers in game (CHAR-02). Hard-coded English skill names. |
| characterEditorDrawCard | `viewer.ts:393` drawCard | ✅ FIXED (2026-10-26) | LOW | Skill cards lack CE's attributes/default subtitle (`skillGetAttributes`). No cards for Level/Exp/Next Level/Tag Skills/Skill Points (120-123). The texts are hard-coded English in `descriptions.ts`, not stat.msg/skill.msg/trait.msg/editor.msg 400-406. — **2026-10-26:** texts from stat.msg / skill.msg / trait.msg / editor.msg (English kept as fallback), skill cards with "Base: n% + (attributes)", cards for Level / Exp / Next Level / Character Points / Skill Points / Tag Skills / Optional Traits / Skills. |
| characterEditorEditName | `creator.ts:416` | ✅ | — | Max 11, an empty entry keeps the old name. |
| _PrintName | — | 🚫 | — | |
| characterEditorEditAge | `creator.ts:450` | ✅ | — | 16..35. No auto-repeat while held (cosmetic). |
| characterEditorEditGender | `creator.ts:497` | ✅ | — | |
| characterEditorAdjustPrimaryStat | `creator.ts:301-317` | ✅ FIXED (CHAR-05) | MED | "+" limit uses the base value only (CHAR-05). No auto-repeat. "−" min 1 ✅. |
| characterEditorShowOptions (save/load/print/erase .GCD) | — | ✅ FIXED (2026-10-25) | LOW | CHAR-06. |
| characterFileExists / characterPrintToFile / _AddSpaces / _AddDots | — | ✅ FIXED (2026-10-25) | LOW | PRINT button inert, `viewer.ts:154` (CHAR-06). |
| characterEditorResetScreen / RegisterInfoAreas | per-element onclick | 🚫 | — | |
| characterEditorSavePlayer / RestorePlayer | `viewer.ts:436-437` (skills + stats clone only) | ✅ FIXED (CHAR-01, CHAR-04) | MED | Only skills are snapshotted; perks, the free-perk flag, traits and HP are not (CHAR-01, CHAR-04). |
| _itostndn | — | ✅ FIXED (2026-10-26) | LOW | No comma formatting. — **2026-10-26:** thousands commas (toLocaleString en-US is the same grouping). |
| characterEditorDrawCardWithOptions | `viewer.ts:393` | 🚫 | — | |
| characterEditorHandleFolderButtonPressed | `viewer.ts:296` activateFolder | ✅ | — | ib3p1xx1, folder card. |
| characterEditorHandleInfoButtonPressed | per-element onclick | ✅ FIXED (2026-10-26) | LOW | SPECIAL/skills/derived/conditions/traits are clickable; Level/Exp/Next Level/Tag/SP are not. — **2026-10-26:** Level / Exp / Next Level / Skill Points / Tag Skills / Optional Traits / Skills open their cards. |
| characterEditorHandleAdjustSkillButtonPressed | `viewer.ts:547` modifySkill | ✅ FIXED (2026-10-26) | LOW | Cost and minimum logic ✅ (`char.ts:150-191`). The errors (editor.msg 132/133 "At maximum level", 134/135 "At minimum level", 136 "Not enough skill points") are only a `dbgWarn` — no dialog, no error sound. — **2026-10-26:** the 132-136 refusals in a dialog with iisxxxx1. |
| characterEditorToggleTaggedSkill | `creator.ts:809` | ✅ FIXED (2026-10-26) | LOW | A 4th tag is refused silently; CE shows 140/141 with iisxxxx1. — **2026-10-26:** 140 / 141 in a dialog. |
| characterEditorDrawOptionalTraits | `creator.ts:619` refreshTraitPanel | ✅ | — | |
| characterEditorToggleOptionalTrait | `creator.ts:690` | ✅ FIXED (2026-10-26) | LOW | A 3rd trait shows the invented card text "You may only pick 2 traits."; CE shows the dialog 148/149 with iisxxxx1. — **2026-10-26:** 148 / 149 in a dialog. |
| characterEditorDrawKarmaFolder | `folders.ts:93` | ✅ | — | karmavar/genrep, town tiers (−30/−15/0/15/30), addictions 4001. |
| characterEditorSave / Load (last level, free perk) | `saveload.ts:203` pendingPerkPick | ✅ | — | |
| characterEditorUpdateLevel | `player.ts:262-287` (at XP gain) | ✅ FIXED (2026-10-26) | LOW | Same SP formula and every-3/4-levels rule. Differences: SP is computed when the XP arrives, not when the editor opens (INT is read at a different time); no 37-perk cap. — **2026-10-26:** the points and the free perk come when the screen opens (editorUpdateLevel; CANCEL undoes it), from base INT then; no free perk with 37 perks taken; the last level seen is saved. |
| perkDialogRefreshPerks / perkDialogShow | `perkModal.ts:39` showPerkModal | ✅ FIXED (CHAR-01) | HIGH | No Tag! skill step (CHAR-01). Lifegiver/Educated effects in `applyPerk` ✅, but Educated is undone by the viewer's DONE (CHAR-01). |
| perkDialogHandleInput | `perkModal.ts:80` showPickList | ✅ FIXED (2026-10-26) | LOW | Mouse only (CE: arrows, Return, ESC, Page keys, double-click). 11 visible lines vs a scrolled div. — **2026-10-26:** Up / Down, Page Up / Down (11), Return, Esc; a click on the selected line is DONE. |
| perkDialogDrawPerks / perkDialogOptionCompare | `perkModal.ts:42`, `perks.ts:19` getValidPerks | ✅ FIXED (2026-10-26) | LOW | Listed by perk id, not sorted by name. Rank shown as "n/max" (CE: "(rank)" only when rank > 0). — **2026-10-26:** sorted by name (case-insensitive); "(rank)" only once taken. |
| perkDialogRefreshTraits / DrawTraits | `perkModal.ts:62` runMutate | ✅ FIXED (2026-10-26) | LOW | PICK A NEW TRAIT offers the trait just dropped (CE leaves out both original traits) and isn't sorted by name. — **2026-10-26:** PICK A NEW TRAIT leaves out both original traits, sorted by name; the Tag! list is sorted too. |
| perkDialogHandleMutatePerk | `perkModal.ts:50-76` | ✅ | — | LOSE (154) → PICK (153); backing out takes the perk away. |
| perkDialogRefreshSkills / HandleTagPerk / DrawSkills | — | ✅ FIXED (CHAR-01) | HIGH | CHAR-01. |
| perkDialogDrawCard | `perkModal.ts:180` | ✅ | — | |
| _pop_perks | — | ✅ FIXED (CHAR-04) | MED | CHAR-04. |
| _is_supper_bonus | `creator.ts:874-877` | ✅ | — | DH2 also refuses values < 1 (unreachable). |
| characterEditorFolderViewInit / Scroll / Clear / DrawHeading / DrawString / DrawKillsEntry | `folders.ts:167-273` | ✅ | — | C57. |
| karmaInit / karmaFree / karmaEntryCompare | `folders.ts:94` | ✅ | — | |
| genericReputationInit / Free / Compare | `folders.ts:95` | ✅ | — | |
| customKarmaFolderInit / Free / GetFrmId (sfall) | `folders.ts:142` fixed frm 47 | 🚫 | — | sfall `KarmaFRMs` ini not read (sfall option). |
| customTownReputationInit / Free (sfall) | `folders.ts:33` vanilla table | 🚫 | — | sfall `TownRepList` not read. |

### pipboy.cc

| CE function | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| pipboyOpen — wmMapPipboyActive / misc.msg 7000 gate | `ui_pipboy/shell.ts:514` | ✅ | — | |
| pipboyOpen — keys ESC/Return/P/Z close, PgUp/PgDn | `input.ts:155`, `status.ts:189` | ✅ | — | |
| pipboyOpen — REST intent (Z) | `shell.ts:605` openPipBoyRest | ✅ | — | |
| pipboyOpen — idle screensaver | — | ✅ FIXED (2026-10-26) | LOW | Documented approximation. — **2026-10-26:** after 2 idle minutes the bombs fall over the bare screen (ui_pipboy/logo.ts, CE's spawn rate, speeds and 50 ms steps); any input ends it. |
| pipboyWindowInit — rest option count | `shell.ts:350` | ✅ | — | Party > 0 and someone healable. |
| pipboyWindowInit — logo + holiday name start screen; "pipon" sound | `shell.ts:584` opens STATUS | 🟡 PARTLY FIXED (2026-10-26) | LOW | No logo screen, no holiday (pipboy.msg holiday ids). pipon: not in the data (C40). — **2026-10-26:** the Pip-Boy opens on the logo with the holiday name (pipboy.msg 100-107) until a tab is picked; pipon is still not in the data (C40). |
| pipboyWindowInit — `_rest_time = 0`, `_proc_bail_flag = 0` | `shell.ts:521` | ✅ | — | |
| pipboyWindowFree — scriptsExecMapUpdateProc, indicatorBarShow, interfaceBarRefresh | `shell.ts:587` (updateMap) | ✅ | — | |
| _pip_init_ / pipboyInit / pipboyReset | `Config.engine.pipboyAvailableAtStart` | ✅ | — | |
| pipboyDrawNumber / pipboyDrawDate | `shell.ts:105` renderDateTimeBar | ✅ | — | DDMonYYYY + HHMM, no colon, as in CE. |
| pipboyDrawText / pipboyDrawBackButton | `status.ts:47` textLine, shell helpers | ✅ FIXED (2026-10-26) | LOW | DOM monospace font, colours #00FF00/#FFFF5A approximate CE 992/32747. — **2026-10-26:** colours 992 / 32747 (#3cf800 / #fcfc7c); the pixel font covers the text. |
| _save_pipboy / pipboySave / pipboyLoad | — | ✅ | — | CE saves nothing. |
| pipboyWindowHandleStatus | `status.ts:75` renderStatusTab, `:136` renderQuestList | ✅ | — | Thresholds `gvar >= display`, completed `>= completed` struck through; 203 when there are no quests. |
| pipboyWindowRenderQuestLocationList | `status.ts:66` questLocations | ✅ | — | |
| pipboyRenderHolodiskText | `status.ts:156` renderHolodisk | ✅ | — | 35 lines a page, END-DISK/END-PAR, 212/200/214/201. |
| pipboyWindowRenderHolodiskList | `status.ts:62` knownHolodisks | ✅ | — | |
| _qscmp | `automaps.ts:250` .sort() | 🟡 | — | See PIP-01. |
| pipboyWindowHandleAutomaps / _PrintAMelevList / _PrintAMList | `ui_pipboy/tabs/automaps.ts:120` | ✅ FIXED (PIP-01) | MED | PIP-01. |
| pipboyHandleVideoArchive / pipboyRenderVideoArchive | `tabs/archives.ts:36` | ✅ | — | Movies 2..15 seen, pipboy.msg 500+n, FADE_IN/OUT/PAUSE_MUSIC. |
| pipboyHandleAlarmClock | `shell.ts:318` toggleWaitMenu, `:379` restFor | ✅ | — | 215 refusal with iisxxxx1; ib1p1xx1 / ib2lu1x1. |
| pipboyWindowRenderRestOptions | `shell.ts:343-372` | ✅ | — | 300, HP line 301, options 302-315. |
| pipboyDrawHitPoints | `shell.ts:308` renderRestClock | ✅ | — | |
| pipboyWindowCreateButtons / DestroyButtons | DOM onclick | 🚫 | — | |
| pipboyRest (fixed / until hour) | `shell.ts:251` | ✅ | — | Same frame math; events fire through `setTime` → timeJumpHandler; ESC; queue bail (C53). |
| pipboyRest (until healed / party healed) | `shell.ts:289-303` | ✅ FIXED (2026-10-26) | LOW | CE's second pass rests one extra 3 h block after the last heal (it loops on the hpToHeal measured *before* the rest, `pipboy.cc:2140-2160`); DH2 checks before each block. No wait-watch cursor. — **2026-10-26:** the second pass tests the wound measured before the last block (one extra 3 h block, as CE); the animated wait-watch cursor (WAIT2) while resting. |
| _Check4Health / _AddHealth (`_partyMemberRestingHeal(3)`) | `shell.ts:223-236` | ✅ | — | Every 180 min, Healing Rate to the dude and party. |
| _ClacTime | `shell.ts:180` | ✅ | — | Literal port. |
| pipboyRenderScreensaver | — | ✅ FIXED (2026-10-26) | LOW | Documented (README known approximations). — **2026-10-26:** ported (ui_pipboy/logo.ts). |
| questInit / questFree / questDescriptionCompare | `questData.ts:43` getQuestDefs | ✅ | — | quests.txt, quests.msg, map.msg, sorted by location (DH2's sort is stable; CE qsort order within a location is unverified). |
| holodiskInit / holodiskFree | `questData.ts:58` | ✅ | — | |

### interface.cc

| CE function | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| interfaceInit (bar window, buttons, sounds) | `ui.ts:208` initUI + static HTML | ✅ FIXED (2026-10-26) | LOW | Every CE button exists (inventory, options, skilldex, map, chr, pip, swap, attack, end turn/combat). Per-button press sounds not checked one by one. — **2026-10-26:** the bar buttons sound ib2p1xx1 / ib2lu1x1, the item button ib3p1xx1 / ib3lu1x1. |
| interfaceReset / interfaceFree | — | 🚫 | — | |
| interfaceLoad / interfaceSave | `saveload.ts:206` activeHand | ✅ FIXED (2026-10-26) | LOW | The current hand is saved. The bar enabled/hidden state and end-button visibility are not (a scripted `game_ui_disable` across a save is lost). — **2026-10-26:** the game_ui_disable state is saved and restored with the hand. |
| interfaceBarHide / Show | — | 🚫 N/A (2026-10-26) | LOW | Unverified for script hides (movies hide the whole UI). — **2026-10-26:** no script opcode hides the bar (game_ui_disable no longer hides it, as CE); movies hide the whole UI. |
| interfaceBarEnable / Disable / Enabled | `globalState.gameUIDisabled`, `input.ts:225` | ✅ | — | |
| interfaceBarRefresh | uiDrawWeapon/drawHP/drawAC callers | ✅ | — | |
| interfaceRenderHitPoints | `ui_hud.ts:90` drawHP | ✅ | — | 25 % / 50 % colour bands, 250/(Δ+1) ms per step. |
| interfaceRenderArmorClass | `ui_hud.ts:119` drawAC | ✅ | — | |
| interfaceRenderActionPoints | `ui_hud.ts:143` drawAP | ✅ | — | Green / yellow free move / all red off-turn; no animation (C42). |
| interfaceGetCurrentHitMode | `Weapon.ts` mode, `unarmed.ts` currentUnarmed | ✅ | — | |
| interfaceUpdateItems | uiDrawWeapon | ✅ FIXED (2026-10-26) | LOW | CE resets the action to primary when a hand's item changes; DH2 keeps `weapon.mode` on the item object (e.g. a weapon re-equipped still in burst). — **2026-10-26:** a new hand item starts on its primary action. |
| interfaceBarSwapHands | `ui.ts:181` swapHands | ✅ FIXED (2026-10-26) | LOW | Animation ✅. CE also drops the crosshair / use-crosshair mouse mode back to move; DH2 keeps `cursorMode`. — **2026-10-26:** the crosshairs go back to the move cursor. |
| interfaceGetItemActions / GetCurrentHand / GetActiveItem | `player.activeHand` | ✅ | — | |
| interfaceCycleItemAction | `ui.ts:193`, `Weapon.ts:244` cycleMode | ✅ | — | primary → aimed → secondary → secondary aimed → reload (if not full); Fast Shot blocks aiming. |
| _intface_use_item | `ui.ts:249` attack button onclick | ✅ FIXED (HUD-02) | MED | HUD-02 (reload AP). Misc-item use in combat: CE checks and charges AP (`itemGetActionPointCost`); DH2 calls `activeItem.use(player)`, AP charge unverified. Crosshair + combat start ✅. |
| _intface_update_ammo_lights | `ui_hud.ts:461` uiUpdateAmmoBar | ✅ | — | |
| interfaceBarEndButtonsShow | `ui_hud.ts:538` uiStartCombat | ✅ FIXED (2026-10-26) | LOW | Animation frames ✅. The "iciboxx1" open sound is missing (only icibcxx1 on close). Fixed 66 ms per frame vs the FRM's fps. — **2026-10-26:** iciboxx1 on opening; a frame every 1000 / the FRM's fps. |
| interfaceBarEndButtonsHide | `ui_hud.ts:559`, `Combat.ts:2882` | ✅ | — | |
| interfaceBarEndButtonsRenderGreenLights / RedLights | `ui_hud.ts:519-532` | ✅ | — | Buttons enabled/disabled with the lights. |
| intface_init_items | — | 🚫 | — | |
| interfaceBarRefreshMainAction | `ui_hud.ts:363` uiDrawWeapon | ✅ | — | C42 (labels, disabled art, AP digit, bullseye). |
| _intface_redraw_items_callback / _intface_change_fid_callback / interfaceBarSwapHandsAnimatePutAwayTakeOutSequence | `Player.playWeaponSwapAnim` | ✅ | — | |
| endTurnButtonInit/Free, endCombatButtonInit/Free | `ui.ts:310-326` | ✅ | — | combatAttemptEnd. |
| interfaceUpdateAmmoBar | `ui_hud.ts:474` | ✅ | — | Rounded down to even. |
| _intface_item_reload | `ui.ts:240` reloadWeapon | ✅ FIXED (HUD-02) | MED | HUD-02: no weapon ready sfx (`sfxBuildWeaponName(READY)`); DH2 forces 'single' where CE calls `interfaceCycleItemAction` (also ends on primary). |
| interfaceRenderCounter | `ui_hud.ts:41` drawDigits | ✅ | — | |
| intface_fatal_error | — | 🚫 | — | |
| indicatorBarInit | `ui_hud.ts:205` buildBadgeSrcCanvases | ✅ FIXED (2026-10-26) | LOW | Labels hard-coded English; CE uses intrface.msg 100-104. — **2026-10-26:** the labels from intrface.msg 100-104. |
| interfaceBarFree / indicatorBarReset | — | 🚫 | — | |
| indicatorBarRefresh | `ui_hud.ts:234` updateIndicatorBar | ✅ FIXED (HUD-01) | MED | HUD-01 (LEVEL source). SNEAK/ADDICT/POISONED (> 0)/RADIATED (> 65) ✅. |
| indicatorBoxCompareByPosition / indicatorBarRender / indicatorBarAdd | `ui_hud.ts:279` | ✅ | — | Enum order, connector geometry. |
| indicatorBarShow / Hide | — | ✅ FIXED (2026-10-26) | LOW | No explicit hide; the Pip-Boy/inventory windows cover it (unverified for every window). — **2026-10-26:** hidden while the dialogue, the character screen or the Pip-Boy is open. |
| customInterfaceBarInit/Exit/GetBackgroundImageData, sidePanelsInit/Exit/Hide/Show/Draw | — | 🚫 | — | sfall hi-res features. |
| interface_get_current_attack_mode (sfall) | — | 🚫 | — | sfall opcode helper (out of scope here). |

## Detailed findings

### CHAR-01 — Level-up perk effects lost; Tag! does nothing (HIGH, NEW) — **FIXED 2026-10-24 (PA5)**
- **CE**: `character_editor.cc characterEditorShow` → `characterEditorUpdateLevel` → `perkDialogShow`, then `perkDialogHandleTagPerk` / `perkDialogHandleMutatePerk` / the Lifegiver and Educated branches (lines 5933-5960). The perk changes the dude directly; the editor works on the live dude, so DONE keeps them. Tag! opens "PICK A NEW TAG SKILL" (editor.msg 155) and stores the skill in `gCharacterEditorTempTaggedSkills[3]`.
- **DH2**: `src/ui_character/viewer.ts:436-437` clones `player.skills` (and stats), and only then (`:633`) opens `showPerkModal`. `applyPerk` (`src/perks/perks.ts:120-150`) changes `player.skills` (Educated `skillPoints += 2`, Tag! `hasTagPerk = true`, Here and Now → `addExperience` → level-up SP). DONE (`viewer.ts:617-620`) then writes the clone's `skillPoints` and `hasTagPerk` over them. Nothing in the game can tag a 4th skill (only the creator has tag toggles).
- **Impact**: Educated's first-rank +2 SP is lost on DONE. Tag! is a wasted perk. Here and Now's level-up skill points are lost.
- **Fix**: open the perk modal before cloning, or re-clone / merge `skillPoints` and `hasTagPerk` after the modal closes. Add a Tag! step (the perk window listing the untagged skills) that sets `tagged[3]`, and remove the perk if the player backs out (CE).

### CHAR-02 — Trait skill modifiers not applied after creation (HIGH, NEW; the wiki is wrong) — **FIXED 2026-10-24 (PA6)**
- **CE**: `skill.cc skillGetValue` always adds `traitGetSkillModifier(skill)` for the dude (Gifted −10 to all, Good Natured +15 First Aid/Doctor/Speech/Barter and −10 to combat skills).
- **DH2**: `SkillSet.get` (`src/char.ts:127-130`) applies them only when `options.traits` is passed. `Critter.getSkill` (`src/object/Critter.ts:307-315`) and the character screen (`viewer.ts:438`, `playerSkillOpts`) never pass `traits`. Only the creator (`creator.ts:84`) does. `applyCreationStats` doesn't bake them into the base either.
- **Impact**: every skill check, the skill-point cost bands and the character screen read Gifted characters 10 % too high and Good Natured ones without the bonus or the penalty. `wiki/perks_traits.md` §1 ("skills read the traits live") contradicts the code. Flagged as a wiki/code conflict.
- **Fix**: pass `traits: this.traits` in `Critter.getSkill` when `isPlayer`, and in the viewer's `playerSkillOpts`. The scripting `has_skill` path probably goes through `getSkill` (verify).

### CHAR-03 — The character screen is not modal and has no keyboard input (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `characterEditorShow` runs its own input loop (`GameMode::kEditor`); the game is paused. Keys: Return/D = done, ESC/C = cancel, P = print, Tab and arrows move the selection, +/− adjust skills, Ctrl-Q quits.
- **DH2**: `showCharacterScreen` never sets `globalState.uiMode` (`UIMode.char` exists but is unused), so `gameTick.ts:132` keeps the world running and `input.ts:234` keeps sending game hotkeys (ESC opens the options menu, I the inventory…). The viewer has no key handler (the creator handles ESC only).
- **Impact**: time, NPC movement and timed events go on while you read the screen; clicks on the map pass through around it.
- **Fix**: set `uiMode = UIMode.char` on open and `none` on close, and add the CE keys (Return/D, ESC/C, P).

### CHAR-04 — CANCEL keeps a perk taken in the level-up dialog (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `characterEditorRestorePlayer` → `_pop_perks` puts every perk back to its saved rank and restores `gCharacterEditorHasFreePerk`, the unspent SP, the tags, the traits and the HP. Cancelling a level-up undoes the perk, so it can be picked again next time.
- **DH2**: `applyPerk` sets `pendingPerkPick = false` and pushes the perk right away; the viewer's CANCEL (`viewer.ts:159`) only closes the window.
- **Impact**: the choice can't be taken back (CE allows it); with Mutate!, the trait swap stays.
- **Fix**: snapshot perks, traits, `pendingPerkPick`, Max HP/HP and SP when the screen opens; restore them on CANCEL.

### CHAR-05 — Creator ignores the trait SPECIAL bonuses in derived stats, skills and the "+" limit (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `characterEditorAdjustPrimaryStat` lets "+" through only while `critterGetBaseStatWithTraitModifier + critterGetBonusStat < 10`. `critterUpdateDerivedStats` and `skillGetValue` use the trait-modified SPECIAL, so picking Bruiser or Gifted updates AP, carry weight, melee damage, HP and the skill % right away.
- **DH2**: `creator.ts:304` checks `cur >= 10` on the base only. `renderStatPanels` and `SkillSet.get` get `newStatSet` (no trait SPECIAL, no `Player.getStat` trait effects). Only the SPECIAL bignums add the trait bonus by hand (`creator.ts:847`).
- **Impact**: the creation screen shows the wrong HP, AP, carry weight, sequence, AC and skill % whenever a trait is picked. With Gifted you can raise a base stat to 10 (shown as 11) and only DONE refuses it (157/158).
- **Fix**: build a temporary Player-like view (trait SPECIAL added, the `Player.getStat` trait switch) for the creator's panels; compare base + trait bonus against 10 in "+".

### CHAR-06 — No print-to-file and no creation OPTIONS (LOW–MED, NEW) — **FIXED 2026-10-25**
- **CE**: `characterPrintToFile` writes a text sheet (in-game PRINT, creation OPTIONS → PRINT). `characterEditorShowOptions` saves, loads and erases `.GCD` premades.
- **DH2**: PRINT label and button with no handler (`viewer.ts:154-155`); no OPTIONS button in the creator.
- **Fix**: PRINT → a browser text download in CE's format; OPTIONS → save/load a GCD-equivalent JSON (localStorage or download).

### HUD-01 — LEVEL indicator tied to unspent skill points (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `interface.cc indicatorBarRefresh` shows LEVEL while `DUDE_STATE_LEVEL_UP_AVAILABLE` is set. It is set in `stat.cc:764` on level-up and cleared in `characterEditorShow` (line 1193) and `stat.cc:815`.
- **DH2**: `ui_hud.ts:262` uses `skills.skillPoints > 0`.
- **Impact**: banked skill points keep LEVEL lit forever; in CE it goes out once the character screen has been opened.
- **Fix**: add a `levelUpAvailable` flag on Player: set it in `addExperience` on level-up, clear it when the character screen closes, save it.

### HUD-02 — HUD reload charges AP even when nothing loads (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `interface.cc _intface_use_item` (RELOAD action, in combat): if `ap >= required` and `_intface_item_reload() == 0` (something loaded), subtract the AP. `_intface_item_reload` plays `sfxBuildWeaponName(WEAPON_SOUND_EFFECT_READY)`. With too few AP nothing happens and nothing is printed.
- **DH2**: `ui.ts:253-267` subtracts the AP first, then `reloadWeapon`, whatever the result. It logs "You don't have enough action points." (an invented string) and plays no sound.
- **Fix**: charge the AP only when `reloadWeapon()` returns true; drop the log line; play the weapon's ready sfx.

### PIP-01 — AUTOMAPS tab structure isn't CE (MED, NEW) — **FIXED 2026-10-25**
- **CE**: `pipboy.cc pipboyWindowHandleAutomaps` / `_PrintAMList` / `_PrintAMelevList`.
  - Level 1: the cities that have automap data (`mapGetCityName`), filtered by `_automapDisplayMap(map)` (`automap.cc _displayMapList`: maps 0-2, 52-53, 59-60, 68-77, 80-91, 94-125, 127, 141-146 and 149-159 hidden; the sfall `automap=` key in maps.txt can change this), merged by `_is_map_idx_same`, sorted by name (`_qscmp`), header 205.
  - Level 2: the current city's maps first, then the other maps of that city (`_get_map_idx_same`), each elevation named by `mapGetName` (map.msg).
  - A pick draws the map once with `automapRenderInPipboyWindow`: static, no zoom.
- **DH2**: `ui_pipboy/tabs/automaps.ts:120-280` groups maps by the worldmap area whose *entrance* list contains them (other maps go under "Unknown"). Rows are raw file names with "L<n>" and "(CURRENT)". It adds zoom (+/−, wheel) and drag-pan, and uses invented strings ("AUTOMAPS", "(no saved maps)", "(no maps known yet — explore the wastes)").
- **Impact**: hidden encounter maps show up; interior maps fall under "Unknown"; names aren't the localized map.msg ones.
- **Fix**: port `_PrintAMList` / `_PrintAMelevList` over the `maps.txt` city ids and map.msg names, with the `_displayMapList` table; keep zoom as an optional DH2 extra if wanted.

## DH2-only behaviour

- Character, creator and perk windows can be dragged (`makePanelDraggable`); creator popups close on a click outside.
- The automap view in the Pip-Boy has zoom (+/−, wheel) and drag-pan (PIP-01).
- The perk window list scrolls (CE: 11 lines with keyboard/arrow scrolling).
- The Pip-Boy STATUS tab shows a debug line of "unknown non-zero GVARs" when `Config.scripting.debugLogShowType.gvars` is on.
- Rest also stops when the UI mode turns to dialogue, barter or worldmap (stands in for CE's `_proc_bail_flag` coming from scripts).
- The HUD HP/AC counters animate with `setInterval` and don't block (CE blocks the loop while counting).
- The `[dh2] pipboy_available_at_game_start` option maps sfall's `PipBoyAvailableAtGameStart` (CE's value-2 behaviour).
