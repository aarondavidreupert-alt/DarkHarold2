# CE parity audit — Dialogue, talking heads, lip sync, party members

Scope: CE `game_dialog.cc`, `dialog.cc`, `lips.cc`, `party_member.cc` (plus the dialogue / party opcodes of
`interpreter_extra.cc` that call into them) vs DH2 `src/scripting.ts` (dialogue + party parts),
`src/vm.ts` / `src/lua/prelude.ts` (gsay_end / gsay_message suspension), `src/ui_dialogue.ts`,
`src/ui_dialogue_review.ts`, `src/talkingHead.ts`, `src/ui_companion.ts`, `src/ui_companion_trade.ts`,
`src/ui_barter/screen.ts` (entry / exit only), `src/party.ts`, `src/aiPackets.ts`, `src/map/GameMap.ts placeParty`,
`src/ui_pipboy/shell.ts` / `src/worldmap/Worldmap.ts` (resting heal). Audited 2026-10-24.

Method: every function of the four CE files was read; DH2 counterparts located by grep and read. Script-side
claims were checked against the decompiled vanilla scripts in the user's install (`data/scripts/*.lua`,
not committed) and `data/data/party.txt` / `ai.txt`. Nothing was run in the browser — behaviour marked
"unverified in game" is derived from reading the code.

## Summary

| Status | Count |
|---|---|
| ✅ MATCH | 44 |
| ⚠️ DIFFERS | 27 |
| 🟡 PARTIAL | 7 |
| ❌ MISSING | 4 |
| 🚫 N/A | 21 (SDL drawing, CE save plumbing, and the unused `dialog.cc` say* library) |

(Counts are per table row; rows group trivially related functions, ~190 CE functions in total.)

Top findings:

- **PTY-01 (HIGH, NEW)** — Dead companions are never taken out of the party. CE `critterKill` (and
  `_combat_..` kill path) calls `partyMemberRemove`; DH2 has no such call anywhere. A dead companion keeps
  counting in `METARULE_PARTY_COUNT` (blocks recruiting), its corpse is carried to every new map and placed
  next to the player by `placeParty`, and its skills still count for the party's best Barter / Outdoorsman.
- **PTY-02 (HIGH, NEW)** — The Custom-disposition picker writes the wrong values: "Always!" stores
  `sometimes`, "Sometimes" stores `no_pref`; the run-away list is shifted by one CE step and "You need a
  tourniquet" stores `none`, which makes the companion flee at the first point of damage; "Never!" falls back
  to the packet's ai.txt `min_hp` instead of 0.
- **PTY-04 (HIGH, NEW)** — `metarule(METARULE_PARTY_COUNT)` returns `party.length`; CE `_getPartyMemberCount`
  counts the dude plus the living, visible critter members only. Without a car the companions' "already a
  crowd" check (`count − GVAR_PLAYER_GOT_CAR − 1 ≥ CHA/2 + MP`) is one too low, so one extra companion can join;
  dead / hidden members and the car trunk are miscounted.
- **DLG-01 (HIGH, partly known P6)** — Barter / Trade / Combat-Control return re-runs `talk_p_proc` from the top
  (`Scripting.reenterDialogue`). CE returns to the same node: the node a script set up after
  `gdialog_mod_barter` ("Thanks for your business", the post-barter options in 64 scripts) is thrown away, the
  greeting logic and every side effect before `gsay_end` run again, and the earlier suspended `talk_p_proc`
  stays on the VM / Lua suspension stack, so its code after `gsay_end` (incl. `end_dialogue`) runs twice when
  the dialogue ends.
- **DLG-02 (MED, NEW)** — `gsay_message` closes the dialogue when its [Done] is picked. In CE it is a nested,
  synchronous dialogue loop: after [Done] the script continues inside the still-open dialogue, and the
  following `gsay_end` returns at once (no reply pending). In DH2 the `gsay_end` after it halts again with
  nothing on screen, so the rest of `talk_p_proc` (`end_dialogue`, post-dialogue code) is deferred until some
  later dialogue with the same script ends (36 vanilla scripts, e.g. `robctrl`, `ccqmstr Node001`).
- **DLG-04 (MED, NEW)** — No dialogue keyboard input at all: CE picks options with 1–9, opens barter with B, pages
  long replies with Space / ↑ / ↓ (and auto-pages after 10 s); the control screen has W / A / D / Esc and the
  customise screen Enter / Esc. DH2's dialogue is mouse only (Escape works only on the companion screens).
- **PTY-03 (MED, NEW)** — Which dispositions / custom values a companion may use comes from `party.txt` in CE
  (`partyMemberSupports*`). DH2 never reads those lists: a disposition button is enabled if `ai.txt` has a
  sibling `PARTY <NAME> <DISP>` packet — and every companion has all five — and every custom value is
  selectable. Marcus can be set to Coward / Defensive, Myron to Berserk, Lenny to Aggressive / Berserk, etc.
- **PTY-05 (MED, NEW)** — Control-screen readout is DH2's own layout: CE draws weapon (112,20), armor (112,49),
  the critter sprite (39,132), HP, **best skill**, weight (red if encumbered), **melee damage** and **AP** at
  x 240; DH2 prints "Weapon/Armor/HP/Weight/Disposition" labels at x 20 and lacks best skill, melee damage,
  AP and the sprite.
- Talking heads, fidgets, reactions, lip sync, music handling, Empathy colours, Smooth Talker IQ gate,
  companion level-ups (`_partyMemberIncLevels` / `_partyMemberCopyLevelInfo`), party placement
  (`_partyMemberSyncPosition`) and resting heal are faithful ports.
