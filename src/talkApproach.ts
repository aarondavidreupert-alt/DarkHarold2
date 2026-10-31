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

// How the dude gets to an NPC before talking. DH2 (default): he always walks up to it
// (known_bugs P15). [dh2] talk_mode=ce — CE actions.cc actionTalk: out of combat he stays
// where he is when the NPC is under 9 hexes away and in sight (_combat_is_shot_blocked),
// else runs up to it (animationRegisterRunToObject).

import { Config } from './config.js'
import { world } from './state/world.js'
import { hexDistance } from './geometry.js'
import { combatIsShotBlocked } from './combat/lineOfFire.js'
import type { Critter, Obj } from './object.js'
import { uiLog } from './messageLog.js'
import { getMessage } from './util.js'

// CE actions.cc _can_talk_to (a forced callback: it runs even when the walk failed) — still
// 9 or more hexes away, or out of sight: misc.msg 2000 "You cannot get there." and no talk
function canTalkTo(player: Critter, target: Obj): boolean {
    if (
        hexDistance(player.position, target.position) >= 9 ||
        combatIsShotBlocked(player, player.position, target.position, target).blocked
    ) {
        uiLog(getMessage('misc', 2000) ?? 'You cannot get there.')
        return false
    }
    return true
}

export function approachToTalk(player: Critter, target: Obj, talk: () => void): void {
    if (Config.engine.talkMode === 'ce' && !world.inCombat) {
        const near = hexDistance(player.position, target.position) < 9
        if (near && !combatIsShotBlocked(player, player.position, target.position, target).blocked) {
            talk()
            return
        }
    }
    const walked = player.walkInFrontOf(target.position, () => {
        player.clearAnim()
        if (canTalkTo(player, target)) talk()
    })
    if (!walked && canTalkTo(player, target)) talk()
}
