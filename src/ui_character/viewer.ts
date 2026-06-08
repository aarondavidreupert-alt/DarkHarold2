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

// FO2-CE ref: editor.cc — in-game read-only character screen.
// Owns showCharacterScreen() plus the WindowFrame singleton accessors
// (getCharacterWindow / closeCharacterScreen). The new-game creator lives
// in creator.ts; the level-up perk picker lives in perkModal.ts.

import { Config } from '../config.js'
import globalState from '../globalState.js'
import { Widget } from '../ui_widget.js'
import { font2, font3, makeFontLabel, renderBignum } from '../ui_font.js'
import { WindowFrame, SmallButton, Label } from '../ui_components.js'
import { makePanelDraggable } from '../ui_drag.js'
import { PERKS } from '../perks.js'
import {
    SPECIAL_FULL_NAMES, SPECIAL_DESCRIPTIONS, SKILL_DESCRIPTIONS,
    DERIVED_DESCRIPTIONS, CONDITION_DESCRIPTIONS, TRAIT_DESCRIPTIONS,
    SPECIAL_IMG, SKILL_IMG, DERIVED_IMG, CONDITION_IMG, TRAIT_IMG,
    STAT_COMMENTS, FOLDER_TABS, STATS, SKILLS,
} from './descriptions.js'
import { showPerkModal } from './perkModal.js'

// ── Window singleton ──────────────────────────────────────────────────────────
// Shared between viewer (showCharacterScreen) and creator (showCharacterCreator)
// so getCharacterWindow() in ui.ts mutual-exclusion sees whichever is currently
// open. Creator imports setCharacterWindow() to plug its WindowFrame in.

let characterWindow: WindowFrame

export function getCharacterWindow(): WindowFrame | null {
    return characterWindow ?? null
}

export function setCharacterWindow(w: WindowFrame): void {
    characterWindow = w
}

export function closeCharacterScreen(): void {
    if (characterWindow && characterWindow.showing) {
        characterWindow.close()
    }
}

// ── showCharacterScreen() ─────────────────────────────────────────────────────
// In-game read-only view — behavior identical to original.

