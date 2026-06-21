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

import globalState from '../globalState.js'
import { lazyLoadImage } from '../images.js'
import { Obj, createObjectWithPID, cloneItem } from '../object.js'
import { uiGetAmount } from '../ui_barter/swap.js'
import { Scripting } from '../scripting.js'
import { drawAC, drawAP, uiDrawWeapon } from '../ui_hud.js'
import { makePanelDraggable } from '../ui_drag.js'
import { UIMode, closeAllPanels, isInventoryOpen, registerCloseInventoryPanel } from '../ui_panels.js'
import { $id, clearEl, showv, hidev, makeEl } from '../ui_dom.js'
import { makeDropTarget, makeDraggable, uiMoveSlot, applyArmorArt, tryLoadAmmoIntoWeapon } from './dragdrop.js'

// --- Public open / close lifecycle -----------------------------------------

export function closeInventory(): void {
    if (!isInventoryOpen()) return
    globalState.uiMode = UIMode.none
    $id('inventoryBox').style.visibility = 'hidden'
    if (globalState.player) globalState.player.clearAnim?.()
    globalState.audioEngine.playSfxByName('isdxxxx1')
    uiDrawWeapon()
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
    makePanelDraggable($id('inventoryBox'))
    $id('inventoryDoneButton').onclick = () => {
        globalState.uiMode = UIMode.none
        $id('inventoryBox').style.visibility = 'hidden'
        globalState.player.clearAnim()
        globalState.audioEngine.playSfxByName('isdxxxx1')
        uiDrawWeapon()
    }

    $id('inventoryBoxList').onwheel = (e: WheelEvent) => {
        const $el = $id('inventoryBoxList')
        const delta = e.deltaY > 0 ? 1 : -1
        $el.scrollTop = $el.scrollTop + 60 * delta
        e.preventDefault()
    }

    $id('inventoryButton').onclick = () => {
        if (isInventoryOpen()) { closeInventory(); return }
        closeAllPanels()
        showInventory()
    }
}

