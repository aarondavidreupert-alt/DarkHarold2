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

// Inventory drag-and-drop primitives and slot mechanics, split out of
// uiInventory.ts. See wiki/ts-split-refactor.md → "Per-file split
// proposals" §8.

import { updateHandFlareLight } from '../object.js'
import { ammoSplitOff, ammoUseTopBox, weaponCanBeReloadedWith, weaponReload } from '../weaponAmmo.js'
import globalState from '../globalState.js'
import { dbg, dbgWarn } from '../logger.js'
import { refreshStealthState } from '../miscItem.js'
import { Obj, cloneItem } from '../object.js'
import type { Critter } from '../object.js'
import { armorPerkSwap } from '../perks.js'
import { lookupArt } from '../pro.js'
import { uiGetAmount } from '../uiBarter/swap.js'
import { drawAC, uiDrawWeapon } from '../uiHud.js'
import { showInventory } from './panel.js'
import { HOOK_INVENTORYMOVE, hasHook, runHook } from '../sfallHooks.js'

// True between a slot/inventory image's dragstart and its dragend. Guards
// against showInventory() (wired to the 'statsChanged' event — see panel.ts)
// tearing down and rebuilding the inventory DOM while the browser's native
// drag session is still tracking one of its <img> elements: removing the
// actively-dragged node mid-drag can leave that native session stuck, which
// silently swallows all further clicks until the page is reloaded.
export let dragInProgress = false

export function makeDropTarget($el: HTMLElement, dropCallback: (data: string, e?: DragEvent) => void | Promise<void>) {
    $el.ondrop = (e: DragEvent) => {
        const data = e.dataTransfer!.getData('text/plain')
        dropCallback(data, e)
        return false
    }
    $el.ondragenter = () => false
    $el.ondragover = () => false
}

export function makeDraggable($el: HTMLElement, data: string, endCallback?: () => void) {
    $el.setAttribute('draggable', 'true')
    $el.ondragstart = (e: DragEvent) => {
        e.dataTransfer!.setData('text/plain', data)
        dragInProgress = true
        dbg('inventory', '[UI] start drag')
    }
    $el.ondragend = (e: DragEvent) => {
        dragInProgress = false
        if (e.dataTransfer!.dropEffect !== 'none') {
            //$(this).remove()
            endCallback && endCallback()
        }
    }
}

// CE inventory.cc _container_enter / _container_exit: the list shows the innermost open bag
// (up to 9 levels deep); the dude's own inventory when none is open
const openContainers: Obj[] = []
export function inventoryList(): Obj[] {
    return openContainers.length > 0
        ? openContainers[openContainers.length - 1].inventory
        : globalState.player!.inventory
}
export function currentContainer(): Obj | null {
    return openContainers[openContainers.length - 1] ?? null
}
export function enterContainer(bag: Obj): void {
    if (openContainers.length < 9) openContainers.push(bag)
}
export function exitContainer(): void {
    openContainers.pop()
}
export function exitAllContainers(): void {
    openContainers.length = 0
}

/**
 * Try to load ammoObj into weaponObj.
 * Compatibility per CE item.cc weaponCanBeReloadedWith: same caliber, and a loaded
 * weapon only takes the ammo type already in it. Returns true if a round was loaded.
 */
// CE inventory.cc _inven_reload — with several boxes, the Move Items window asks how
// many; then weaponReload box after box until the weapon is full. No message; the
// weapon's READY sound on success.
export async function tryLoadAmmoIntoWeapon(ammoObj: Obj, weaponObj: Obj): Promise<boolean> {
    if (!weaponCanBeReloadedWith(weaponObj, ammoObj)) return false
    const inventory = inventoryList()
    const boxes = (ammoObj.amount ?? 1) > 1 ? await uiGetAmount(ammoObj) : 1
    if (boxes <= 0) return false
    let reloaded = false
    for (let i = 0; i < boxes; i++) {
        const rc = weaponReload(weaponObj, ammoObj)
        if (rc === -1) break
        reloaded = true
        if (rc !== 0) break
        const last = (ammoObj.amount ?? 1) <= 1
        ammoUseTopBox(ammoObj, inventory)
        if (last) break
    }
    if (!reloaded) return false
    const soundId = (weaponObj as any).pro?.extra?.soundID
    if (typeof soundId === 'number') globalState.audioEngine.playWeaponSfx(String.fromCharCode(soundId), 'reload')
    return true
}

// sfall HOOK_INVENTORYMOVE (sfallHooks.ts; not in CE): runs before the player moves an
// item between the backpack (0), the hands (1 left, 2 right) and the armor slot (3), or
// reloads a weapon by dropping ammo on it (4); a return other than -1 cancels the move.
function inventoryMoveHookCancels(target: string, item: Obj | null, replaced: Obj | null): boolean {
    if (!item || !hasHook(HOOK_INVENTORYMOVE)) return false
    const slot = ({ inventory: 0, leftHand: 1, rightHand: 2, armor: 3 } as { [k: string]: number })[target] ?? 0
    const reload = slot !== 0 && slot !== 3 && replaced !== null && item.subtype === 'ammo'
    const ret = runHook(HOOK_INVENTORYMOVE, [reload ? 4 : slot, item, replaced ?? 0])
    return ret.length > 0 && ret[0] !== -1
}

