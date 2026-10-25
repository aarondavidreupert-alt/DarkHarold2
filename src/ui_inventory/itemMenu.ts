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

// CE inventory.cc inventoryWindowOpenContextMenu: the item action menu of the inventory,
// loot (and steal) and trade windows — which actions an item gets, and the menu itself.

import globalState from '../globalState.js'
import { Obj, createObjectWithPID } from '../object.js'
import { objExamine } from '../examine.js'
import { uiLog } from '../ui_hud.js'
import { $id, clearEl, hidev } from '../ui_dom.js'
import { ammoGetCapacity, ammoGetQuantity, ammoSetQuantity, weaponCanBeUnloaded, weaponGetAmmoTypePid } from '../weaponAmmo.js'

export type ItemMenuAction = 'look' | 'use' | 'drop' | 'unload' | 'cancel'

// CE _proto_action_can_use / _proto_action_can_use_on (extendedFlags 0x0800 / 0x1000;
// drugs can always be used on someone); a lit flare or an armed explosive can't be used
function canUseOrUseOn(item: Obj): boolean {
    if (item.pid === 205 || item.pid === 206 || item.pid === 209) return false // lit flare, armed explosives
    const flags = (item.pro?.extra as any)?.weaponFlags ?? 0
    return (flags & 0x08) !== 0 || (flags & 0x10) !== 0 || item.subtype === 'drug' || item.canUse
}

/** CE's action set for an item: `normal` is the inventory window (the dude's items, `inSlot`
 *  for a hand or the armor), otherwise a loot / trade window, where `ownerIsDude` tells the
 *  dude's own items from the other side's. */
export function itemMenuActions(item: Obj, normal: boolean, ownerIsDude: boolean, inSlot = false): ItemMenuAction[] {
    if (item.subtype === 'weapon' && weaponCanBeUnloaded(item)) {
        return !normal && !ownerIsDude ? ['look', 'unload', 'cancel'] : ['look', 'unload', 'drop', 'cancel'] // _act_weap2 / _act_weap
    }
    if (!normal) {
        // (A container's USE enters it — CE _container_enter — which DH2 doesn't have yet.)
        return ownerIsDude ? ['look', 'drop', 'cancel'] : ['look', 'cancel'] // _act_no_use / _act_nothing
    }
    // a container in the list opens with USE (_container_enter); in a hand it can't
    if (item.subtype === 'container') return inSlot ? ['look', 'drop', 'cancel'] : ['look', 'use', 'drop', 'cancel']
    return canUseOrUseOn(item) ? ['look', 'use', 'drop', 'cancel'] : ['look', 'drop', 'cancel'] // _act_use / _act_no_use
}

/** CE GAME_MOUSE_ACTION_MENU_ITEM_LOOK outside the inventory window: _obj_examine_func to
 *  the message window */
export function examineToLog(item: Obj): void {
    const player = globalState.player
    if (!player) return
    for (const line of objExamine(player, item)) uiLog(line)
}

/** CE GAME_MOUSE_ACTION_MENU_ITEM_UNLOAD → item.cc weaponUnload, repeated: one box at a time
 *  holding up to a box's rounds, each given to the weapon's owner; the weapon keeps its
 *  ammo type. */
export function unloadWeapon(weapon: Obj, giveAmmo: (ammo: Obj) => void): void {
    const ammoPid = weaponGetAmmoTypePid(weapon)
    if (ammoPid <= 0) return
    while (ammoGetQuantity(weapon) > 0) {
        const ammo = createObjectWithPID(ammoPid)
        const rounds = ammoGetQuantity(weapon)
        const capacity = ammoGetCapacity(ammo)
        if (capacity <= 0) break
        ammoSetQuantity(ammo, Math.min(rounds, capacity))
        ammoSetQuantity(weapon, Math.max(0, rounds - capacity))
        giveAmmo(ammo)
    }
}

/** The action menu at the mouse (#itemContextMenu); `run` gets the picked action (Cancel and
 *  clicks elsewhere just close it). */
export function showItemMenu(e: MouseEvent, actions: ItemMenuAction[], run: (action: ItemMenuAction) => void): void {
    const $menu = $id('itemContextMenu')
    clearEl($menu)
    // #itemContextMenu lives inside #uiStage (centered with a transform): stage-local coords
    const stage = document.getElementById('uiStage')
    const rect = stage?.getBoundingClientRect()
    Object.assign($menu.style, {
        visibility: 'visible',
        left: `${rect ? e.clientX - rect.left : e.clientX}px`,
        top: `${rect ? e.clientY - rect.top : e.clientY}px`,
    })
    const close = () => {
        hidev($menu)
        document.removeEventListener('mousedown', outside, true)
    }
    const outside = (ev: MouseEvent) => { if (!$menu.contains(ev.target as Node)) close() }
    document.addEventListener('mousedown', outside, true)
    for (const action of actions) {
        const btn = document.createElement('div')
        btn.id = 'context_' + action
        btn.className = 'itemContextMenuButton'
        btn.onclick = () => {
            close()
            if (action !== 'cancel') run(action)
        }
        $menu.appendChild(btn)
    }
}