- Doc error: `wiki/companion_party.md` §8.4 says the ai.txt packet numbers "don't line up" with CE's
  `aiSetDisposition` arithmetic. They do (e.g. Myron custom 62, coward 61, defensive 60, aggressive 59,
  berserk 58 = base − disposition); the earlier reading used file order instead of `packet_num`. DH2's
  name-based lookup gives the same packet, so behaviour is ✅.

## Function table

### game_dialog.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `gameDialogInit` | — | 🚫 N/A | — | sfall `DialogGameFix` / `NumbersInDialogue` config; DH2 has no number keys at all (DLG-04). |
| `_gdialogReset`, `gameDialogReset`, `gameDialogExit` | `talkingHead.ts:286 endLips` via `uiEndDialogue` | ✅ | — | Only ends lips. |
| `_gdialogActive` | `globalState.uiMode === UIMode.dialogue` / `currentDialogueObject` | ✅ | — | |
| `gameDialogEnter` | `scripting.ts:3461 talk` + callers (`playerUse.ts:409`, `ui_contextmenu.ts:100`, `input.ts:458`) | ⚠️ | LOW | Combat refusal is in the callers, not in `talk`; no `_action_can_talk_to` (660 "can't see", 661 > 12 hexes) for the `dialogue_system_enter` path; barter modifier reset on exit instead of entry (same effect); camera centre not restored at the end (DLG-07). |
| `_gdialogSystemEnter` | `scripting.ts:3452 processDialogueRequest` | ✅ | — | Request opened by the game tick (L9). |
| `gameDialogStartLips` | `talkingHead.ts:267 startLips` | 🟡 | LOW | "censor" sfx for a null name ✅. CE still plays the ACM when the `.lip` file is missing (`lipsLoad` goes on with no stream); DH2 plays nothing without a `.lip`. Unverified whether vanilla has such lines. |
| `gameDialogEndLips` | `talkingHead.ts:286 endLips` | ✅ | — | |
| `gameDialogEnable` / `gameDialogDisable` | `talkingHead.ts:307 ticker` (rAF) | 🚫 N/A | — | |
| `_gdialogInitFromScript` | `scripting.ts:2452 start_gdialog` → `ui_dialogue.ts:133 uiStartDialogue`, `talkingHead.ts:372 startTalkingHead` | 🟡 | LOW | Head / reaction / music (half volume or stop) ✅. CE `opStartGameDialog` returns at once in combat; DH2 still opens the UI (only the head is skipped). No `textObjectsReset` (floating texts stay), no `indicatorBarHide`. |
| `_gdialogExitFromScript` | `scripting.ts:533 dialogueExit` → `ui_dialogue.ts:184 uiEndDialogue` / `stopTalkingHead` | ⚠️ | LOW | Music restore ✅. CE refuses to exit while a barter / control switch is pending (`_dialogue_switch_mode` 2/8/11) — DH2's architecture differs (DLG-01). No camera restore (DLG-07). |
| `gameDialogSetBackground` | `talkingHead.ts:373` | ✅ | — | |
| `gameDialogRenderSupplementaryMessage` | `ui_companion.ts:222 showAIUpdateMsg`, `ui_companion_trade.ts` (`uiSetDialogueReply`) | ⚠️ | LOW | The dialogue Barter button's 903 / 913 refusals go to the message monitor (`ui_dialogue.ts:102 uiLog`), CE shows them in the reply window. |
| `_gdialogStart` | `scripting.ts:2754 gsay_start` | ⚠️ | LOW | Options cleared ✅. CE also empties the review list on every `gsay_start`; DH2 empties it on a fresh `start_gdialog` only (same in practice). |
| `_gdialogSayMessage` | `scripting.ts:2777 gsay_message` | ⚠️ | MED | DLG-02. |
| `gameDialogAddMessageOptionWithProcIdentifier`, `gameDialogAddTextOptionWithProcIdentifier`, `gameDialogAddMessageOptionWithProc`, `gameDialogAddTextOptionWithProc` | `scripting.ts:2743 gsay_option`, `:2819 giq_option`, `vm_bridge.ts:328`, `lua/prelude.ts:188` | ✅ | — | IQ test incl. Smooth Talker and negative IQ ✅. CE silently ignores a *string* proc name (proc = 0, option ends the dialogue); DH2 behaviour for that case unverified (no vanilla script uses it). |
| `gameDialogSetMessageReply`, `gameDialogSetTextReply` | `scripting.ts:2765 gsay_reply` | ⚠️ | LOW | Review entry ✅, speech ✅. CE also clears the option list (options added before the reply are dropped); DH2 keeps them. |
| `_gdialogGo` | `vm_bridge.ts:317` / `scripting.ts:2801 gsay_end`, `lua/prelude.ts:180` | ⚠️ | MED | DLG-02 / DLG-03: CE returns at once when no reply is pending, and adds an implicit option when there are none; DH2 always suspends. |
| `_gdialogUpdatePartyStatus` | — | ❌ | LOW | Recruiting / dismissing during a conversation doesn't swap `di_talk`/`di_talkp` or show / hide Combat Control until the next `uiStartDialogue`. |
| `gdHide`, `gdUnhide` | `uiSwapDialoguePanel` | 🚫 N/A | — | |
| `gameDialogAddMessageOption`, `gameDialogAddTextOption` | `ui_dialogue.ts:251 uiAddDialogueOption` | ⚠️ | LOW | CE capacity 30 options; prefix `\x95 ` (bullet) — DH2 `- `. |
| `gameDialogReviewWindowInit`, `gameDialogReviewWindowFree`, `gameDialogShowReview`, `gameDialogReviewButtonOnMouseUp`, `gameDialogReviewWindowUpdate` | `ui_dialogue_review.ts:35 uiShowDialogueReview` | ⚠️ | LOW | Art / buttons / rect ✅. CE prints "Name:" (speaker, colour 992) and "Dude:" (21140) headers per entry, reply 768 / option 15855 colours, starts at the oldest entry, ↑/↓ keys scroll one entry, opening it stops the lip-sync speech. DH2: no names, opens scrolled to the bottom, no arrow keys, speech keeps playing. |
| `dialogReviewEntriesClear`, `gameDialogAddReviewMessage`, `gameDialogAddReviewText`, `gameDialogSetReviewOptionMessage`, `gameDialogSetReviewOptionText` | `scripting.ts:100 dialogueReviewLog`, `:492 dialogueReply` | ✅ | — | Capacity 80 not enforced (harmless). |
| `_gdProcessInit`, `_gdProcessCleanup`, `_gdProcessExit` | DOM `#dialogueBox` | 🚫 N/A | — | |
| `gameDialogRenderCaps` | `ui_dialogue.ts:125 updateDialogueCaps` | ⚠️ | LOW | CE `itemGetTotalCaps` also counts caps inside carried containers; DH2 counts loose PID 41 only. |
| `_gdProcess` | `ui_dialogue.ts:261` (click) + `scripting.ts:492 dialogueReply` | ❌ | MED | DLG-04: no 1–9 / B / Space / ↑ / ↓ keys, no 10 s auto-paging of over-long replies. |
| `_gdProcessChoice` | `scripting.ts:492 dialogueReply` | ✅ | — | Review option, `_talk_to_critter_reacts` with the option's reaction, end when the proc adds no options ✅. The sub-screen cases are DLG-01. |
| `gameDialogOptionOnMouseEnter`, `gameDialogOptionOnMouseExit` | `ui_dialogue.ts:249-260` | ✅ | — | Hover yellow, Empathy blue / red (+ hover magenta / light red) as CE. |
| `gameDialogRenderReply`, `_gdProcessUpdate` | `ui_dialogue.ts:196 uiSetDialogueReply`, `:251` | ⚠️ | LOW | Scrollable div instead of CE pages; CE gives no button to options that don't fit the 112 px window (still reachable by key); `[Done]` text hard-coded instead of proto.msg 650; "Go on" (655) case missing (DLG-03). |
| `_gdCreateHeadWindow`, `_gdDestroyHeadWindow` | `talkingHead.ts:349 ensureCanvas`, `:399 stopTalkingHead` | ✅ | — | |
| `_gdSetupFidget` | `talkingHead.ts:160 setupFidget` | ✅ | — | Fidget choice 68 / 52 / 77 %, phoneme anim per reaction ✅. |
| `gameDialogWaitForFidgetToComplete`, `_gdPlayTransition` | `talkingHead.ts:190 playTransition` | ✅ | LOW | Async (promise chain) instead of a blocking loop; the dialogue stays clickable during a transition. |
| `_reply_arrow_up`, `_reply_arrow_down`, `_reply_arrow_restore` | — | 🚫 N/A | — | Scroll cursors over the reply. |
| `_demo_copy_title`, `_demo_copy_options`, `_gDialogRefreshOptionsRect` | — | 🚫 N/A | — | |
| `gameDialogTicker` | `talkingHead.ts:307 ticker`; sub-mode switches in `uiSwapDialoguePanel` | ✅ | — | Lips → phoneme frame, end of speech → fidget after `_tocksWaiting` ✅. |
| `_talk_to_critter_reacts` | `talkingHead.ts:213 talkToCritterReacts` | ✅ | — | |
| `_gdialog_scroll_subwin` | `ui_dialogue.ts:37 uiAnimateBox` | 🚫 N/A | — | 1 s CSS ease vs 10 px strips every 33 ms. |
| `_text_num_lines`, `text_to_rect_wrapped`, `gameDialogDrawText` | CSS wrapping | 🚫 N/A | — | |
| `gameDialogSetBarterModifier` | `scripting.ts:2439 gdialog_set_barter_mod` | ✅ | — | |
| `gameDialogBarter` | `scripting.ts:2444 gdialog_mod_barter` | ⚠️ | HIGH | DLG-01. Also: CE refuses outside a dialogue (`_dialog_state_fix`); DH2 opens barter anyway. |
| `_barter_end_to_talk_to` | `ui_barter/screen.ts uiEndBarterMode` → `scripting.ts:562 reenterDialogue` | ⚠️ | HIGH | DLG-01 (known design, P6 / P10; consequences NEW). |
| `_gdialog_barter_create_win`, `_gdialog_barter_destroy_win` | `ui_barter/screen.ts uiBarterMode`, `ui_companion_trade.ts uiCompanionTrade` / `uiEndCompanionTrade` | ⚠️ | LOW | barter.frm / trade.frm pick ✅. Missing: `aiAttemptWeaponReload(speaker)` after the barter window closes; CE stops a playing lip-sync speech when barter opens (`gameDialogBarterButtonUpMouseUp`). |
| `_gdialog_barter_cleanup_tables` | barter working copies (`ui_barter/screen.ts`, `ui_companion_trade.ts`) | 🟡 | — | Barter internals belong to the inventory audit; not checked here. |
| `partyMemberControlWindowInit` | `ui_companion.ts:301 uiCompanionControl` | ⚠️ | MED | Buttons / positions ✅; disposition enable rule is PTY-03. |
| `partyMemberControlWindowFree` | `uiSwapDialoguePanel` | 🚫 N/A | — | |
| `partyMemberControlWindowUpdate` | `ui_companion.ts:315 redraw` | ⚠️ | MED | PTY-05. |
| `gameDialogCombatControlButtonOnMouseUp` | `ui_dialogue.ts:110-113` | ✅ | — | |
| `_gdPickAIUpdateMsg` | `ui_companion.ts:218 showAIUpdateMsg` | ✅ | — | 670–674, dogs 677–678. |
| `_gdCanBarter` | — (control Trade button `ui_companion.ts:346`) | ⚠️ | LOW | CE's control-screen Trade (D) checks `CRITTER_BARTER` and shows 913 "can't carry anything" (e.g. dogs); DH2 opens the trade screen unconditionally from the control screen (the dialogue Barter button does check). |
| `partyMemberControlWindowHandleEvents` | `ui_companion.ts:228 useBestWeapon`, `:253 useBestArmor`, disposition clicks | ⚠️ | LOW | Logic ✅ (unwield right hand, `_ai_search_inven_weap`, reload, message only when found; armor except PID 0x10000A1, message always). Keys W / A / D missing (Esc ✅). |
| `partyMemberCustomizationWindowInit`, `…Free`, `…HandleEvents`, `…Update` | `ui_companion.ts:406 uiCompanionCustomize` | ⚠️ | LOW | Done button at (593,161) — CE (593,101), key Enter missing; current values shown as raw keys (`be_sure`) next to the buttons instead of the custom.msg text at x 232; "Not Applicable" (99) for unset area-attack missing; extra DH2 title line. |
| `_gdCustomSelectRedraw`, `_gdCustomSelect` | `ui_companion.ts:458 uiCustomCategoryPicker` | ⚠️ | MED | Unsupported values not greyed / refused (PTY-03); single click commits (CE: select, then Done / Enter or double-click; Cancel / Esc); hard-coded English labels instead of custom.msg; no Done / Cancel buttons (70,164)/(176,163). |
| `_gdCustomUpdateSetting` | `party.ts:261 setCompanionCustomSetting` + `ui_companion.ts:84 CUSTOM_OPTIONS` | ⚠️ | HIGH | PTY-02. Also PTY-06 (custom values dropped on a disposition change). |
| `gameDialogBarterButtonUpMouseUp` | `ui_dialogue.ts:93` | ✅ | LOW | Flag check, party → trade ✅; refusal text goes to the monitor (see SupplementaryMessage row). |
| `_gdialog_window_create`, `_gdialog_window_destroy` | `ui_dialogue.ts:72 setupDialogueActionButtons` | ✅ | — | di_talk / di_talkp, Barter (593,41), Review (13,154), Combat Control (593,116) only for party members. |
| `talk_to_create_background_window`, `gameDialogWindowRenderBackground` | `#dialogueContainer` / `#dialogueFrame` (alltlk) | ✅ | — | |
| `_talkToRefreshDialogWindowRect` | — | 🚫 N/A | — | |
| `gameDialogRenderHighlight`, `gameDialogRenderTalkingHead` | `talkingHead.ts:133 render`, hilight1/2 overlays (P22) | ✅ | — | Offset arithmetic incl. the `width*dirY` quirk ✅. No-head case: CE copies the map view into the screen; DH2 leaves the map visible through the frame (🚫). |
| `gameDialogHighlightsInit`, `gameDialogHighlightsExit`, `gameDialogRedButtonsInit`, `gameDialogRedButtonsExit` | CSS / PNG overlays | 🚫 N/A | — | |

