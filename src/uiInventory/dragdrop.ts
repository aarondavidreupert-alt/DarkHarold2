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

import { recordAction } from '../actionLog.js'
import { updateHandFlareLight } from '../object.js'
import { ammoSplitOff, ammoUseTopBox, weaponCanBeReloadedWith, weaponReload } from '../weaponAmmo.js'
import { world } from '../state/world.js'
import { services } from '../state/services.js'
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

// Item drag and drop for the inventory, loot, steal, barter and companion-trade windows.
// CE inventory.cc _inven_pickup: the dragged item's picture follows the mouse in place of the
// cursor until the button is let go over a slot or a list. The browser's native drag and drop
// showed the system's drag cursors (the copy mark, the "no entry" sign) — pages cannot style
// those — so the drag runs on mouse events: past a few pixels of movement the item's image
// follows the mouse, and the release over a drop target calls its handler.

// True while an item is being dragged. Guards against showInventory() (wired to the
// 'statsChanged' event — see panel.ts) rebuilding the inventory DOM under the drag.
export let dragInProgress = false

const DRAG_THRESHOLD = 4 // px of movement before a press becomes a drag (a click stays a click)
const dropTargets = new WeakSet<HTMLElement>()
const dropOutside = new WeakMap<HTMLElement, (x: number, y: number) => void>()

/** A drop target: `dropCallback` gets the dragged item's data. Its handler is the element's
 *  `ondrop`, so `off($el, 'drop')` (uiDom.ts) removes it. */
export function makeDropTarget($el: HTMLElement, dropCallback: (data: string, e?: DragEvent) => void | Promise<void>) {
    dropTargets.add($el)
    $el.ondrop = (e: DragEvent) => {
        const data = e.dataTransfer?.getData('text/plain') ?? ''
        void dropCallback(data, e)
        return false
    }
    $el.ondragenter = () => false
    $el.ondragover = () => false
}

/** What happens when a drag from `$el` is let go over no drop target ([dh2] inventory_drag_drop). */
export function setDropOutside($el: HTMLElement, callback: (x: number, y: number) => void): void {
    dropOutside.set($el, callback)
}

function dropTargetAt(x: number, y: number): HTMLElement | null {
    for (let n = document.elementFromPoint(x, y) as HTMLElement | null; n; n = n.parentElement) {
        if (dropTargets.has(n) && typeof n.ondrop === 'function') {
            return n
        }
    }
    return null
}

/** A draggable item image: `data` names the item for the drop target; `endCallback` runs after a
 *  drop on a target. */
export function makeDraggable($el: HTMLElement, data: string, endCallback?: () => void) {
    $el.setAttribute('draggable', 'false')
    $el.addEventListener('mousedown', (down: MouseEvent) => {
        if (down.button !== 0 || dragInProgress) {
            return
        }
        down.preventDefault() // no native image drag, no text selection
        const startX = down.clientX
        const startY = down.clientY
        let ghost: HTMLElement | null = null
        const place = (x: number, y: number): void => {
            if (ghost) {
                ghost.style.left = x - ghost.offsetWidth / 2 + 'px'
                ghost.style.top = y - ghost.offsetHeight / 2 + 'px'
            }
        }
        const move = (e: MouseEvent): void => {
            if (!ghost) {
                if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) {
                    return
                }
                dragInProgress = true
                dbg('inventory', '[UI] start drag')
                const r = $el.getBoundingClientRect()
                ghost = $el.cloneNode(true) as HTMLElement
                Object.assign(ghost.style, {
                    position: 'fixed',
                    width: r.width + 'px',
                    height: r.height + 'px',
                    margin: '0',
                    pointerEvents: 'none',
                    zIndex: '100000',
                })
                document.body.appendChild(ghost)
                document.body.classList.add('dh2ItemDrag')
            }
            place(e.clientX, e.clientY)
        }
        const up = (e: MouseEvent): void => {
            window.removeEventListener('mousemove', move, true)
            window.removeEventListener('mouseup', up, true)
            if (!ghost) {
                return // a click
            }
            // the release ends the drag only (as the native drag did: no mouseup reached the page)
            e.stopPropagation()
            e.preventDefault()
            ghost.remove()
            document.body.classList.remove('dh2ItemDrag')
            // the click that follows the release is not a click on the item
            window.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true })
            setTimeout(() => {
                dragInProgress = false
            }, 0)
            const target = dropTargetAt(e.clientX, e.clientY)
            if (target) {
                const drop = {
                    dataTransfer: { getData: () => data, dropEffect: 'move' },
                    clientX: e.clientX,
                    clientY: e.clientY,
                    preventDefault() {},
                    stopPropagation() {},
                } as unknown as DragEvent
                ;(target.ondrop as (ev: DragEvent) => unknown)(drop)
                endCallback?.()
            } else {
                dropOutside.get($el)?.(e.clientX, e.clientY)
            }
        }
        window.addEventListener('mousemove', move, true)
        window.addEventListener('mouseup', up, true)
    })
}

