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

// Using an item *on* something — CE proto.cc _proto_action_can_use_on, the HUD's
// use crosshair (interface.cc _intface_use_item → GAME_MOUSE_MODE_USE_CROSSHAIR,
// game_mouse.cc:1019) and proto_instance.cc _obj_use_item_on /
// _protinst_use_item_on / _protinst_default_use_item.

import { useDrug } from './drugs.js'
import { hexDistance, hexNeighbors } from './geometry.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Critter, Obj } from './object.js'
import { Scripting } from './scripting.js'
import { skillUse } from './skillUse.js'
import { drawAP, drawHP, uiDrawWeapon } from './ui_hud.js'
import { uiLog } from './ui.js'
import { getProtoMsg, getRandomInt } from './util.js'
import { Config } from './config.js'

const PROTO_ID_FIRST_AID_KIT = 47
const PROTO_ID_DOCTORS_BAG = 91
const PROTO_ID_FIELD_MEDIC_FIRST_AID_KIT = 408
const PROTO_ID_PARAMEDICS_BAG = 409

// CE itemGetActionPointCost — a non-weapon item costs 2 AP.
const USE_ITEM_AP = 2

// The item waiting for its target while the use crosshair is active.
let pendingItem: Obj | null = null

// CE proto.cc _proto_action_can_use_on — extendedFlags 0x1000 ("use on"; byte 3 of
// the PRO flagsExt = DH2's weaponFlags 0x10) or any drug.
export function itemCanUseOn(item: Obj): boolean {
    const extra: any = item.pro?.extra
    if (!extra) return false
    if (((extra.weaponFlags ?? 0) & 0x10) !== 0) return true
    return item.type === 'item' && item.subtype === 'drug'
}

// interface.cc _intface_use_item — USE_CROSSHAIR cursor for `item`.
export function beginUseItemOn(item: Obj): void {
    pendingItem = item
    globalState.cursorMode = 'useItem'
}

export function cancelUseItemOn(): void {
    pendingItem = null
    if (globalState.cursorMode === 'useItem') globalState.cursorMode = 'move'
}

// game_mouse.cc:1019 — a click in use-crosshair mode: use the item on the object
// under the cursor (in combat only with 2 AP), then back to the move cursor either way.
export function usePendingItemOn(target: Obj | null): void {
    const item = pendingItem
    pendingItem = null
    globalState.cursorMode = 'move'
    const player = globalState.player as unknown as Critter
    if (!item || !target || !player) return

    if (globalState.inCombat) {
        const ap = player.AP
        if (!ap || ap.getAvailableCombatAP() < USE_ITEM_AP) {
            uiLog(getProtoMsg(700) ?? "You don't have enough action points.")
            return
        }
    }

    const act = () => {
        if (globalState.inCombat) {
            player.AP?.subtractCombatAP(USE_ITEM_AP)
            if (player.AP) drawAP(player.AP.getAvailableCombatAP(), player.AP.getTotalMaxAP())
        }
        objUseItemOn(player, target, item)
    }

    // actions.cc _action_use_an_item_on_object — walk next to the target first.
    if (target === player || Config.engine.doInfiniteUse === true || hexDistance(player.position, target.position) <= 1) {
        act()
        return
    }
    const map = globalState.gMap!
    let dest: { x: number; y: number } | null = null
    let best = Infinity
    for (const n of hexNeighbors(target.position)) {
        if (map.recalcPath(player.position, n).length > 0) {
            const d = hexDistance(player.position, n)
            if (d < best) { best = d; dest = n }
        }
    }
    if (!dest) {
        uiLog("Can't reach that.")
        return
    }
    if (globalState.inCombat) {
        const moveAP = player.AP?.getAvailableMoveAP() ?? 0
        if (!player.walkTo(dest, Config.engine.doAlwaysRun, () => { player.clearAnim(); act() }, moveAP)) {
            uiLog("Can't reach that.")
            return
        }
        player.AP?.subtractMoveAP(player.path.path.length - 1)
    } else {
        player.walkTo(dest, Config.engine.doAlwaysRun, () => { player.clearAnim(); act() })
    }
}