### dialog.cc

| CE function (file) | DH2 counterpart | Status | Sev | Notes |
|---|---|---|---|---|
| `_getReply`, `_replyAddOption`, `_replyAddOptionProc`, `_optionFree`, `_replyFree`, `_endDialog` | — | 🚫 N/A | — | The generic interpreter dialog library behind the `interpreter_lib.cc` `say*` opcodes (sayStart, sayReply, sayOption, sayGotoReply, sayQuit …). No vanilla Fallout 2 script uses them (opcode scan in CLAUDE.md / C54); Fallout 2 dialogue goes through `game_dialog.cc`. |
| `_printLine`, `_printStr`, `_drawStr`, `_abortReply`, `_endReply` | — | 🚫 N/A | — | same |
| `_dialogStart`, `_dialogRestart`, `_dialogGotoReply`, `dialogSetReplyTitle`, `_dialogReply`, `_dialogOption`, `_dialogOptionProc`, `sub_430FD4`, `sub_431088`, `_dialogGetExitPoint` | — | 🚫 N/A | — | same (several are "Incomplete" stubs in CE too) |
| `_dialogQuit`, `_dialogClose` | (called by `_barter_end_to_talk_to`) | 🚫 N/A | — | Bookkeeping of the say* library only. |
| `dialogSetOptionWindow`, `dialogSetReplyWindow`, `dialogSetBorder`, `_dialogSetScrollUp`, `_dialogSetScrollDown`, `dialogSetOptionSpacing`, `dialogSetOptionColor`, `dialogSetReplyColor`, `_dialogSetOptionFlags` | — | 🚫 N/A | — | Layout setters; `_gdialogInitFromScript` calls some of them but `game_dialog.cc` draws itself. |
| `dialogInit`, `_dialogGetDialogDepth`, `_dialogRegisterWinDrawCallbacks`, `_dialogToggleMediaFlag`, `_dialogGetMediaFlag` | — | 🚫 N/A | — | |

