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
import { pad } from './util.js'
import { Worldmap } from './worldmap.js'
import { Config } from './config.js'
import { Point } from './geometry.js'
import { lazyLoadImage } from './images.js'
import { openAutomap } from './automap.js'
import { openPipBoy } from './pipboy.js'
import { getActiveUnarmedMode, nextUnarmedModeIdx } from './unarmed.js'

// UI system

// TODO: reduce code duplication, circular references,
//       and general badness/unmaintainability.
// TODO: combat UI on main bar
// TODO: stats/info view in inventory screen
// TODO: fix inventory image size
// TODO: fix style for inventory image amount
// TODO: option for scaling the UI

// Bounding box that accepts strings as well as numbers
export interface CSSBoundingBox {
    x: number | string
    y: number | string
    w: number | string
    h: number | string
}

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
export class Widget {
    elem: HTMLElement
    hoverBackground: string | null = null
    mouseDownBackground: string | null = null

    constructor(public background: string | null, public bbox: CSSBoundingBox) {
        this.elem = document.createElement('div')

        Object.assign(this.elem.style, {
            position: 'absolute',
            left: `${bbox.x}px`,
            top: `${bbox.y}px`,
            width: `${bbox.w}px`,
            height: `${bbox.h}px`,
            backgroundImage: background && `url('${background}')`,
        })
    }

    onClick(fn: (widget?: Widget) => void): this {
        this.elem.onclick = () => {
            fn(this)
        }
        return this
    }

    hoverBG(background: string): this {
        this.hoverBackground = background

        if (!this.elem.onmouseenter) {
            // Set up events for hovering/not hovering
            this.elem.onmouseenter = () => {
                this.elem.style.backgroundImage = `url('${this.hoverBackground}')`
            }
            this.elem.onmouseleave = () => {
                this.elem.style.backgroundImage = `url('${this.background}')`
            }
        }

        return this
    }

    mouseDownBG(background: string): this {
        this.mouseDownBackground = background

        if (!this.elem.onmousedown) {
            // Set up events for mouse down/up
            this.elem.onmousedown = () => {
                this.elem.style.backgroundImage = `url('${this.mouseDownBackground}')`
            }
            this.elem.onmouseup = () => {
                this.elem.style.backgroundImage = `url('${this.background}')`
            }
        }

        return this
    }

    css(props: object): this {
        Object.assign(this.elem.style, props)
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
            console.warn(`Can't find item's element for item UID ${item.uid}`)
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
    $uiContainer = document.getElementById('game-container')!

    initSkilldex()
    // initCharacterScreen();

    const chrBtn = document.getElementById('chrButton')
    if (chrBtn) {
        chrBtn.onclick = () => {
            characterWindow && characterWindow.close()
            initCharacterScreen()
        }
    }

    document.getElementById('pipBoyButton')!.onclick = () => {
        openPipBoy()
    }

    document.getElementById('mapButton')!.onclick = () => {
        openAutomap()
    }
}

let skilldexWindow: WindowFrame
let characterWindow: WindowFrame

// FO2-CE ref: skilldex.cc — skilldexOpen() / skilldexWindowInit()
// Skilldex window showing 8 usable skills with current values and keyboard shortcuts
function initSkilldex() {
    // Skill value labels — updated each time the skilldex is opened/shown
    const skillValueLabels: Label[] = []

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
            x: Config.ui.screenWidth - 185,
            y: Config.ui.screenHeight - 368 - 99,
        },
        185,
        368
    )
        .add(new Label(65, 15, 'SKILLDEX'))

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

        // Skill name + hotkey number
        skilldexWindow.add(
            new Label(25, yPos, `${i + 1}. ${name}`)
                .css({ width: '110px', height: '24px', cursor: 'pointer', lineHeight: '24px' })
                .onClick(useSkill(skill))
        )

        // FO2-CE ref: skilldex.cc — 3-digit skill value display next to each button
        const valLabel = new Label(140, yPos, '---')
            .css({ width: '40px', height: '24px', lineHeight: '24px', textAlign: 'right' })
        skillValueLabels.push(valLabel)
        skilldexWindow.add(valLabel)

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
                skillValueLabels[i].setText(`${val}%`)
                skillValueLabels[i].elem.style.color = val < 0 ? '#FF0000' : '#00FF00'
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

