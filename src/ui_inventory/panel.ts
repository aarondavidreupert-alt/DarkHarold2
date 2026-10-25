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

// Inventory panel — split out of ui_inventory.ts. See
// wiki/ts-split-refactor.md → "Per-file split proposals" §8.

import { beginUseItemOn, usePendingItemOn } from '../useItemOn.js'
import { ammoGetCapacity, ammoGetQuantity, ammoSetQuantity, ammoSplitOff, weaponGetAmmoTypePid } from '../weaponAmmo.js'
import { weaponAttackType } from '../combat/hitChance.js'
import { Combat } from '../combat.js'
import { loadPRO } from '../pro.js'
import globalState from '../globalState.js'
import { dbg } from '../logger.js'
import { lazyLoadImage } from '../images.js'
import { Obj, createObjectWithPID, cloneItem, testDroppedExplosive } from '../object.js'
import { uiGetAmount } from '../ui_barter/swap.js'
import { Scripting } from '../scripting.js'
import { drawAC, drawAP, uiDrawWeapon, uiLog } from '../ui_hud.js'
import { makePanelDraggable } from '../ui_drag.js'
import { UIMode, closeAllPanels, isInventoryOpen, registerCloseInventoryPanel } from '../ui_panels.js'
import { appendItemSlot, $id, clearEl, showv, hidev, makeEl } from '../ui_dom.js'
import { makeDropTarget, makeDraggable, uiMoveSlot, applyArmorArt, tryLoadAmmoIntoWeapon, dragInProgress } from './dragdrop.js'
import { refreshStealthState } from '../miscItem.js'
import { armorPerkSwap } from '../perks.js'
import { Events } from '../events.js'
import { unarmedHandMode } from '../unarmed.js'
import { getMessage, getProtoMsg } from '../util.js'
import { objExamine } from '../examine.js'

// --- Public open / close lifecycle -----------------------------------------

// Stable reference for Events.on/off — wraps showInventory() so a
// statsChanged refresh can be skipped while a native drag is in progress
// (see dragInProgress in dragdrop.ts).
function onStatsChangedRefresh(): void {
    if (dragInProgress) return
    showInventory()
}

// CE inventory.cc inventoryOpenUseItemOn — the action menu's Inventory icon: the next
// item clicked is used on this object (2 AP in combat), and the window closes.
let useOnTarget: Obj | null = null

export function showInventoryUseOn(target: Obj): void {
    useOnTarget = target
    showInventory(true)
}

// CE inventory.cc _dropped_explosive: an armed explosive was dropped from the inventory
let droppedExplosive = false

export function closeInventory(): void {
    useOnTarget = null
    if (!isInventoryOpen()) return
    // CE _exit_inventory: the dropped explosive's would-be victims may notice
    if (droppedExplosive && globalState.player) testDroppedExplosive(globalState.player)
    droppedExplosive = false
    globalState.uiMode = UIMode.none
    $id('inventoryBox').style.visibility = 'hidden'
    if (globalState.player) globalState.player.clearAnim?.()
    uiDrawWeapon()
    Events.off('statsChanged', onStatsChangedRefresh)
}

// a button's press / release sounds (CE button.cc buttonSetCallbacks)
function buttonSounds($el: HTMLElement, press: string, release: string): void {
    $el.addEventListener('mousedown', (e) => { if (e.button === 0) globalState.audioEngine?.playSfxByName?.(press) })
    $el.addEventListener('mouseup', (e) => { if (e.button === 0) globalState.audioEngine?.playSfxByName?.(release) })
}

/**
 * Wire static DOM event handlers (drop targets, buttons, drag, scroll) for
 * the inventory panel. Call once during uiInit().
 */