### lips.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `lips_fix_string` | — | 🚫 N/A | — | |
| `lipsTicker` | `talkingHead.ts:295 lipsPhoneme`, `:307 ticker` | ✅ | LOW | Position derived from `currentTime / duration × totalBytes` of the converted mp3 (CE: sound byte position); CE's "stop when wrapped past marker 3" branch not ported — the audio's `ended` ends it. |
| `lipsStart` | `talkingHead.ts:267 startLips` | ✅ | — | Volume = speech × 0.69 ✅. |
| `lipsReadV1` | — | ❌ | LOW | Version-1 `.lip` files rejected (`talkingHead.ts:247`). Vanilla files appear to be v2; unverified. |
| `lipsLoad` | `talkingHead.ts:238 loadLips` | 🟡 | LOW | v2 header / phonemes / markers ✅. Missing `.lip` → no speech (CE plays the ACM anyway). |
| `_lips_make_speech` | `talkingHead.ts:262` (`audio/speech/<head>/<name>.mp3`) | ✅ | — | |
| `lipsFree` | `talkingHead.ts:286 endLips` | ✅ | — | |

### party_member.cc

| CE function (file) | DH2 counterpart (file:line) | Status | Sev | Notes |
|---|---|---|---|---|
| `partyMembersInit` | `party.ts:50 loadPartyDescs` | 🟡 | MED | Reads pid + level fields only; `area_attack_mode`, `attack_who`, `best_weapon`, `chem_use`, `distance`, `run_away_mode`, `disposition` lists are ignored (PTY-03). |
| `partyMembersReset`, `partyMembersExit` | `gameReset.ts:45-46` | ✅ | — | |
| `partyMemberGetDescription` | `loadPartyDescs().find(pid)` (`party.ts:112`) | ✅ | — | CE skips `[Party Member 0]` (the dude); irrelevant in DH2. |
| `partyMemberDescriptionInit` | `party.ts:61` defaults | ✅ | — | |
| `partyMemberAdd` | `party.ts:92 addPartyMember` ← `scripting.ts:3211 party_add` | ⚠️ | LOW | Duplicate / table-limit rules and team 0 ✅. Missing `queueRemoveEventsByType(obj, EVENT_TYPE_SCRIPT)` (pending script timers of the recruit keep firing) and `_gdialogUpdatePartyStatus`. Object id / NO_SAVE flags N/A (DH2 save model). |
| `partyMemberRemove` | `party.ts:145 dismissPartyMember` ← `scripting.ts:3215 party_remove` | ⚠️ | HIGH | Removing via the opcode ✅ (team unchanged as CE). Missing timer removal (LOW). **Not called on death** (CE `critter.cc critterKill`, `combat.cc` kill path) — PTY-01. |
| `_partyMemberPrepSave`, `_partyMemberUnPrepSave`, `partyMembersSave`, `_partyMemberPrepLoad`, `_partyMemberPrepLoadInstance`, `_partyMemberRecoverLoad`, `_partyMemberRecoverLoadInstance`, `partyMembersLoad`, `_partyMemberClear` | `party.ts:172 serialize / deserialize / serializeLevels`, `saveload.ts:195,382` | 🚫 N/A | — | Different save model (objects with script + LVARs serialised, M10). Level-up info saved ✅. |
| `_partyMemberSyncPosition` | `GameMap.ts:317 placeParty` | ✅ | — | Rotation +4 / +2 alternating, distance 1,1,2,2… via `_objPMAttemptPlacement`; hidden / non-critter skipped ✅. (Dead members are placed too — PTY-01.) |
| `_partyMemberRestingHeal` | `ui_pipboy/shell.ts addHealth`, `worldmap/Worldmap.ts:1088 partyRestingHeal` | ✅ | — | Dude + members heal Healing Rate per step ✅. |
| `partyMemberFindByPid` | `party.ts:168 getPartyMemberByPID` ← `party_member_obj` | ✅ | — | (Returns dead members — PTY-01.) |
| `_isPotentialPartyMember` | `party.ts:76 isPartyMemberPid` | ✅ | — | CE's own loop compares member *i* with pid *i* (a CE bug); DH2 does the intended list lookup. Not used for gameplay decisions in this scope. |
| `objectIsPartyMember` | `party.ts:164 isPartyMember` | ✅ | — | |
| `_getPartyMemberCount` | `scripting.ts:777 metarule 16` (`party.length`) | ⚠️ | HIGH | PTY-04. |
| `_partyMemberNewObjID`, `_partyMemberNewObjIDRecurseFind`, `_partyMemberPrepItemSaveAll`, `_partyMemberPrepItemSave`, `_partyMemberItemSave`, `_partyMemberItemRecover`, `_partyMemberClearItemList` | — | 🚫 N/A | — | Item-script preservation across map changes; DH2 keeps inventories (and their scripts) on the objects. |
| `partyMemberGetBestSkill` | inline in `playerUse.ts:85` | ✅ | — | Not shown on the control screen (PTY-05). |
| `partyMemberGetBestInSkill` | `playerUse.ts:77 skillPerformer` | ✅ | — | |
| `partyGetBestSkillValue` | `ui_barter/screen.ts:227`, `worldmap/encounters.ts:84 partyBestSkill` | ✅ | — | Counts dead members because of PTY-01. |
| `partyFixMultipleMembers` | (M10: party excluded from map snapshots) | 🟡 | — | No explicit doppelganger sweep; M10 removes the cause. |
| `_partyMemberSaveProtos` | — | 🚫 N/A | — | DH2 stores level-up stats on the critter object. |
| `partyMemberSupportsDisposition` | `ui_companion.ts:395 findSiblingPreview` | ⚠️ | MED | PTY-03 (ai.txt packet existence instead of party.txt). |
| `partyMemberSupportsAreaAttackMode`, `…RunAwayMode`, `…BestWeapon`, `…Distance`, `…AttackWho`, `…ChemUse` | — | ❌ | MED | PTY-03: every value selectable. |
| `_partyMemberIncLevels` | `party.ts:106 Party.incLevels` ← `player.ts:292` | ✅ | — | numLevelUps / levelMod / isEarly / `random(0,100) > 100·mod/every`, level_minimum, msg 9000 + individual 9000+10·idx+lvl−1 float ✅. |
| `_partyMemberCopyLevelInfo` | `party.ts:193 copyLevelInfo` | ✅ | — | SPECIAL (base+bonus) and skills only, Max HP not recomputed, healed to max, gear stays equipped ✅. |
| `partyIsAnyoneCanBeHealedByRest`, `partyGetMaxWoundToHealByRest` | `ui_pipboy/shell.ts:211 restHealableParty`, `:215 partyMaxWound` | ✅ | — | |
| `get_all_party_members_objects` (sfall) | `party.ts:160 getPartyMembersAndPlayer` | 🟡 | — | No dead / hidden filter variant. |