function initCharacterScreen() {
    const player = globalState.player!
    const skillList = new List({ x: 380, y: 27, w: 'auto', h: 'auto' })

    skillList.css({ fontSize: '0.75em' })

    // FO2-CE ref: stat.cc pcGetExperienceForLevel() — XP needed for next level
    const currentLevel = player.getStat('Level')
    const nextLevelXP = Math.floor((currentLevel + 1) * currentLevel / 2) * 1000

    // Derived stats labels (updated in redraw)
    const derivedStatsLabel = new Label(194, 57, '').css({ fontSize: '0.7em', color: '#00FF00', whiteSpace: 'pre' })

    characterWindow = new WindowFrame(
        'art/intrface/edtredt.png',
        {
            x: Config.ui.screenWidth / 2 - 640 / 2,
            y: Config.ui.screenHeight / 2 - 480 / 2,
        },
        640,
        480
    )
        // FO2-CE ref: editor.cc — Done button saves changes, Cancel discards
        .add(new SmallButton(455, 454)) // Done button (onClick set below)
        .add(new Label(455 + 18, 454, 'Done'))
        .add(
            new SmallButton(552, 454).onClick(() => {
                characterWindow.close()
            })
        )
        .add(new Label(552 + 18, 454, 'Cancel'))
        .add(new Label(22, 6, 'Name'))
        .add(new Label(160, 6, 'Age'))
        .add(new Label(242, 6, 'Gender'))
        .add(
            new Label(33, 280, `Level: ${currentLevel}`).css({
                fontSize: '0.75em',
                color: '#00FF00',
            })
        )
        .add(
            new Label(33, 292, `Exp: ${player.getStat('Experience')}`).css({
                fontSize: '0.75em',
                color: '#00FF00',
            })
        )
        .add(
            new Label(33, 304, `Next: ${nextLevelXP}`).css({
                fontSize: '0.75em',
                color: '#00FF00',
            })
        )
        .add(new Label(380, 5, 'Skill'))
        .add(new Label(399, 233, 'Skill Points'))
        .add(
            new Label(
                194,
                45,
                `Hit Points ${player.getStat('HP')}/${player.getStat('Max HP')}`
            ).css({ fontSize: '0.75em', color: '#00FF00' })
        )
        .add(derivedStatsLabel)
        .add(skillList)
        .show()

    const skills = [
        'Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons',
        'Throwing', 'First Aid', 'Doctor', 'Sneak', 'Lockpick', 'Steal', 'Traps',
        'Science', 'Repair', 'Speech', 'Barter', 'Gambling', 'Outdoorsman',
    ]

    const stats = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']

    const statWidgets: Label[] = []

    let selectedStat = stats[0]

    let n = 0
    for (const stat of stats) {
        const widget = new Label(20, 39 + n, '').css({ background: 'black', padding: '5px' })
        widget.onClick(() => {
            selectedStat = stat
        })
        statWidgets.push(widget)
        characterWindow.add(widget)
        n += 33
    }

    const newStatSet = player.stats.clone()
    const newSkillSet = player.skills.clone()
    // FO2-CE ref: skill.cc — player-only options for skill value calculation
    const playerSkillOpts = { isPlayer: true, perks: player.perks }

    // Skill Points / Tag Skills counter
    const skillPointCounter = new Label(522, 230, '').css({ background: 'black', padding: '5px' })
    characterWindow.add(skillPointCounter)

    const redrawStatsSkills = () => {
        // Draw skills
        skillList.clear()

        for (const skill of skills) {
            const val = newSkillSet.get(skill, newStatSet, playerSkillOpts)
            const tag = newSkillSet.isTagged(skill) ? ' *' : ''
            skillList.addItem({ text: `${skill} ${val}%${tag}`, id: skill })
        }

        // Draw stats
        for (let i = 0; i < stats.length; i++) {
            const stat = stats[i]
            statWidgets[i].setText(`${stat} - ${newStatSet.get(stat)}`)
        }

        // Update skill point counter
        skillPointCounter.setText(pad(newSkillSet.skillPoints, 2))

        // FO2-CE ref: stat.cc critterUpdateDerivedStats() — display derived stats
        const agi = newStatSet.get('AGI')
        const end = newStatSet.get('END')
        const str = newStatSet.get('STR')
        const per = newStatSet.get('PER')
        const luk = newStatSet.get('LUK')

        const derivedLines = [
            `AC: ${agi}`,
            `AP: ${5 + Math.floor(agi / 2)}`,
            `Melee Dmg: ${Math.max(1, str - 5)}`,
            `Carry: ${25 + 25 * str} lbs`,
            `Sequence: ${2 * per}`,
            `Heal Rate: ${Math.max(1, Math.floor(end / 3))}`,
            `Crit Chance: ${luk}%`,
        ]
        derivedStatsLabel.setText(derivedLines.join('\n'))
    }

    redrawStatsSkills()

    // FO2-CE ref: editor.cc — skill modification is available when the player has skill points
    // Stat changes are never allowed during normal gameplay (only char creation).
    const hasSkillPoints = newSkillSet.skillPoints > 0
    const canChangeStats = false // FO2: stats only changeable at char creation

    if (hasSkillPoints) {
        const modifySkill = (inc: boolean) => {
            const sel = skillList.getSelection()
            if (!sel) return
            const skill = sel.id
            console.log('skill: %s currently: %d', skill, newSkillSet.get(skill, newStatSet, playerSkillOpts))

            if (inc) {
                const changed = newSkillSet.incBase(skill, newStatSet, playerSkillOpts)
                if (!changed) {
                    console.warn('Not enough skill points!')
                }
            } else {
                newSkillSet.decBase(skill, newStatSet, playerSkillOpts)
            }

            redrawStatsSkills()
        }

        const toggleTagSkill = () => {
            const sel = skillList.getSelection()
            if (!sel) return
            const skill = sel.id
            const tagged = newSkillSet.isTagged(skill)
            console.log('skill: %s currently: %d tagged: %s', skill, newSkillSet.get(skill, newStatSet, playerSkillOpts), tagged)

            if (!tagged) {
                if (!newSkillSet.tag(skill)) {
                    console.warn('Maximum tagged skills reached!')
                }
            } else {
                newSkillSet.untag(skill)
            }

            redrawStatsSkills()
        }

        // Skill level up buttons
        characterWindow.add(
            new Label(580, 236, '-').onClick(() => {
                modifySkill(false)
            })
        )
        characterWindow.add(
            new Label(600, 236, '+').onClick(() => {
                modifySkill(true)
            })
        )
        characterWindow.add(
            new Label(620, 236, 'Tag').onClick(() => {
                toggleTagSkill()
            })
        )
    }

    // Stat level up buttons (char creation only)
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
    characterWindow.children[0].onClick(() => {
        // Apply skill changes to the player
        player.skills.baseSkills = Object.assign({}, newSkillSet.baseSkills)
        player.skills.tagged = newSkillSet.tagged.slice()
        player.skills.skillPoints = newSkillSet.skillPoints
        player.skills.hasTagPerk = newSkillSet.hasTagPerk

        // Apply stat changes (if any were allowed)
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
        uiInventoryScreen()
    }
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
                console.log("Can't end turn while player is in an animation.")
                return
            }
            console.log('[TURN]')
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
        skilldexWindow.toggle()
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
    Object.assign($menu.style, {
        visibility: 'visible',
        left: `${evt.clientX}px`,
        top: `${evt.clientY}px`,
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
        console.log('talking to ' + obj.name)
        if (!obj._script) {
            console.warn('obj has no script')
            return
        }
        Scripting.talk(obj._script, obj)
    })
    const pickupBtn = button(obj, 'pickup', () => obj.pickup(globalState.player))
    const inventoryBtn = button(obj, 'inventory', () => uiInventoryScreen())
    const skillBtn = button(obj, 'skill', () => skilldexWindow.toggle())

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
        console.log('idx: ' + idx)
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

    console.log('obj: ' + obj + ' (data: ' + data + ', target: ' + target + ')')

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
                console.warn('applyArmorArt: lookupArt failed for fid', fid, e)
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
        console.log('start drag')
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
                console.log('using object: ' + obj.art)
                obj.use(globalState.player)
                break
            case 'drop':
                console.log('dropping: ' + obj.art + ' with pid ' + obj.pid)
                if (slot !== 'inventory') {
                    console.log('moving into inventory first')
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
                console.log(`[unload] ammoPID=${ammoPID} rounds=${ammoCurrent}`)
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
        Object.assign($menu.style, {
            visibility: 'visible',
            left: `${e.clientX}px`,
            top: `${e.clientY}px`,
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
        console.log('going to pop up barter box')

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
        console.log('[OFFER]')

        const merchantOffered = totalAmount(merchantBarterTable)
        const playerOffered = totalAmount(playerBarterTable)
        const diffOffered = playerOffered - merchantOffered

        if (diffOffered >= 0) {
            // OK, player offered equal to more more than the value
            console.log('[OFFER OK]')

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
            console.log('[OFFER REFUSED]')
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
        console.log('barter: move ' + data + ' to ' + where)

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
        console.log('loot: move ' + data + ' to ' + where)

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

    console.log('looting...')

    showv($id('lootBox'))

    // loot drop targets
    makeDropTarget($id('lootBoxLeft'), (data: string) => {
        uiLootMove(data, 'left')
    })
    makeDropTarget($id('lootBoxRight'), (data: string) => {
        uiLootMove(data, 'right')
    })

    $id('lootBoxTakeAllButton').onclick = () => {
        console.log('take all...')
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
        console.log('Area entrance: ' + entrance.mapLookupName)
        const $entranceEl = makeEl('div', { classes: ['worldmapEntrance'] })
        const $hotspot = makeEl('div', { classes: ['worldmapEntranceHotspot'] })

        $hotspot.onclick = () => {
            // hotspot click -- travel to relevant map
            const mapName = lookupMapNameFromLookup(entrance.mapLookupName)
            console.log('hotspot -> ' + mapName + ' (via ' + entrance.mapLookupName + ')')
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
    console.log('elevator art: ' + art)
    console.log('buttons: ' + elevator.buttonCount)

    if (elevator.labels !== -1) {
        const labelArt = lookupInterfaceArt(elevator.labels)
        console.log('elevator label art: ' + labelArt)

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
                console.log('elevator -> map ' + mapID + ', level ' + level + ' @ ' + position.x + ', ' + position.y)
                globalState.gMap.loadMapByID(mapID, position, level)
            } else if (level !== globalState.currentElevation) {
                // same map, different elevation
                console.log('elevator -> level ' + level + ' @ ' + position.x + ', ' + position.y)
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
        console.log('id: %s | chance: %d', '#calledShot-' + region + '-chance #digit', chance)
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
                console.log('clicked a called location (%s)', clickedRegion)
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
