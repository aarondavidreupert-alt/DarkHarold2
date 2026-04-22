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

import { Combat } from './combat.js'
import { Area, Elevator, loadAreas, lookupMapNameFromLookup } from './data.js'
import globalState from './globalState.js'
import { Critter, cloneItem, createObjectWithPID, Obj } from './object.js'
import { Player } from './player.js'
import { lookupArt, lookupInterfaceArt } from './pro.js'
import { objectBoundingBox } from './renderer.js'
import { formatSaveDate, load, save, SaveGame, saveList } from './saveload.js'
import { Scripting } from './scripting.js'
import { Skills, SKILL_NAMES } from './skills.js'
import { skillUse } from './skillUse.js'
import { fromTileNum } from './tile.js'
import { Worldmap } from './worldmap.js'
import { Config } from './config.js'
import { Point } from './geometry.js'
import { lazyLoadImage } from './images.js'
import { CSSBoundingBox, Widget } from './widget.js'
import { font1, font3, FontWidget, makeFontLabel, renderBignum } from './font.js'
import { openAutomap, closeAutomap, isAutomapOpen } from './automap.js'

// Re-export so existing `from './ui.js'` importers still see Widget / CSSBoundingBox.
export { Widget } from './widget.js'
export type { CSSBoundingBox } from './widget.js'
import { openPipBoy, closePipBoy, isPipBoyOpen } from './pipboy.js'
import { getActiveUnarmedMode, nextUnarmedModeIdx } from './unarmed.js'
import { makePanelDraggable } from './dragPanel.js'

// UI system

// TODO: reduce code duplication, circular references,
//       and general badness/unmaintainability.
// TODO: combat UI on main bar
// TODO: stats/info view in inventory screen
// TODO: fix inventory image size
// TODO: fix style for inventory image amount
// TODO: option for scaling the UI

export class WindowFrame {
    children: Widget[] = []
    elem: HTMLElement
    showing = false

    constructor(
        public background: string,
        public position: Point,
        public width: number,
        public height: number,
        children?: Widget[]
    ) {
        this.elem = document.createElement('div')

        Object.assign(this.elem.style, {
            position: 'absolute',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: `${width}px`,
            height: `${height}px`,
            backgroundImage: `url('${background}')`,
        })

        if (children) {
            for (const child of children) {
                this.add(child)
            }
        }
    }

    add(widget: Widget): this {
        this.children.push(widget)
        this.elem.appendChild(widget.elem)
        return this
    }

    show(): this {
        if (this.showing) {
            return this
        }
        this.showing = true
        $uiContainer.appendChild(this.elem)
        return this
    }

    close(): void {
        if (!this.showing) {
            return
        }
        this.showing = false
        this.elem.parentNode!.removeChild(this.elem)
    }

    toggle(): this {
        if (this.showing) {
            this.close()
        } else {
            this.show()
        }
        return this
    }
}
export class SmallButton extends Widget {
    constructor(x: number, y: number) {
        super('art/intrface/lilredup.png', { x, y, w: 15, h: 16 })
        this.mouseDownBG('art/intrface/lilreddn.png')
    }
}

export class Label extends Widget {
    constructor(x: number, y: number, text: string, public textColor: string = 'yellow') {
        super(null, { x, y, w: 'auto', h: 'auto' })
        this.setText(text)
        this.elem.style.color = this.textColor
    }

    setText(text: string): void {
        this.elem.innerHTML = text
    }
}

interface ListItem {
    id?: any // identifier userdata
    uid?: number // unique identifier (filled in by List)
    text: string
    onSelected?: () => void
}

// TODO: disable-selection class
export class List extends Widget {
    items: ListItem[] = []
    itemSelected?: (item: ListItem) => void
    currentlySelected: ListItem | null = null
    currentlySelectedElem: HTMLElement | null = null
    _lastUID = 0

    constructor(
        bbox: CSSBoundingBox,
        items?: ListItem[],
        public textColor: string = '#00FF00',
        public selectedTextColor: string = '#FCFC7C'
    ) {
        super(null, bbox)
        this.elem.style.color = this.textColor

        if (items) {
            for (const item of items) {
                this.addItem(item)
            }
        }
    }

    onItemSelected(fn: (item: ListItem) => void): this {
        this.itemSelected = fn
        return this
    }

    getSelection(): ListItem | null {
        return this.currentlySelected
    }

    // Select the given item (and optionally, give its element for performance reasons)
    select(item: ListItem, itemElem?: HTMLElement): boolean {
        if (!itemElem) {
            // Find element belonging to this item
            itemElem = this.elem.querySelector(`[data-uid="${item.uid}"]`) as HTMLElement
        }

        if (!itemElem) {
            console.warn(`[UI] can't find item's element for item UID ${item.uid}`)
            return false
        }

        this.itemSelected && this.itemSelected(item)

        item.onSelected && item.onSelected()

        if (this.currentlySelectedElem) {
            // Reset text color for old selection
            this.currentlySelectedElem.style.color = this.textColor
        }

        // Use selection color for new selection
        itemElem.style.color = this.selectedTextColor

        this.currentlySelected = item
        this.currentlySelectedElem = itemElem

        return true
    }

    // Select item given by its id
    selectId(id: any): boolean {
        const item = this.items.filter((item) => item.id === id)[0]
        if (!item) {
            return false
        }
        this.select(item)
        return true
    }

    addItem(item: ListItem): ListItem {
        item.uid = this._lastUID++
        this.items.push(item)

        const itemElem = document.createElement('div')
        itemElem.style.cursor = 'pointer'
        itemElem.textContent = item.text
        itemElem.setAttribute('data-uid', item.uid + '')
        itemElem.onclick = () => {
            this.select(item, itemElem)
        }
        this.elem.appendChild(itemElem)

        // Select first item added
        if (!this.currentlySelected) {
            this.select(item)
        }

        return item
    }

    clear(): void {
        this.items.length = 0

        const node = this.elem
        while (node.firstChild) {
            node.removeChild(node.firstChild)
        }
    }
}
// Container that all of the top-level UI elements reside in
let $uiContainer: HTMLElement

function uiInit() {
    // WindowFrame.show() appends to $uiContainer; point it at #uiStage so
    // all skilldex/character/save-load/worldmap windows inherit the 800×600
    // centered coordinate frame. Fall back to #game-container if the stage
    // div is missing (e.g. legacy HTML).
    $uiContainer = (document.getElementById('uiStage') ?? document.getElementById('game-container'))!

    initSkilldex()
    initOptionsMenu()
    // initCharacterScreen();

    const chrBtn = document.getElementById('chrButton')
    if (chrBtn) {
        chrBtn.onclick = () => {
            // Toggle: pressing while open closes it.
            if (isCharacterOpen()) { characterWindow.close(); return }
            closeAllPanels()
            initCharacterScreen()
        }
    }

    document.getElementById('pipBoyButton')!.onclick = () => {
        if (isPipBoyOpen()) { closePipBoy(); return }
        closeAllPanels()
        openPipBoy()
    }

    document.getElementById('mapButton')!.onclick = () => {
        if (isAutomapOpen()) { closeAutomap(); return }
        closeAllPanels()
        openAutomap()
    }
}

// --- Panel mutual-exclusion helpers -----------------------------------------
//
// These let each panel-open path close any other panels that are currently up,
// so buttons behave like tabs rather than stackable overlays. They are also
// used by the button handlers to implement toggle-to-close.

export function isInventoryOpen(): boolean {
    return globalState.uiMode === UIMode.inventory
}

export function isCharacterOpen(): boolean {
    return !!(characterWindow && characterWindow.showing)
}

export function isSkilldexOpen(): boolean {
    return !!(skilldexWindow && skilldexWindow.showing)
}

export function isOptionsOpen(): boolean {
    return !!(optionsWindow && optionsWindow.showing)
}

function closeInventoryPanel(): void {
    if (!isInventoryOpen()) return
    globalState.uiMode = UIMode.none
    $id('inventoryBox').style.visibility = 'hidden'
    if (globalState.player) globalState.player.clearAnim?.()
    uiDrawWeapon()
}

export function closeAllPanels(): void {
    if (isPipBoyOpen()) closePipBoy()
    if (isAutomapOpen()) closeAutomap()
    if (isCharacterOpen()) characterWindow.close()
    if (isInventoryOpen()) closeInventoryPanel()
    if (isSkilldexOpen()) skilldexWindow.close()
    if (isOptionsOpen()) optionsWindow.close()
}

let skilldexWindow: WindowFrame
let characterWindow: WindowFrame
let optionsWindow: WindowFrame

// FO2-CE ref: skilldex.cc — skilldexOpen() / skilldexWindowInit()
// Skilldex window showing 8 usable skills with current values and keyboard shortcuts
function initSkilldex() {
    // Skill value containers — updated each time the skilldex is opened/shown
    const skillValueElems: HTMLElement[] = []

    // FO2-CE ref: skilldex.cc — Sneak is the only truly passive skill (toggle).
    // First Aid and Doctor can target other critters OR self (ground click = self).
    // All other skills require a target object.
    function isPassiveSkill(skill: Skills): boolean {
        return skill === Skills.Sneak
    }

    function useSkill(skill: Skills) {
        return () => {
            skilldexWindow.close()

            if (isPassiveSkill(skill)) {
                // Passive/self skills: execute immediately, no target selection needed
                const skillName = SKILL_NAMES[skill - 1]
                const player = globalState.player
                if (!player) return
                const result = skillUse(player, player, skillName)
                uiLog(result.message)
                if (result.hpHealed > 0) {
                    drawHP(player.getStat('HP'))
                }
                console.log('[UI] Passive skill executed:', skillName, result)
                return
            }

            // Target skills: enter targeting mode — cursor changes, game loop continues
            globalState.uiMode = UIMode.useSkill
            globalState.skillMode = skill
            globalState.cursorMode = 'useSkill'
            // CSS cursor fallback — crosshair visible even if WebGL crossuse asset is missing
            const cnv = document.getElementById('cnv')
            if (cnv) cnv.style.cursor = "url('art/intrface/crossuse.png') 11 11, crosshair"
            console.log('[UI] Skill targeting mode:', SKILL_NAMES[skill - 1])
        }
    }

    skilldexWindow = new WindowFrame(
        'art/intrface/skldxbox',
        {
            // Positions are in the 800×600 layout frame provided by
            // #uiStage; the stage centers those coordinates on screen.
            x: Config.ui.screenWidth - 185,
            y: Config.ui.screenHeight - 368 - 99,
        },
        185,
        368
    )
        .add(new FontWidget(65, 15, 'SKILLDEX', font3, '#FFD700'))

    // FO2-CE ref: skilldex.cc SkilldexSkill enum — 8 skills in order
    const skilldexSkills: [string, Skills][] = [
        ['Sneak',     Skills.Sneak],
        ['Lockpick',  Skills.Lockpick],
        ['Steal',     Skills.Steal],
        ['Traps',     Skills.Traps],
        ['First Aid', Skills.FirstAid],
        ['Doctor',    Skills.Doctor],
        ['Science',   Skills.Science],
        ['Repair',    Skills.Repair],
    ]

    let yPos = 49
    for (let i = 0; i < skilldexSkills.length; i++) {
        const [name, skill] = skilldexSkills[i]

        // Skill name — div-per-glyph for transparent background
        const nameWidget = new Widget(null, { x: 19, y: yPos - 5, w: 110, h: 24 })
        nameWidget.css({ cursor: 'pointer', display: 'flex', alignItems: 'flex-end' }).onClick(useSkill(skill))
        skilldexWindow.add(nameWidget)

        // Render text once font is loaded
        font3.onLoad(() => {
            const rendered = font3.renderText(name.toUpperCase(), '#FFD700')
            rendered.style.pointerEvents = 'none'
            nameWidget.elem.appendChild(rendered)
        })

        // FO2-CE ref: skilldex.cc — 3-digit skill value display next to each button
        const valWidget = new Widget(null, { x: 112, y: yPos - 2, w: 42, h: 28 })
        skillValueElems.push(valWidget.elem)
        skilldexWindow.add(valWidget)

        yPos += 36
    }

    skilldexWindow.add(
        new SmallButton(47, 339).onClick(() => { skilldexWindow.close() })
    )

    Object.assign(skilldexWindow.elem.style, {
        backgroundImage: `url('${skilldexWindow.background}.png')`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
        zIndex: '20',
        cursor: 'default',
    })

    // Drag-to-reposition from non-interactive areas of the skilldex frame,
    // matching the PipBoy / automap / inventory / character panels.
    makePanelDraggable(skilldexWindow.elem)

    // FO2-CE ref: skilldex.cc — update skill values when the skilldex is shown
    const origShow = skilldexWindow.show.bind(skilldexWindow)
    skilldexWindow.show = function() {
        const result = origShow()
        // Update displayed skill values from current player stats
        const player = globalState.player
        if (player) {
            for (let i = 0; i < skilldexSkills.length; i++) {
                const skillName = skilldexSkills[i][0]
                const val = player.getSkill(skillName)
                // FO2-CE: negative values (from Hard difficulty) shown in red
                const el = skillValueElems[i]
                while (el.firstChild) el.removeChild(el.firstChild)
                el.appendChild(renderBignum(val, 3, val < 0 ? 'red' : 'yellow'))
            }
        }
        return result
    }

    // FO2-CE ref: skilldex.cc — keyboard shortcuts: 1-8 for skills, ESC to close
    const skilldexKeyHandler = (e: KeyboardEvent) => {
        if (!skilldexWindow.showing) return

        if (e.key === 'Escape') {
            skilldexWindow.close()
            e.preventDefault()
            return
        }

        const num = parseInt(e.key)
        if (num >= 1 && num <= 8) {
            useSkill(skilldexSkills[num - 1][1])()
            e.preventDefault()
        }
    }
    document.addEventListener('keydown', skilldexKeyHandler)
}