### Related CE code used by this scope (not in the four files)

| CE function | DH2 | Status | Sev | Notes |
|---|---|---|---|---|
| `interpreter_extra.cc opStartGameDialog` | `scripting.ts:2452` | ✅ | — | Head fidget from LVAR 0 via `reactionTranslateValue` ✅ (combat refusal: see `_gdialogInitFromScript`). |
| `opEndGameDialog` | `scripting.ts:2815 end_dialogue` | ✅ | — | |
| `opGameDialogReaction` | `scripting.ts:2739 dialogue_reaction` | ✅ | — | |
| `opGameDialogSystemEnter` | `scripting.ts:2840` | ✅ | — | |
| `combat_ai.cc aiSetDisposition` | `party.ts:231 setCompanionDisposition` | ✅ | — | Name lookup ≡ `packet_num − (disp − cur)` for all party packets checked (see doc error above). |
| `combat_ai.cc aiSetRunAwayMode` (min_hp) | `combat/Combat.ts:269 aiMinHp` | ⚠️ | HIGH | Table keyed by the wrong index — PTY-02. |
| `combat_ai.cc aiSave` (custom packets) | `Critter.customAiOverrides` (saved) | ⚠️ | LOW | PTY-06. |

## Detailed findings

### PTY-01 — Dead party members stay in the party — **FIXED 2026-10-24 (PA12)**
- **CE:** `critter.cc critterKill` → `partyMemberRemove(critter)` (first thing it does); `combat.cc` kill path (`~:4881`) → `partyMemberRemove`. A dead companion leaves the party: not counted by `_getPartyMemberCount`, not placed on map change, its corpse stays on the map where it died.
- **DH2:** `globalState.gParty` is only changed by `party_add` / `party_remove` (`scripting.ts:3211-3219`) and save / reset; nothing in `critter/lifecycle.ts critterKill` or `Combat.ts` removes a dead member. Vanilla companion scripts don't call `party_remove` in `destroy_p_proc` (checked kcsulik, hcmarcus, nhmyron, ocgoris, gclenny, ian).
- **Impact:** after a companion dies (common), `metarule(16)` still counts it — the CHA cap blocks a replacement; `GameMap.changeElevation` / `placeParty` (`GameMap.ts:243-259, 317`) move the corpse to every new map and next to the player; `party_member_obj(PID)` still returns the corpse (scripts think e.g. Sulik is with you); dead skills still count in `partyBestSkill` (encounter avoidance, barter). Unverified in game.
- **Fix:** call `globalState.gParty.dismissPartyMember(critter)` at the start of `critterKill` (and the combat kill path), as CE.
- **Ref:** NEW.

