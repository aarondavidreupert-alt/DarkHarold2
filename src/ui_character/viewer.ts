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
import { Events } from '../events.js'
import globalState from '../globalState.js'
import { UIMode } from '../ui_panels.js'
import { dbg, dbgWarn } from '../logger.js'
import { Widget } from '../ui_widget.js'
import { font2, font3, makeFontLabel, renderBignum } from '../ui_font.js'
import { updateIndicatorBar } from '../ui_hud.js'
import { WindowFrame, SmallButton, Label } from '../ui_components.js'
import { makePanelDraggable } from '../ui_drag.js'
import { PERKS } from '../perks.js'
import {
    SPECIAL_FULL_NAMES, SPECIAL_DESCRIPTIONS, SKILL_DESCRIPTIONS,
    DERIVED_DESCRIPTIONS, CONDITION_DESCRIPTIONS, TRAIT_DESCRIPTIONS,
    SPECIAL_IMG, SKILL_IMG, DERIVED_IMG, CONDITION_IMG, TRAIT_IMG,
    statComment, FOLDER_TABS, STATS, SKILLS,
} from './descriptions.js'
import { showPerkModal } from './perkModal.js'
import { ADDICTION_KARMA_GVARS } from '../drugs.js'
import { Scripting } from '../scripting.js'
import { getMessage } from '../util.js'
import { showAlert } from '../ui_dialog.js'
import { renderStatPanels } from './statPanels.js'
import { printCharacterSheet } from './printSheet.js'
import { createFolderView, FolderView } from './folders.js'
import { assetUrl } from '../modAssets.js'

// ── Window singleton ──────────────────────────────────────────────────────────
// Shared between viewer (showCharacterScreen) and creator (showCharacterCreator)
// so getCharacterWindow() in ui.ts mutual-exclusion sees whichever is currently
// open. Creator imports setCharacterWindow() to plug its WindowFrame in.

let characterWindow: WindowFrame
let _statsChangedHandler: (() => void) | null = null

/** CE character_editor.cc: a refused change — the error sound and editor.msg `a` / `b` in a
 *  dialog box (characterEditorHandleAdjustSkillButton, ToggleTaggedSkill, ToggleOptionalTrait). */
export function editorRefuse(a: number, b?: number): Promise<void> {
    globalState.audioEngine?.playSfxByName?.('iisxxxx1')
    const line = (id: number) => getMessage('editor', id) ?? ''
    return showAlert(b === undefined ? line(a) : `${line(a)}
${line(b)}`)
}

export function getCharacterWindow(): WindowFrame | null {
    return characterWindow ?? null
}

export function setCharacterWindow(w: WindowFrame): void {
    characterWindow = w
}

export function closeCharacterScreen(): void {
    if (_statsChangedHandler) { Events.off('statsChanged', _statsChangedHandler); _statsChangedHandler = null }
    if (characterWindow && characterWindow.showing) {
        characterWindow.close()
    }
}

// ── showCharacterScreen() ─────────────────────────────────────────────────────
// In-game read-only view — behavior identical to original.

