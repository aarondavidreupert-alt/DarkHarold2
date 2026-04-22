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

// FO2-CE ref: editor.cc — Character screen.
// SPECIAL stats with descriptive comments, HP / condition flags panel,
// derived stats panel, skill list with bignum point totals, +/- buttons
// (hold-to-repeat) and slider, info card (FO2 stgvsn / skilldex assets),
// folder tab strip (perks / karma / kills), drag-to-reposition.

import { Config } from './config.js'
import globalState from './globalState.js'
import { Widget } from './ui_widget.js'
import { font1, font3, makeFontLabel, renderBignum } from './ui_font.js'
import { WindowFrame, SmallButton, Label, List } from './ui_components.js'
import { makePanelDraggable } from './ui_drag.js'

let characterWindow: WindowFrame

export function getCharacterWindow(): WindowFrame | null {
    return characterWindow ?? null
}

export function closeCharacterScreen(): void {
    if (characterWindow && characterWindow.showing) {
        characterWindow.close()
    }
}

export function showCharacterScreen() {
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
        STR: 'Strength determines how much you can carry and affects melee damage.',
        PER: 'Perception affects your ranged combat and awareness.',
        END: 'Endurance determines your health points and resistances.',
        CHA: 'Charisma affects your ability to deal with people.',
        INT: 'Intelligence affects your skills and dialogue options.',
        AGI: 'Agility affects your action points and small arms skill.',
        LUK: 'Luck affects critical hits and random events.',
    }
    const SKILL_DESCRIPTIONS: Record<string, string> = {
        'Small Guns':     'Small guns skill covers pistols and rifles.',
        'Big Guns':       'Big guns skill covers heavy weapons.',
        'Energy Weapons': 'Energy weapons skill covers laser and plasma.',
        'Unarmed':        'Unarmed skill covers hand-to-hand combat.',
        'Melee Weapons':  'Melee weapons skill covers blades and clubs.',
        'Throwing':       'Throwing skill covers grenades and knives.',
        'First Aid':      'First aid skill allows you to heal minor wounds.',
        'Doctor':         'Doctor skill heals crippled limbs and serious wounds.',
        'Sneak':          'Sneak skill lets you move without being detected.',
        'Lockpick':       'Lockpick skill lets you open locks.',
        'Steal':          'Steal skill lets you lift items from others.',
        'Traps':          'Traps skill lets you set and disarm traps.',
        'Science':        'Science skill covers computers and technology.',
        'Repair':         'Repair skill lets you fix broken equipment.',
        'Speech':         'Speech skill improves your dialogue options.',
        'Barter':         'Barter skill lets you trade for better prices.',
        'Gambling':       'Gambling skill improves your odds in games of chance.',
        'Outdoorsman':    'Outdoorsman skill helps you navigate the wasteland.',
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