// CE inventory.cc _container_enter / _container_exit: the list shows the innermost open bag
// (up to 9 levels deep); the dude's own inventory when none is open
const openContainers: Obj[] = []
export function inventoryList(): Obj[] {
    return openContainers.length > 0 ? openContainers[openContainers.length - 1].inventory : world.player!.inventory
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
    if (typeof soundId === 'number') services.audioEngine.playWeaponSfx(String.fromCharCode(soundId), 'reload')
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
    const playerUnsafe = world.player as any
    // the action recorder (actionLog.ts): the item and where it goes (`d`: list index or slot)
    recordAction({
        t: 'invMove',
        item: data[0] === 'i' ? inventoryList()[parseInt(data.slice(1))] : playerUnsafe[data],
        d: data[0] === 'i' ? 'i' : data,
        to: target,
    })
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
        else world.player!.inventory.push(obj)
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
        armorPerkSwap(world.player!, oldArmor, playerUnsafe.armor ?? null)
        if (target === 'armor' && obj) {
            const fid: number =
                world.player!.gender === 'female'
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
            services.audioEngine.playSfxByName(armorSound)
        }
        applyArmorArt(target === 'armor' ? obj : null)
        const armorAC = (world.player as any).armor?.pro?.extra?.AC ?? 0
        drawAC(world.player!.getStat('AC') + armorAC)
    }

    // CE ref: item.cc:353 itemAdd() stealthBoyTurnOn / item.cc:449 stealthBoyTurnOff —
    // recompute stealthActive whenever a hand slot changes (equip, unequip, or swap).
    if (target === 'leftHand' || target === 'rightHand' || data === 'leftHand' || data === 'rightHand') {
        refreshStealthState(world.player as unknown as Critter)
        updateHandFlareLight(world.player as unknown as Critter) // inventory.cc _invenWieldFunc: a lit flare in hand
    }

    uiDrawWeapon()
    showInventory()
}

// Apply or remove armor appearance — updates player.art to the armor's critter base art
export function applyArmorArt(armor: Obj | null) {
    const playerAny = world.player as any
    if (armor?.pro?.extra) {
        const fid: number = world.player!.gender === 'female' ? armor.pro.extra.femaleFID : armor.pro.extra.maleFID
        if (fid && fid !== 0) {
            try {
                const armorArt = lookupArt(fid)
                if (armorArt) {
                    if (!playerAny._baseArt) {
                        playerAny._baseArt = world.player!.art
                    }
                    world.player!.art = armorArt
                    return
                }
            } catch (e) {
                dbgWarn('inventory', `[UI] applyArmorArt: lookupArt failed for fid ${fid}: ${e}`)
            }
        }
    }
    // No armor or no valid FID — restore original art
    if (playerAny._baseArt) {
        world.player!.art = playerAny._baseArt
        playerAny._baseArt = null
    }
}