// TODO: Rewrite this sanely (and not directly modify the player object's properties...)
export async function uiMoveSlot(data: string, target: string) {
    const playerUnsafe = globalState.player as any
    const oldArmor = playerUnsafe.armor ?? null
    let obj = null

    if (data[0] === 'i') {
        if (target === 'inventory') {
            return
        } // disallow inventory -> inventory

        const idx = parseInt(data.slice(1))
        dbg('inventory', '[UI] inventory idx: ' + idx)
        obj = inventoryList()[idx]

        // CE ref: inventory.cc — armor slot only accepts armor items
        if (target === 'armor' && obj.subtype !== 'armor') return
        if (inventoryMoveHookCancels(target, obj, playerUnsafe[target])) return

        // Drag-drop reload: ammo from inventory dropped onto a hand slot with a weapon
        if ((target === 'leftHand' || target === 'rightHand') && playerUnsafe[target]) {
            if (await tryLoadAmmoIntoWeapon(obj, playerUnsafe[target] as Obj)) {
                uiDrawWeapon()
                showInventory()
                return
            }
            // CE inventory.cc _switch_hand: ammo on a weapon it can't load isn't swapped in
            if (obj.subtype === 'ammo' && playerUnsafe[target].subtype === 'weapon' && playerUnsafe[target].pid !== 383)
                return
        }

        if (obj.amount > 1) {
            const wanted = await uiGetAmount(obj)
            if (wanted <= 0) return
            if (wanted < obj.amount) {
                // Partial split: leave remainder in inventory, equip a clone
                const split = cloneItem(obj)
                split.amount = wanted
                obj.amount -= wanted
                ammoSplitOff(obj, split) // CE itemRemove: the top ammo box goes along
                obj = split
                // inventory entry stays — only count was reduced above
            } else {
                inventoryList().splice(idx, 1)
            }
        } else {
            inventoryList().splice(idx, 1)
        }
    } else {
        // CE inventory.cc:2440 — the armor slot accepts only armor, from any source (and a
        // swap may not put the other item there either)
        if (target === 'armor' && playerUnsafe[data]?.subtype !== 'armor') return
        if (
            data === 'armor' &&
            target !== 'inventory' &&
            playerUnsafe[target] &&
            playerUnsafe[target].subtype !== 'armor'
        )
            return
        if (inventoryMoveHookCancels(target, playerUnsafe[data], target === 'inventory' ? null : playerUnsafe[target]))
            return
        // CE _drop_into_container: an open bag takes it only within its capacity (itemAttemptAdd)
        const bag = currentContainer()
        if (
            target === 'inventory' &&
            bag &&
            playerUnsafe[data] &&
            !bag.canCarry(playerUnsafe[data], playerUnsafe[data].amount ?? 1)
        )
            return
        obj = playerUnsafe[data]
        playerUnsafe[data] = null // remove object from slot
    }

    dbg('inventory', `[UI] drop target: obj=${obj} data=${data} target=${target}`)

    if (target === 'inventory') {
        const bag = currentContainer()
        if (bag) bag.addInventoryItem(obj, obj.amount ?? 1)
        else globalState.player!.inventory.push(obj)
    } else {
        if (playerUnsafe[target] !== undefined && playerUnsafe[target] !== null) {
            // perform a swap
            if (data[0] === 'i') {
                inventoryList().push(playerUnsafe[target])
            } // inventory -> slot
            else {
                playerUnsafe[data] = playerUnsafe[target]
            } // slot -> slot
        }

        playerUnsafe[target] = obj // move the object over
        // (CE _inven_pickup / _switch_hand run no script proc when equipping.)
    }

    // Update armor appearance if armor slot changed
    if (target === 'armor' || data === 'armor') {
        armorPerkSwap(globalState.player!, oldArmor, playerUnsafe.armor ?? null)
        if (target === 'armor' && obj) {
            const fid: number =
                globalState.player!.gender === 'female'
                    ? (obj as any).pro?.extra?.femaleFID
                    : (obj as any).pro?.extra?.maleFID
            let armorSound = 'ltharmor'
            if (fid) {
                try {
                    const armorArt = lookupArt(fid) ?? ''
                    if (armorArt.includes('pwr')) armorSound = 'pwrarmor'
                    else if (armorArt.includes('mtl')) armorSound = 'mtlarmor'
                    else if (armorArt.includes('robe')) armorSound = 'robe'
                } catch {}
            }
            globalState.audioEngine.playSfxByName(armorSound)
        }
        applyArmorArt(target === 'armor' ? obj : null)
        const armorAC = (globalState.player as any).armor?.pro?.extra?.AC ?? 0
        drawAC(globalState.player!.getStat('AC') + armorAC)
    }

    // CE ref: item.cc:353 itemAdd() stealthBoyTurnOn / item.cc:449 stealthBoyTurnOff —
    // recompute stealthActive whenever a hand slot changes (equip, unequip, or swap).
    if (target === 'leftHand' || target === 'rightHand' || data === 'leftHand' || data === 'rightHand') {
        refreshStealthState(globalState.player as unknown as Critter)
        updateHandFlareLight(globalState.player as unknown as Critter) // inventory.cc _invenWieldFunc: a lit flare in hand
    }

    uiDrawWeapon()
    showInventory()
}

// Apply or remove armor appearance — updates player.art to the armor's critter base art
export function applyArmorArt(armor: Obj | null) {
    const playerAny = globalState.player as any
    if (armor?.pro?.extra) {
        const fid: number =
            globalState.player!.gender === 'female' ? armor.pro.extra.femaleFID : armor.pro.extra.maleFID
        if (fid && fid !== 0) {
            try {
                const armorArt = lookupArt(fid)
                if (armorArt) {
                    if (!playerAny._baseArt) {
                        playerAny._baseArt = globalState.player!.art
                    }
                    globalState.player!.art = armorArt
                    return
                }
            } catch (e) {
                dbgWarn('inventory', `[UI] applyArmorArt: lookupArt failed for fid ${fid}: ${e}`)
            }
        }
    }
    // No armor or no valid FID — restore original art
    if (playerAny._baseArt) {
        globalState.player!.art = playerAny._baseArt
        playerAny._baseArt = null
    }
}
