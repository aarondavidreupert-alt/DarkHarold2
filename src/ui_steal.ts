/*
Copyright 2026

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

// Steal screen — reuses the loot window's two-column drag-and-drop chrome
// (#lootBox) against a living critter's inventory, but gates every drag
// with a real per-item performSteal() roll instead of a free transfer.
//
// CE ref: inventory.cc:4505 inventoryOpenStealing(), :4525 _move_inventory().
// CE reuses the identical INVENTORY_WINDOW_TYPE_LOOT window for stealing,
// distinguished only by the internal _gIsSteal flag — same approach here
// (the #lootBox DOM is reused; initLoot() rebinds the Done button when this
// session ends so a later real loot session isn't left pointing at stale
// steal-session state).

import globalState from './globalState.js'
import { Critter, itemIsHidden, Obj } from './object.js'
import { UIMode } from './uiMode.js'
import { uiGetAmount, uiSwapItem } from './ui_barter.js'
import { uiLog } from './messageLog.js'
import {
    examineToLog,
    itemMenuActions,
    makeDropTarget,
    makeDraggable,
    MAX_OPEN_BAGS,
    showItemMenu,
    unloadWeapon,
    itemCountLabel,
} from './ui_inventory.js'
import { appendItemSlot, $id, clearEl, showv, hidev, off, makeEl } from './ui_dom.js'
import { performSteal } from './skillUse.js'
import * as Scripting from './scripting.js'
import { drawLootBagViews, initLoot } from './ui_loot.js'
import { dbg } from './logger.js'
import { getMessage } from './util.js'

/**
 * CE ref: inventory.cc:4505 inventoryOpenStealing(). Every drag from the
 * target's side to the thief's side rolls performSteal() (skill.cc:1031)
 * instead of moving freely; getting caught ends the session immediately and
 * fires the target's pickup_p_proc (inventory.cc:4492-4499), matching CE —
 * the NPC's own script decides how it reacts. Dragging from the thief's
 * side to the target's side plants the item, with the same roll (isPlanting).
 */