function removeOne(user: Critter, item: Obj): void {
    const idx = user.inventory.indexOf(item)
    if (idx !== -1) {
        if (item.amount > 1) item.amount--
        else user.inventory.splice(idx, 1)
        return
    }
    const u = user as any
    if (item.amount > 1) { item.amount--; return }
    if (u.leftHand === item) u.leftHand = undefined
    else if (u.rightHand === item) u.rightHand = undefined
}

// proto_instance.cc _obj_use_item_on — rc 1 = the item is used up.
export function objUseItemOn(user: Critter, target: Obj, item: Obj): number {
    let rc = protinstUseItemOn(user, target, item)
    if (rc === 1) {
        removeOne(user, item)
        if (user.isPlayer) uiDrawWeapon()
        rc = 0
    }
    globalState.gMap?.updateMap() // scriptsExecMapUpdateProc
    return rc
}

// proto_instance.cc _protinst_use_item_on
function protinstUseItemOn(user: Critter, target: Obj, item: Obj): number {
    let messageId = -1
    let criticalChanceModifier = 0
    let skill: 'First Aid' | 'Doctor' | null = null
    switch (item.pid) {
        case PROTO_ID_DOCTORS_BAG: messageId = 900; criticalChanceModifier = 20; skill = 'Doctor'; break
        case PROTO_ID_FIRST_AID_KIT: messageId = 901; criticalChanceModifier = 20; skill = 'First Aid'; break
        case PROTO_ID_PARAMEDICS_BAG: messageId = 910; criticalChanceModifier = 40; skill = 'Doctor'; break
        case PROTO_ID_FIELD_MEDIC_FIRST_AID_KIT: messageId = 911; criticalChanceModifier = 40; skill = 'First Aid'; break
    }

    if (skill === null) {
        // Item script first (use_obj_on_p_proc with target_obj = target), then the
        // target's own use_obj_on_p_proc (target_obj = item); unless one overrides,
        // the engine default applies.
        if (Scripting.useObjOnItem(item, user, target)) return 0
        if (Scripting.useObjOnMe(target, item, user)) return 0
        return defaultUseItem(user, target, item)
    }

    if (globalState.inCombat) {
        if (user.isPlayer) uiLog(getProtoMsg(902) ?? 'You cannot do that in combat.')
        return -1
    }
    if (target.type !== 'critter') {
        if (user.isPlayer) uiLog(getProtoMsg(582) ?? 'That does nothing.')
        return -1
    }
    const result = skillUse(user, target as Critter, skill, criticalChanceModifier)
    if (user.isPlayer) uiLog(result.message)
    if (result.hpHealed > 0 && (target as Critter).isPlayer) drawHP((target as Critter).getStat('HP'))
    if (result.blocked) return 0 // CE skillUse != 0 → the kit isn't touched
    if (getRandomInt(1, 10) !== 1) return 0
    if (user.isPlayer) uiLog(getProtoMsg(messageId) ?? 'The supplies run out.')
    return 1
}

// proto_instance.cc _protinst_default_use_item
function defaultUseItem(user: Critter, target: Obj, item: Obj): number {
    if (item.subtype === 'drug') {
        if (target.type !== 'critter') {
            if (user.isPlayer) uiLog(getProtoMsg(582) ?? 'That does nothing.')
            return -1
        }
        const critter = target as Critter
        if (critter.dead) {
            uiLog(getProtoMsg(583 + getRandomInt(0, 3)) ?? 'That won\'t work on the dead.')
            return -1
        }
        const rc = useDrug(item, critter) ? 1 : -1
        dbg('object', `[UseItemOn] ${item.name} on ${critter.name}: rc=${rc}`)
        if (user.isPlayer && critter !== (user as Critter)) {
            const fmt = getProtoMsg(581) ?? 'You use the %s on %s.'
            uiLog(fmt.replace('%s', item.name ?? 'item').replace('%s', critter.name ?? 'it'))
        }
        if (critter.isPlayer) drawHP(critter.getStat('HP'))
        return rc
    }
    // Not ported: power cells on the car (_obj_use_power_on_car), flares (_obj_use_flare).
    if (user.isPlayer) uiLog(getProtoMsg(582) ?? 'That does nothing.')
    return -1
}