export function showInventory() {
    const wasOpen = isInventoryOpen()
    globalState.uiMode = UIMode.inventory
    if (!wasOpen) globalState.audioEngine.playSfxByName('iisxxxx1')

    // CE ref: inventory.cc inventoryOpen() — deduct AP on first open during combat
    // Base cost: 4; Quick Pockets perk reduces by 2 per rank (CE: PERK_QUICK_POCKETS id=35)
    if (!wasOpen && globalState.inCombat && globalState.player?.AP) {
        const player = globalState.player
        const qpRank = player.hasPerk('Quick Pockets') ? 1 : 0
        const apCost = Math.max(0, 4 - 2 * qpRank)
        if (apCost > 0) {
            player.AP.subtractCombatAP(apCost)
            drawAP(player.AP.getAvailableCombatAP(), player.AP.getTotalMaxAP())
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
        const desc = obj.getDescription ? obj.getDescription() : null
        if (desc) {
            const descEl = document.createElement('div')
            descEl.className = 'invItemDesc'
            descEl.textContent = desc
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

        const addWeaponSection = (weapon: any, label: string) => {
            addHR()
            if (!weapon) {
                addRow(label, 'None')
                return
            }
            const name = weapon.name ?? label
            addRow(name, '')
            const pro = weapon.pro?.extra
            if (pro) {
                const minD = pro.minDmg ?? '?'
                const maxD = pro.maxDmg ?? '?'
                const rng = pro.maxRange1 ?? '?'
                addRow(`  Dmg: ${minD}-${maxD}`, `Rng: ${rng}`)
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

        const armorAC: number = armorExtra?.AC ?? 0
        const baseAC: number = p.getStat('AGI')
        const dr = (key: string) => armorExtra?.stats?.[key] ?? 0

        const derivedStats: [string, string][] = [
            ['HP', `${p.getStat('HP')}/${p.getStat('Max HP')}`],
            ['AC', String(baseAC + armorAC)],
            ['Normal', `${dr('DR Normal')}%`],
            ['Laser', `${dr('DR Laser')}%`],
            ['Fire', `${dr('DR Fire')}%`],
            ['Plasma', `${dr('DR Plasma')}%`],
            ['Explode', `${dr('DR Electrical')}%`],
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
        addWeaponSection(playerAny.leftHand ?? null, 'Left Hand')
        addWeaponSection(playerAny.rightHand ?? null, 'Right Hand')

        // Total weight
        addHR()
        let current = 0
        for (const item of p.inventory) {
            current += ((item.pro?.extra?.weight ?? 0) as number) * item.amount
        }
        if (playerAny.leftHand?.pro?.extra?.weight) current += playerAny.leftHand.pro.extra.weight
        if (playerAny.rightHand?.pro?.extra?.weight) current += playerAny.rightHand.pro.extra.weight
        if (armorExtra?.weight) current += armorExtra.weight
        const max = 25 + p.getStat('STR') * 25
        addRow('Total Wt:', `${current}/${max}`)
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
            ctx.drawImage(img, frameInfo.sx, 0, frameInfo.w, frameInfo.h, 0, 0, frameInfo.w, frameInfo.h)
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
        let current = 0
        for (const item of globalState.player.inventory) {
            current += ((item.pro?.extra?.weight ?? 0) as number) * item.amount
        }
        const playerAny = globalState.player as any
        if (playerAny.leftHand?.pro?.extra?.weight) current += playerAny.leftHand.pro.extra.weight
        if (playerAny.rightHand?.pro?.extra?.weight) current += playerAny.rightHand.pro.extra.weight
        if (playerAny.armor?.pro?.extra?.weight) current += playerAny.armor.pro.extra.weight
        const max = 25 + globalState.player.getStat('STR') * 25
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
                style: { maxWidth: '72px', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
                click: () => {
                    showItemInfo(invObj)
                },
            })
            img.oncontextmenu = (e: MouseEvent) => {
                e.preventDefault()
                makeItemContextMenu(e, invObj, 'inventory')
                return false
            }
            $el.appendChild(img)
            const amtSpan = document.createElement('span')
            amtSpan.className = 'invItemAmount'
            amtSpan.textContent = 'x' + invObj.amount
            $el.appendChild(amtSpan)
            makeDraggable(img, 'i' + i, () => {
                showInventory()
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

    async function itemAction(obj: Obj, slot: string, action: ItemAction) {
        const playerAny = globalState.player as any
        switch (action) {
            case 'look':
                showItemInfo(obj)
                break
            case 'cancel':
                break
            case 'use':
                console.log('[UI] using object: ' + obj.art)
                obj.use(globalState.player)
                break
            case 'drop': {
                console.log('[UI] dropping: ' + obj.art + ' with pid ' + obj.pid)

                // Stacked items prompt for how many to drop, matching the
                // "Move Items" dialog used for barter/loot transfers.
                let dropAmount = obj.amount
                if (slot === 'inventory' && obj.amount > 1) {
                    dropAmount = await uiGetAmount(obj)
                    if (dropAmount === 0) break // player cancelled
                }

                if (slot !== 'inventory') {
                    console.log('[UI] moving into inventory first')
                    globalState.player.inventory.push(obj)
                    playerAny[slot] = null
                }

                if (dropAmount < obj.amount) {
                    // Partial stack: split off a clone holding dropAmount and
                    // drop that, leaving the remainder in the inventory.
                    obj.amount -= dropAmount
                    const dropped = cloneItem(obj)
                    dropped.amount = dropAmount
                    globalState.player.inventory.push(dropped)
                    dropped.drop(globalState.player)
                } else {
                    obj.drop(globalState.player)
                }
                globalState.player.clearAnim()
                uiDrawWeapon()
                showInventory()
                break
            }
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
                    applyArmorArt(null)
                    drawAC(globalState.player.getStat('AC'))
                }
                globalState.player.clearAnim()
                uiDrawWeapon()
                showInventory()
                break
            case 'unload': {
                const ammoPID: number | undefined = obj.pro?.extra?.ammoPID
                const ammoCurrent: number = obj.pro?.extra?.rounds ?? 0
                console.log(`[UI] unload: ammoPID=${ammoPID} rounds=${ammoCurrent}`)
                if (ammoCurrent > 0) {
                    if (ammoPID) {
                        // Create an ammo item and return it to inventory
                        const ammoObj = createObjectWithPID(ammoPID)
                        ammoObj.amount = ammoCurrent
                        globalState.player.addInventoryItem(ammoObj, ammoCurrent)
                    }
                    obj.pro.extra.rounds = 0
                    if (obj.pro.extra.ammoPID !== undefined) obj.pro.extra.ammoPID = 0
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
        btn.onclick = () => {
            itemAction(obj, slot, action)
            if (closeOnClick) hidev($id('itemContextMenu'))
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
            style: { maxWidth: '72px', maxHeight: '60px', objectFit: 'contain', display: 'inline-block', verticalAlign: 'middle' },
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
