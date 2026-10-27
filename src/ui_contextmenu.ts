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
import { elevatorSpatialFor } from './elevatorUse.js'
import { Config } from './config.js'
import { approachToTalk } from './talkApproach.js'
import { pathfinderFindPath } from './map/pathfinder.js'

export function uiHideContextMenu() {
    globalState.uiMode = UIMode.none
    // CE: the mode stays ARROW after an action menu ([dh2] mouse_mode=ce); DH2 goes back to move
    globalState.cursorMode = Config.ui.mouseMode === 'ce' ? 'command' : 'move'
    $id('itemContextMenu').style.visibility = 'hidden'
}

// The actions behind the menu's icons (and CE's click actions, uiPrimaryAction).
function objectActions(obj: Obj) {
    const player = globalState.player as Critter
    return {
        // CE: LOOK → _obj_examine (proto_instance.cc _obj_examine_func)
        look: () => {
            for (const line of objExamine(player, obj)) uiLog(line)
        },
        // CE: INVENTORY → inventoryOpenUseItemOn(target)
        inventory: () => showInventoryUseOn(obj),
        // CE: USE_SKILL → skilldexOpen, then actionUseSkill(gDude, target, skill)
        skill: () => {
            if (isSkilldexOpen()) {
                closeSkilldex()
                return
            }
            closeAllPanels()
            showSkilldex((sk: Skills) => {
                globalState.uiMode = UIMode.useSkill
                globalState.skillMode = sk
                playerUse(obj)
            })
        },
        talk: () => {
            // CE actions.cc actionTalk — walk up to the critter, then its talk_p_proc
            if (!obj._script) {
                dbgWarn('dialogue', '[Dialog] obj has no script')
                return
            }
            approachToTalk(player, obj, () => {
                dbg('dialogue', '[Dialog] talking to ' + obj.name)
                Scripting.talk(obj._script!, obj)
            })
        },
        use: () => {
            player.walkInFrontOfToAct(
                obj.position,
                () => {
                    player.clearAnim()
                    obj.use(player)
                },
                3,
                obj.isLadder && obj.pro?.extra?.subType === 3 ? hexInDirection(obj.position, 2) : undefined,
            ) // CE _action_climb_ladder: from the SE neighbour
        },
        // CE actionPickUp: a container that can't be picked up is opened
        pickUp: () => {
            if (obj.canPickUp) obj.pickup(player)
            else objectActions(obj).use()
        },
        rotate: () => {
            player.orientation = (player.orientation + 1) % 6
        }, // objectRotateClockwise
    }
}

// CE game_mouse.cc _gmouse_handle_event (ARROW mode, button released before the menu opened):
// the object's primary action — pick up an item, rotate the dude, talk to a talkable critter
// (examine it in combat), loot any other critter, use usable scenery, else examine.
export function uiPrimaryAction(obj: Obj): void {
    const a = objectActions(obj)
    if (obj.type === 'item') a.pickUp()
    else if (obj.type === 'critter') {
        const c = obj as Critter
        if (c === globalState.player) {
            if (!c.anim || c.anim === 'idle') a.rotate()
        } else if (objActionCanTalkTo(c)) {
            if (globalState.inCombat) a.look()
            else a.talk()
        } else uiLootWalk(c)
    } else if (obj.type === 'scenery') {
        if (obj.canUse) a.use()
        else a.look()
    } else if (obj.type === 'wall') a.look()
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
    const { look, inventory, skill, talk, use, pickUp, rotate } = objectActions(obj)

    // CE game_mouse.cc gameMouseHandleActionMenu — the icons per object type
    const critter = obj.type === 'critter' ? (obj as Critter) : null
    if (obj.type === 'item') {
        // ITEM: USE (actionPickUp: a container that can't be picked up is opened) LOOK
        // [INVENTORY SKILL for containers] CANCEL
        add('use', pickUp)
        add('look', look)
        if (obj.isContainer) {
            add('inventory', inventory)
            add('skill', skill)
        }
    } else if (critter) {
        if (critter === player) {
            add('rotate', rotate)
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
        else {
            // [dh2] elevator_use: walk into the elevator, which runs its spatial script as
            // stepping in does (DH2 addition; CE has no Use on elevators)
            const spatial = elevatorSpatialFor(obj)
            if (spatial)
                add('use', () => {
                    player.walkTo({ ...spatial.position }, false)
                })
        }
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

// CE game_mouse.cc gameMouseRefresh (ARROW mode): the pointed object's primary action, whose
// icon the cursor shows — USE for items and usable scenery, TALK for a talkable critter out of
// combat, LOOK in combat / for walls / other scenery / no-steal critters, ROTATE for the dude
export function primaryActionIcon(obj: Obj): string {
    const icon = (name: string) => 'art/intrface/' + name
    if (obj.type === 'item') return icon('usegetn')
    if (obj.type === 'critter') {
        const c = obj as Critter
        if (c === globalState.player) return icon('rotaten')
        if (objActionCanTalkTo(c)) return icon(globalState.inCombat ? 'lookn' : 'talkn')
        return icon((critterProtoFlags(c) & CRITTER_NO_STEAL) !== 0 ? 'lookn' : 'usegetn')
    }
    if (obj.type === 'scenery') return icon(obj.canUse ? 'usegetn' : 'lookn')
    return icon('lookn')
}
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
    player.walkInFrontOfToAct(target.position, () => {
        player.clearAnim()
        uiLoot(target)
    })
}

// CE actions.cc actionCheckPush: a different, active critter in talking range whose
// script has push_p_proc; in combat not an ally the pusher hit, nor one whose attacker
// is on the pusher's team.
function actionCheckPush(pusher: Critter, target: Critter): boolean {
    if (pusher === target || !objActionCanTalkTo(target)) return false
    // _action_can_talk_to: a path that sight-blocking scenery / walls don't cut, then ≤ 12 hexes
    if (pathfinderFindPath(pusher, pusher.position, target.position, false, 'sight').length === 0) return false
    if (hexDistance(pusher.position, target.position) > 12) return false
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
        if (map.blockingObjectAt(toTileNum(dest), target.elevation ?? map.currentElevation, 0, target) !== null)
            continue
        target.orientation = hexDirectionTo(target.position, dest)
        // CE: in combat the pushed critter moves on its own AP (none left: it stays)
        if (globalState.inCombat && target.AP) {
            if (target.AP.getAvailableMoveAP() <= 0) return
            if (target.walkTo(dest, false, undefined, 1)) target.AP.subtractMoveAP(1)
            return
        }
        target.walkTo(dest, false)
        return
    }
}