export function showCharacterScreen() {
    const player = globalState.player!

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
        zIndex: '10',
    })

    const sliderBody = document.createElement('div')
    Object.assign(sliderBody.style, {
        position: 'absolute',
        width: '43px',
        height: '29px',
        backgroundImage: "url('art/intrface/slider.png')",
        backgroundRepeat: 'no-repeat',
        left: '-8px',
        top: '-10px',
    })

    const plusBtn = document.createElement('div')
    Object.assign(plusBtn.style, {
        position: 'absolute',
        width: '22px',
        height: '12px',
        backgroundImage: "url('art/intrface/splsoff.png')",
        backgroundRepeat: 'no-repeat',
        cursor: 'pointer',
        left: '14px',
        top: '-7px',
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
        left: '14px',
        top: '4px',
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
        .add(skillPointBignumW)
        .show()

    const skillRowsEl = document.createElement('div')
    Object.assign(skillRowsEl.style, {
        position: 'absolute',
        left: '380px',
        top: '25px',
        fontSize: '0.69em',
    })
    characterWindow.elem.appendChild(skillRowsEl)

    characterWindow.elem.appendChild(sliderContainer)

    // ── Identity display: inert clones of creator trigger buttons ────────────
    // Name — nameoff.png sprite + font3 name text on top
    const screenNameBtn = document.createElement('div')
    Object.assign(screenNameBtn.style, {
        position: 'absolute', left: '11px', top: '0px',
        width: '145px', height: '35px',
        backgroundImage: "url('art/intrface/nameoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(screenNameBtn)

    const screenNameLbl = document.createElement('div')
    Object.assign(screenNameLbl.style, {
        position: 'absolute', left: '33px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })
    font3.onLoad(() => {
        screenNameLbl.appendChild(font3.renderText(player.name || 'none', '#FFD700'))
    })
    characterWindow.elem.appendChild(screenNameLbl)

    // Age — ageoff.png sprite + font3 age text on top
    const screenAgeBtn = document.createElement('div')
    Object.assign(screenAgeBtn.style, {
        position: 'absolute', left: '156px', top: '0px',
        width: '81px', height: '35px',
        backgroundImage: "url('art/intrface/ageoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(screenAgeBtn)

    const screenAgeLbl = document.createElement('div')
    Object.assign(screenAgeLbl.style, {
        position: 'absolute', left: '184px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })
    font3.onLoad(() => {
        screenAgeLbl.appendChild(font3.renderText(String(player.getStat('Age')), '#FFD700'))
    })
    characterWindow.elem.appendChild(screenAgeLbl)

    // Sex — sexoff.png sprite + font3 gender text on top
    const screenSexBtn = document.createElement('div')
    Object.assign(screenSexBtn.style, {
        position: 'absolute', left: '237px', top: '0px',
        width: '80px', height: '35px',
        backgroundImage: "url('art/intrface/sexoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(screenSexBtn)

    const screenSexLbl = document.createElement('div')
    Object.assign(screenSexLbl.style, {
        position: 'absolute', left: '248px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })
    font3.onLoad(() => {
        screenSexLbl.appendChild(font3.renderText(player.gender === 'female' ? 'Female' : 'Male', '#FFD700'))
    })
    characterWindow.elem.appendChild(screenSexLbl)

    // --- Folder tab strip (Perks / Karma / Kills) ---
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

    const tabContentEl = document.createElement('div')
    Object.assign(tabContentEl.style, {
        position: 'absolute',
        left: '30px',
        top: '370px',
        fontSize: '0.69em',
        color: '#00FF00',
    })

    const mkSectionHeader = (text: string) => {
        const hdr = document.createElement('div')
        hdr.textContent = text
        Object.assign(hdr.style, {
            color: '#00FF00',
            fontSize: '0.85em',
            margin: '2px 0 1px',
            pointerEvents: 'none',
            userSelect: 'none',
        })
        return hdr
    }

    const folderPanels: HTMLElement[] = FOLDER_TABS.map((t, i) => {
        const panel = document.createElement('div')
        if (i === 0) {
            // ── TRAITS section ────────────────────────────────────────────────
            panel.appendChild(mkSectionHeader('────── TRAITS ──────'))

            const activeTraits: string[] = player.traits ?? []
            if (activeTraits.length === 0) {
                const none = document.createElement('div')
                none.textContent = 'No traits selected.'
                Object.assign(none.style, { color: '#70A070', fontSize: '0.9em' })
                panel.appendChild(none)
            } else {
                for (const traitName of activeTraits) {
                    const line = document.createElement('div')
                    line.textContent = traitName
                    Object.assign(line.style, { color: '#FFD700', cursor: 'pointer' })
                    line.onclick = () => showInfoCard(traitName, TRAIT_DESCRIPTIONS[traitName] ?? traitName, TRAIT_IMG[traitName])
                    panel.appendChild(line)
                }
            }

            // ── PERKS section ─────────────────────────────────────────────────
            panel.appendChild(mkSectionHeader('────── PERKS ──────'))

            const perks = player.perks ?? []
            if (perks.length === 0) {
                const none = document.createElement('div')
                none.textContent = 'No perks.'
                Object.assign(none.style, { color: '#00FF00', fontSize: '0.9em' })
                panel.appendChild(none)
            } else {
                const counts: Record<string, number> = {}
                for (const p of perks) counts[p] = (counts[p] ?? 0) + 1
                for (const [perkName, rank] of Object.entries(counts)) {
                    const def = PERKS.find(d => d.name === perkName)
                    const line = document.createElement('div')
                    line.textContent = rank > 1 ? `${perkName} (${rank})` : perkName
                    line.style.color = '#FFD700'
                    line.style.cursor = 'pointer'
                    line.onclick = () => showInfoCard(perkName, def?.description ?? perkName, undefined)
                    panel.appendChild(line)
                }
            }
        } else if (i === 1) {
            // KARMA panel — populated fresh each time the tab is activated
            panel.dataset.karmaPanel = '1'
        } else {
            panel.textContent = t.label
        }
        panel.style.display = i === 0 ? 'block' : 'none'
        tabContentEl.appendChild(panel)
        return panel
    })

    const KARMA_TITLES: Array<[number, string]> = [
        [750, 'Savior of the Damned'],
        [500, 'Guardian of the Wastes'],
        [250, 'Shield of Hope'],
        [100, 'Defender'],
        [0,   'Wanderer'],
        [-99, 'Betrayer'],
        [-249, 'Sword of Despair'],
        [-499, 'Scourge of the Wastes'],
        [-Infinity, 'Demon Spawn'],
    ]

    const TOWN_NAMES = [
        'Arroyo', 'Klamath', 'The Den', 'Vault City', 'Gecko', 'Modoc',
        'Sierra Base', 'Broken Hills', 'New Reno', 'Redding', 'NCR',
        'Vault 13', 'San Francisco', 'Abbey', 'EPA', 'Primitive Tribe',
        'Raiders', 'Vault 15', 'Ghost Farm',
    ]

    const townStanding = (val: number): string => {
        if (val >= 30)  return 'Idolized'
        if (val >= 15)  return 'Liked'
        if (val >= 1)   return 'Accepted'
        if (val === 0)  return 'Neutral'
        if (val >= -14) return 'Antipathy'
        if (val >= -29) return 'Hated'
        return 'Vilified'
    }

    const addLine = (parent: HTMLElement, text: string) => {
        const el = document.createElement('div')
        el.textContent = text
        Object.assign(el.style, { color: '#00FF00' })
        parent.appendChild(el)
    }

    const refreshKarmaPanel = (panel: HTMLElement) => {
        while (panel.firstChild) panel.removeChild(panel.firstChild)

        // ── Global Karma ──────────────────────────────────────────────────────
        panel.appendChild(mkSectionHeader('────── KARMA ──────'))
        const karmaVal = player.stats.getBase('Karma')
        addLine(panel, `Karma: ${karmaVal}`)
        const title = (KARMA_TITLES.find(([threshold]) => karmaVal >= threshold) ?? KARMA_TITLES[KARMA_TITLES.length - 1])[1]
        addLine(panel, title)

        // ── Town Reputation ───────────────────────────────────────────────────
        panel.appendChild(mkSectionHeader('────── REPUTATION ──────'))
        for (const town of TOWN_NAMES) {
            const key = `Rep_${town}`
            const repStats = player.stats as any
            if (!(key in (repStats.baseStats ?? {}))) continue
            const val: number = player.stats.getBase(key)
            addLine(panel, `${town}: ${townStanding(val)}`)
        }
    }

    let activeFolder = 0
    const activateFolder = (idx: number) => {
        activeFolder = idx
        tabImg.src = FOLDER_TABS[idx].sprite
        folderPanels.forEach((p, i) => { p.style.display = i === idx ? 'block' : 'none' })
        if (idx === 1) refreshKarmaPanel(folderPanels[1])
    }

    // Populate karma panel for initial display if it starts active
    refreshKarmaPanel(folderPanels[1])

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

    makePanelDraggable(characterWindow.elem)

    // ── Info card ─────────────────────────────────────────────────────────────
    const cardImgEl = document.createElement('img') as HTMLImageElement
    Object.assign(cardImgEl.style, {
        position: 'absolute',
        left: '483px',
        top: '308px',
        width: '140px',
        height: '117px',
        objectFit: 'contain',
        visibility: 'hidden',
        cursor: 'grab',
    })
    cardImgEl.onload = () => { cardImgEl.style.visibility = 'visible' }
    cardImgEl.onerror = () => { cardImgEl.style.visibility = 'hidden' }
    characterWindow.elem.appendChild(cardImgEl)
    makePanelDraggable(cardImgEl)

    const cardTitleEl = document.createElement('div')
    Object.assign(cardTitleEl.style, {
        position: 'absolute',
        left: '348px',
        top: '274px',
        background: 'transparent',
        border: 'none',
        padding: '0',
        cursor: 'grab',
        pointerEvents: 'auto',
        width: '265px',
    })
    characterWindow.elem.appendChild(cardTitleEl)
    makePanelDraggable(cardTitleEl)

    const cardBodyEl = document.createElement('div')
    Object.assign(cardBodyEl.style, {
        position: 'absolute',
        left: '348px',
        top: '313px',
        width: '130px',
        background: 'transparent',
        border: 'none',
        padding: '0',
        cursor: 'grab',
        pointerEvents: 'auto',
    })
    characterWindow.elem.appendChild(cardBodyEl)
    makePanelDraggable(cardBodyEl)

    const cardDividerEl = document.createElement('hr')
    Object.assign(cardDividerEl.style, {
        border: 'none',
        borderTop: '2px solid #000000',
        margin: '2px 0',
        width: '100%',
    })
    cardTitleEl.appendChild(cardDividerEl)

    const cardDescEl = document.createElement('div')
    Object.assign(cardDescEl.style, {
        fontSize: '0.69em',
        color: '#000000',
        overflow: 'hidden',
        lineHeight: '1.3',
    })
    cardBodyEl.appendChild(cardDescEl)

    const showInfoCard = (title: string, desc: string, imgPath?: string): void => {
        if (cardTitleEl.firstChild && cardTitleEl.firstChild !== cardDividerEl) cardTitleEl.removeChild(cardTitleEl.firstChild)
        cardTitleEl.insertBefore(font2.renderText(title.toUpperCase(), '#000000'), cardDividerEl)
        cardDescEl.textContent = desc
        if (imgPath) {
            cardImgEl.src = imgPath
        } else {
            cardImgEl.src = ''
            cardImgEl.style.visibility = 'hidden'
        }
    }
    // ── end info card ──────────────────────────────────────────────────────────

    const statValueWidgets: HTMLElement[] = []
    const statCommentLabels: Label[] = []

    let selectedStat = STATS[0]

    let n = 0
    for (const stat of STATS) {
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

    const newStatSet = globalState.player!.stats.clone()
    const newSkillSet = globalState.player!.skills.clone()
    const playerSkillOpts = { isPlayer: true, perks: globalState.player!.perks }

    const openingBaseSkills: { [name: string]: number } = {}
    for (const skill of SKILLS) {
        openingBaseSkills[skill] = newSkillSet.getBase(skill)
    }

    let selectedSkill: string | null = SKILLS[0]

    const positionSlider = () => {
        if (!selectedSkill) {
            sliderContainer.style.display = 'none'
            return
        }
        const idx = SKILLS.indexOf(selectedSkill)
        if (idx === -1) {
            sliderContainer.style.display = 'none'
            return
        }
        const rowEl = skillRowsEl.children[idx] as HTMLElement | undefined
        if (!rowEl) {
            sliderContainer.style.display = 'none'
            return
        }
        sliderContainer.style.left = '602px'
        sliderContainer.style.top = `${skillRowsEl.offsetTop + rowEl.offsetTop}px`
        sliderContainer.style.display = 'block'
    }

    const updateSkillPointBignum = () => {
        while (skillPointBignumEl.firstChild) skillPointBignumEl.removeChild(skillPointBignumEl.firstChild)
        skillPointBignumEl.appendChild(renderBignum(newSkillSet.skillPoints, 2))
    }

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
        while (skillRowsEl.firstChild) skillRowsEl.removeChild(skillRowsEl.firstChild)

        for (const skill of SKILLS) {
            const val = newSkillSet.get(skill, newStatSet, playerSkillOpts)
            const isTagged = newSkillSet.tagged.includes(skill)
            const row = document.createElement('div')
            Object.assign(row.style, {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minWidth: '215px',
                cursor: 'pointer',
                color: isTagged ? '#FFD700' : '#00FF00',
            })
            const nameSpan = document.createElement('span')
            nameSpan.textContent = skill
            const valSpan = document.createElement('span')
            valSpan.textContent = `${val}%`
            row.appendChild(nameSpan)
            row.appendChild(valSpan)
            const capturedSkill = skill
            row.onclick = () => {
                selectedSkill = capturedSkill
                positionSlider()
                showInfoCard(capturedSkill, SKILL_DESCRIPTIONS[capturedSkill] ?? capturedSkill, SKILL_IMG[capturedSkill])
            }
            skillRowsEl.appendChild(row)
        }

        for (let i = 0; i < STATS.length; i++) {
            const el = statValueWidgets[i]
            while (el.firstChild) el.removeChild(el.firstChild)
            const value = newStatSet.get(STATS[i])
            el.appendChild(renderBignum(value, 2))

            const clamped = Math.max(1, Math.min(10, value))
            statCommentLabels[i].setText(STAT_COMMENTS[clamped])
        }

        updateSkillPointBignum()
        renderPanel2()
        renderPanel3()

        positionSlider()
    }

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

    // FO2-CE ref: editor.cc editorRun() — perk selector is triggered inside the
    // editor, not at XP gain. Show it now if a pick is pending.
    if (player.pendingPerkPick) {
        showPerkModal(player)
    }
}
