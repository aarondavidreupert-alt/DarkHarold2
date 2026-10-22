/*
Copyright 2026 DarkHarold2 contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// CE ref: game.cc gameReset — wipes all per-game state. CE runs it before NEW GAME
// (main.cc main_reset_system) and before reading a save (loadsave.cc _PrepLoad), so
// nothing of the previous game — seen movies (the tribal/jumpsuit look), GVARs,
// MVARs, worldmap, car, party, timers — leaks into the next one.

import { killCounts } from './critter.js'
import { sfallArraysReset } from './sfallArrays.js'
import { START_TICKS } from './gametime.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Scripting } from './scripting.js'
import { Worldmap } from './worldmap.js'
import { resetAutomap } from './automapData.js'
import { resetSkillUsage } from './skillUse.js'
import { removeAllGlobalScripts, sfallGlobalVarsReset } from './sfallGlobalScripts.js'
import { sfallHooksReset } from './sfallHooks.js'

export function gameReset(): void {
    // combatReset
    if (globalState.inCombat) globalState.combat?.forceEnd()
    globalState.inCombat = false
    globalState.combat = null

    Scripting.resetGameState()                // gameLoadGlobalVars, _scr_reset, scriptsReset, queueExit
    globalState.seenMovies = new Set()        // gameMoviesReset
    globalState.gameTickTime = START_TICKS    // gameTimeReset (via _scr_reset)
    globalState.eventLog = []
    globalState.dirtyMapCache = {}            // other maps' saved state
    killCounts.clear()                        // critterReset → killsReset
    resetSkillUsage()                         // skillsReset → skill_use_slot_clear
    globalState.gParty.deserialize([])        // partyMembersReset
    globalState.gParty.deserializeLevels(undefined)
    Worldmap.resetWorldmap()                  // wmWorldMap_reset
    Worldmap.resetEncounters()                // wmGenDataReset (didMeetFrankHorrigan)
    resetAutomap()                            // automapReset: the automap belongs to the game
    sfallArraysReset()                        // sfallArraysReset (CE game.cc gameReset)
    sfallGlobalVarsReset()                    // sfall_gl_vars_reset
    removeAllGlobalScripts()                  // sfall_gl_scr_reset
    sfallHooksReset()                         // (sfall: hooks belong to the global scripts)
    globalState.player?.resetForNewGame()     // stats/skills/perks/traits/_inven_reset_dude
    globalState.player?.updateNativeLook()    // _proto_dude_update_gender: tribal again
    dbg('saveload', '[gameReset] per-game state cleared')
}