export function showCharacterScreen() {
    const player = globalState.player!
    // CE character_editor.cc characterEditorShow: DUDE_STATE_LEVEL_UP_AVAILABLE goes out
    player.levelUpAvailable = false
    updateIndicatorBar()
    // CE characterEditorSavePlayer / characterEditorRestorePlayer: CANCEL puts the perks,
    // the free perk, traits, SPECIAL / HP and skills back as they were when the screen opened
    const saved = {
        perks: player.perks.slice(),
        traits: ((player as any).traits ?? []).slice(),
        pendingPerkPick: player.pendingPerkPick,
        baseStats: Object.assign({}, player.stats.baseStats),
        bonusStats: Object.assign({}, player.stats.bonusStats),
        baseSkills: Object.assign({}, player.skills.baseSkills),
        tagged: player.skills.tagged.slice(),
        skillPoints: player.skills.skillPoints,
        hasTagPerk: player.skills.hasTagPerk,
    }
    const cancel = () => {
        player.perks = saved.perks
        ;(player as any).traits = saved.traits
        player.pendingPerkPick = saved.pendingPerkPick
        player.stats.baseStats = saved.baseStats
        player.stats.bonusStats = saved.bonusStats
        player.skills.baseSkills = saved.baseSkills
        player.skills.tagged = saved.tagged
        player.skills.skillPoints = saved.skillPoints
        player.skills.hasTagPerk = saved.hasTagPerk
        updateIndicatorBar()
        Events.emit('statsChanged')
        closeCharacterScreen()
    }

    // FO2-CE ref: stat.cc pcGetExperienceForLevel() — XP needed for next level
    const currentLevel = player.getStat('Level')
    const nextLevelXP = Math.floor((currentLevel + 1) * currentLevel / 2) * 1000

    // Skill point bignum container
    const skillPointBignumW = new Widget(null, { x: 523, y: 228, w: 28, h: 28 })
    const skillPointBignumEl = skillPointBignumW.elem

    // Panel 2: Hit Points + condition flags (upper status box)
    // Both status boxes are drawn in one window-origin layer at CE coordinates
    // (statPanels.ts); panel3 stays empty.
    const panel2 = new Widget(null, { x: 0, y: 0, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', whiteSpace: 'pre' })
    const panel2El = panel2.elem

    // Panel 3: derived stats (lower status box)
    const panel3 = new Widget(null, { x: 196, y: 176, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#3cf800', whiteSpace: 'pre', lineHeight: '1.2' })
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
        backgroundImage: "url('" + assetUrl('art/intrface/slider.png') + "')",
        backgroundRepeat: 'no-repeat',
        left: '-8px',
        top: '-10px',
    })

    const plusBtn = document.createElement('div')
    Object.assign(plusBtn.style, {
        position: 'absolute',
        width: '22px',
        height: '12px',
        backgroundImage: "url('" + assetUrl('art/intrface/splsoff.png') + "')",
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
        backgroundImage: "url('" + assetUrl('art/intrface/snegoff.png') + "')",
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
        .add(new SmallButton(345, 454).onClick(() => printCharacterSheet())) // CE characterPrintToFile
        .add(makeFontLabel(345 + 18, 454, 'PRINT', font3).css({ pointerEvents: 'none' }))
        .add(doneButton)
        .add(makeFontLabel(455 + 18, 454, 'DONE', font3).css({ pointerEvents: 'none' }))
        .add(
            new SmallButton(552, 454).onClick(cancel)
        )
        .add(makeFontLabel(552 + 18, 454, 'CANCEL', font3).css({ pointerEvents: 'none' }))
        // CE characterEditorDrawPcStats: x 32 from y 280, lineHeight + 1 apart, editor.msg 113-115
        .add(
            new Label(32, 280, `${getMessage('editor', 113) ?? 'Level:'} ${currentLevel}`).css({
                fontSize: '0.69em',
                color: '#3cf800',
            })
        )
        .add(
            new Label(32, 291, `${getMessage('editor', 114) ?? 'Exp:'} ${player.getStat('Experience')}`).css({
                fontSize: '0.69em',
                color: '#3cf800',
            })
        )
        .add(
            new Label(32, 302, `${getMessage('editor', 115) ?? 'Next Level:'} ${nextLevelXP}`).css({
                fontSize: '0.69em',
                color: '#3cf800',
            })
        )
        .add(makeFontLabel(380, 5, 'Skills', font3))
        .add(makeFontLabel(399, 233, 'Skill Points', font3))
        .add(panel2)
        .add(panel3)
        .add(skillPointBignumW)
        .show()

    const skillRowsEl = document.createElement('div')
    // CE characterEditorDrawSkills: font 101 from (380, 27), fontGetLineHeight() + 1 =
    // 11 px a row — fixed, so the list doesn't depend on the browser font's metrics.
    Object.assign(skillRowsEl.style, {
        position: 'absolute',
        left: '380px',
        top: '27px',
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
        backgroundImage: "url('" + assetUrl('art/intrface/nameoff.png') + "')",
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
        screenNameLbl.appendChild(font3.renderText(player.name || 'none', '#907824'))
    })
    characterWindow.elem.appendChild(screenNameLbl)

    // Age — ageoff.png sprite + font3 age text on top
    const screenAgeBtn = document.createElement('div')
    Object.assign(screenAgeBtn.style, {
        position: 'absolute', left: '156px', top: '0px',
        width: '81px', height: '35px',
        backgroundImage: "url('" + assetUrl('art/intrface/ageoff.png') + "')",
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
        screenAgeLbl.appendChild(font3.renderText(String(player.getStat('Age')), '#907824'))
    })
    characterWindow.elem.appendChild(screenAgeLbl)

    // Sex — sexoff.png sprite + font3 gender text on top
    const screenSexBtn = document.createElement('div')
    Object.assign(screenSexBtn.style, {
        position: 'absolute', left: '237px', top: '0px',
        width: '80px', height: '35px',
        backgroundImage: "url('" + assetUrl('art/intrface/sexoff.png') + "')",
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
        screenSexLbl.appendChild(font3.renderText(player.gender === 'female' ? 'Female' : 'Male', '#907824'))
    })
    characterWindow.elem.appendChild(screenSexLbl)

    // --- Folder tab strip (Perks / Karma / Kills) ---
    const tabStripEl = document.createElement('div')
    Object.assign(tabStripEl.style, {
        position: 'absolute',
        left: '11px',
        top: '330px',
    })

    const tabImg = document.createElement('img')
    tabImg.src = assetUrl(FOLDER_TABS[0].sprite)
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

    // The folder contents (CE folder view) — created with the info card below.
    let folderView: FolderView | null = null

    let activeFolder = 0
    const activateFolder = (idx: number) => {
        activeFolder = idx
        tabImg.src = assetUrl(FOLDER_TABS[idx].sprite)
        globalState.audioEngine?.playSfxByName?.('ib3p1xx1')
        folderView?.setFolder(idx)
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
            const lbl = font3.renderText(tab.label, '#907824')
            lbl.style.pointerEvents = 'none'
            region.appendChild(lbl)
        })

        tabOverlayEl.appendChild(region)
    })

    characterWindow.elem.appendChild(tabStripEl)

    makePanelDraggable(characterWindow.elem, 'character')

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

    const cardBodyEl = document.createElement('div')
    Object.assign(cardBodyEl.style, {
        position: 'absolute',
        left: '348px',
        top: '313px',
        width: '136px', // CE characterEditorDrawCard: wordWrap(description, 136) from x 348
        background: 'transparent',
        border: 'none',
        padding: '0',
        cursor: 'grab',
        pointerEvents: 'auto',
    })
    characterWindow.elem.appendChild(cardBodyEl)

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
        // the pixel font's first glyph column sits left of the text box — the clip box
        // starts 2 px further left, the text stays at x 348
        paddingLeft: '2px',
        marginLeft: '-2px',
        lineHeight: '1.3',
    })
    cardBodyEl.appendChild(cardDescEl)

    const drawCard = (title: string, desc: string, imgPath?: string): void => {
        if (cardTitleEl.firstChild && cardTitleEl.firstChild !== cardDividerEl) cardTitleEl.removeChild(cardTitleEl.firstChild)
        cardTitleEl.insertBefore(font2.renderText(title.toUpperCase(), '#000000'), cardDividerEl)
        cardDescEl.textContent = desc
        if (imgPath) {
            cardImgEl.src = assetUrl(imgPath)
        } else {
            cardImgEl.src = ''
            cardImgEl.style.visibility = 'hidden'
        }
    }
    // A card of the stats / skills / traits: the folder loses its selection.
    const showInfoCard = (title: string, desc: string, imgPath?: string): void => {
        folderView?.blur()
        drawCard(title, desc, imgPath)
    }
    // ── end info card ──────────────────────────────────────────────────────────

    folderView = createFolderView(characterWindow.elem, player, drawCard)

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

        // CE characterEditorDrawPrimaryStat: description at x 103, y statY + 8
        const commentLbl = new Label(103, 45 + n, '', '#3cf800').css({ fontSize: '0.69em' }) as Label
        statCommentLabels.push(commentLbl)
        characterWindow.add(commentLbl)

        n += 33
    }

    const newStatSet = globalState.player!.stats.clone()
    const newSkillSet = globalState.player!.skills.clone()
    const playerSkillOpts = { isPlayer: true, perks: globalState.player!.perks, traits: (globalState.player as any).traits }

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
        renderStatPanels(panel2El, {
            hp: player.getStat('HP'),
            maxHp: newStatSet.get('Max HP'),
            conditions: CONDITIONS.map(([, active]) => active()),
            stats: newStatSet,
            onInfo: (label, kind) => kind === 'condition'
                ? showInfoCard(label, CONDITION_DESCRIPTIONS[label] ?? label, CONDITION_IMG[label])
                : showInfoCard(label, DERIVED_DESCRIPTIONS[label] ?? label, DERIVED_IMG[label]),
        })
    }

    // Drawn by renderPanel2 (both boxes, statPanels.ts).
    const renderPanel3 = () => {}

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
                height: '11px',
                lineHeight: '11px',
                cursor: 'pointer',
                color: isTagged ? '#a0a0a0' : '#3cf800', // CE 21140 tagged / 992
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
            statCommentLabels[i].setText(statComment(clamped))
        }

        updateSkillPointBignum()
        renderPanel2()
        renderPanel3()

        positionSlider()
    }

    const modifySkill = (inc: boolean) => {
        if (!selectedSkill) return

        // CE characterEditorHandleAdjustSkillButton: editor.msg 132 / 133 at 300 %, 136 without the
        // points, 134 / 135 back at the value the editor opened with
        if (inc) {
            const changed = newSkillSet.incBase(selectedSkill, newStatSet, playerSkillOpts)
            if (!changed) {
                if (newSkillSet.get(selectedSkill, newStatSet, playerSkillOpts) >= 300) void editorRefuse(132, 133)
                else void editorRefuse(136)
            }
        } else {
            const currentBase = newSkillSet.getBase(selectedSkill)
            if (currentBase <= openingBaseSkills[selectedSkill]) { void editorRefuse(134, 135); return }
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
            btn.style.backgroundImage = `url('${assetUrl(onSprite)}')`
            modifySkill(inc)
            repeatTimer = window.setInterval(() => modifySkill(inc), 100)
        }
        btn.onmouseup = () => {
            btn.style.backgroundImage = `url('${assetUrl(offSprite)}')`
            stopRepeat()
        }
        btn.onmouseleave = () => {
            btn.style.backgroundImage = `url('${assetUrl(offSprite)}')`
            stopRepeat()
        }
    }

    wireSkillButton(plusBtn, 'art/intrface/splson.png', 'art/intrface/splsoff.png', true)
    wireSkillButton(minusBtn, 'art/intrface/snegon.png', 'art/intrface/snegoff.png', false)

    redrawStatsSkills()
    showInfoCard(SPECIAL_FULL_NAMES['STR'], SPECIAL_DESCRIPTIONS['STR'], SPECIAL_IMG['STR'])

    // Refresh stats live when drugs/effects change them while the screen is open
    _statsChangedHandler = redrawStatsSkills
    Events.on('statsChanged', redrawStatsSkills)

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

        dbg('object', '[CharScreen] Changes saved.')
        updateIndicatorBar()
        closeCharacterScreen()
    })

    // FO2-CE ref: editor.cc editorRun() — perk selector is triggered inside the
    // editor, not at XP gain. Show it now if a pick is pending.
    // CE runs the perk dialog on the live dude; DH2's screen edits clones, so a perk's
    // changes (Educated / Here and Now skill points, Tag!, Mutate!, Gain SPECIAL) are
    // copied into them here — DONE would otherwise write the old values back.
    const syncFromPlayer = () => {
        newSkillSet.baseSkills = Object.assign({}, player.skills.baseSkills)
        newSkillSet.tagged = player.skills.tagged.slice()
        newSkillSet.skillPoints = player.skills.skillPoints
        newSkillSet.hasTagPerk = player.skills.hasTagPerk
        newStatSet.baseStats = Object.assign({}, player.stats.baseStats)
        newStatSet.bonusStats = Object.assign({}, player.stats.bonusStats)
        playerSkillOpts.traits = (player as any).traits
        for (const skill of SKILLS) openingBaseSkills[skill] = newSkillSet.getBase(skill)
        redrawStatsSkills()
    }
    if (player.pendingPerkPick) {
        showPerkModal(player, syncFromPlayer)
    }

    // CE characterEditorShow runs its own input loop (the map is paused): Return / D = done,
    // ESC / C = cancel, P = print
    characterWindow.onShow = null
    globalState.uiMode = UIMode.char
    const onKey = (e: KeyboardEvent) => {
        if (!characterWindow.showing || globalState.uiMode !== UIMode.char) return
        if (document.getElementById('perk-modal-overlay')) return // the perk dialog has its own keys
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
        if (k === 'Enter' || k === 'd') doneButton.elem.click()
        else if (k === 'p') printCharacterSheet()
        else if (k === 'Escape' || k === 'c') cancel()
        else return
        e.preventDefault()
        e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    characterWindow.onClose = () => {
        document.removeEventListener('keydown', onKey, true)
        if (globalState.uiMode === UIMode.char) globalState.uiMode = UIMode.none
    }
}