export function initInventory(): void {
    registerCloseInventoryPanel(closeInventory)

    makeDropTarget($id('inventoryBoxList'), (data: string) => {
        uiMoveSlot(data, 'inventory')
    })
    makeDropTarget($id('inventoryBoxItem1'), (data: string) => {
        uiMoveSlot(data, 'leftHand')
    })
    makeDropTarget($id('inventoryBoxItem2'), (data: string) => {
        uiMoveSlot(data, 'rightHand')
    })
    makeDropTarget($id('inventoryBoxArmor'), (data: string) => {
        uiMoveSlot(data, 'armor')
    })

    // Inventory panel is a static DOM element — wire drag once at init.
    makePanelDraggable($id('inventoryBox'), 'inventory')
    $id('inventoryDoneButton').onclick = () => {
        globalState.uiMode = UIMode.none
        $id('inventoryBox').style.visibility = 'hidden'
        globalState.player.clearAnim()
        uiDrawWeapon()
    }
    // CE inventory.cc _setup_inventory: the Done button is a red button
    // (game_sound.cc _gsound_red_butt_press / _release)
    buttonSounds($id('inventoryDoneButton'), 'ib1p1xx1', 'ib1lu1x1')

    $id('inventoryBoxList').onwheel = (e: WheelEvent) => {
        const $el = $id('inventoryBoxList')
        const delta = e.deltaY > 0 ? 1 : -1
        $el.scrollTop = $el.scrollTop + 60 * delta
        e.preventDefault()
    }

    // CE interface.cc interfaceInit: the INV button plays _gsound_med_butt_press / _release;
    // opening and closing the inventory make no sound of their own
    buttonSounds($id('inventoryButton'), 'ib2p1xx1', 'ib2lu1x1')
    $id('inventoryButton').onclick = () => {
        if (isInventoryOpen()) { closeInventory(); return }
        closeAllPanels()
        showInventory()
    }
}