export function uiSteal(thief: Critter, target: Critter): void {
    globalState.uiMode = UIMode.loot // reuse the loot UI mode/DOM

    let stealCount = 0
    // CE ref: inventory.cc:4368-4369,4470 — bonus XP accrues per successful,
    // uncaught item this session (+10 each time) and is awarded once at
    // session end, capped at 300 minus the thief's Steal skill.
    let stealingXp = 0
    let stealingXpBonus = 10
    let ended = false
    let caught = false
    // CE _container_enter: each side's open bags (the steal window is a loot window)
    const thiefBags: Obj[] = []
    const targetBags: Obj[] = []
    const thiefList = () => (thiefBags.length ? thiefBags[thiefBags.length - 1].inventory : thief.inventory)
    const targetList = () => (targetBags.length ? targetBags[targetBags.length - 1].inventory : target.inventory)

    function drawInventory($el: HTMLElement, who: 'l' | 'r', objects: Obj[]) {
        clearEl($el)
        // CE inventory.cc _display_inventory: newest first (items[length − (i + offset + 1)])
        for (let i = objects.length - 1; i >= 0; i--) {
            // CE inventory.cc itemMoveAllHidden: natural weapons aren't shown
            if (itemIsHidden(objects[i])) continue
            // CE inventoryOpenLooting:4135-4148 (_gIsSteal): the target's hand items and worn
            // armor are taken out of the window (OBJECT_IN_LEFT/RIGHT_HAND | OBJECT_WORN)
            if (who === 'r' && ((objects[i].flags ?? 0) & 0x7000000) !== 0) continue
            const inventoryImage = objects[i].invArt
            const img = makeEl('img', {
                src: inventoryImage + '.png',
                attrs: { title: objects[i].name },
                style: {
                    maxWidth: '100%',
                    maxHeight: '60px',
                    objectFit: 'contain',
                    display: 'inline-block',
                    verticalAlign: 'middle',
                },
            })
            appendItemSlot($el, img, itemCountLabel(objects[i]))
            makeDraggable(img, who + i)
            // CE inventoryWindowOpenContextMenu (the loot window, stealing)
            const item = objects[i]
            const ownerIsDude = who === 'l'
            img.oncontextmenu = (e: MouseEvent) => {
                e.preventDefault()
                showItemMenu(e, itemMenuActions(item, false, ownerIsDude), (action) => {
                    const bags = ownerIsDude ? thiefBags : targetBags
                    const owner: Obj = bags[bags.length - 1] ?? (ownerIsDude ? thief : target)
                    if (action === 'use' && item.subtype === 'container') {
                        if (bags.length < MAX_OPEN_BAGS) bags.push(item)
                    } else if (action === 'look') examineToLog(item)
                    else if (action === 'unload') unloadWeapon(item, (ammo) => owner.addInventoryItem(ammo, 1))
                    else if (action === 'drop') {
                        const list = thiefList()
                        if (list !== thief.inventory) {
                            list.splice(list.indexOf(item), 1)
                            thief.inventory.push(item)
                        }
                        item.drop(thief)
                    }
                    drawSteal()
                })
                return false
            }
        }
    }

    function drawSteal() {
        drawInventory($id('lootBoxLeft'), 'l', thiefList())
        drawInventory($id('lootBoxRight'), 'r', targetList())
        drawLootBagViews(thiefBags, targetBags, drawSteal, thief, target)
    }

    function endSteal() {
        if (ended) return
        ended = true

        // CE ref: inventory.cc:4470 — no bonus XP if caught, or vs. a party member.
        if (!caught && stealingXp > 0 && !globalState.gParty.isPartyMember(target)) {
            const xp = Math.min(300 - thief.getSkill('Steal'), stealingXp)
            const p = thief as any
            const before = p.stats?.get?.('Experience') ?? 0
            p.addExperience?.(xp)
            // inventry.msg 29: You gain %d experience points for successfully using your Steal skill.
            const msg = getMessage('inventry', 29)
            if (msg) uiLog(msg.replace('%d', String((p.stats?.get?.('Experience') ?? 0) - before)))
        }

        globalState.uiMode = UIMode.none
        hidev($id('lootBox'))
        off($id('lootBoxLeft'), 'drop dragenter dragover')
        off($id('lootBoxRight'), 'drop dragenter dragover')
        // back to the window's visibility: an element set 'visible' shows even
        // inside the hidden loot box (it stayed on the map after the steal)
        $id('lootBoxTakeAllButton').style.visibility = ''
        initLoot() // restore the Done button's normal uiEndLoot() binding
    }

    // CE inventory.cc _move_inventory: the quantity first, then skillsPerformStealing
    // (planting rolls too), then the move.
    async function attemptSteal(item: Obj, isPlanting = false): Promise<void> {
        const fromList = isPlanting ? thiefList() : targetList()
        const toList = isPlanting ? targetList() : thiefList()
        const toBag = isPlanting ? targetBags[targetBags.length - 1] : thiefBags[thiefBags.length - 1]
        const to: Obj = toBag ?? (isPlanting ? target : thief)
        stealCount += 1
        const wantedAmount = item.amount > 1 ? await uiGetAmount(item) : 1
        if (wantedAmount <= 0) return
        const result = performSteal(thief, target, item, stealCount, isPlanting)

        if (!result.success) {
            caught = true
            dbg('skills', '[skill:Steal] caught stealing %s from %s', item.name ?? item.pid, target.name ?? 'critter')
            if (target._script) {
                // CE ref: inventory.cc:4492-4499 — fires the target's own
                // pickup_p_proc(self=target, source=thief); the NPC's script
                // decides the in-fiction reaction (dialogue, hostility, etc.)
                try {
                    Scripting.pickup(target, thief)
                } catch (e) {
                    dbg('script', 'uiSteal: pickup_p_proc error: %o', e)
                }
            }
            endSteal()
            return
        }

        // (into the thief's open bag: its room and the thief's carry weight, CE itemAttemptAdd)
        if (!to.canCarry?.(item, wantedAmount) || (toBag && !isPlanting && !thief.canCarry(item, wantedAmount))) {
            uiLog(getMessage('inventry', 26) ?? 'There is no space left for that item.')
            return
        }

        stealingXp += stealingXpBonus
        stealingXpBonus += 10

        uiSwapItem(fromList, item, toList, wantedAmount)
        drawSteal()
    }

    showv($id('lootBox'))
    hidev($id('lootBoxTakeAllButton')) // CE inventory.cc _setup_inventory: no 'Take All' button when _gIsSteal

    makeDropTarget($id('lootBoxRight'), (data: string) => {
        if (data[0] !== 'l') return // thief -> target: planting (skillsPerformStealing isPlanting)
        const item = thiefList()[parseInt(data.slice(1))]
        if (item === undefined) return
        attemptSteal(item, true)
    })
    makeDropTarget($id('lootBoxLeft'), (data: string) => {
        if (data[0] !== 'r') return // only target -> thief drags are steal attempts
        const idx = parseInt(data.slice(1))
        const item = targetList()[idx]
        if (item === undefined) return
        attemptSteal(item)
    })

    $id('lootBoxDoneButton').onclick = () => endSteal()

    drawSteal()
}