// FO2-CE ref: options.cc — in-game options panel with Save/Load/Preferences/Quit/Done
function initOptionsMenu() {
    optionsWindow = new WindowFrame(
        'art/intrface/opbase',
        {
            x: (Config.ui.screenWidth - 200) / 2,
            y: (Config.ui.screenHeight - 260) / 2,
        },
        200,
        260
    )
        .add(new FontWidget(50, 15, 'OPTIONS', font3, '#FFD700'))

    // FO2-CE ref: options.cc — button order matches original: Save, Load, Preferences, Quit, Done
    const optionButtons: [string, () => void][] = [
        ['Save Game',   () => { optionsWindow.close(); uiSaveLoad(true) }],
        ['Load Game',   () => { optionsWindow.close(); uiSaveLoad(false) }],
        ['Preferences', () => { alert('Preferences not yet implemented.') }],
        ['Quit Game',   () => { if (confirm('Quit to main menu?')) window.location.reload() }],
        ['Done',        () => { optionsWindow.close() }],
    ]

    let yPos = 55
    for (const [label, handler] of optionButtons) {
        const btnWidget = new Widget('art/intrface/opbtnoff.png', { x: 32, y: yPos, w: 137, h: 33 })
            .mouseDownBG('art/intrface/opbtnon.png')
            .css({ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' })
            .onClick(handler)
        optionsWindow.add(btnWidget)

        font3.onLoad(() => {
            const rendered = font3.renderText(label.toUpperCase(), '#FFD700')
            rendered.style.pointerEvents = 'none'
            btnWidget.elem.appendChild(rendered)
        })

        yPos += 36
    }

    Object.assign(optionsWindow.elem.style, {
        backgroundImage: `url('${optionsWindow.background}.png')`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: '100% 100%',
        zIndex: '20',
        cursor: 'default',
    })

    makePanelDraggable(optionsWindow.elem)

    // FO2-CE ref: options.cc — S=Save, L=Load, P=Preferences, ESC/D=Done
    const optionsKeyHandler = (e: KeyboardEvent) => {
        if (!optionsWindow.showing) return

        switch (e.key.toLowerCase()) {
            case 's': optionsWindow.close(); uiSaveLoad(true); e.preventDefault(); break
            case 'l': optionsWindow.close(); uiSaveLoad(false); e.preventDefault(); break
            case 'p': alert('Preferences not yet implemented.'); e.preventDefault(); break
            case 'd':
            case 'escape': optionsWindow.close(); e.preventDefault(); break
        }
    }
    document.addEventListener('keydown', optionsKeyHandler)
}

function initCharacterScreen() {
    const player = globalState.player!
    const skillList = new List({ x: 380, y: 25, w: 'auto', h: 'auto' })

    skillList.css({ fontSize: '0.69em', color: 'rgb(0, 255, 0)' })

    // FO2-CE ref: stat.cc pcGetExperienceForLevel() — XP needed for next level
    const currentLevel = player.getStat('Level')
    const nextLevelXP = Math.floor((currentLevel + 1) * currentLevel / 2) * 1000

    // Skill point bignum container
    const skillPointBignumW = new Widget(null, { x: 523, y: 228, w: 28, h: 28 })
    const skillPointBignumEl = skillPointBignumW.elem

    // Panel 2: Hit Points + condition flags (upper status box)
    const panel2 = new Widget(null, { x: 196, y: 43, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel2El = panel2.elem

    // Panel 3: derived stats (lower status box)
    const panel3 = new Widget(null, { x: 196, y: 176, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel3El = panel3.elem

    // Slider widget elements (initially hidden)
    const sliderContainer = document.createElement('div')
    Object.assign(sliderContainer.style, {
        position: 'absolute',
        display: 'none',
        zIndex: '10',
    })

    const sliderBody = document.createElement('div')
    Object.assign(sliderBody.style, {
        position: 'absolute',
        width: '43px',
        height: '30px',
        backgroundImage: "url('art/intrface/slider.png')",
        backgroundRepeat: 'no-repeat',
        left: '130px',
        top: '14px',
    })

    const plusBtn = document.createElement('div')
    Object.assign(plusBtn.style, {
        position: 'absolute',
        width: '22px',
        height: '12px',
        backgroundImage: "url('art/intrface/splsoff.png')",
        backgroundRepeat: 'no-repeat',
        cursor: 'pointer',
        left: '152px',
        top: '17px',
        zIndex: '1',
    })

    const minusBtn = document.createElement('div')
    Object.assign(minusBtn.style, {
        position: 'absolute',
        width: '22px',
        height: '12px',
        backgroundImage: "url('art/intrface/snegoff.png')",
        backgroundRepeat: 'no-repeat',
        cursor: 'pointer',
        left: '152px',
        top: '29px',
        zIndex: '1',
    })

    sliderContainer.appendChild(sliderBody)
    sliderContainer.appendChild(plusBtn)
    sliderContainer.appendChild(minusBtn)

    const doneButton = new SmallButton(455, 454)

    characterWindow = new WindowFrame(
        'art/intrface/edtredt.png',
        {
            x: Config.ui.screenWidth / 2 - 640 / 2,
            y: Config.ui.screenHeight - 99 - 480,
        },
        640,
        480
    )
        // FO2-CE ref: editor.cc — Print / Done / Cancel buttons
        .add(new SmallButton(345, 454))
        .add(makeFontLabel(345 + 18, 454, 'PRINT', font3).css({ pointerEvents: 'none' }))
        .add(doneButton)
        .add(makeFontLabel(455 + 18, 454, 'DONE', font3).css({ pointerEvents: 'none' }))
        .add(
            new SmallButton(552, 454).onClick(() => {
                characterWindow.close()
            })
        )
        .add(makeFontLabel(552 + 18, 454, 'CANCEL', font3).css({ pointerEvents: 'none' }))
        .add(makeFontLabel(22, 6, 'Name', font3))
        .add(makeFontLabel(160, 6, 'Age', font1))
        .add(makeFontLabel(242, 6, 'Gender', font3))
        .add(
            new Label(33, 278, `Level: ${currentLevel}`).css({
                fontSize: '0.69em',
                color: '#00FF00',
            })
        )
        .add(
            new Label(33, 289, `Exp: ${player.getStat('Experience')}`).css({
                fontSize: '0.69em',
                color: '#00FF00',
            })
        )
        .add(
            new Label(33, 300, `Next Level: ${nextLevelXP}`).css({
                fontSize: '0.69em',
                color: '#00FF00',
            })
        )
        .add(makeFontLabel(380, 5, 'Skills', font3))
        .add(makeFontLabel(399, 233, 'Skill Points', font3))
        .add(panel2)
        .add(panel3)
        .add(skillList)
        .add(skillPointBignumW)
        .show()

    characterWindow.elem.appendChild(sliderContainer)

    // --- Folder tab strip (Perks / Karma / Kills) ---
    const FOLDER_TABS = [
        { label: 'PERKS',  sprite: 'art/intrface/perksfdr.png' },
        { label: 'KARMA',  sprite: 'art/intrface/karmafdr.png' },
        { label: 'KILLS',  sprite: 'art/intrface/killsfdr.png' },
    ]

    const tabStripEl = document.createElement('div')
    Object.assign(tabStripEl.style, {
        position: 'absolute',
        left: '15px',
        top: '330px',
    })

    const tabImg = document.createElement('img')
    tabImg.src = FOLDER_TABS[0].sprite
    tabImg.style.display = 'block'
    tabImg.style.pointerEvents = 'none'
    tabStripEl.appendChild(tabImg)

    // Three equal click regions overlaid on the image
    const tabOverlayEl = document.createElement('div')
    Object.assign(tabOverlayEl.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        display: 'flex',
    })
    tabStripEl.appendChild(tabOverlayEl)

    // Content panel below the tab strip (placeholder divs per folder)
    const tabContentEl = document.createElement('div')
    Object.assign(tabContentEl.style, {
        position: 'absolute',
        left: '15px',
        top: '395px',
        fontSize: '0.69em',
        color: '#00FF00',
    })

    const folderPanels: HTMLElement[] = FOLDER_TABS.map((t, i) => {
        const panel = document.createElement('div')
        panel.textContent = t.label  // placeholder — to be filled in later
        panel.style.display = i === 0 ? 'block' : 'none'
        tabContentEl.appendChild(panel)
        return panel
    })

    let activeFolder = 0
    const activateFolder = (idx: number) => {
        activeFolder = idx
        tabImg.src = FOLDER_TABS[idx].sprite
        folderPanels.forEach((p, i) => { p.style.display = i === idx ? 'block' : 'none' })
    }

    FOLDER_TABS.forEach((tab, idx) => {
        const region = document.createElement('div')
        Object.assign(region.style, {
            flex: '1',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })
        region.onclick = () => activateFolder(idx)

        font3.onLoad(() => {
            const lbl = font3.renderText(tab.label, '#FFD700')
            lbl.style.pointerEvents = 'none'
            region.appendChild(lbl)
        })

        tabOverlayEl.appendChild(region)
    })

    characterWindow.elem.appendChild(tabStripEl)
    characterWindow.elem.appendChild(tabContentEl)

    // Drag-to-reposition from non-interactive areas of the frame.
    makePanelDraggable(characterWindow.elem)

    // ── Info card (FO2-CE ref: editor.cc characterEditorDrawCard) ────────────
    //  Always-visible panel that updates its content whenever the player clicks
    //  any interactive element (SPECIAL stats, skills, conditions, derived stats).

    const SPECIAL_FULL_NAMES: Record<string, string> = {
        STR: 'Strength', PER: 'Perception', END: 'Endurance',
        CHA: 'Charisma', INT: 'Intelligence', AGI: 'Agility', LUK: 'Luck',
    }
    const SPECIAL_DESCRIPTIONS: Record<string, string> = {
        STR: 'Raw physical strength. A high Strength is good for physical characters. Modifies: Hit Points, Melee Damage, and Carry Weight.',
        PER: 'The ability to see, hear, taste and notice unusual things. A high Perception is important for a sharpshooter.  Modifies: Sequence and ranged combat distance modifiers.',
        END: 'Stamina and physical toughness. A character with a high Endurance will survive where others may not. Modifies: Hit Points, Poison & Radiation Resistance, Healing Rate, and the additional hit points per level.',
        CHA: 'A combination of appearance and charm. A high Charisma is important for characters that want to influence people with words. Modifies: NPC reactions, and barter prices.',
        INT: 'Knowledge, wisdom and the ability to think quickly. A high Intelligence is important for any character. Modifies: the number of new skill points per level, dialogue options, and many skills.',
        AGI: 'Coordination and the ability to move well. A high Agility is important for any active character. Modifies: Action Points, Armor Class, Sequence, and many skills.',
        LUK: 'Fate. Karma. An extremely high or low Luck will affect the character - somehow. Events and situations will be changed by how lucky (or unlucky) your character is.',
    }
    const SKILL_DESCRIPTIONS: Record<string, string> = {
        'Small Guns':     'The use, care and general knowledge of small firearms - pistols, SMGs and rifles.',
        'Big Guns':       'The operation and maintenance of really big guns - miniguns, rocket launchers, flamethrowers and such.',
        'Energy Weapons': 'The care and feeding of energy-based weapons.  How to arm and operate weapons that use laser or plasma technology.',
        'Unarmed':        'A combination of martial arts, boxing and other hand-to-hand martial arts.  Combat with your hands and feet.',
        'Melee Weapons':  'Using non-ranged weapons in hand-to-hand, or melee combat - knives, sledgehammers, spears, clubs and so on.',
        'Throwing':       'The skill of muscle-propelled ranged weapons, such as throwing knives, spears and grenades.',
        'First Aid':      'General healing skill.  Used to heal small cuts, abrasions and other minor ills.  In game terms, the use of first aid can heal more hit points over time than just rest.',
        'Doctor':         'The healing of major wounds and crippled limbs.  Without this skill, it will take a much longer period of time to restore crippled limbs to use.',
        'Sneak':          'Quiet movement, and the ability to remain unnoticed. If successful, you will be much harder to locate. You cannot run and sneak at the same time.',
        'Lockpick':       'The skill of opening locks without the proper key. The use of lockpicks or electronic lockpicks will greatly enhance this skill.',
        'Steal':          'The ability to make the things of others your own.  Can be used to steal from people or places.',
        'Traps':          'The finding and removal of traps.  Also the setting of explosives for demolition purposes.',
        'Science':        'Covers a variety of high technology skills, such as computers, biology, physics and geology.',
        'Repair':         'The practical application of the Science skill for fixing broken equipment, machinery and electronics.',
        'Speech':         'The ability to communicate in a practical and efficient manner. The skill of convincing others that your position is correct. The ability to lie and not get caught.',
        'Barter':         'Trading and trade-related tasks. The ability to get better prices for items you sell, and lower prices for items you buy.',
        'Gambling':       'The knowledge and practical skills related to wagering. The skill at cards, dice and other games.',
        'Outdoorsman':    'Practical knowledge of the outdoors, and the ability to live off the land. The knowledge of plants and animals.',
    }
    const DERIVED_DESCRIPTIONS: Record<string, string> = {
        'Armor Class':          'Armor Class: reduces chance of being hit.',
        'Action Points':        'Action Points: how many actions you can take per turn.',
        'Carry Weight':         'Maximum weight you can carry.',
        'Melee Damage':         'Bonus damage added to melee attacks.',
        'Damage Resistance':    'Percentage of damage absorbed.',
        'Poison Resistance':    'Resistance to poison effects.',
        'Radiation Resistance': 'Resistance to radiation.',
        'Sequence':             'Determines order of action in combat.',
        'Healing Rate':         'HP recovered per rest period.',
        'Critical Chance':      'Base chance to score a critical hit.',
    }
    const CONDITION_DESCRIPTIONS: Record<string, string> = {
        'Poisoned':           'You are poisoned. Lose HP over time until treated.',
        'Radiated':           'You have absorbed radiation. High levels are fatal.',
        'Eye Damage':         'Your eyes are damaged. Perception is reduced.',
        'Crippled Right Arm': 'Your arm is crippled. Combat effectiveness reduced.',
        'Crippled Left Arm':  'Your arm is crippled. Combat effectiveness reduced.',
        'Crippled Right Leg': 'Your leg is crippled. Movement is impaired.',
        'Crippled Left Leg':  'Your leg is crippled. Movement is impaired.',
    }

    // FO2-CE ref: character_editor.cc — image paths used in characterEditorDrawCard()
    const SPECIAL_IMG: Record<string, string> = {
        STR: 'art/skilldex/strength.png',
        PER: 'art/skilldex/perceptn.png',
        END: 'art/skilldex/endur.png',
        CHA: 'art/skilldex/charisma.png',
        INT: 'art/skilldex/intel.png',
        AGI: 'art/skilldex/agility.png',
        LUK: 'art/skilldex/luck.png',
    }
    const SKILL_IMG: Record<string, string> = {
        'Small Guns':     'art/skilldex/gunsml.png',
        'Big Guns':       'art/skilldex/gunbig.png',
        'Energy Weapons': 'art/skilldex/energywp.png',
        'Unarmed':        'art/skilldex/hnd2hnd.png',
        'Melee Weapons':  'art/skilldex/melee.png',
        'Throwing':       'art/skilldex/throwing.png',
        'First Aid':      'art/skilldex/firstaid.png',
        'Doctor':         'art/skilldex/doctor.png',
        'Sneak':          'art/skilldex/sneak.png',
        'Lockpick':       'art/skilldex/lockpick.png',
        'Steal':          'art/skilldex/pickpock.png',
        'Traps':          'art/skilldex/traps.png',
        'Science':        'art/skilldex/science.png',
        'Repair':         'art/skilldex/repair.png',
        'Speech':         'art/skilldex/speech.png',
        'Barter':         'art/skilldex/barter.png',
        'Gambling':       'art/skilldex/gambling.png',
        'Outdoorsman':    'art/skilldex/outdoors.png',
    }
    const DERIVED_IMG: Record<string, string> = {
        'Armor Class':          'art/skilldex/armorcls.png',
        'Action Points':        'art/skilldex/actionpt.png',
        'Carry Weight':         'art/skilldex/carryamt.png',
        'Melee Damage':         'art/skilldex/meleedam.png',
        'Damage Resistance':    'art/skilldex/damresis.png',
        'Poison Resistance':    'art/skilldex/poisnres.png',
        'Radiation Resistance': 'art/skilldex/radresis.png',
        'Sequence':             'art/skilldex/sequence.png',
        'Healing Rate':         'art/skilldex/healrate.png',
        'Critical Chance':      'art/skilldex/critchnc.png',
    }
    const CONDITION_IMG: Record<string, string> = {
        'Poisoned':           'art/skilldex/poisoned.png',
        'Radiated':           'art/skilldex/radiated.png',
        'Eye Damage':         'art/skilldex/eyedamag.png',
        'Crippled Right Arm': 'art/skilldex/armright.png',
        'Crippled Left Arm':  'art/skilldex/armleft.png',
        'Crippled Right Leg': 'art/skilldex/legright.png',
        'Crippled Left Leg':  'art/skilldex/legleft.png',
    }
    const TRAIT_DESCRIPTIONS: Record<string, string> = {
        'Fast Metabolism': 'Your metabolic rate is twice normal.  This means that you are much less resistant to radiation and poison, but your body heals faster.',
        'Bruiser':         'A little slower, but a little bigger.  You may not hit as often, but they will feel it when you do!  Your total action points are lowered, but your Strength is increased.',
        'Small Frame':     "You are not quite as big as the other villagers, but that never slowed you down.  You can't carry as much, but you are more agile.",
        'One Hander':      'One of your hands is very dominant.  You excel with single-handed weapons, but two-handed weapons cause a problem.',
        'Finesse':         'Your attacks show a lot of finesse.  You don\'t do as much damage, but you cause more critical hits.',
        'Kamikaze':        'By not paying attention to any threats, you can act a lot faster in a turn.  This lowers your armor class to just what you are wearing, but you sequence much faster in a combat turn.',
        'Heavy Handed':    'You swing harder, not better.  Your attacks are very brutal, but lack finesse.  You rarely cause a good critical, but you always do more melee damage.',
        'Fast Shot':       'You don\'t have time to aim for a targeted attack, because you attack faster than normal people.  It costs you one less action point for guns and thrown weapons.',
        'Bloody Mess':     'By some strange twist of fate, people around you die violently.  You always see the worst way a person can die.',
        'Jinxed':          'The good thing is that everyone around you has more critical failures in combat, the bad thing is so do you!',
        'Good Natured':    'You studied less-combative skills as you were growing up.  Your combat skills start at a lower level, but First Aid, Doctor, Speech and Barter are substantially improved.',
        'Chem Reliant':    'You are more easily influenced by chems.  Your chance to be reliant by chem use is twice normal, but you recover faster from their ill effects.',
        'Chem Resistant':  'Chems only affect you half as long as normal, but your chance to be reliant is also only 50% of normal.',
        'Sex Appeal':      'You\'ve got the "right" stuff.  Members of the opposite sex are attracted to you, but those of the same sex tend to become quite jealous.',
        'Skilled':         'Since you spent more time improving your skills than a normal person, you gain 5 additional skill points per experience level. The tradeoff is that you do not gain as many extra abilities. You gain a perk every four levels.',
        'Gifted':          'You have more innate abilities than most, so you have not spent as much time honing your skills.  Your primary statistics are each +1, but you lose -10% on all skills to start, and receive 5 less skill points per level.',
    }
    const TRAIT_IMG: Record<string, string> = {
        'Fast Metabolism': 'art/skilldex/fastmeta.png',
        'Bruiser':         'art/skilldex/bruiser.png',
        'Small Frame':     'art/skilldex/smlframe.png',
        'One Hander':      'art/skilldex/onehand.png',
        'Finesse':         'art/skilldex/finesse.png',
        'Kamikaze':        'art/skilldex/kamikaze.png',
        'Heavy Handed':    'art/skilldex/heavyhnd.png',
        'Fast Shot':       'art/skilldex/fastshot.png',
        'Bloody Mess':     'art/skilldex/bldmess.png',
        'Jinxed':          'art/skilldex/jinxed.png',
        'Good Natured':    'art/skilldex/goodnatr.png',
        'Chem Reliant':    'art/skilldex/chemrely.png',
        'Chem Resistant':  'art/skilldex/chemrst.png',
        'Sex Appeal':      'art/skilldex/sexappel.png',
        'Skilled':         'art/skilldex/skilled.png',
        'Gifted':          'art/skilldex/gifted.png',
    }

    const infoCardEl = document.createElement('div')
    Object.assign(infoCardEl.style, {
        position: 'absolute',
        left: '348px',
        top: '274px',
        width: '265px',
        height: '156px',
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        pointerEvents: 'none',
    })

    const cardImgEl = document.createElement('img') as HTMLImageElement
    Object.assign(cardImgEl.style, {
        width: '60px',
        height: '75px',
        flexShrink: '0',
        objectFit: 'contain',
        margin: '8px 6px 8px 8px',
        alignSelf: 'flex-start',
        visibility: 'hidden',
    })
    cardImgEl.onload = () => { cardImgEl.style.visibility = 'visible' }
    cardImgEl.onerror = () => { cardImgEl.style.visibility = 'hidden' }
    infoCardEl.appendChild(cardImgEl)

    const cardTextEl = document.createElement('div')
    Object.assign(cardTextEl.style, {
        flex: '1',
        padding: '6px 6px 6px 0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    })
    infoCardEl.appendChild(cardTextEl)

    const cardTitleEl = document.createElement('div')
    cardTextEl.appendChild(cardTitleEl)

    const cardDescEl = document.createElement('div')
    Object.assign(cardDescEl.style, {
        fontSize: '0.69em',
        color: 'rgb(0,255,0)',
        overflow: 'hidden',
        lineHeight: '1.3',
    })
    cardTextEl.appendChild(cardDescEl)

    const showInfoCard = (title: string, desc: string, imgPath?: string): void => {
        while (cardTitleEl.firstChild) cardTitleEl.removeChild(cardTitleEl.firstChild)
        cardTitleEl.appendChild(font3.renderText(title.toUpperCase(), '#FFD700'))
        cardDescEl.textContent = desc
        if (imgPath) {
            cardImgEl.src = imgPath
        } else {
            cardImgEl.src = ''
            cardImgEl.style.visibility = 'hidden'
        }
    }

    characterWindow.elem.appendChild(infoCardEl)
    // ── end info card ─────────────────────────────────────────────────────────

    const skills = [
        'Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons',
        'Throwing', 'First Aid', 'Doctor', 'Sneak', 'Lockpick', 'Steal', 'Traps',
        'Science', 'Repair', 'Speech', 'Barter', 'Gambling', 'Outdoorsman',
    ]

    const stats = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']

    const statValueWidgets: HTMLElement[] = []
    const statCommentLabels: Label[] = []

    let selectedStat = stats[0]

    let n = 0
    for (const stat of stats) {
        const valW = new Widget(null, { x: 59, y: 37 + n, w: 28, h: 28 })
        valW.css({ cursor: 'pointer' }).onClick(() => {
            selectedStat = stat
            showInfoCard(SPECIAL_FULL_NAMES[stat], SPECIAL_DESCRIPTIONS[stat], SPECIAL_IMG[stat])
        })
        statValueWidgets.push(valW.elem)
        characterWindow.add(valW)

        const commentLbl = new Label(105, 43 + n, '', '#00FF00').css({ fontSize: '0.69em' }) as Label
        statCommentLabels.push(commentLbl)
        characterWindow.add(commentLbl)

        n += 33
    }

    const newStatSet = player.stats.clone()
    const newSkillSet = player.skills.clone()
    const playerSkillOpts = { isPlayer: true, perks: player.perks }

    // Snapshot opening base values — cannot decrement below these
    const openingBaseSkills: { [name: string]: number } = {}
    for (const skill of skills) {
        openingBaseSkills[skill] = newSkillSet.getBase(skill)
    }

    let selectedSkill: string | null = null

    const positionSlider = () => {
        if (!selectedSkill) {
            sliderContainer.style.display = 'none'
            return
        }
        const idx = skills.indexOf(selectedSkill)
        if (idx === -1) {
            sliderContainer.style.display = 'none'
            return
        }
        const listEl = skillList.elem
        const itemEl = listEl.children[idx] as HTMLElement | undefined
        if (!itemEl) {
            sliderContainer.style.display = 'none'
            return
        }
        const listLeft = parseInt(listEl.style.left || '0')
        const listTop = parseInt(listEl.style.top || '0')
        const rowY = listTop + itemEl.offsetTop
        const rowRight = listLeft + itemEl.offsetWidth + 4
        sliderContainer.style.left = `${rowRight}px`
        sliderContainer.style.top = `${rowY - 23}px`
        sliderContainer.style.display = 'block'
    }

    const updateSkillPointBignum = () => {
        while (skillPointBignumEl.firstChild) skillPointBignumEl.removeChild(skillPointBignumEl.firstChild)
        skillPointBignumEl.appendChild(renderBignum(newSkillSet.skillPoints, 2))
    }

    // FO2-CE ref: editor.cc gCharacterEditorPrimaryStatDescriptions — value → adjective
    const STAT_COMMENTS = [
        '', 'Terrible', 'Bad', 'Poor', 'Fair', 'Average',
        'Good', 'Very Good', 'Great', 'Excellent', 'Heroic',
    ]

    // FO2-CE ref: editor.cc EDITOR_* condition flags
    const CONDITIONS: Array<[string, () => boolean]> = [
        ['Poisoned',            () => player.getStat('Poison Level') > 0],
        ['Radiated',            () => player.getStat('Radiation Level') > 0],
        ['Eye Damage',          () => !!player.isBlinded],
        ['Crippled Right Arm',  () => !!player.crippledRightArm],
        ['Crippled Left Arm',   () => !!player.crippledLeftArm],
        ['Crippled Right Leg',  () => !!player.crippledRightLeg],
        ['Crippled Left Leg',   () => !!player.crippledLeftLeg],
    ]

    const renderPanel2 = () => {
        while (panel2El.firstChild) panel2El.removeChild(panel2El.firstChild)

        const hp = document.createElement('div')
        hp.textContent = `Hit Points: ${player.getStat('HP')} / ${player.getStat('Max HP')}`
        panel2El.appendChild(hp)

        for (const [label, active] of CONDITIONS) {
            const line = document.createElement('div')
            line.textContent = label
            line.style.opacity = active() ? '1' : '0.3'
            line.style.cursor = 'pointer'
            line.onclick = () => showInfoCard(label, CONDITION_DESCRIPTIONS[label] ?? label, CONDITION_IMG[label])
            panel2El.appendChild(line)
        }
    }

    const renderPanel3 = () => {
        while (panel3El.firstChild) panel3El.removeChild(panel3El.firstChild)

        const rows: Array<[string, string | number]> = [
            ['Armor Class',          newStatSet.get('AC')],
            ['Action Points',        newStatSet.get('AP')],
            ['Carry Weight',         newStatSet.get('Carry')],
            ['Melee Damage',         newStatSet.get('Melee')],
            ['Damage Resistance',    `${newStatSet.get('DR Normal')}%`],
            ['Poison Resistance',    `${newStatSet.get('DR Poison')}%`],
            ['Radiation Resistance', `${newStatSet.get('DR Radiation')}%`],
            ['Sequence',             newStatSet.get('Sequence')],
            ['Healing Rate',         newStatSet.get('Healing Rate')],
            ['Critical Chance',      `${newStatSet.get('Critical Chance')}%`],
        ]
        for (const [label, value] of rows) {
            const line = document.createElement('div')
            line.textContent = `${label}: ${value}`
            line.style.cursor = 'pointer'
            line.onclick = () => showInfoCard(label, DERIVED_DESCRIPTIONS[label] ?? label, DERIVED_IMG[label])
            panel3El.appendChild(line)
        }
    }

    const redrawStatsSkills = () => {
        const prevSelected = selectedSkill
        skillList.clear()

        for (const skill of skills) {
            const val = newSkillSet.get(skill, newStatSet, playerSkillOpts)
            skillList.addItem({ text: `${skill} ${val}%`, id: skill })
        }

        // Re-select previously selected skill
        if (prevSelected) {
            skillList.selectId(prevSelected)
        }

        for (let i = 0; i < stats.length; i++) {
            const el = statValueWidgets[i]
            while (el.firstChild) el.removeChild(el.firstChild)
            const value = newStatSet.get(stats[i])
            el.appendChild(renderBignum(value, 2))

            const clamped = Math.max(1, Math.min(10, value))
            statCommentLabels[i].setText(STAT_COMMENTS[clamped])
        }

        updateSkillPointBignum()
        renderPanel2()
        renderPanel3()

        positionSlider()
    }

    skillList.onItemSelected((item) => {
        selectedSkill = item.id
        positionSlider()
        showInfoCard(item.id, SKILL_DESCRIPTIONS[item.id] ?? item.id, SKILL_IMG[item.id])
    })

    const modifySkill = (inc: boolean) => {
        if (!selectedSkill) return

        if (inc) {
            const changed = newSkillSet.incBase(selectedSkill, newStatSet, playerSkillOpts)
            if (!changed) {
                console.warn('Not enough skill points or at skill cap!')
            }
        } else {
            const currentBase = newSkillSet.getBase(selectedSkill)
            if (currentBase <= openingBaseSkills[selectedSkill]) return
            newSkillSet.decBase(selectedSkill, newStatSet, playerSkillOpts)
        }

        redrawStatsSkills()
    }

    const wireSkillButton = (
        btn: HTMLElement,
        onSprite: string,
        offSprite: string,
        inc: boolean
    ) => {
        let repeatTimer: number | null = null
        const stopRepeat = () => {
            if (repeatTimer !== null) { clearInterval(repeatTimer); repeatTimer = null }
        }
        btn.onmousedown = () => {
            btn.style.backgroundImage = `url('${onSprite}')`
            modifySkill(inc)
            repeatTimer = window.setInterval(() => modifySkill(inc), 100)
        }
        btn.onmouseup = () => {
            btn.style.backgroundImage = `url('${offSprite}')`
            stopRepeat()
        }
        btn.onmouseleave = () => {
            btn.style.backgroundImage = `url('${offSprite}')`
            stopRepeat()
        }
    }

    wireSkillButton(plusBtn, 'art/intrface/splson.png', 'art/intrface/splsoff.png', true)
    wireSkillButton(minusBtn, 'art/intrface/snegon.png', 'art/intrface/snegoff.png', false)

    redrawStatsSkills()
    showInfoCard(SPECIAL_FULL_NAMES['STR'], SPECIAL_DESCRIPTIONS['STR'], SPECIAL_IMG['STR'])

    // Stat level up buttons (char creation only)
    const canChangeStats = false
    if (canChangeStats) {
        const modifyStat = (change: number) => {
            newStatSet.modifyBase(selectedStat, change)
            redrawStatsSkills()
        }

        characterWindow.add(
            new Label(115, 260, '-').onClick(() => { modifyStat(-1) })
        )
        characterWindow.add(
            new Label(135, 260, '+').onClick(() => { modifyStat(+1) })
        )
    }

    // FO2-CE ref: editor.cc — Done button: write cloned stats/skills back to player
    doneButton.onClick(() => {
        player.skills.baseSkills = Object.assign({}, newSkillSet.baseSkills)
        player.skills.tagged = newSkillSet.tagged.slice()
        player.skills.skillPoints = newSkillSet.skillPoints
        player.skills.hasTagPerk = newSkillSet.hasTagPerk

        if (canChangeStats) {
            player.stats.baseStats = Object.assign({}, newStatSet.baseStats)
        }

        console.log('[CharScreen] Changes saved.')
        characterWindow.close()
    })
}

export enum UIMode {
    none = 0,
    dialogue = 1,
    barter = 2,
    loot = 3,
    inventory = 4,
    worldMap = 5,
    elevator = 6,
    calledShot = 7,
    skilldex = 8,
    useSkill = 9,
    contextMenu = 10,
    saveLoad = 11,
    char = 12,
    pipBoy = 13,
    automap = 14,
    options = 15,
}

// XXX: Should this throw if the element doesn't exist?
function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function $img(id: string): HTMLImageElement {
    return document.getElementById(id) as HTMLImageElement
}

function $q(selector: string): HTMLElement {
    return document.querySelector(selector) as HTMLElement
}

function $qa(selector: string): HTMLElement[] {
    return Array.from(document.querySelectorAll(selector))
}

function clearEl($el: HTMLElement): void {
    $el.innerHTML = ''
}

function show($el: HTMLElement): void {
    $el.style.display = 'block'
}

function hide($el: HTMLElement): void {
    $el.style.display = 'none'
}

// TODO: Examine if we actually need visibility or we can replace them all with show/hide
export function showv($el: HTMLElement): void {
    $el.style.visibility = 'visible'
}

export function hidev($el: HTMLElement): void {
    $el.style.visibility = 'hidden'
}

function off($el: HTMLElement, events: string): void {
    const eventList = events.split(' ')
    for (const event of eventList) {
        ;(<any>$el)['on' + event] = null
    }
}

function appendHTML($el: HTMLElement, html: string): void {
    $el.insertAdjacentHTML('beforeend', html)
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

export function makeEl(tag: string, options: ElementOptions): HTMLElement {
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

export function initUI() {
    uiInit()

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

    for (let i = 0; i < 2; i++) {
        for (const $chance of Array.from(document.querySelectorAll('#calledShotBox .calledShotChance'))) {
            $chance.appendChild(
                makeEl('div', { classes: ['number'], style: { left: i * 9 + 'px' }, id: 'digit' + (i + 1) })
            )
        }
    }

    $id('calledShotCancelBtn').onclick = () => {
        uiCloseCalledShot()
    }

    /*
    $id("worldmapViewButton").onclick = () => {
        var onAreaMap = ($("#areamap").css("visibility") === "visible")
        if(onAreaMap)
            uiWorldMapWorldView()
        else {
            var currentArea = areaContainingMap(gMap.name)
            if(currentArea)
                uiWorldMapShowArea(currentArea)
            else
                uiWorldMapAreaView()
        }
    }
    */

    $id('inventoryButton').onclick = () => {
        if (isInventoryOpen()) { closeInventoryPanel(); return }
        closeAllPanels()
        uiInventoryScreen()
    }

    $id('optionsButton').onclick = () => {
        if (isOptionsOpen()) { optionsWindow.close(); return }
        closeAllPanels()
        optionsWindow.show()
    }
    // Inventory panel is a static DOM element — wire drag once at init.
    makePanelDraggable($id('inventoryBox'))
    $id('inventoryDoneButton').onclick = () => {
        globalState.uiMode = UIMode.none
        $id('inventoryBox').style.visibility = 'hidden'
        globalState.player.clearAnim()
        uiDrawWeapon()
    }

    $id('lootBoxDoneButton').onclick = () => {
        uiEndLoot()
    }

    $id('handSwapButton').onclick = () => {
        const p = globalState.player as any
        const player = globalState.player
        const nextHand: 'leftHand' | 'rightHand' = p.activeHand === 'leftHand' ? 'rightHand' : 'leftHand'
        player.playWeaponSwapAnim(() => {
            p.activeHand = nextHand
            uiDrawWeapon()
        })
    }

    /** Attempt to reload weaponObj from inventory. Returns true if rounds were loaded. */
    function reloadWeapon(weaponObj: Obj): boolean {
        const w = weaponObj as any
        const ammoPID: number | undefined = w.pro?.extra?.ammoPID
        const maxAmmo: number = w.pro?.extra?.maxAmmo ?? 0
        const currentRounds: number = w.pro?.extra?.rounds ?? 0
        if (maxAmmo <= 0 || currentRounds >= maxAmmo) return false

        // Find compatible ammo in inventory by matching pid
        const inv = globalState.player.inventory as any[]
        const ammoIdx = inv.findIndex((item) => item.pid === ammoPID)
        if (ammoIdx === -1) {
            uiLog("No compatible ammo in inventory.")
            return false
        }

        const ammoItem = inv[ammoIdx]
        const needed = maxAmmo - currentRounds
        const available: number = ammoItem.amount ?? 1
        const toLoad = Math.min(needed, available)

        w.pro.extra.rounds = currentRounds + toLoad
        ammoItem.amount = available - toLoad
        if (ammoItem.amount <= 0) inv.splice(ammoIdx, 1)

        uiLog(`Reloaded ${toLoad} round${toLoad !== 1 ? 's' : ''}.`)
        return true
    }

    $id('attackButtonContainer').onclick = () => {
        // Reload mode: immediately reload from inventory (AP cost in combat)
        const wep = globalState.player.equippedWeapon
        if (wep?.weapon?.mode === 'reload') {
            if (globalState.inCombat && globalState.player.AP) {
                const reloadAP = 2 // TODO: read from weapon PRO (reloadAP field)
                if (globalState.player.AP.getAvailableCombatAP() < reloadAP) {
                    uiLog("You don't have enough action points.")
                    return
                }
                globalState.player.AP.subtractCombatAP(reloadAP)
                uiUpdateCombatAP()
            }
            reloadWeapon(wep)
            wep.weapon.mode = 'single'
            uiDrawWeapon()
            return
        }

        if (!Config.engine.doCombat) {
            return
        }
        if (globalState.inCombat) {
            // clicking gun in combat → switch to attack cursor
            globalState.cursorMode = 'attack'
        } else {
            // begin combat and switch to attack cursor
            Combat.start()
            globalState.cursorMode = 'attack'
        }
    }

    $id('attackButtonContainer').oncontextmenu = () => {
        // right mouse button (cycle weapon modes)
        const wep = globalState.player.equippedWeapon
        if (!wep || !wep.weapon) {
            // Cycle unarmed mode
            const skill = globalState.player!.getSkill('Unarmed')
            globalState.unarmedModeIdx = nextUnarmedModeIdx(skill, globalState.unarmedModeIdx)
            const mode = getActiveUnarmedMode(skill, globalState.unarmedModeIdx)
            uiLog(`Unarmed: ${mode.name}`)
            uiDrawWeapon()
            return false
        }
        wep.weapon.cycleMode()
        uiDrawWeapon()
        return false
    }

    $id('endTurnButton').onclick = () => {
        if (globalState.inCombat && globalState.combat!.inPlayerTurn) {
            if (globalState.player.anim !== null && globalState.player.anim !== 'idle') {
                console.log("[Combat] can't end turn while player is in an animation")
                return
            }
            console.log('[Combat] player turn ended')
            globalState.combat!.nextTurn()
        }
    }

    $id('endCombatButton').onclick = () => {
        if (globalState.inCombat) {
            globalState.combat!.end()
        }
    }

    $id('endContainer').addEventListener('animationiteration', uiEndCombatAnimationDone)
    $id('endContainer').addEventListener('webkitAnimationIteration', uiEndCombatAnimationDone)

    $id('skilldexButton').onclick = () => {
        // Toggle: pressing while open closes it; otherwise close any other
        // open panel first and open skilldex.
        if (isSkilldexOpen()) { skilldexWindow.close(); return }
        closeAllPanels()
        skilldexWindow.show()
    }

    function makeScrollable($el: HTMLElement, scroll = 60) {
        $el.onwheel = (e: WheelEvent) => {
            const delta = e.deltaY > 0 ? 1 : -1
            $el.scrollTop = $el.scrollTop + scroll * delta
            e.preventDefault()
        }
    }

    makeScrollable($id('inventoryBoxList'))

    makeScrollable($id('barterBoxInventoryLeft'))
    makeScrollable($id('barterBoxInventoryRight'))
    makeScrollable($id('barterBoxLeft'))
    makeScrollable($id('barterBoxRight'))
    makeScrollable($id('lootBoxLeft'))
    makeScrollable($id('lootBoxRight'))
    makeScrollable($id('worldMapLabels'))
    makeScrollable($id('displayLog'))
    makeScrollable($id('dialogueBoxReply'), 30)

    drawHP(globalState.player.getStat('HP'))
    drawAC(globalState.player.getStat('AC'))
    uiDrawWeapon()
}

function uiHideContextMenu() {
    globalState.uiMode = UIMode.none
    globalState.cursorMode = 'move'
    $id('itemContextMenu').style.visibility = 'hidden'
}

export { uiHideContextMenu }

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
    const cancelBtn = button(obj, 'cancel')
    const lookBtn = button(obj, 'look', () => uiLog('You see: ' + obj.getLookText()))
    const useBtn = button(obj, 'use', () => {
        globalState.player.walkInFrontOf(obj.position, () => {
            globalState.player.clearAnim()
            obj.use(globalState.player)
        })
    })
    const talkBtn = button(obj, 'talk', () => {
        console.log('[Dialog] talking to ' + obj.name)
        if (!obj._script) {
            console.warn('[Dialog] obj has no script')
            return
        }
        Scripting.talk(obj._script, obj)
    })
    const pickupBtn = button(obj, 'pickup', () => obj.pickup(globalState.player))
    const inventoryBtn = button(obj, 'inventory', () => uiInventoryScreen())
    const skillBtn = button(obj, 'skill', () => {
        // Route through the panel system so skilldex obeys mutual-exclusion
        // with PipBoy / inventory / character / automap.
        if (isSkilldexOpen()) { skilldexWindow.close(); return }
        closeAllPanels()
        skilldexWindow.show()
    })

    const isCritter = obj.type === 'critter'
    const isDead = isCritter && (obj as Critter).dead
    const hasTalk = obj._script && obj._script.talk_p_proc !== undefined

    if (isCritter && !isDead) {
        // Living critter: Talk (if available) → Use (if available) → Look → Cancel
        if (hasTalk) $menu.appendChild(talkBtn)
        if (obj.canUse) $menu.appendChild(useBtn)
        $menu.appendChild(lookBtn)
    } else if (isCritter && isDead) {
        // Dead critter: Look → Loot → Cancel
        const lootBtn = button(obj, 'pickup', () => uiLoot(obj))
        $menu.appendChild(lookBtn)
        $menu.appendChild(lootBtn)
    } else if ((obj.type === 'scenery' || obj.type === 'misc') && obj.canUse) {
        // Container/Scenery with canUse: Use → Look → Cancel
        $menu.appendChild(useBtn)
        $menu.appendChild(lookBtn)
    } else if (obj.isContainer) {
        // Container (type=item, subType=container): always show Use → Look → Cancel
        $menu.appendChild(useBtn)
        $menu.appendChild(lookBtn)
    } else if (obj.type === 'item') {
        // Item on the ground: Pickup → Look → Cancel
        $menu.appendChild(pickupBtn)
        $menu.appendChild(lookBtn)
    } else {
        // Fallback: Look → Cancel
        $menu.appendChild(lookBtn)
    }
    $menu.appendChild(inventoryBtn)
    $menu.appendChild(skillBtn)
    $menu.appendChild(cancelBtn)
}

export function uiStartCombat() {
    globalState.cursorMode = 'attack'
    // play end container animation
    Object.assign($id('endContainer').style, { animationPlayState: 'running', webkitAnimationPlayState: 'running' })
    uiUpdateCombatAP()

    const player = globalState.player
    drawHP(player.getStat('HP'))
    drawAC(player.getStat('AC'))
    drawAP(player.AP!.getAvailableMoveAP(), player.AP!.getTotalMaxAP())
}

export function uiEndCombat() {
    // play end container animation
    Object.assign($id('endContainer').style, { animationPlayState: 'running', webkitAnimationPlayState: 'running' })

    // disable buttons
    hidev($id('endTurnButton'))
    hidev($id('endCombatButton'))
    // reset cursor back to move mode
    globalState.cursorMode = 'move'

    // hide combat-specific UI
    const $ap = document.getElementById('combatAPDisplay')
    if ($ap) $ap.style.display = 'none'
    const $hover = document.getElementById('combatHoverInfo')
    if ($hover) $hover.style.display = 'none'
}

export function uiUpdateCombatAP() {
    const $ap = document.getElementById('combatAPDisplay')
    if (!$ap) return
    if (!globalState.inCombat || !globalState.player.AP) {
        $ap.style.display = 'none'
        return
    }
    const ap = globalState.player.AP
    $ap.style.display = 'block'
    $ap.textContent = `AP: ${ap.getAvailableCombatAP()} / ${ap.getTotalMaxAP()}`
}

export function uiShowCombatHover(target: Critter, screenX: number, screenY: number) {
    const $hover = document.getElementById('combatHoverInfo')
    if (!$hover) return

    let info = `${target.name || 'Unknown'}\nHP: ${target.getStat('HP')}/${target.getStat('Max HP')}`

    if (globalState.inCombat && globalState.combat && globalState.player.equippedWeapon?.weapon) {
        const hitChance = globalState.combat.getHitChance(globalState.player, target, 'torso')
        info += `\nHit: ${Math.max(0, hitChance.hit)}%`
    }

    $hover.style.display = 'block'
    $hover.style.left = (screenX + 16) + 'px'
    $hover.style.top = (screenY - 10) + 'px'
    $hover.textContent = info
    $hover.style.whiteSpace = 'pre'
}

export function uiHideCombatHover() {
    const $hover = document.getElementById('combatHoverInfo')
    if ($hover) $hover.style.display = 'none'
}

function uiEndCombatAnimationDone(this: HTMLElement) {
    Object.assign(this.style, { animationPlayState: 'paused', webkitAnimationPlayState: 'paused' })

    if (globalState.inCombat) {
        // enable buttons
        showv($id('endTurnButton'))
        showv($id('endCombatButton'))
    }
}

export function uiDrawWeapon() {
    // draw the active weapon in the interface bar
    const weapon = globalState.player.equippedWeapon
    clearEl($id('attackButton'))
    const $wepImg = $id('attackButtonWeapon') as HTMLImageElement
    const $typeImg = $img('attackButtonType')
    if (!weapon || !weapon.weapon) {
        // Unarmed HUD: show current punch/kick mode icon and AP cost
        const unarmedSkill = globalState.player!.getSkill('Unarmed')
        const mode = getActiveUnarmedMode(unarmedSkill, globalState.unarmedModeIdx)
        $wepImg.style.display = 'none'
        $typeImg.style.display = ''
        $img('attackButtonType').src = `art/intrface/${mode.icon}.png`
        const CHAR_W = 10
        if (mode.apCost <= 9) {
            $id('attackButtonAPDigit').style.backgroundPosition = 0 - CHAR_W * mode.apCost + 'px'
        }
        hide($id('attackButtonCalled'))
        return
    }
    $wepImg.style.display = ''
    $typeImg.style.display = ''

    if (weapon.weapon.type !== 'melee') {
        $wepImg.onload = null
        $wepImg.onload = function (this: HTMLImageElement) {
            if (!this.complete) {
                return
            }
            Object.assign(this.style, {
                position: 'absolute',
                top: '5px',
                left: $id('attackButton').offsetWidth / 2 - this.width / 2 + 'px',
                maxHeight: $id('attackButton').offsetHeight - 10 + 'px',
                display: '',
            })
            this.setAttribute('draggable', 'false')
        }
        $wepImg.src = weapon.invArt + '.png'
    }

    // draw weapon AP cost digit
    // reload=2, called=APCost1+1 (aiming surcharge), burst=APCost2, otherwise APCost1
    const CHAR_W = 10
    let digit: number
    const mode = weapon.weapon.mode
    if (mode === 'reload') {
        digit = 2 // TODO: read reload AP from weapon PRO
    } else if (mode === 'called') {
        digit = weapon.weapon.getAPCost(1) + 1 // base weapon cost + 1 for aiming (FO2: weaponGetActionPointCost)
    } else if (weapon.weapon.isBurst && weapon.weapon.isBurst()) {
        digit = weapon.weapon.getAPCost(2)
    } else {
        digit = weapon.weapon.getAPCost(1)
    }
    if (digit === undefined || digit > 9) {
        return
    } // TODO: Weapon AP >9?
    $id('attackButtonAPDigit').style.backgroundPosition = 0 - CHAR_W * digit + 'px'

    // draw weapon type (single, burst, called, punch, reload, ...)
    // TODO: all melee weapons
    let type: string
    if (weapon.weapon.type === 'melee') {
        type = 'punch'
    } else if (mode === 'reload') {
        type = 'reload'
    } else if (weapon.weapon.isBurst && weapon.weapon.isBurst()) {
        type = 'burst'
    } else {
        type = 'single'
    }
    $img('attackButtonType').src = `art/intrface/${type}.png`

    // hide or show called shot sigil?
    if (mode === 'called') {
        show($id('attackButtonCalled'))
    } else {
        hide($id('attackButtonCalled'))
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
                uiInventoryScreen()
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
    uiInventoryScreen()
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

function makeDropTarget($el: HTMLElement, dropCallback: (data: string, e?: DragEvent) => void) {
    $el.ondrop = (e: DragEvent) => {
        const data = e.dataTransfer.getData('text/plain')
        dropCallback(data, e)
        return false
    }
    $el.ondragenter = () => false
    $el.ondragover = () => false
}

function makeDraggable($el: HTMLElement, data: string, endCallback?: () => void) {
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

export function uiInventoryScreen() {
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
                src: invObj.invArt + '.png',
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
                uiInventoryScreen()
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
                        uiInventoryScreen()
                    }
                })
            }
        }
    }

    type ItemAction = 'cancel' | 'use' | 'drop' | 'equip_left' | 'equip_right' | 'equip_armor' | 'unequip' | 'unload'

    function itemAction(obj: Obj, slot: string, action: ItemAction) {
        const playerAny = globalState.player as any
        switch (action) {
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
                uiInventoryScreen()
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
                uiInventoryScreen()
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
                uiInventoryScreen()
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
                uiInventoryScreen()
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
                uiInventoryScreen()
                break
            }
        }
    }

    function makeContextButton(obj: Obj, slot: string, action: ItemAction, label?: string) {
        if (label) {
            // text-based button for equip actions (no dedicated art asset)
            const btn = document.createElement('div')
            btn.className = 'itemContextMenuButton itemContextMenuText'
            btn.textContent = label
            btn.onclick = () => {
                itemAction(obj, slot, action)
                hidev($id('itemContextMenu'))
            }
            return btn
        }
        return makeEl('img', {
            id: 'context_' + action,
            classes: ['itemContextMenuButton'],
            click: () => {
                itemAction(obj, slot, action)
                hidev($id('itemContextMenu'))
            },
        })
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

        $menu.appendChild(makeContextButton(obj, slot, 'cancel'))
        if (obj.canUse) {
            $menu.appendChild(makeContextButton(obj, slot, 'use'))
        }
        $menu.appendChild(makeContextButton(obj, slot, 'drop'))

        // Unload option: any weapon with non-zero ammo capacity and rounds currently loaded
        // (matches fallout2-ce ammoGetCapacity != 0 condition — works for all gun types)
        if (obj.subtype === 'weapon' && obj.pro?.extra?.maxAmmo > 0 && obj.pro?.extra?.rounds > 0) {
            $menu.appendChild(makeContextButton(obj, slot, 'unload'))
        }

        // Equip options for inventory items
        if (slot === 'inventory') {
            if (obj.subtype === 'weapon' || obj.subtype === 'misc') {
                $menu.appendChild(makeContextButton(obj, slot, 'equip_left', 'Eq. Left'))
                $menu.appendChild(makeContextButton(obj, slot, 'equip_right', 'Eq. Right'))
            } else if (obj.subtype === 'armor') {
                $menu.appendChild(makeContextButton(obj, slot, 'equip_armor', 'Equip'))
            }
        } else {
            // Unequip from hand/armor slot
            $menu.appendChild(makeContextButton(obj, slot, 'unequip', 'Unequip'))
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

export function drawHP(hp: number) {
    drawDigits('#hpDigit', hp, 4, true)
}

export function drawAC(ac: number) {
    drawDigits('#acDigit', ac, 4, true)
}

export function drawAP(current: number, max: number) {
    for (let i = 1; i <= 10; i++) {
        const el = document.getElementById('apLight' + i)
        if (el) {
            el.style.visibility = i <= current ? 'visible' : 'hidden'
        }
    }
}

function drawDigits(idPrefix: string, amount: number, maxDigits: number, hasSign: boolean) {
    const CHAR_W = 9,
        CHAR_NEG = 12
    const sign = amount < 0 ? CHAR_NEG : 0
    if (amount < 0) {
        amount = -amount
    }
    const digits = amount.toString()
    const firstDigitIdx = hasSign ? 2 : 1
    if (hasSign) {
        $q(idPrefix + '1').style.backgroundPosition = 0 - CHAR_W * sign + 'px'
    } // sign
    for (
        let i = firstDigitIdx;
        i <= maxDigits - digits.length;
        i++ // left-fill with zeroes
    ) {
        $q(idPrefix + i).style.backgroundPosition = '0px'
    }
    for (let i = 0; i < digits.length; i++) {
        const idx = digits.length - 1 - i
        let digit
        if (digits[idx] === '-') {
            digit = 12
        } else {
            digit = parseInt(digits[idx])
        }
        $q(idPrefix + (maxDigits - i)).style.backgroundPosition = 0 - CHAR_W * digit + 'px'
    }
}

// Smoothly transition an element's top property from an origin to a target position over a duration
function uiAnimateBox($el: HTMLElement, origin: number | null, target: number, callback?: () => void): void {
    const style = $el.style

    // Reset to origin, instantly
    if (origin !== null) {
        style.transition = 'none'
        style.top = `${origin}px`
    }

    // We need to wait for the browser to process the updated CSS position, so we need to wait here
    setTimeout(() => {
        // Set up our transition finished callback if necessary
        if (callback) {
            let listener = () => {
                callback()
                $el.removeEventListener('transitionend', listener)
                ;(listener as any) = null // Allow listener to be GC'd
            }

            $el.addEventListener('transitionend', listener)
        }

        // Ease into the target position over 1 second
        $el.style.transition = 'top 1s ease'
        $el.style.top = `${target}px`
    }, 1)
}

export function uiStartDialogue(force: boolean, target?: Critter) {
    if (globalState.uiMode === UIMode.barter && force !== true) {
        return
    }

    globalState.uiMode = UIMode.dialogue
    $id('dialogueContainer').style.visibility = 'visible'
    $id('dialogueBox').style.visibility = 'visible'
    uiAnimateBox($id('dialogueBox'), 480, 290)

    // center around the dialogue target
    if (!target) {
        return
    }
    const bbox = objectBoundingBox(target)
    if (bbox !== null) {
        const dc = $id('dialogueContainer')
        // alternatively: dc.offset().left - $(heart.canvas).offset().left
        const dx = ((dc.offsetWidth / 2) | 0) + dc.offsetLeft
        const dy = ((dc.offsetHeight / 4) | 0) + dc.offsetTop - ((bbox.h / 2) | 0)
        // dx/dy are HTML-layout (screen) pixels; divide by zoom so the
        // resulting camera offset is in world units (which is what
        // cameraPosition is stored in).
        const z = globalState.cameraZoom || 1.0
        globalState.cameraPosition.x = bbox.x - dx / z
        globalState.cameraPosition.y = bbox.y - dy / z
    }
}

export function uiEndDialogue() {
    // TODO: Transition the dialogue box down?
    globalState.uiMode = UIMode.none

    $id('dialogueContainer').style.visibility = 'hidden'
    $id('dialogueBox').style.visibility = 'hidden'
    $id('dialogueBoxReply').innerHTML = ''
}

export function uiSetDialogueReply(reply: string) {
    const $dialogueBoxReply = $id('dialogueBoxReply')
    $dialogueBoxReply.innerHTML = reply
    $dialogueBoxReply.scrollTop = 0

    $id('dialogueBoxTextArea').innerHTML = ''
}

export function uiAddDialogueOption(msg: string, optionID: number) {
    const item = document.createElement('div')
    item.textContent = `- ${msg}`
    item.style.cursor = 'pointer'
    item.onclick = () => Scripting.dialogueReply(optionID)
    $id('dialogueBoxTextArea').appendChild(item)
}

function uiGetAmount(item: Obj): Promise<number> {
    // Fallout 2 "Move Items" dialog using movemult.png as background
    // movemult.png is 169×60 in the original game
    const DIALOG_W = 169
    const DIALOG_H = 60

    return new Promise((resolve) => {
        const overlay = document.createElement('div')
        Object.assign(overlay.style, {
            position: 'absolute',
            left: '0', top: '0', width: '100%', height: '100%',
            zIndex: '50',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })

        const modal = document.createElement('div')
        Object.assign(modal.style, {
            position: 'relative',
            width: `${DIALOG_W}px`,
            height: `${DIALOG_H}px`,
            backgroundImage: "url('art/intrface/movemult.png')",
            backgroundSize: `${DIALOG_W}px ${DIALOG_H}px`,
            backgroundRepeat: 'no-repeat',
            fontFamily: "'VT323', monospace",
        })

        // Number display — centered near the top of the dialog
        const numDisplay = document.createElement('div')
        Object.assign(numDisplay.style, {
            position: 'absolute',
            left: '0', top: '5px', width: '100%',
            textAlign: 'center',
            color: '#00FF00',
            fontSize: '14px',
            pointerEvents: 'none',
        })
        numDisplay.textContent = String(item.amount)

        // Slider — positioned across the middle of the dialog
        const slider = document.createElement('input')
        slider.type = 'range'
        slider.min = '1'
        slider.max = String(item.amount)
        slider.value = String(item.amount)
        Object.assign(slider.style, {
            position: 'absolute',
            left: '12px', top: '22px',
            width: `${DIALOG_W - 24}px`,
            accentColor: '#00AA00',
            cursor: 'pointer',
        })
        slider.oninput = () => {
            numDisplay.textContent = slider.value
        }

        function cleanup(amount: number) {
            overlay.remove()
            resolve(amount)
        }

        // OK button — bottom left
        const okBtn = document.createElement('div')
        okBtn.textContent = 'OK'
        Object.assign(okBtn.style, {
            position: 'absolute',
            left: '20px', bottom: '4px',
            color: '#00FF00',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '0 6px',
        })
        okBtn.onmouseenter = () => { okBtn.style.color = '#FCFC7C' }
        okBtn.onmouseleave = () => { okBtn.style.color = '#00FF00' }
        okBtn.onclick = () => {
            const val = parseInt(slider.value)
            if (isNaN(val) || val < 1 || val > item.amount) return
            cleanup(val)
        }

        // Cancel button — bottom right
        const cancelBtn = document.createElement('div')
        cancelBtn.textContent = 'Cancel'
        Object.assign(cancelBtn.style, {
            position: 'absolute',
            right: '20px', bottom: '4px',
            color: '#00FF00',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '0 6px',
        })
        cancelBtn.onmouseenter = () => { cancelBtn.style.color = '#FF4444' }
        cancelBtn.onmouseleave = () => { cancelBtn.style.color = '#00FF00' }
        cancelBtn.onclick = () => cleanup(0)

        slider.onkeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') okBtn.click()
            if (e.key === 'Escape') cancelBtn.click()
        }

        modal.appendChild(numDisplay)
        modal.appendChild(slider)
        modal.appendChild(okBtn)
        modal.appendChild(cancelBtn)
        overlay.appendChild(modal)
        $id('game-container').appendChild(overlay)
        slider.focus()
    })
}

function _uiAddItem(items: Obj[], item: Obj, count: number) {
    for (let i = 0; i < items.length; i++) {
        if (items[i].approxEq(item)) {
            items[i].amount += count
            return
        }
    }

    // no existing item, add new inventory object
    items.push(item.clone().setAmount(count))
}

function uiSwapItem(a: Obj[], item: Obj, b: Obj[], amount: number) {
    // swap item from a -> b
    if (amount === 0) {
        return
    }

    let idx = -1
    for (let i = 0; i < a.length; i++) {
        if (a[i].approxEq(item)) {
            idx = i
            break
        }
    }
    if (idx === -1) {
        throw 'item (' + item + ') does not exist in a'
    }

    if (amount < item.amount) {
        // deduct amount from a and give amount to b
        item.amount -= amount
    }
    // just swap them
    else {
        a.splice(idx, 1)
    }

    // add the item to b
    _uiAddItem(b, item, amount)
}

function uiEndBarterMode() {
    const $barterBox = $id('barterBox')

    uiAnimateBox($barterBox, null, 480, () => {
        $barterBox.style.visibility = 'hidden'
        $barterBox.style.display = 'none'
        $barterBox.style.pointerEvents = 'none'
        off($id('barterBoxLeft'), 'drop dragenter dragover')
        off($id('barterBoxRight'), 'drop dragenter dragover')
        off($id('barterBoxInventoryLeft'), 'drop dragenter dragover')
        off($id('barterBoxInventoryRight'), 'drop dragenter dragover')
        off($id('barterTalkButton'), 'click')
        off($id('barterOfferButton'), 'click')

        // Re-enter dialogue: re-trigger the NPC's talk_p_proc to present
        // fresh dialogue options (the old ones were cleared when we entered barter)
        Scripting.reenterDialogue()
    })
}

export function uiBarterMode(merchant: Critter) {
    globalState.uiMode = UIMode.barter

    // Keep the TV screen (dialogueContainer) visible — only hide the dialogue panel
    $id('dialogueContainer').style.visibility = 'visible'

    // Hide dialogue panel (animate down), keep TV screen above
    const $dialogueBox = $id('dialogueBox')
    uiAnimateBox($dialogueBox, null, 480, () => {
        $dialogueBox.style.visibility = 'hidden'
        console.log('[Barter] popping up barter box')

        // Pop up the bartering screen (animate up)
        const $barterBox = $id('barterBox')
        $barterBox.style.display = ''
        $barterBox.style.visibility = 'visible'
        $barterBox.style.pointerEvents = 'auto'
        uiAnimateBox($barterBox, 480, 290)
    })

    // logic + UI for bartering
    // TODO: would it be better if we dropped the "working" copies?

    // a copy of inventories for both parties
    let workingPlayerInventory = globalState.player.inventory.map(cloneItem)
    let workingMerchantInventory = merchant.inventory.map(cloneItem)

    // and our working barter tables
    let playerBarterTable: Obj[] = []
    let merchantBarterTable: Obj[] = []

    function totalAmount(objects: Obj[]): number {
        let total = 0
        for (let i = 0; i < objects.length; i++) {
            total += objects[i].pro.extra.cost * objects[i].amount
        }
        return total
    }

    // TODO: checkOffer() or some-such
    function offer() {
        console.log('[Barter] offer')

        const merchantOffered = totalAmount(merchantBarterTable)
        const playerOffered = totalAmount(playerBarterTable)
        const diffOffered = playerOffered - merchantOffered

        if (diffOffered >= 0) {
            // OK, player offered equal to more more than the value
            console.log('[Barter] offer accepted')

            // finalize and apply the deal

            // swap to working inventories
            merchant.inventory = workingMerchantInventory
            globalState.player.inventory = workingPlayerInventory

            // add in the table items
            for (let i = 0; i < merchantBarterTable.length; i++) {
                globalState.player.addInventoryItem(merchantBarterTable[i], merchantBarterTable[i].amount)
            }
            for (let i = 0; i < playerBarterTable.length; i++) {
                merchant.addInventoryItem(playerBarterTable[i], playerBarterTable[i].amount)
            }

            // re-clone so we can continue bartering if necessary
            workingPlayerInventory = globalState.player.inventory.map(cloneItem)
            workingMerchantInventory = merchant.inventory.map(cloneItem)

            playerBarterTable = []
            merchantBarterTable = []

            redrawBarterInventory()
        } else {
            console.log('[Barter] offer refused')
        }
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[]) {
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

    async function uiBarterMove(data: string, where: 'left' | 'right' | 'leftInv' | 'rightInv') {
        console.log('[Barter] move ' + data + ' to ' + where)

        const from = (
            {
                p: workingPlayerInventory,
                m: workingMerchantInventory,
                l: playerBarterTable,
                r: merchantBarterTable,
            } as any
        )[data[0]]

        if (from === undefined) {
            throw 'uiBarterMove: wrong data: ' + data
        }

        const idx = parseInt(data.slice(1))
        const obj = from[idx]
        if (obj === undefined) {
            throw 'uiBarterMove: obj not found in list (' + idx + ')'
        }

        // player inventory -> left table or player inventory
        if (data[0] === 'p' && where !== 'left' && where !== 'leftInv') {
            return
        }

        // merchant inventory -> right table or merchant inventory
        if (data[0] === 'm' && where !== 'right' && where !== 'rightInv') {
            return
        }

        const to = {
            left: playerBarterTable,
            right: merchantBarterTable,
            leftInv: workingPlayerInventory,
            rightInv: workingMerchantInventory,
        }[where]

        if (to === undefined) {
            throw 'uiBarterMove: invalid location: ' + where
        } else if (to === from) {
            // table -> same table
            return
        } else if (obj.amount > 1) {
            uiSwapItem(from, obj, to, await uiGetAmount(obj))
        } else {
            uiSwapItem(from, obj, to, 1)
        }

        redrawBarterInventory()
    }

    // bartering drop targets
    makeDropTarget($id('barterBoxLeft'), (data: string) => {
        uiBarterMove(data, 'left')
    })
    makeDropTarget($id('barterBoxRight'), (data: string) => {
        uiBarterMove(data, 'right')
    })
    makeDropTarget($id('barterBoxInventoryLeft'), (data: string) => {
        uiBarterMove(data, 'leftInv')
    })
    makeDropTarget($id('barterBoxInventoryRight'), (data: string) => {
        uiBarterMove(data, 'rightInv')
    })

    $id('barterTalkButton').onclick = uiEndBarterMode
    $id('barterOfferButton').onclick = offer

    function redrawBarterInventory() {
        drawInventory($id('barterBoxInventoryLeft'), 'p', workingPlayerInventory)
        drawInventory($id('barterBoxInventoryRight'), 'm', workingMerchantInventory)
        drawInventory($id('barterBoxLeft'), 'l', playerBarterTable)
        drawInventory($id('barterBoxRight'), 'r', merchantBarterTable)

        const moneyLeft = totalAmount(playerBarterTable)
        const moneyRight = totalAmount(merchantBarterTable)

        $id('barterBoxLeftAmount').innerHTML = '$' + moneyLeft
        $id('barterBoxRightAmount').innerHTML = '$' + moneyRight
    }

    redrawBarterInventory()
}

function uiEndLoot() {
    globalState.uiMode = UIMode.none

    hidev($id('lootBox'))
    off($id('lootBoxLeft'), 'drop dragenter dragover')
    off($id('lootBoxRight'), 'drop dragenter dragover')
    off($id('lootBoxTakeAllButton'), 'click')
}

export function uiLoot(object: Obj) {
    globalState.uiMode = UIMode.loot

    async function uiLootMove(data: string /* "l"|"r" */, where: 'left' | 'right') {
        console.log('[Loot] move ' + data + ' to ' + where)

        const from = ({ l: globalState.player.inventory, r: object.inventory } as any)[data[0]]

        if (from === undefined) {
            throw 'uiLootMove: wrong data: ' + data
        }

        const idx = parseInt(data.slice(1))
        const obj = from[idx]
        if (obj === undefined) {
            throw 'uiLootMove: obj not found in list (' + idx + ')'
        }

        const to = { left: globalState.player.inventory, right: object.inventory }[where]

        if (to === undefined) {
            throw 'uiLootMove: invalid location: ' + where
        } else if (to === from) {
            // object -> same location
            return
        } else if (obj.amount > 1) {
            uiSwapItem(from, obj, to, await uiGetAmount(obj))
        } else {
            uiSwapItem(from, obj, to, 1)
        }

        drawLoot()
    }

    function drawInventory($el: HTMLElement, who: 'p' | 'm' | 'l' | 'r', objects: Obj[]) {
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

    console.log('[Loot] opening loot screen')

    showv($id('lootBox'))

    // loot drop targets
    makeDropTarget($id('lootBoxLeft'), (data: string) => {
        uiLootMove(data, 'left')
    })
    makeDropTarget($id('lootBoxRight'), (data: string) => {
        uiLootMove(data, 'right')
    })

    $id('lootBoxTakeAllButton').onclick = () => {
        console.log('[Loot] take all')
        const inv = object.inventory.slice(0) // clone inventory
        for (let i = 0; i < inv.length; i++) {
            uiSwapItem(object.inventory, inv[i], globalState.player.inventory, inv[i].amount)
        }
        drawLoot()
    }

    function drawLoot() {
        drawInventory($id('lootBoxLeft'), 'l', globalState.player.inventory)
        drawInventory($id('lootBoxRight'), 'r', object.inventory)
    }

    drawLoot()
}

export function uiLog(msg: string) {
    const $log = $id('displayLog')
    $log.insertAdjacentHTML('beforeend', `<li>${msg}</li>`)
    $log.scrollTop = $log.scrollHeight
}

export function uiCloseWorldMap() {
    globalState.uiMode = UIMode.none

    hide($id('worldMapContainer'))
    hidev($id('areamap'))
    hidev($id('worldmap'))

    Worldmap.stop()
}

export function uiWorldMap(onAreaMap = false) {
    globalState.uiMode = UIMode.worldMap
    show($id('worldMapContainer'))

    if (!globalState.mapAreas) {
        globalState.mapAreas = loadAreas()
    }

    if (onAreaMap) {
        uiWorldMapAreaView()
    } else {
        uiWorldMapWorldView()
    }
    uiWorldMapLabels()
}

function uiWorldMapAreaView() {
    hidev($id('worldmap'))
    showv($id('areamap'))

    Worldmap.stop()
}

function uiWorldMapWorldView() {
    showv($id('worldmap'))
    hidev($id('areamap'))

    Worldmap.start()
}

export function uiWorldMapShowArea(area: Area) {
    uiWorldMapAreaView()

    const $areamap = $id('areamap')
    $areamap.style.backgroundImage = `url('${area.mapArt}.png')`
    clearEl($areamap)

    for (const entrance of area.entrances) {
        console.log('[Worldmap] area entrance: ' + entrance.mapLookupName)
        const $entranceEl = makeEl('div', { classes: ['worldmapEntrance'] })
        const $hotspot = makeEl('div', { classes: ['worldmapEntranceHotspot'] })

        $hotspot.onclick = () => {
            // hotspot click -- travel to relevant map
            const mapName = lookupMapNameFromLookup(entrance.mapLookupName)
            console.log(`[Worldmap] hotspot → ${mapName} (via ${entrance.mapLookupName})`)
            globalState.gMap.loadMap(mapName, undefined, entrance.elevation)
            uiCloseWorldMap()
        }

        $entranceEl.appendChild($hotspot)
        appendHTML($entranceEl, entrance.mapLookupName)
        $entranceEl.style.left = entrance.x + 'px'
        $entranceEl.style.top = entrance.y + 'px'
        $id('areamap').appendChild($entranceEl)
    }
}

function uiWorldMapLabels() {
    $id('worldMapLabels').innerHTML = "<div id='worldMapLabelsBackground'></div>"

    let i = 0
    for (const areaID in globalState.mapAreas) {
        const area = globalState.mapAreas[areaID]
        if (!area.labelArt) {
            continue
        }

        const label = makeEl('img', { classes: ['worldMapLabelImage'], src: area.labelArt + '.png' })
        const labelButton = makeEl('div', {
            classes: ['worldMapLabelButton'],
            click: () => {
                uiWorldMapShowArea(globalState.mapAreas[areaID])
            },
        })

        const areaLabel = makeEl('div', {
            classes: ['worldMapLabel'],
            style: { top: 1 + i * 27 + 'px' },
            children: [label, labelButton],
        })
        $id('worldMapLabels').appendChild(areaLabel)
        i++
    }
}

function uiElevatorDone() {
    globalState.uiMode = UIMode.none
    hidev($id('elevatorBox'))

    // flip all buttons to hidden
    for (const $elevatorButton of $qa('.elevatorButton')) {
        hidev($elevatorButton)
        $elevatorButton.onclick = null
    }
    hidev($id('elevatorLabel'))
}

export function uiElevator(elevator: Elevator) {
    globalState.uiMode = UIMode.elevator
    const art = lookupInterfaceArt(elevator.type)
    console.log('[Elevator] art: ' + art)
    console.log('[Elevator] buttons: ' + elevator.buttonCount)

    if (elevator.labels !== -1) {
        const labelArt = lookupInterfaceArt(elevator.labels)
        console.log('[Elevator] label art: ' + labelArt)

        const $elevatorLabel = $id('elevatorLabel')
        showv($elevatorLabel)
        $elevatorLabel.style.backgroundImage = `url('${labelArt}.png')`
    }

    const $elevatorBox = $id('elevatorBox')
    showv($elevatorBox)
    $elevatorBox.style.backgroundImage = `url('${art}.png')`

    // flip the buttons we need visible
    for (let i = 1; i <= elevator.buttonCount; i++) {
        const $elevatorButton = $id('elevatorButton' + i)
        showv($elevatorButton)
        $elevatorButton.onclick = () => {
            // button `i` pushed
            // todo: animate positioner/spinner (and come up with a better name for that)

            const mapID = elevator.buttons[i - 1].mapID
            const level = Number(elevator.buttons[i - 1].level) || 0
            const position = fromTileNum(elevator.buttons[i - 1].tileNum)

            if (mapID !== globalState.gMap.mapID) {
                // different map
                console.log(`[Elevator] → map ${mapID}, level ${level} @ (${position.x}, ${position.y})`)
                globalState.gMap.loadMapByID(mapID, position, level)
            } else if (level !== globalState.currentElevation) {
                // same map, different elevation
                console.log(`[Elevator] → level ${level} @ (${position.x}, ${position.y})`)
                globalState.player.move(position)
                globalState.gMap.changeElevation(level, true)
            }

            // else, same elevation, do nothing
            uiElevatorDone()
        }
    }
}

export function uiCloseCalledShot() {
    globalState.uiMode = UIMode.none
    hide($id('calledShotBox'))
}

export function uiCalledShot(art: string, target: Critter, callback?: (regionHit: string) => void) {
    globalState.uiMode = UIMode.calledShot
    show($id('calledShotBox'))

    function drawChance(region: string) {
        let chance: any = Combat.prototype.getHitChance(globalState.player, target, region).hit
        console.log('[UI] called shot: id: %s | chance: %d', '#calledShot-' + region + '-chance #digit', chance)
        if (chance <= 0) {
            chance = '--'
        }
        drawDigits('#calledShot-' + region + '-chance #digit', chance, 2, false)
    }

    drawChance('torso')
    drawChance('head')
    drawChance('eyes')
    drawChance('groin')
    drawChance('leftArm')
    drawChance('rightArm')
    drawChance('leftLeg')
    drawChance('rightLeg')

    $id('calledShotBackground').style.backgroundImage = `url('${art}.png')`

    // Map region name to the Critter's crippled flag
    const crippledFlags: { [region: string]: keyof Critter } = {
        leftArm:  'crippledLeftArm',
        rightArm: 'crippledRightArm',
        leftLeg:  'crippledLeftLeg',
        rightLeg: 'crippledRightLeg',
    }

    for (const $label of $qa('.calledShotLabel')) {
        const id = ($label as HTMLElement).id
        const regionHit = id.split('-')[1]
        const crippledKey = crippledFlags[regionHit]
        const isCrippled = crippledKey ? !!(target as any)[crippledKey] : false

        if (isCrippled) {
            // Gray out crippled parts so the player knows they're already damaged
            Object.assign(($label as HTMLElement).style, {
                color: '#666666',
                textDecoration: 'line-through',
                cursor: 'default',
                pointerEvents: 'none',
            })
            const $chance = $id('calledShot-' + regionHit + '-chance')
            if ($chance) Object.assign(($chance as HTMLElement).style, { opacity: '0.4' })
        } else {
            // Reset styles (in case uiCalledShot is called multiple times)
            Object.assign(($label as HTMLElement).style, {
                color: '',
                textDecoration: '',
                cursor: '',
                pointerEvents: '',
            })
            $label.onclick = (evt: MouseEvent) => {
                const clickedRegion = (evt.target as HTMLElement).id.split('-')[1]
                console.log('[UI] called shot: clicked region %s', clickedRegion)
                if (callback) {
                    callback(clickedRegion)
                }
            }
        }
    }
}

export function uiSaveLoad(isSave: boolean): void {
    globalState.uiMode = UIMode.saveLoad

    const listOfSaves = new List({ x: 55, y: 50, w: 'auto', h: 'auto' })
    const saveInfo = new Label(404, 262, '', '#00FF00')
    // TODO: CSSBoundingBox's width and height should be optional (and default to `auto`), then Label can accept one
    Object.assign(saveInfo.elem.style, {
        width: '154px',
        height: '33px',
        fontSize: '8pt',
        overflow: 'hidden',
    })

    const saveLoadWindow = new WindowFrame('art/intrface/lsgame.png', { x: 80, y: 20 }, 640, 480)
        .add(new Widget('art/intrface/lscover.png', { x: 340, y: 40, w: 275, h: 173 }))
        .add(new Label(50, 26, isSave ? 'Save Game' : 'Load Game'))
        .add(new SmallButton(391, 349).onClick(selected))
        .add(new Label(391 + 18, 349, 'Done'))
        .add(new SmallButton(495, 349).onClick(done))
        .add(new Label(495 + 18, 349, 'Cancel'))
        .add(saveInfo)
        .add(listOfSaves)
        .show()

    if (isSave) {
        listOfSaves.select(
            listOfSaves.addItem({
                text: '<New Slot>',
                id: -1,
                onSelected: () => {
                    saveInfo.setText('New save')
                },
            })
        )
    }

    // List saves, and write them to the UI list
    saveList((saves: SaveGame[]) => {
        for (const save of saves) {
            listOfSaves.addItem({
                text: save.name,
                id: save.id,
                onSelected: () => {
                    saveInfo.setText(formatSaveDate(save) + '<br>' + save.currentMap)
                },
            })
        }
    })

    function done() {
        globalState.uiMode = UIMode.none
        saveLoadWindow.close()
    }

    function selected() {
        // Done was clicked, so save/load the slot
        const item = listOfSaves.getSelection()
        if (!item) {
            return
        } // No slot selected

        const saveID = item.id

        console.log('[UI] %s save #%d.', isSave ? 'Saving' : 'Loading', saveID)

        if (isSave) {
            const name = prompt('Save Name?')

            if (saveID !== -1) {
                if (!confirm('Are you sure you want to overwrite that save slot?')) {
                    return
                }
            }

            save(name, saveID === -1 ? undefined : saveID, done)
        } else {
            load(saveID)
            done()
        }
    }
}
