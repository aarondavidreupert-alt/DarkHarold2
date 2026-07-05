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
import { Critter, Obj } from './object.js'
import { UIMode } from './ui_panels.js'
import { uiGetAmount, uiSwapItem } from './ui_barter.js'
import { uiLog } from './ui_hud.js'
import { makeDropTarget, makeDraggable } from './ui_inventory.js'
import { $id, clearEl, showv, hidev, off, makeEl } from './ui_dom.js'
import { performSteal } from './skillUse.js'
import { Scripting } from './scripting.js'
import { initLoot } from './ui_loot.js'
import { dbg } from './logger.js'

/**
 * CE ref: inventory.cc:4505 inventoryOpenStealing(). Every drag from the
 * target's side to the thief's side rolls performSteal() (skill.cc:1031)
 * instead of moving freely; getting caught ends the session immediately and
 * fires the target's pickup_p_proc (inventory.cc:4492-4499), matching CE —
 * the NPC's own script decides how it reacts. Dragging from the thief's
 * side to the target's side ("planting") is CE-supported but not wired here:
 * no DH2 script currently calls for it.
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

    function drawInventory($el: HTMLElement, who: 'l' | 'r', objects: Obj[]) {
        clearEl($el)
        for (let i = 0; i < objects.length; i++) {
            const inventoryImage = objects[i].invArt
            const img = makeEl('img', {
                src: inventoryImage + '.png',
                attrs: { title: objects[i].name },
                style: { maxWidth: '72px', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
            })
            $el.appendChild(img)
            $el.insertAdjacentHTML('beforeend', 'x' + objects[i].amount)
            makeDraggable(img, who + i)
        }
    }

    function drawSteal() {
        drawInventory($id('lootBoxLeft'), 'l', thief.inventory)
        drawInventory($id('lootBoxRight'), 'r', target.inventory)
    }

    function endSteal() {
        if (ended) return
        ended = true

        // CE ref: inventory.cc:4470 — no bonus XP if caught, or vs. a party member.
        if (stealingXp > 0 && !globalState.gParty.isPartyMember(target)) {
            const maxXp = 300 - thief.getSkill('Steal')
            const xp = Math.min(maxXp, stealingXp)
            if (xp > 0) (thief as any).addExperience?.(xp)
        }

        globalState.uiMode = UIMode.none
        hidev($id('lootBox'))
        off($id('lootBoxLeft'), 'drop dragenter dragover')
        off($id('lootBoxRight'), 'drop dragenter dragover')
        showv($id('lootBoxTakeAllButton'))
        initLoot() // restore the Done button's normal uiEndLoot() binding
    }

    async function attemptSteal(item: Obj): Promise<void> {
        stealCount += 1
        const result = performSteal(thief, target, item, stealCount)

        if (!result.success) {
            uiLog('You are caught stealing!')
            dbg('skills', '[skill:Steal] caught stealing %s from %s', item.name ?? item.pid, target.name ?? 'critter')
            if (target._script) {
                // CE ref: inventory.cc:4492-4499 — fires the target's own
                // pickup_p_proc(self=target, source=thief); the NPC's script
                // decides the in-fiction reaction (dialogue, hostility, etc.)
                try { Scripting.pickup(target, thief) } catch (e) { dbg('script', 'uiSteal: pickup_p_proc error: %o', e) }
            }
            endSteal()
            return
        }

        const wantedAmount = item.amount > 1 ? await uiGetAmount(item) : 1
        if (wantedAmount <= 0) return
        if (!thief.canCarry?.(item, wantedAmount)) {
            uiLog("You can't carry any more.")
            return
        }

        stealingXp += stealingXpBonus
        stealingXpBonus += 10

        uiSwapItem(target.inventory, item, thief.inventory, wantedAmount)
        drawSteal()
    }

    showv($id('lootBox'))
    hidev($id('lootBoxTakeAllButton')) // CE: 'Take All' is a no-op during a steal session (inventory.cc:4272)

    makeDropTarget($id('lootBoxRight'), () => {
        // Planting (thief -> target) not wired — see file header.
    })
    makeDropTarget($id('lootBoxLeft'), (data: string) => {
        if (data[0] !== 'r') return // only target -> thief drags are steal attempts
        const idx = parseInt(data.slice(1))
        const item = target.inventory[idx]
        if (item === undefined) return
        attemptSteal(item)
    })

    $id('lootBoxDoneButton').onclick = () => endSteal()

    drawSteal()
}
