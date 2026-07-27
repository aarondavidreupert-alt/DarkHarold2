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
// ui_inventory.ts. See wiki/ts-split-refactor.md → "Per-file split
// proposals" §8.

import globalState from '../globalState.js'
import { refreshStealthState } from '../miscItem.js'
import { Obj, cloneItem } from '../object.js'
import type { Critter } from '../object.js'
import { lookupArt } from '../pro.js'
import { Scripting } from '../scripting.js'
import { uiGetAmount } from '../ui_barter/swap.js'
import { drawAC, uiDrawWeapon, uiLog } from '../ui_hud.js'
import { showInventory } from './panel.js'

export function makeDropTarget($el: HTMLElement, dropCallback: (data: string, e?: DragEvent) => void | Promise<void>) {
    $el.ondrop = (e: DragEvent) => {
        const data = e.dataTransfer.getData('text/plain')
        dropCallback(data, e)
        return false
    }
    $el.ondragenter = () => false
    $el.ondragover = () => false
}

export function makeDraggable($el: HTMLElement, data: string, endCallback?: () => void) {
    $el.setAttribute('draggable', 'true')
    $el.ondragstart = (e: DragEvent) => {
        e.dataTransfer.setData('text/plain', data)
        console.log('[UI] start drag')
    }
    $el.ondragend = (e: DragEvent) => {
        if (e.dataTransfer.dropEffect !== 'none') {
            //$(this).remove()
            endCallback && endCallback()
        }
    }
}

/**
 * Try to load ammoObj into weaponObj.
 * Compatibility: ammo pid must match weapon.pro.extra.ammoPID (or weapon is unloaded).
 * Returns true if at least one round was loaded.
 */
export function tryLoadAmmoIntoWeapon(ammoObj: Obj, weaponObj: Obj): boolean {
    const w = weaponObj as any
    const a = ammoObj as any
    const maxAmmo: number = w.pro?.extra?.maxAmmo ?? 0
    const currentRounds: number = w.pro?.extra?.rounds ?? 0
    const weaponAmmoPID: number | undefined = w.pro?.extra?.ammoPID
    if (maxAmmo <= 0 || currentRounds >= maxAmmo) return false
    // Compatibility: ammoPID must match (or weapon is empty and has no type yet)
    if (weaponAmmoPID && weaponAmmoPID !== a.pid) return false
    const needed = maxAmmo - currentRounds
    const available: number = a.amount ?? 1
    const toLoad = Math.min(needed, available)
    w.pro.extra.rounds = currentRounds + toLoad
    w.pro.extra.ammoPID = a.pid // record which ammo type is now loaded
    a.amount = available - toLoad
    const ammoIdx = globalState.player.inventory.indexOf(ammoObj)
    if (a.amount <= 0 && ammoIdx !== -1) globalState.player.inventory.splice(ammoIdx, 1)
    uiLog(`Loaded ${toLoad} round${toLoad !== 1 ? 's' : ''}.`)
    const soundId: string = w.pro?.extra?.soundId ?? ''
    if (soundId) globalState.audioEngine.playWeaponSfx(soundId, 'reload')
    return true
}

// TODO: Rewrite this sanely (and not directly modify the player object's properties...)
export async function uiMoveSlot(data: string, target: string) {
    const playerUnsafe = globalState.player as any
    let obj = null

    if (data[0] === 'i') {
        if (target === 'inventory') {
            return
        } // disallow inventory -> inventory

        const idx = parseInt(data.slice(1))
        console.log('[UI] inventory idx: ' + idx)
        obj = globalState.player.inventory[idx]

        // CE ref: inventory.cc — armor slot only accepts armor items
        if (target === 'armor' && obj.subtype !== 'armor') return

        // Drag-drop reload: ammo from inventory dropped onto a hand slot with a weapon
        if ((target === 'leftHand' || target === 'rightHand') && playerUnsafe[target]) {
            if (tryLoadAmmoIntoWeapon(obj, playerUnsafe[target] as Obj)) {
                uiDrawWeapon()
                showInventory()
                return
            }
        }

        if (obj.amount > 1) {
            const wanted = await uiGetAmount(obj)
            if (wanted <= 0) return
            if (wanted < obj.amount) {
                // Partial split: leave remainder in inventory, equip a clone
                const split = cloneItem(obj)
                split.amount = wanted
                obj.amount -= wanted
                obj = split
                // inventory entry stays — only count was reduced above
            } else {
                globalState.player.inventory.splice(idx, 1)
            }
        } else {
            globalState.player.inventory.splice(idx, 1)
        }
    } else {
        obj = playerUnsafe[data]
        playerUnsafe[data] = null // remove object from slot
    }

    console.log(`[UI] drop target: obj=${obj} data=${data} target=${target}`)

    if (target === 'inventory') {
        globalState.player.inventory.push(obj)
    } else {
        if (playerUnsafe[target] !== undefined && playerUnsafe[target] !== null) {
            // perform a swap
            if (data[0] === 'i') {
                globalState.player.inventory.push(playerUnsafe[target])
            } // inventory -> slot
            else {
                playerUnsafe[data] = playerUnsafe[target]
            } // slot -> slot
        }

        playerUnsafe[target] = obj // move the object over

        // CE ref: inventory.cc:4494 — SCRIPT_PROC_PICKUP fires when the player
        // equips an item from the inventory screen (in addition to ground pickup).
        if ((target === 'leftHand' || target === 'rightHand') && obj?._script && globalState.player) {
            try { Scripting.pickup(obj, globalState.player) } catch (_e) { /* ignore */ }
        }
    }

    // Update armor appearance if armor slot changed
    if (target === 'armor' || data === 'armor') {
        if (target === 'armor' && obj) {
            const fid: number = globalState.player.gender === 'female'
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
        drawAC(globalState.player.getStat('AC') + armorAC)
    }

    // CE ref: item.cc:353 itemAdd() stealthBoyTurnOn / item.cc:449 stealthBoyTurnOff —
    // recompute stealthActive whenever a hand slot changes (equip, unequip, or swap).
    if (
        target === 'leftHand' || target === 'rightHand' ||
        data === 'leftHand' || data === 'rightHand'
    ) {
        refreshStealthState(globalState.player as unknown as Critter)
    }

    uiDrawWeapon()
    showInventory()
}

// Apply or remove armor appearance — updates player.art to the armor's critter base art
export function applyArmorArt(armor: Obj | null) {
    const playerAny = globalState.player as any
    if (armor?.pro?.extra) {
        const fid: number =
            globalState.player.gender === 'female'
                ? armor.pro.extra.femaleFID
                : armor.pro.extra.maleFID
        if (fid && fid !== 0) {
            try {
                const armorArt = lookupArt(fid)
                if (armorArt) {
                    if (!playerAny._baseArt) {
                        playerAny._baseArt = globalState.player.art
                    }
                    globalState.player.art = armorArt
                    return
                }
            } catch (e) {
                console.warn('[UI] applyArmorArt: lookupArt failed for fid', fid, e)
            }
        }
    }
    // No armor or no valid FID — restore original art
    if (playerAny._baseArt) {
        globalState.player.art = playerAny._baseArt
        playerAny._baseArt = null
    }
}