### PTY-02 — Custom-screen values written wrongly (area attack, run away) — **FIXED 2026-10-24 (PA13)**
- **CE:** `game_dialog.cc:394-410 _custom_settings`: Always! → `AREA_ATTACK_MODE_ALWAYS`, Sometimes → `SOMETIMES`, … ; run-away entries store `RUN_AWAY_MODE_X − 1` = 0…5, and `aiSetRunAwayMode` sets `min_hp = maxHP − maxHP · _hp_run_away_value[i] / 100` with `{0, 25, 40, 60, 75, 100}`: Abject coward min_hp = max HP, finger hurts 75 %, bleeding 60 %, not feeling good 40 %, tourniquet 25 %, Never! 0.
- **DH2:** `ui_companion.ts:85-99 CUSTOM_OPTIONS`: "Always!" → `'sometimes'`, "Sometimes" → `'no_pref'`; run-away coward / finger_hurts / bleeding / not_feeling_good / **'none'** (for "You need a tourniquet") / never. `Combat.ts:262-275 aiMinHp` uses `{none:0, coward:25, finger_hurts:40, bleeding:60, not_feeling_good:75, tourniquet:100}` keyed by name, i.e. one CE step off: coward → min 75 %, finger → 60 %, bleeding → 40 %, not feeling good → 25 %, "tourniquet" (`none`) → min = max HP (flees at the first damage), "Never!" → not in the table → the packet's ai.txt `min_hp`.
- **Impact:** a companion told "Always" burst only sometimes, "Sometimes" uses the no-preference rule; run-away settings are all wrong, and the tourniquet setting is the opposite of what was chosen.
- **Fix:** store `'always'` / `'sometimes'`; map run-away labels to CE's percentage index (coward 0, finger 25, bleeding 40, not feeling 60, tourniquet 75, never 100) and compute `min_hp` from that index, with "tourniquet" stored as `'tourniquet'`.
- **Ref:** NEW.

