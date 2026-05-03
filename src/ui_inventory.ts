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

// Inventory panel: equipment slots, item list, drag-and-drop, equip/unequip,
// item context menu, character portrait, weight readout, weapon reload.
//
// Static DOM (#inventoryBox lives in index.html); this module owns the
// initialization wiring (initInventory) and the open/close lifecycle.

import globalState from './globalState.js'
import { lazyLoadImage } from './images.js'
import { Obj, createObjectWithPID } from './object.js'
import { lookupArt } from './pro.js'
import { drawAC, uiDrawWeapon, uiLog } from './ui_hud.js'
import { makePanelDraggable } from './ui_drag.js'
import { UIMode, closeAllPanels, isInventoryOpen, registerCloseInventoryPanel } from './ui_panels.js'

// --- DOM helpers (mirrors the ones in ui.ts) -------------------------------

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function clearEl($el: HTMLElement): void {
    $el.innerHTML = ''
}

function showv($el: HTMLElement): void {
    $el.style.visibility = 'visible'
}

function hidev($el: HTMLElement): void {
    $el.style.visibility = 'hidden'
}

interface ElementOptions {
    id?: string
    src?: string
    classes?: string[]
    click?: (e: MouseEvent) => void
    style?: { [key in keyof CSSStyleDeclaration]?: string }
    children?: HTMLElement[]
    attrs?: { [key: string]: string | number }
}

function makeEl(tag: string, options: ElementOptions): HTMLElement {
    const $el = document.createElement(tag)

    if (options.id !== undefined) {
        $el.id = options.id
    }
    if (options.src !== undefined) {
        ;($el as HTMLImageElement).src = options.src
    }
    if (options.classes !== undefined) {
        $el.className = options.classes.join(' ')
    }
    if (options.click !== undefined) {
        $el.onclick = options.click
    }
    if (options.style !== undefined) {
        Object.assign($el.style, options.style)
    }
    if (options.children !== undefined) {
        for (const child of options.children) {
            $el.appendChild(child)
        }
    }
    if (options.attrs !== undefined) {
        for (const prop in options.attrs) {
            $el.setAttribute(prop, options.attrs[prop] + '')
        }
    }

    return $el
}

// --- Drag-and-drop helpers -------------------------------------------------
//
// Used by the inventory panel below; also re-exported and consumed by
// barter/loot in ui.ts.

export function makeDropTarget($el: HTMLElement, dropCallback: (data: string, e?: DragEvent) => void) {
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

// --- Public open / close lifecycle -----------------------------------------

export function closeInventory(): void {
    if (!isInventoryOpen()) return
    globalState.uiMode = UIMode.none
    $id('inventoryBox').style.visibility = 'hidden'
    if (globalState.player) globalState.player.clearAnim?.()
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

/**
 * Try to load ammoObj into weaponObj.
 * Compatibility: ammo pid must match weapon.pro.extra.ammoPID (or weapon is unloaded).
 * Returns true if at least one round was loaded.
 */
function tryLoadAmmoIntoWeapon(ammoObj: Obj, weaponObj: Obj): boolean {
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
    return true
}

// TODO: Rewrite this sanely (and not directly modify the player object's properties...)
function uiMoveSlot(data: string, target: string) {
    const playerUnsafe = globalState.player as any
    let obj = null

    if (data[0] === 'i') {
        if (target === 'inventory') {
            return
        } // disallow inventory -> inventory

        const idx = parseInt(data.slice(1))
        console.log('[UI] inventory idx: ' + idx)
        obj = globalState.player.inventory[idx]

        // Drag-drop reload: ammo from inventory dropped onto a hand slot with a weapon
        if ((target === 'leftHand' || target === 'rightHand') && playerUnsafe[target]) {
            if (tryLoadAmmoIntoWeapon(obj, playerUnsafe[target] as Obj)) {
                uiDrawWeapon()
                showInventory()
                return
            }
        }

        globalState.player.inventory.splice(idx, 1) // remove object from inventory
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
    }

    // Update armor appearance if armor slot changed
    if (target === 'armor' || data === 'armor') {
        applyArmorArt(target === 'armor' ? obj : null)
        const armorAC = (globalState.player as any).armor?.pro?.extra?.AC ?? 0
        drawAC(globalState.player.getStat('AC') + armorAC)
    }

    uiDrawWeapon()
    showInventory()
}

// Apply or remove armor appearance — updates player.art to the armor's critter base art
function applyArmorArt(armor: Obj | null) {
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

export function showInventory() {
    globalState.uiMode = UIMode.inventory

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

    function itemAction(obj: Obj, slot: string, action: ItemAction) {
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
            case 'drop':
                console.log('[UI] dropping: ' + obj.art + ' with pid ' + obj.pid)
                if (slot !== 'inventory') {
                    console.log('[UI] moving into inventory first')
                    globalState.player.inventory.push(obj)
                    playerAny[slot] = null
                }
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
