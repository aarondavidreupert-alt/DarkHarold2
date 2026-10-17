/*
Copyright 2014 darkf

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

// Right-click "what would you like to do?" context menu shown above an
// in-world Obj. Per object type/state, picks an appropriate set of action
// buttons (talk / use / look / pickup / loot) plus the always-visible
// inventory and skill (skilldex) buttons.

import { objExamine } from './examine.js'
import globalState from './globalState.js'
import { dbg, dbgWarn } from './logger.js'
import { Critter, Obj } from './object.js'
import { Scripting } from './scripting.js'
import { uiLog } from './ui_hud.js'
import { showInventoryUseOn } from './ui_inventory.js'
import { uiLoot } from './ui_loot.js'
import { closeSkilldex, showSkilldex } from './ui_skilldex.js'
import { playerUse } from './playerUse.js'
import { Skills } from './skills.js'
import { hexDirectionTo, hexDistance, hexInDirection } from './geometry.js'
import { toTileNum } from './tile.js'
import { UIMode, closeAllPanels, isSkilldexOpen } from './ui_panels.js'
import { $id, clearEl, makeEl } from './ui_dom.js'

export function uiHideContextMenu() {
    globalState.uiMode = UIMode.none
    globalState.cursorMode = 'move'
    $id('itemContextMenu').style.visibility = 'hidden'
}

export function uiContextMenu(obj: Obj, evt: any) {
    globalState.uiMode = UIMode.contextMenu

    function button(obj: Obj, action: string, onclick: (() => void) | undefined = undefined) {
        return makeEl('div', {
            id: 'context_' + action,
            classes: ['itemContextMenuButton'],
            click: () => {
                if (onclick) {
                    onclick()
                }
                uiHideContextMenu()
            },
        })
    }

    const $menu = $id('itemContextMenu')
    clearEl($menu)
    // #itemContextMenu lives inside #uiStage, which is centered via
    // transform: translate(-50%, -50%). Convert viewport-relative click
    // coords to the stage's local frame so the menu appears under the
    // cursor regardless of viewport size. (Same transform as
    // makeItemContextMenu below.)
    const stage = document.getElementById('uiStage')
    const rect = stage?.getBoundingClientRect()
    const lx = rect ? evt.clientX - rect.left : evt.clientX
    const ly = rect ? evt.clientY - rect.top : evt.clientY
    Object.assign($menu.style, {
        visibility: 'visible',
        left: `${lx}px`,
        top: `${ly}px`,
    })
    const player = globalState.player as Critter
    const add = (action: string, fn?: () => void) => $menu.appendChild(button(obj, action, fn))

    // CE: LOOK → _obj_examine (proto_instance.cc _obj_examine_func)
    const look = () => { for (const line of objExamine(player, obj)) uiLog(line) }
    // CE: INVENTORY → inventoryOpenUseItemOn(target)
    const inventory = () => showInventoryUseOn(obj)
    // CE: USE_SKILL → skilldexOpen, then actionUseSkill(gDude, target, skill)
    const skill = () => {
        if (isSkilldexOpen()) { closeSkilldex(); return }
        closeAllPanels()
        showSkilldex((sk: Skills) => {
            globalState.uiMode = UIMode.useSkill
            globalState.skillMode = sk
            playerUse(obj)
        })
    }
    const talk = () => {
        // CE actions.cc actionTalk — walk up to the critter, then its talk_p_proc
        if (!obj._script) { dbgWarn('dialogue', '[Dialog] obj has no script'); return }
        player.walkInFrontOf(obj.position, () => {
            player.clearAnim()
            dbg('dialogue', '[Dialog] talking to ' + obj.name)
            Scripting.talk(obj._script!, obj)
        })
    }
    const use = () => {
        player.walkInFrontOf(obj.position, () => {
            player.clearAnim()
            obj.use(player)
        })
    }

    // CE game_mouse.cc gameMouseHandleActionMenu — the icons per object type
    const critter = obj.type === 'critter' ? obj as Critter : null
    if (obj.type === 'item') {
        // ITEM: USE (actionPickUp) LOOK [INVENTORY SKILL for containers] CANCEL
        add('use', obj.isContainer ? use : () => obj.pickup(player))
        add('look', look)
        if (obj.isContainer) { add('inventory', inventory); add('skill', skill) }
    } else if (critter) {
        if (critter === player) {
            add('rotate', () => { player.orientation = (player.orientation + 1) % 6 }) // objectRotateClockwise
        } else {
            if (objActionCanTalkTo(critter)) {
                if (!globalState.inCombat) add('talk', talk)
            } else if ((critterProtoFlags(critter) & CRITTER_NO_STEAL) === 0) {
                add('use', () => uiLootWalk(critter)) // _action_loot_container
            }
            if (actionCheckPush(player, critter)) add('push', () => actionPush(player, critter))
        }
        add('look', look)
        add('inventory', inventory)
        add('skill', skill)
    } else if (obj.type === 'scenery') {
        if (obj.canUse) add('use', use)
        add('look', look)
        add('inventory', inventory)
        add('skill', skill)
    } else if (obj.type === 'wall') {
        add('look', look)
        if (obj.canUse) add('inventory', inventory)
    } else {
        add('look', look)
    }
    add('cancel')
}

// CE critter.h CRITTER_NO_STEAL
const CRITTER_NO_STEAL = 0x20
function critterProtoFlags(c: Critter): number {
    return ((c.pro as any)?.extra?.flags ?? 0) >>> 0
}

// CE object.cc _obj_action_can_talk_to: a critter that is active (alive, not knocked
// out or down).
function objActionCanTalkTo(c: Critter): boolean {
    return !c.dead && !c.isKnockedDown && ((c.injuryFlags ?? 0) & 0x01) === 0 // DAM_KNOCKED_OUT
}

// CE actions.cc _action_loot_container: walk (run from 5 hexes) to it, then loot.
function uiLootWalk(target: Obj): void {
    const player = globalState.player as Critter
    player.walkInFrontOf(target.position, () => {
        player.clearAnim()
        uiLoot(target)
    })
}

// CE actions.cc actionCheckPush: a different, active critter in talking range whose
// script has push_p_proc; in combat not an ally the pusher hit, nor one whose attacker
// is on the pusher's team.
function actionCheckPush(pusher: Critter, target: Critter): boolean {
    if (pusher === target || !objActionCanTalkTo(target)) return false
    if (hexDistance(pusher.position, target.position) > 12) return false // _action_can_talk_to
    if (!target._script || target._script.push_p_proc === undefined) return false
    if (globalState.inCombat) {
        const whoHitPusher = (pusher as any).whoHitMe
        if (target.teamNum === pusher.teamNum && target === whoHitPusher) return false
        const whoHitTarget = (target as any).whoHitMe as Critter | null
        if (whoHitTarget && whoHitTarget.teamNum === pusher.teamNum) return false
    }
    return true
}

// CE actions.cc actionPush: push_p_proc (unless it overrides), then the target steps
// one hex away from the pusher — straight on, else turning ±1, ±2, 3.
function actionPush(pusher: Critter, target: Critter): void {
    if (!actionCheckPush(pusher, target)) return
    if (Scripting.push(target, pusher)) return
    const map = globalState.gMap
    if (!map) return
    const rotation = hexDirectionTo(pusher.position, target.position)
    for (const turn of [0, 1, 5, 2, 4, 3]) {
        const dest = hexInDirection(target.position, (rotation + turn) % 6)
        if (map.blockingObjectAt(toTileNum(dest), target.elevation ?? map.currentElevation, 0, target) !== null) continue
        target.orientation = hexDirectionTo(target.position, dest)
        target.walkTo(dest, false)
        return
    }
}