### PTY-03 — Disposition / custom-value availability ignores party.txt — **FIXED 2026-10-25**
- **CE:** `partyMembersInit` parses every member's `disposition`, `area_attack_mode`, `run_away_mode`, `best_weapon`, `distance`, `attack_who`, `chem_use` lists; `partyMemberControlWindowInit` disables disposition buttons not in the list (`partyMemberSupportsDisposition`, `disposition[d + 1]`), `_gdCustomSelect` greys and refuses values not in the lists.
- **DH2:** `party.ts:50` parses only pid / level fields. `ui_companion.ts:365 supported = … || findSiblingPreview()` — true whenever ai.txt has `PARTY <NAME> <DISP>`, which every companion has for all five. `uiCustomCategoryPicker` offers every value.
- **Impact:** e.g. Marcus (party.txt: custom, aggressive, berserk; distance charge / on_your_own; run away tourniquet / never) can be made a Coward that snipes; Myron can go Berserk; Lenny Aggressive / Berserk; Goris Coward / Defensive.
- **Fix:** parse the seven lists in `loadPartyDescs` and port the seven `partyMemberSupports*` (note the `+1` index for disposition and run-away mode).
- **Ref:** NEW (companion_party.md §8.2 documents the ai.txt rule as if it were CE's).

### PTY-04 — `METARULE_PARTY_COUNT` is `party.length` — **FIXED 2026-10-24 (PA12)**
- **CE:** `_getPartyMemberCount` = `gPartyMembersLength` (dude included) minus members that are not critters, dead or hidden.
- **DH2:** `scripting.ts:776-777` returns `gParty.party.length` — dude not counted, the car trunk (`zicrtrnk` calls `party_add`) and dead / hidden members counted.
- **Impact:** companion scripts test `metarule(16) − GVAR_PLAYER_GOT_CAR − 1 ≥ floor(CHA/2) + MP` (e.g. `kcsulik Node043`). Without a car DH2's value is one lower → one companion more than CE can join; with the car the trunk happens to replace the missing dude; dead (PTY-01) or hidden members wrongly count.
- **Fix:** `1 + members.filter(c => c.type === 'critter' && !c.dead && visible).length`.
- **Ref:** NEW (companion_party.md §1 states the CE rule but says DH2 is "the same").

### PTY-05 — Control screen readout — **FIXED 2026-10-25**
- **CE:** `partyMemberControlWindowUpdate`: right-hand item name (or proto.msg 10) at (112,20), armor at (112,49), standing SW sprite centred at (39,132), HP `cur/max` (240,96), best skill name (240,113), weight `inv/carry` (240,131, red when encumbered), melee damage (240,148), AP `cur/max` (240,167).
- **DH2:** `ui_companion.ts:326-342` — name, "Weapon:", "Armor:", "HP:", "Weight:", "Disposition:" labels at x 20, y 4…96; no sprite, best skill, melee damage or AP; weapon is `equippedWeapon` rather than the right-hand item.
- **Impact:** layout clashes with control.png's own captions; information missing.
- **Fix:** draw CE's eight fields at CE's positions (proto.msg 10 for "None", `skillGetName(partyMemberGetBestSkill)`).
- **Ref:** NEW.

### DLG-01 — Returning from Barter / Trade / Combat Control re-runs `talk_p_proc` — **FIXED 2026-10-24 (PA14)**
- **CE:** barter, trade and the control / customise screens run inside the dialogue loop (`_gdProcess` switch modes 3 / 9 / 12, `gameDialogTicker`). Afterwards `_dialogue_switch_mode = 1` re-creates the window and `gdUnhide` shows the *same* reply and options — including those the node set up right after `gdialog_mod_barter` (e.g. `gsay_reply(…); giq_option(… "Bye")`, `gsay_message("Thanks for your business")`). `talk_p_proc` runs once per conversation.
- **DH2:** `gdialog_mod_barter` opens barter immediately (`scripting.ts:2444`); `uiEndBarterMode`, `uiEndCompanionTrade` and the control screen's Talk all call `Scripting.reenterDialogue` (`scripting.ts:562`), which clears the options and calls `talk()` again. Because the first `talk_p_proc` is still suspended in `gsay_end` (`vm.ts ScriptVM.suspended`, `lua/prelude.ts suspended`), the second run suspends on top of it, and `resume()` later continues both (`vm.ts:441-476` loops until the stack is empty; Lua `__resume` likewise).
- **Impact:** in 64 vanilla scripts with `gdialog_mod_barter` the post-barter node is lost and the greeting starts over (re-greets, re-runs reaction / karma setup and any counters before `gsay_end`); the code after `gsay_end` (`end_dialogue`, post-talk actions) runs once per re-entry when the conversation ends. Unverified in game.
- **Fix:** keep the options / reply across the sub-screen (don't clear `dialogueOptionProcs` in `reenterDialogue`, just re-render them), and only call `talk` when there is no suspended dialogue — i.e. port CE's "return to the same node".
- **Ref:** P6 / P10 describe the re-entry design; the lost node and double tail are NEW.

### DLG-02 — `gsay_message` ends the dialogue; the following `gsay_end` suspends again — **FIXED 2026-10-25**
- **CE:** `_op_gsay_message` → `gameDialogSetMessageReply`, option (−2,−2 = proto.msg 650 "[Done]"), `_gdialogSayMessage` → `_gdialogGo` → a nested `_gdProcess`. Picking [Done] returns to the script inside the open dialogue; `gDialogReplyMessageListId = −1`, so a later `gsay_end` returns at once (`_gdialogGo: if (gDialogReplyMessageListId == -1) return 0`).
- **DH2:** `scripting.ts:2777-2799` adds a no-op `[Done]` and suspends; picking it → `dialogueReply` → no options → `dialogueExit` closes the UI and resumes. When the `gsay_message` was reached directly from `talk_p_proc` (36 scripts, e.g. `robctrl talk_p_proc`, `ccqmstr Node001` else-branch), the resumed code reaches `gsay_end`, which suspends again (`vm_bridge.ts:317`, `prelude.ts:180`) with no UI — `end_dialogue` and anything after it wait for the next dialogue end of that script, then run out of order. A `gsay_message` followed by more options in the same flow would lose them (no vanilla case found).
- **Fix:** don't close the UI on the gsay_message [Done]; just resume the suspended procedure. Track "reply pending" (set by `gsay_reply`, cleared by `gsay_message` / option pick) and make `gsay_end` return without suspending when no reply is pending.
- **Ref:** NEW (L2 fixed a related stack bug).

### DLG-03 — `gsay_end` with a reply but no options — **FIXED 2026-10-25**
- **CE:** `_gdialogGo` adds an implicit option (−1,−1): text proto.msg 655 ("Go on") for INT < 4, otherwise an empty entry; key 1 / click continues and ends the loop.
- **DH2:** nothing is added; the reply is shown with no option and the VM stays suspended (only Review is clickable). Vanilla nodes like `zark21` / `scenlone Node004` have no options but are reached from an option proc (ending the dialogue as CE does); a top-level case was not found, so impact is likely LOW. Unverified in game.
- **Fix:** in `gsay_end`, if a reply is pending and no options exist, add the CE implicit option.
- **Ref:** NEW.

### DLG-04 — No keyboard control in dialogue / companion screens — **FIXED 2026-10-25**
- **CE:** `_gdProcess`: keys `1`–`9` pick option *n* (also options without a button), `0` ignored (sfall fix), `B` = Barter button, Space / auto after 10 s next page of a long reply, ↑ / ↓ page back / forward, mouse wheel → arrows. Control screen W / A / D / Esc, customise Enter / Esc, picker Enter / Esc, review ↑ / ↓ / Esc.
- **DH2:** `input.ts:224-236` returns for any non-none UI mode and the dialogue has no key handler (`ui_dialogue.ts`); Esc exists only on the companion screens and the review.
- **Fix:** a keydown handler while `uiMode === dialogue` mapping `1`–`9` to `dialogueReply(n−1)` and `b` to the Barter button; W / A / D on the control screen; Enter on customise / picker.
- **Ref:** NEW.

### PTY-06 — Custom settings dropped on a disposition change (LOW) — **FIXED 2026-10-25**
- **CE:** custom values are stored in the companion's CUSTOM packet itself (`aiSet*` write `aiGetPacket`), saved by `aiSave`; switching to Aggressive and back to Custom restores them.
- **DH2:** `party.ts:246` clears `customAiOverrides` when a named disposition is chosen.
- **Ref:** NEW.
- **Fixed 2026-10-25:** a named disposition keeps the companion's Custom settings; they apply only while the custom packet is in use, so switching back restores them.

### DLG-07 — Camera not restored after dialogue (LOW) — **FIXED 2026-10-25**
- **CE:** `_gdialogExitFromScript` scrolls back to the centre tile saved at `gameDialogEnter` (or to the dude if he moved).
- **DH2:** `uiStartDialogue` centres on the speaker (`ui_dialogue.ts:166-181`); `uiEndDialogue` leaves the camera there.
- **Ref:** NEW.
- **Fixed 2026-10-25:** `uiStartDialogue` saves the centre tile and the dude's tile; `uiEndDialogue` centres back on it, or on the dude if he moved (no scroll animation).

## DH2-only behaviour

- `Scripting.reenterDialogue` (re-running `talk_p_proc` after a sub-screen) — DH2 mechanism, see DLG-01.
- Review window: draggable (`makePanelDraggable`), "(Nothing said yet.)" placeholder, opens scrolled to the newest entry.
- Companion customise screen: title line "<name> — Custom behavior"; picker is a floating modal with hard-coded English labels.
- Dialogue options can be clicked anywhere in their text row; all options are shown even if they don't fit CE's 117 px options window (scrollable).
- Talking-head transitions are asynchronous (the dialogue stays interactive while a reaction animation plays).
- `party.ts dismissPartyMember` returns a boolean and silently ignores non-members (CE `partyMemberRemove` returns −1 — same effect).