export function showInventory(useOn = false) {
    if (!useOn && !isInventoryOpen()) useOnTarget = null
    const wasOpen = isInventoryOpen()
    // CE inventory.cc inventoryOpen: in combat, too few AP → inventry.msg 19 and no window
    if (!wasOpen && !useOn && !useOnTarget && globalState.inCombat && globalState.player?.AP) {
        const player = globalState.player
        const apCost = Math.max(0, 4 - 2 * (player.hasPerk('Quick Pockets') ? 1 : 0))
        if (apCost > 0 && apCost > player.AP.getAvailableCombatAP()) {
            uiLog(getMessage('inventry', 19) ?? "You don't have enough action points to use inventory")
            return
        }
    }
    globalState.uiMode = UIMode.inventory
    if (!wasOpen) {
        Events.off('statsChanged', onStatsChangedRefresh)
        Events.on('statsChanged', onStatsChangedRefresh)
    }

    // CE ref: inventory.cc inventoryOpen() — deduct AP on first open during combat
    // Base cost: 4; Quick Pockets perk reduces by 2 per rank (CE: PERK_QUICK_POCKETS id=35)
    if (!wasOpen && !useOnTarget && globalState.inCombat && globalState.player?.AP) {
        const player = globalState.player
        const qpRank = player.hasPerk('Quick Pockets') ? 1 : 0
        const apCost = Math.max(0, 4 - 2 * qpRank)
        if (apCost > 0) {
            player.AP.subtractCombatAP(apCost)
            drawAP(player.AP.getAvailableCombatAP(), player.AP.getTotalMaxAP(), player.AP.move)
        }
    }

    showv($id('inventoryBox'))

    function showItemInfo(obj: Obj) {
        const $info = $id('inventoryBoxInfo')
        clearEl($info)
        const nameEl = document.createElement('div')
        nameEl.className = 'invItemName'
        nameEl.textContent = obj.name || ''
        $info.appendChild(nameEl)
        // CE inventory.cc inventoryExamineItem: _obj_examine_func (description_p_proc, the
        // proto description, the weapon / ammo lines), then "It weighs %d pound(s)."
        // (proto.msg 540 / 541 for one pound) unless the item weighs nothing
        const lines = globalState.player ? objExamine(globalState.player, obj) : []
        const weight = obj.getWeight() // CE itemGetWeight
        if (weight !== 0) {
            const fmt = getProtoMsg(weight === 1 ? 541 : 540) ?? 'It weighs %d pounds.'
            lines.push(fmt.replace('%d', String(weight)))
        }
        for (const line of lines) {
            const descEl = document.createElement('div')
            descEl.className = 'invItemDesc'
            descEl.textContent = line
            $info.appendChild(descEl)
        }
    }

    function showStats() {
        const $info = $id('inventoryBoxInfo')
        clearEl($info)
        const p = globalState.player
        const playerAny = p as any
        const armor = playerAny.armor ?? null
        const armorExtra = armor?.pro?.extra ?? null

        const addHR = () => {
            const hr = document.createElement('hr')
            hr.className = 'invStatHr'
            $info.appendChild(hr)
        }

        const addRow = (left: string, right: string) => {
            const row = document.createElement('div')
            row.className = 'invStatRow'
            const lbl = document.createElement('span')
            lbl.className = 'invStatLabel'
            lbl.textContent = left
            const val = document.createElement('span')
            val.className = 'invStatValue'
            val.textContent = right
            row.appendChild(lbl)
            row.appendChild(val)
            $info.appendChild(row)
        }

        const addWeaponSection = (weapon: any, label: string, hand: 'leftHand' | 'rightHand') => {
            addHR()
            if (!weapon) {
                // CE inventory.cc inventoryRenderSummary: "No item" and, for the player,
                // "Unarmed dmg: bonus+min - bonus+Melee+max" of the hand's punch / kick
                // hit mode (the selected primary or secondary one).
                addRow(getMessage('inventry', 14) ?? 'No item', '')
                const mode = unarmedHandMode(p as any, hand)
                const melee = (p as any).getStat('Melee') ?? 0
                addRow(`  ${getMessage('inventry', 24) ?? 'Unarmed dmg:'} ${mode.bonusDamage + mode.minDmg}-${mode.bonusDamage + melee + mode.maxDmg}`, '')
                return
            }
            // CE inventoryRenderSummary: the item's name; armor held in a hand "(Not worn)";
            // a weapon "Dmg: min-max" (+ Melee Damage for melee / unarmed modes) and, for a
            // throw or a range above 1, "Rng: r" — of the hand's active mode; "Ammo: q/cap
            // <ammo>" when it takes ammo
            addRow(weapon.name ?? label, '')
            if (weapon.subtype !== 'weapon') {
                if (weapon.subtype === 'armor') addRow(getMessage('inventry', 18) ?? '(Not worn)', '')
                return
            }
            const pro = weapon.pro?.extra
            if (!pro) return
            const attackType = weaponAttackType(weapon)
            const melee = attackType === 'melee' || attackType === 'unarmed' ? p.getStat('Melee') : 0
            const range = Combat.weaponRange(p as any, weapon)
            const dmg = `${getMessage('inventry', 15) ?? 'Dmg:'} ${pro.minDmg ?? 0}-${(pro.maxDmg ?? 0) + melee}`
            if (attackType !== 'throw' && range <= 1) addRow(dmg, '')
            else addRow(`${dmg}   ${getMessage('inventry', 16) ?? 'Rng:'} ${range}`, '')
            const cap = ammoGetCapacity(weapon)
            if (cap > 0) {
                const q = ammoGetQuantity(weapon)
                const ammoPid = weaponGetAmmoTypePid(weapon)
                const ammoName = q !== 0 && ammoPid !== -1 ? ' ' + (getMessage('pro_item', loadPRO(ammoPid, ammoPid & 0xffff)?.textID ?? -1) ?? '') : ''
                addRow(`${getMessage('inventry', 17) ?? 'Ammo:'} ${q}/${cap}${ammoName}`, '')
            }
        }

        // Player name
        const nameEl = document.createElement('div')
        nameEl.className = 'invStatName'
        nameEl.textContent = (p as any).name ?? 'Character'
        $info.appendChild(nameEl)

        addHR()

        // SPECIAL (left) + derived stats (right) in a two-column layout
        const twoCol = document.createElement('div')
        twoCol.className = 'invStatTwoCol'

        const leftCol = document.createElement('div')
        leftCol.className = 'invStatColLeft'

        const rightCol = document.createElement('div')
        rightCol.className = 'invStatColRight'

        const specialStats: [string, number][] = [
            ['ST', p.getStat('STR')],
            ['PE', p.getStat('PER')],
            ['EN', p.getStat('END')],
            ['CH', p.getStat('CHA')],
            ['IN', p.getStat('INT')],
            ['AG', p.getStat('AGI')],
            ['LK', p.getStat('LUK')],
        ]

        for (const [lbl, val] of specialStats) {
            const row = document.createElement('div')
            row.className = 'invStatRow'
            const l = document.createElement('span')
            l.className = 'invStatLabel'
            l.textContent = lbl
            const v = document.createElement('span')
            v.className = 'invStatValue'
            v.textContent = String(val)
            row.appendChild(l)
            row.appendChild(v)
            leftCol.appendChild(row)
        }

        // CE gSummaryStats / gSummaryStats2 with inventry.msg 7-13: HP cur/max, Armor
        // Class, then DT/DR% for Normal, Laser, Fire, Plasma and Explosion — the critter's
        // stats (armor, perks, traits, drugs)
        const msg = (id: number, fallback: string) => (getMessage('inventry', id) ?? fallback).trim()
        const dtdr = (type: string) => `${p.getStat('DT ' + type) + p.getArmorDT(type)}/${Math.min(100, p.getStat('DR ' + type) + p.getArmorDR(type))}%`
        const derivedStats: [string, string][] = [
            [msg(7, 'Hit Points'), `${p.getStat('HP')}/${p.getStat('Max HP')}`],
            [msg(8, 'Armor Class'), String(p.getStat('AC'))],
            [msg(9, 'Normal'), dtdr('Normal')],
            [msg(10, 'Laser'), dtdr('Laser')],
            [msg(11, 'Fire'), dtdr('Fire')],
            [msg(12, 'Plasma'), dtdr('Plasma')],
            [msg(13, 'Explode'), dtdr('Explosive')],
        ]

        for (const [lbl, val] of derivedStats) {
            const row = document.createElement('div')
            row.className = 'invStatRow'
            const l = document.createElement('span')
            l.className = 'invStatLabel'
            l.textContent = lbl
            const v = document.createElement('span')
            v.className = 'invStatValue'
            v.textContent = val
            row.appendChild(l)
            row.appendChild(v)
            rightCol.appendChild(row)
        }

        twoCol.appendChild(leftCol)
        twoCol.appendChild(rightCol)
        $info.appendChild(twoCol)

        // Weapon sections
        addWeaponSection(playerAny.leftHand ?? null, 'Left Hand', 'leftHand')
        addWeaponSection(playerAny.rightHand ?? null, 'Right Hand', 'rightHand')

        // Total weight
        addHR()
        // CE item.cc objectGetInventoryWeight / STAT_CARRY_WEIGHT
        const current = p.getInventoryWeight()
        const max = p.getStat('Carry')
        addRow(getMessage('inventry', 20) ?? 'Total Wt:', `${current}/${max}`)
        // CE: red while encumbered
        if (current > max) (($info.lastElementChild as HTMLElement).lastElementChild as HTMLElement).style.color = '#fc0000'
    }

    let _portraitInterval: ReturnType<typeof setInterval> | null = null

    function drawCharacterPortrait() {
        const $char = $id('inventoryBoxChar')
        clearEl($char)

        if (_portraitInterval !== null) {
            clearInterval(_portraitInterval)
            _portraitInterval = null
        }

        const art = globalState.player.getAnimation('idle')
        let currentOrientation = 0

        const canvas = document.createElement('canvas')
        $char.appendChild(canvas)

        const renderOrientation = (img: HTMLImageElement, orientation: number) => {
            const info = globalState.imageInfo?.[art]
            if (!info) return
            const numOrientations = Object.keys(info.frameOffsets).length
            if (numOrientations === 0) return
            const ori = orientation % numOrientations
            const frameInfo = info.frameOffsets[ori]?.[0]
            if (!frameInfo) return
            canvas.width = frameInfo.w
            canvas.height = frameInfo.h
            const ctx = canvas.getContext('2d')!
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(img, frameInfo.sx, frameInfo.sy ?? 0, frameInfo.w, frameInfo.h, 0, 0, frameInfo.w, frameInfo.h)
        }

        lazyLoadImage(art, (img: HTMLImageElement) => {
            renderOrientation(img, currentOrientation)
            _portraitInterval = setInterval(() => {
                const $box = document.getElementById('inventoryBox')
                if (!$box || $box.style.visibility === 'hidden') {
                    clearInterval(_portraitInterval!)
                    _portraitInterval = null
                    return
                }
                currentOrientation = (currentOrientation + 1) % 6
                renderOrientation(img, currentOrientation)
            }, 250)
        })
    }

    function updateWeightDisplay() {
        const $weight = document.getElementById('inventoryBoxWeight')
        if (!$weight) return
        // CE item.cc objectGetInventoryWeight / STAT_CARRY_WEIGHT
        const current = globalState.player.getInventoryWeight()
        const max = globalState.player.getStat('Carry')
        $weight.textContent = `Wt: ${current}/${max}`
    }

    function drawInventory($el: HTMLElement, objects: Obj[]) {
        clearEl($el)
        clearEl($id('inventoryBoxItem1'))
        clearEl($id('inventoryBoxItem2'))
        clearEl($id('inventoryBoxArmor'))

        for (let i = 0; i < objects.length; i++) {
            const invObj = objects[i]
            const img = makeEl('img', {
                src: invObj.invArt ? invObj.invArt + '.png' : '',
                attrs: { title: invObj.name },
                style: { maxWidth: '100%', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
                click: () => {
                    showItemInfo(invObj)
                },
            })
            img.oncontextmenu = (e: MouseEvent) => {
                e.preventDefault()
                makeItemContextMenu(e, invObj, 'inventory')
                return false
            }
            appendItemSlot($el, img, invObj.amount)
            makeDraggable(img, 'i' + i, () => {
                showInventory()
            })
            img.addEventListener('click', () => {
                const target = useOnTarget
                if (!target) return
                closeInventory()
                // _action_use_an_item_on_object (useItemOn.ts: walk there, 2 AP in combat)
                beginUseItemOn(invObj)
                usePendingItemOn(target)
            })

            // Allow ammo to be dropped onto a weapon in the inventory list
            if (invObj.subtype === 'weapon') {
                const capturedWeapon = invObj
                makeDropTarget(img, (data: string) => {
                    if (data[0] !== 'i') return // only inventory items
                    const srcIdx = parseInt(data.slice(1))
                    const srcObj = globalState.player.inventory[srcIdx]
                    if (!srcObj || srcObj === capturedWeapon) return
                    if (tryLoadAmmoIntoWeapon(srcObj, capturedWeapon)) {
                        uiDrawWeapon()
                        showInventory()
                    }
                })
            }
        }
    }

    type ItemAction = 'cancel' | 'look' | 'use' | 'drop' | 'equip_left' | 'equip_right' | 'equip_armor' | 'unequip' | 'unload'

    function itemAction(obj: Obj, slot: string, action: ItemAction) {
        const playerAny = globalState.player as any
        switch (action) {
            case 'look':
                showItemInfo(obj)
                break
            case 'cancel':
                break
            case 'use':
                dbg('inventory', '[UI] using object: ' + obj.art)
                obj.use(globalState.player)
                showInventory()  // refresh so consumed items disappear
                break
            case 'drop':
                dbg('inventory', '[UI] dropping: ' + obj.art + ' with pid ' + obj.pid)
                if (slot !== 'inventory') {
                    dbg('inventory', '[UI] moving into inventory first')
                    globalState.player.inventory.push(obj)
                    playerAny[slot] = null
                    if (slot === 'leftHand' || slot === 'rightHand') refreshStealthState(globalState.player!)
                }
                if (obj.pid === 206 || obj.pid === 209) droppedExplosive = true // explosiveIsActiveExplosive
                obj.drop(globalState.player)
                globalState.player.clearAnim()
                uiDrawWeapon()
                showInventory()
                break
            case 'equip_left':
            case 'equip_right': {
                const targetSlot = action === 'equip_left' ? 'leftHand' : 'rightHand'
                const idx = globalState.player.inventory.indexOf(obj)
                if (idx !== -1) {
                    globalState.player.inventory.splice(idx, 1)
                    if (playerAny[targetSlot]) {
                        globalState.player.inventory.push(playerAny[targetSlot])
                    }
                    playerAny[targetSlot] = obj
                    refreshStealthState(globalState.player!)
                }
                globalState.player.clearAnim()
                uiDrawWeapon()
                showInventory()
                break
            }
            case 'equip_armor': {
                const idx = globalState.player.inventory.indexOf(obj)
                if (idx !== -1) {
                    globalState.player.inventory.splice(idx, 1)
                    if (playerAny.armor) {
                        globalState.player.inventory.push(playerAny.armor)
                    }
                    armorPerkSwap(globalState.player!, playerAny.armor ?? null, obj)
                    playerAny.armor = obj
                }
                applyArmorArt(obj)
                const armorAC = obj?.pro?.extra?.AC ?? 0
                drawAC(globalState.player.getStat('AC') + armorAC)
                showInventory()
                break
            }
            case 'unequip':
                globalState.player.inventory.push(obj)
                playerAny[slot] = null
                if (slot === 'armor') {
                    armorPerkSwap(globalState.player!, obj, null)
                    applyArmorArt(null)
                    drawAC(globalState.player.getStat('AC'))
                } else if (slot === 'leftHand' || slot === 'rightHand') {
                    refreshStealthState(globalState.player!)
                }
                globalState.player.clearAnim()
                uiDrawWeapon()
                showInventory()
                break
            case 'unload': {
                const ammoPID = weaponGetAmmoTypePid(obj)
                const ammoCurrent = ammoGetQuantity(obj)
                dbg('inventory', `[UI] unload: ammoPID=${ammoPID} rounds=${ammoCurrent}`)
                if (ammoCurrent > 0) {
                    // CE inventory.cc unload → item.cc weaponUnload, repeated: one box at a
                    // time holding up to a box's rounds; the weapon keeps its ammo type.
                    while (ammoPID > 0 && ammoGetQuantity(obj) > 0) {
                        const ammoObj = createObjectWithPID(ammoPID)
                        const rounds = ammoGetQuantity(obj)
                        const capacity = ammoGetCapacity(ammoObj)
                        ammoSetQuantity(ammoObj, Math.min(rounds, capacity))
                        ammoSetQuantity(obj, Math.max(0, rounds - capacity))
                        globalState.player.addInventoryItem(ammoObj, 1)
                    }
                    ammoSetQuantity(obj, 0)
                }
                uiDrawWeapon()
                showInventory()
                break
            }
        }
    }

    // Actions that have dedicated CSS icon art (id="context_ACTION" → background-image).
    const ICON_ACTIONS = new Set(['look', 'use', 'drop', 'cancel', 'unload'])

    function makeContextButton(obj: Obj, slot: string, action: ItemAction, label: string, closeOnClick = true) {
        const btn = document.createElement('div')
        if (ICON_ACTIONS.has(action)) {
            // Icon button: background-image supplied by #context_ACTION CSS rule.
            btn.id = 'context_' + action
            btn.className = 'itemContextMenuButton'
        } else {
            // Text button: used for actions without dedicated icon art (e.g. Unequip).
            btn.className = 'itemContextMenuButton itemContextMenuText'
            btn.textContent = label
        }
        btn.onclick = async () => {
            if (closeOnClick) hidev($id('itemContextMenu'))
            // CE ref: inventory.cc:4909 — quantity dialog for drop when amount > 1.
            if (action === 'drop' && obj.amount > 1) {
                const wanted = await uiGetAmount(obj)
                if (wanted <= 0) return
                const playerAny = globalState.player as any
                if (wanted < obj.amount) {
                    const split = cloneItem(obj)
                    split.amount = wanted
                    obj.amount -= wanted
                    ammoSplitOff(obj, split) // CE itemRemove: the top ammo box goes along
                    // a script that refuses the drop keeps the items with the dude
                    if (!split.drop(globalState.player)) globalState.player.addInventoryItem(split, split.amount)
                } else {
                    if (slot !== 'inventory') {
                        globalState.player.inventory.push(obj)
                        playerAny[slot] = null
                    }
                    obj.drop(globalState.player)
                }
                globalState.player.clearAnim()
                uiDrawWeapon()
                showInventory()
            } else {
                itemAction(obj, slot, action)
            }
        }
        return btn
    }

    function makeItemContextMenu(e: MouseEvent, obj: Obj, slot: string) {
        const $menu = $id('itemContextMenu')
        clearEl($menu)
        // #itemContextMenu lives inside #uiStage, which is centered via
        // transform: translate(-50%, -50%). Convert viewport-relative click
        // coords to the stage's local coordinate frame so the menu appears
        // where the user clicked regardless of window size.
        const stage = document.getElementById('uiStage')
        const rect = stage?.getBoundingClientRect()
        const lx = rect ? e.clientX - rect.left : e.clientX
        const ly = rect ? e.clientY - rect.top : e.clientY
        Object.assign($menu.style, {
            visibility: 'visible',
            left: `${lx}px`,
            top: `${ly}px`,
        })

        const isWeaponWithAmmo = obj.subtype === 'weapon' && (obj.pro?.extra?.maxAmmo ?? 0) > 0
        const fromInventory = slot === 'inventory'

        // Determine action set — mirrors fallout2-ce _act_weap/_act_use/_act_no_use etc.
        type Action = { action: ItemAction; label: string; closeOnClick?: boolean }
        let actions: Action[]

        if (isWeaponWithAmmo) {
            // _act_weap / _act_weap2
            actions = fromInventory
                ? [{ action: 'look', label: 'Look', closeOnClick: false }, { action: 'unload', label: 'Unload' }, { action: 'drop', label: 'Drop' }, { action: 'cancel', label: 'Cancel' }]
                : [{ action: 'look', label: 'Look', closeOnClick: false }, { action: 'unload', label: 'Unload' }, { action: 'cancel', label: 'Cancel' }]
        } else if (obj.canUse) {
            // _act_use / _act_just_use
            actions = fromInventory
                ? [{ action: 'look', label: 'Look', closeOnClick: false }, { action: 'use', label: 'Use' }, { action: 'drop', label: 'Drop' }, { action: 'cancel', label: 'Cancel' }]
                : [{ action: 'look', label: 'Look', closeOnClick: false }, { action: 'use', label: 'Use' }, { action: 'cancel', label: 'Cancel' }]
        } else {
            // _act_no_use / _act_nothing
            actions = fromInventory
                ? [{ action: 'look', label: 'Look', closeOnClick: false }, { action: 'drop', label: 'Drop' }, { action: 'cancel', label: 'Cancel' }]
                : [{ action: 'look', label: 'Look', closeOnClick: false }, { action: 'cancel', label: 'Cancel' }]
        }

        // DarkHarold2 addition: unequip button for equipped slots
        if (!fromInventory) {
            actions.push({ action: 'unequip', label: 'Unequip' })
        }

        for (const { action, label, closeOnClick } of actions) {
            $menu.appendChild(makeContextButton(obj, slot, action, label, closeOnClick ?? true))
        }
    }

    function drawSlot(slot: string, slotID: string) {
        const item = (globalState.player as any)[slot] as Obj | null
        if (!item || !item.invArt) return
        const img = makeEl('img', {
            src: item.invArt + '.png',
            attrs: { title: item.name },
            click: () => {
                showItemInfo(item)
            },
        })
        img.oncontextmenu = (e: MouseEvent) => {
            e.preventDefault()
            makeItemContextMenu(e, item, slot)
            return false
        }
        makeDraggable(img, slot)

        const $slotEl = $id(slotID)
        clearEl($slotEl)
        $slotEl.appendChild(img)
    }

    drawInventory($id('inventoryBoxList'), globalState.player.inventory)
    showStats()
    drawCharacterPortrait()
    updateWeightDisplay()

    if (globalState.player.leftHand) {
        drawSlot('leftHand', 'inventoryBoxItem1')
    }
    if (globalState.player.rightHand) {
        drawSlot('rightHand', 'inventoryBoxItem2')
    }
    const playerAny = globalState.player as any
    if (playerAny.armor) {
        drawSlot('armor', 'inventoryBoxArmor')
    }
}
