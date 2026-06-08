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

// FO2-CE ref: editor.cc editorRun() — character creation mode.
// Called from the main menu NEW GAME path via ui_charactercreator.ts.
// Shares the `characterWindow` singleton with viewer.ts via
// setCharacterWindow() so ui.ts's mutual-exclusion lookup works for both.

import { Config } from '../config.js'
import globalState from '../globalState.js'
import { Widget } from '../ui_widget.js'
import { font2, font3, makeFontLabel, renderBignum } from '../ui_font.js'
import { WindowFrame, SmallButton, Label } from '../ui_components.js'
import { makePanelDraggable } from '../ui_drag.js'
import { StatSet, SkillSet, SkillCalcOptions } from '../char.js'
import {
    SPECIAL_FULL_NAMES, SPECIAL_DESCRIPTIONS, SKILL_DESCRIPTIONS,
    DERIVED_DESCRIPTIONS, CONDITION_DESCRIPTIONS, TRAIT_DESCRIPTIONS,
    SPECIAL_IMG, SKILL_IMG, DERIVED_IMG, CONDITION_IMG, TRAIT_IMG,
    STAT_COMMENTS, STATS, SKILLS, TRAITS,
} from './descriptions.js'
import { setCharacterWindow } from './viewer.js'

// ── showCharacterCreator() ────────────────────────────────────────────────────
// FO2-CE ref: editor.cc editorRun() — character creation mode.
// Called from the main menu NEW GAME path via ui_charactercreator.ts.
//
// onDone   — called after valid DONE (player stats applied, start the game)
// onCancel — called when CANCEL is clicked (returns to main menu)

export function showCharacterCreator(onDone: () => void, onCancel: () => void): void {
    const player = globalState.player!

    // Fresh stat/skill sets — all SPECIAL at default (5); no invested points
    const newStatSet = new StatSet()
    const newSkillSet = new SkillSet()



    // Creation-mode state
    let pool = 5                                   // bonus SPECIAL points to allocate
    let selectedTraits: string[] = []
    let playerName = 'none'
    let playerAge = 25
    let playerSex: 'Male' | 'Female' = 'Male'

    // SkillCalcOptions — traits array updated live so skill list reflects Good Natured etc.
    const skillOpts: SkillCalcOptions = { isPlayer: true, perks: [], traits: selectedTraits }

    // ── Skill point pool bignum (not used in creation — tags only) ────────────
    const skillPointBignumW = new Widget(null, { x: 523, y: 228, w: 28, h: 28 })
    // In creation mode we show a pool label instead of skill points
    skillPointBignumW.css({ display: 'none' })

    // ── Panel 2: HP display (conditions all inactive for new character) ────────
    const panel2 = new Widget(null, { x: 196, y: 43, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel2El = panel2.elem

    // ── Panel 3: derived stats ────────────────────────────────────────────────
    const panel3 = new Widget(null, { x: 196, y: 176, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel3El = panel3.elem

    // ── Skill rows container (replaces List widget) ───────────────────────────
    const skillRowsEl = document.createElement('div')
    Object.assign(skillRowsEl.style, {
        position: 'absolute',
        left: '356px',
        top: '25px',
        width: '240px',
        fontSize: '0.69em',
    })

    // ── Build WindowFrame ─────────────────────────────────────────────────────
    const doneBtn = new SmallButton(455, 454)
    const cancelBtn = new SmallButton(552, 454)

    const characterWindow = new WindowFrame(
        'art/intrface/edtrcrte.png',
        {
            x: Config.ui.screenWidth / 2 - 640 / 2,
            y: Config.ui.screenHeight - 99 - 480,
        },
        640,
        480
    )
        .add(doneBtn)
        .add(makeFontLabel(455 + 18, 454, 'DONE', font3).css({ pointerEvents: 'none' }))
        .add(cancelBtn)
        .add(makeFontLabel(552 + 18, 454, 'CANCEL', font3).css({ pointerEvents: 'none' }))
        .add(makeFontLabel(380, 5, 'Skills', font3))
        .add(panel2)
        .add(panel3)
        .add(skillPointBignumW)
        .show()
    setCharacterWindow(characterWindow)

    characterWindow.elem.appendChild(skillRowsEl)
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

    // ── Stat value widgets (bignum displays) ──────────────────────────────────
    const statValueWidgets: HTMLElement[] = []
    const statCommentLabels: Label[] = []

    let n = 0
    for (const stat of STATS) {
        const valW = new Widget(null, { x: 59, y: 37 + n, w: 28, h: 28 })
        valW.css({ cursor: 'pointer' }).onClick(() => {
            showInfoCard(SPECIAL_FULL_NAMES[stat], SPECIAL_DESCRIPTIONS[stat], SPECIAL_IMG[stat])
        })
        statValueWidgets.push(valW.elem)
        characterWindow.add(valW)

        const commentLbl = new Label(105, 43 + n, '', '#00FF00').css({ fontSize: '0.69em' }) as Label
        statCommentLabels.push(commentLbl)
        characterWindow.add(commentLbl)

        n += 33
    }

    // ── Pool display: "Skill Points" label + bignum value ────────────────────
    const poolTextEl = document.createElement('div')
    Object.assign(poolTextEl.style, {
        position: 'absolute',
        left: '15px',
        top: '287px',
        pointerEvents: 'none',
    })
    font3.onLoad(() => {
        poolTextEl.appendChild(font3.renderText('Char Points', '#FFD700'))
    })
    characterWindow.elem.appendChild(poolTextEl)

    const poolBignumContainer = document.createElement('div')
    Object.assign(poolBignumContainer.style, {
        position: 'absolute',
        left: '128px',
        top: '282px',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(poolBignumContainer)

    const updatePoolLabel = () => {
        while (poolBignumContainer.firstChild) poolBignumContainer.removeChild(poolBignumContainer.firstChild)
        poolBignumContainer.appendChild(renderBignum(pool, 2))
    }
    updatePoolLabel()

    // ── SPECIAL ± buttons (stplsoff/stplson · stnegoff/stnegon) ─────────────
    const wireEbut = (btn: HTMLElement, imgOff: string, imgOn: string, onPress: () => void) => {
        btn.onmousedown  = () => { btn.style.backgroundImage = `url('${imgOn}')`;  onPress() }
        btn.onmouseup    = () => { btn.style.backgroundImage = `url('${imgOff}')` }
        btn.onmouseleave = () => { btn.style.backgroundImage = `url('${imgOff}')` }
    }

    let si = 0
    for (const stat of STATS) {
        const upBtn = document.createElement('div')
        Object.assign(upBtn.style, {
            position: 'absolute',
            left: '149px',
            top: `${38 + si * 33}px`,
            width: '16px',
            height: '12px',
            backgroundImage: "url('art/intrface/stplsoff.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '16px 12px',
            cursor: 'pointer',
            zIndex: '2',
        })

        const dnBtn = document.createElement('div')
        Object.assign(dnBtn.style, {
            position: 'absolute',
            left: '149px',
            top: `${48 + si * 33}px`,
            width: '16px',
            height: '12px',
            backgroundImage: "url('art/intrface/stnegoff.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '16px 12px',
            cursor: 'pointer',
            zIndex: '2',
        })

        const capturedStat = stat
        wireEbut(upBtn, 'art/intrface/stplsoff.png', 'art/intrface/stplson.png', () => {
            if (pool <= 0) return
            const cur = newStatSet.getBase(capturedStat)
            if (cur >= 10) return
            newStatSet.setBase(capturedStat, cur + 1)
            pool--
            updatePoolLabel()
            redrawStatsSkills()
        })
        wireEbut(dnBtn, 'art/intrface/stnegoff.png', 'art/intrface/stnegon.png', () => {
            const cur = newStatSet.getBase(capturedStat)
            if (cur <= 1) return
            newStatSet.setBase(capturedStat, cur - 1)
            pool++
            updatePoolLabel()
            redrawStatsSkills()
        })

        characterWindow.elem.appendChild(upBtn)
        characterWindow.elem.appendChild(dnBtn)
        si++
    }

    // ── Popup helper ──────────────────────────────────────────────────────────
    let popupEscHandler: ((e: KeyboardEvent) => void) | null = null

    const closePopup = () => {
        const el = document.getElementById('creator-popup-overlay')
        if (el) el.remove()
        if (popupEscHandler) {
            document.removeEventListener('keydown', popupEscHandler)
            popupEscHandler = null
        }
    }

    const openCreatorPopup = (type: 'name' | 'age' | 'sex', onConfirm: () => void) => {
        closePopup()

        let applyFn: () => void = () => {}
        const confirmAndClose = () => { applyFn(); onConfirm(); closePopup() }

        const overlay = document.createElement('div')
        overlay.id = 'creator-popup-overlay'
        Object.assign(overlay.style, {
            position: 'fixed', zIndex: '2000',
            left: '0', top: '0', width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)',
        })
        overlay.onclick = (e) => { if (e.target === overlay) closePopup() }

        const box = document.createElement('div')
        Object.assign(box.style, {
            position: 'relative',
            backgroundImage: "url('art/intrface/charwin.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '100% 100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 12px 8px',
            minWidth: '139px',
            minHeight: '72px',
            boxSizing: 'border-box',
        })
        box.onclick = (e) => e.stopPropagation()

        const contentEl = document.createElement('div')
        Object.assign(contentEl.style, {
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '4px',
            flex: '1', width: '100%',
        })
        box.appendChild(contentEl)

        // ── DONE button row ──────────────────────────────────────────────────
        const doneRow = document.createElement('div')
        Object.assign(doneRow.style, {
            position: 'relative',
            left: '-13px', top: '-1px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'flex-end', width: '100%', gap: '4px',
        })

        const doneBoxEl = document.createElement('div')
        Object.assign(doneBoxEl.style, {
            position: 'absolute', left: '18px', top: '-3px',
            width: '108px', height: '24px',
            backgroundImage: "url('art/intrface/donebox.png')",
            backgroundRepeat: 'no-repeat', backgroundSize: '108px 24px',
            pointerEvents: 'none', zIndex: '0',
        })
        doneRow.appendChild(doneBoxEl)

        const doneLblEl = document.createElement('div')
        Object.assign(doneLblEl.style, { pointerEvents: 'none', zIndex: '1', position: 'relative' })
        font3.onLoad(() => { doneLblEl.appendChild(font3.renderText('DONE')) })

        const doneBtn = document.createElement('div')
        Object.assign(doneBtn.style, {
            width: '15px', height: '16px',
            backgroundImage: "url('art/intrface/lilredup.png')",
            backgroundRepeat: 'no-repeat', backgroundSize: '15px 16px',
            cursor: 'pointer', zIndex: '1', position: 'relative',
        })
        doneBtn.onmousedown  = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilreddn.png')" }
        doneBtn.onmouseup    = doneBtn.onmouseleave = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilredup.png')" }
        doneBtn.onclick      = () => confirmAndClose()

        doneRow.appendChild(doneLblEl)
        doneRow.appendChild(doneBtn)
        box.appendChild(doneRow)

        // ── Per-type content ─────────────────────────────────────────────────
        if (type === 'name') {
            const nameBoxBg = document.createElement('div')
            Object.assign(nameBoxBg.style, {
                position: 'absolute',
                width: '111px', height: '20px',
                backgroundImage: "url('art/intrface/namebox.png')",
                backgroundRepeat: 'no-repeat', backgroundSize: '111px 20px',
                pointerEvents: 'none', zIndex: '1',
            })
            contentEl.style.position = 'relative'
            contentEl.appendChild(nameBoxBg)

            const inp = document.createElement('input')
            Object.assign(inp, { type: 'text', maxLength: 11, value: playerName })
            Object.assign(inp.style, {
                position: 'relative', zIndex: '2',
                fontSize: '0.9em', color: '#FFD700',
                background: 'transparent', border: 'none',
                borderBottom: '1px solid #806814',
                fontFamily: 'monospace', outline: 'none',
                width: '110px', textAlign: 'center',
            })
            inp.addEventListener('keydown', (e) => {
                e.stopPropagation()
                if (e.key === 'Enter') confirmAndClose()
                if (e.key === 'Escape') closePopup()
            })
            inp.addEventListener('keyup',    (e) => e.stopPropagation())
            inp.addEventListener('keypress', (e) => e.stopPropagation())

            applyFn = () => { playerName = inp.value.trim() || playerName }
            contentEl.appendChild(inp)
            setTimeout(() => inp.focus(), 0)

        } else if (type === 'age') {
            let popupAge = playerAge
            const bignumEl = document.createElement('div')

            const refreshBignum = () => {
                while (bignumEl.firstChild) bignumEl.removeChild(bignumEl.firstChild)
                bignumEl.appendChild(renderBignum(popupAge, 2))
            }
            refreshBignum()

            const makeArrow = (upSrc: string, dnSrc: string, delta: number) => {
                const btn = document.createElement('div')
                Object.assign(btn.style, {
                    width: '20px', height: '18px',
                    backgroundImage: `url('art/intrface/${upSrc}')`,
                    backgroundRepeat: 'no-repeat', backgroundSize: '20px 18px',
                    cursor: 'pointer',
                    position: 'relative', zIndex: '3',
                })
                btn.onmousedown = () => { btn.style.backgroundImage = `url('art/intrface/${dnSrc}')` }
                btn.onmouseup = btn.onmouseleave = () => { btn.style.backgroundImage = `url('art/intrface/${upSrc}')` }
                btn.onclick = () => {
                    const next = popupAge + delta
                    if (next >= 16 && next <= 35) { popupAge = next; refreshBignum() }
                }
                return btn
            }

            Object.assign(bignumEl.style, { position: 'relative', zIndex: '3' })

            const ageBoxBg = document.createElement('div')
            Object.assign(ageBoxBg.style, {
                backgroundImage: "url('art/intrface/agebox.png')",
                backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
                pointerEvents: 'none', zIndex: '1',
                position: 'absolute',
                width: '124px', height: '29px',
            })
            contentEl.style.position = 'relative'
            contentEl.style.gap = '17px'
            contentEl.appendChild(ageBoxBg)

            applyFn = () => { playerAge = popupAge }
            contentEl.appendChild(makeArrow('slu.png', 'sld.png', -1))
            contentEl.appendChild(bignumEl)
            contentEl.appendChild(makeArrow('sru.png', 'srd.png', +1))

        } else { // sex
            const malEl = document.createElement('div')
            const femEl = document.createElement('div')

            const refreshSexBtns = () => {
                malEl.style.backgroundImage = `url('art/intrface/male${playerSex === 'Male' ? 'on' : 'off'}.png')`
                femEl.style.backgroundImage = `url('art/intrface/fem${playerSex === 'Female' ? 'on' : 'off'}.png')`
            }

            Object.assign(malEl.style, {
                width: '45px', height: '43px',
                backgroundImage: `url('art/intrface/male${playerSex === 'Male' ? 'on' : 'off'}.png')`,
                backgroundRepeat: 'no-repeat', cursor: 'pointer',
            })
            malEl.onclick = () => { playerSex = 'Male'; updateSexDisplay(); refreshSexBtns() }

            Object.assign(femEl.style, {
                width: '45px', height: '43px',
                backgroundImage: `url('art/intrface/fem${playerSex === 'Female' ? 'on' : 'off'}.png')`,
                backgroundRepeat: 'no-repeat', cursor: 'pointer',
            })
            femEl.onclick = () => { playerSex = 'Female'; updateSexDisplay(); refreshSexBtns() }

            contentEl.appendChild(malEl)
            contentEl.appendChild(femEl)
        }

        popupEscHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePopup() }
        document.addEventListener('keydown', popupEscHandler)
        overlay.appendChild(box)
        document.body.appendChild(overlay)
    }

    // ── Name button + font4 label ─────────────────────────────────────────────
    const nameBtn = document.createElement('div')
    Object.assign(nameBtn.style, {
        position: 'absolute', left: '11px', top: '0px',
        width: '145px', height: '35px',
        backgroundImage: "url('art/intrface/nameoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        cursor: 'pointer', zIndex: '1',
    })
    nameBtn.onmousedown  = () => { nameBtn.style.backgroundImage = "url('art/intrface/nameon.png')" }
    nameBtn.onmouseup    = nameBtn.onmouseleave = () => { nameBtn.style.backgroundImage = "url('art/intrface/nameoff.png')" }

    const nameLabelEl = document.createElement('div')
    Object.assign(nameLabelEl.style, {
        position: 'absolute', left: '33px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })

    const updateNameDisplay = () => {
        while (nameLabelEl.firstChild) nameLabelEl.removeChild(nameLabelEl.firstChild)
        nameLabelEl.appendChild(font3.renderText(playerName, '#FFD700'))
    }
    updateNameDisplay()
    nameBtn.onclick = () => openCreatorPopup('name', updateNameDisplay)

    characterWindow.elem.appendChild(nameBtn)
    characterWindow.elem.appendChild(nameLabelEl)

    // ── Age button + font4 label ──────────────────────────────────────────────
    const ageBtn = document.createElement('div')
    Object.assign(ageBtn.style, {
        position: 'absolute', left: '156px', top: '0px',
        width: '81px', height: '35px',
        backgroundImage: "url('art/intrface/ageoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        cursor: 'pointer', zIndex: '1',
    })
    ageBtn.onmousedown  = () => { ageBtn.style.backgroundImage = "url('art/intrface/ageon.png')" }
    ageBtn.onmouseup    = ageBtn.onmouseleave = () => { ageBtn.style.backgroundImage = "url('art/intrface/ageoff.png')" }

    const ageLabelEl = document.createElement('div')
    Object.assign(ageLabelEl.style, {
        position: 'absolute', left: '184px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })

    const updateAgeDisplay = () => {
        while (ageLabelEl.firstChild) ageLabelEl.removeChild(ageLabelEl.firstChild)
        ageLabelEl.appendChild(font3.renderText(String(playerAge), '#FFD700'))
    }
    updateAgeDisplay()
    ageBtn.onclick = () => openCreatorPopup('age', updateAgeDisplay)

    characterWindow.elem.appendChild(ageBtn)
    characterWindow.elem.appendChild(ageLabelEl)

    // ── Sex button + font4 label ──────────────────────────────────────────────
    const sexBtn = document.createElement('div')
    Object.assign(sexBtn.style, {
        position: 'absolute', left: '237px', top: '0px',
        width: '80px', height: '35px',
        backgroundImage: "url('art/intrface/sexoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        cursor: 'pointer', zIndex: '1',
    })
    sexBtn.onmousedown  = () => { sexBtn.style.backgroundImage = "url('art/intrface/sexon.png')" }
    sexBtn.onmouseup    = sexBtn.onmouseleave = () => { sexBtn.style.backgroundImage = "url('art/intrface/sexoff.png')" }

    const sexLabelEl = document.createElement('div')
    Object.assign(sexLabelEl.style, {
        position: 'absolute', left: '248px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })

    const updateSexDisplay = () => {
        while (sexLabelEl.firstChild) sexLabelEl.removeChild(sexLabelEl.firstChild)
        sexLabelEl.appendChild(font3.renderText(playerSex, '#FFD700'))
    }
    updateSexDisplay()
    sexBtn.onclick = () => openCreatorPopup('sex', updateSexDisplay)

    characterWindow.elem.appendChild(sexBtn)
    characterWindow.elem.appendChild(sexLabelEl)

    // ── Trait panel ───────────────────────────────────────────────────────────
    // Two columns × 8 rows. Clicking shows info card; max 2 selectable.
    const traitRowEls: HTMLElement[] = []
    const traitToggleImgs: HTMLImageElement[] = []

    const refreshTraitPanel = () => {
        for (let i = 0; i < TRAITS.length; i++) {
            const selected = selectedTraits.includes(TRAITS[i])
            traitToggleImgs[i].src = selected
                ? 'art/intrface/tgsklon.png'
                : 'art/intrface/tgskloff.png'
            traitRowEls[i].style.color = selected ? '#FFD700' : '#00FF00'
        }
    }

    const leftColEl = document.createElement('div')
    Object.assign(leftColEl.style, {
        position: 'absolute',
        left: '23px',
        top: '352px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        width: '163px',
    })

    const rightColEl = document.createElement('div')
    Object.assign(rightColEl.style, {
        position: 'absolute',
        left: '152px',
        top: '352px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        width: '163px',
    })

    for (let i = 0; i < TRAITS.length; i++) {
        const trait = TRAITS[i]
        const isRight = i >= 8
        const container = isRight ? rightColEl : leftColEl

        const row = document.createElement('div')
        Object.assign(row.style, {
            display: 'flex',
            alignItems: 'center',
            flexDirection: isRight ? 'row-reverse' : 'row',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '0.69em',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
        })

        const toggleImg = document.createElement('img') as HTMLImageElement
        toggleImg.src = 'art/intrface/tgskloff.png'
        Object.assign(toggleImg.style, {
            width: '17px',
            height: '11px',
            flexShrink: '0',
            imageRendering: 'pixelated',
        })

        const label = document.createElement('span')
        label.textContent = trait
        Object.assign(label.style, {
            flex: '1',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: isRight ? 'right' : 'left',
        })

        row.appendChild(toggleImg)
        row.appendChild(label)

        const capturedTrait = trait
        const handleClick = () => {
            if (selectedTraits.includes(capturedTrait)) {
                selectedTraits.splice(selectedTraits.indexOf(capturedTrait), 1)
                skillOpts.traits = selectedTraits
                refreshTraitPanel()
                redrawStatsSkills()
            } else if (selectedTraits.length < 2) {
                selectedTraits.push(capturedTrait)
                skillOpts.traits = selectedTraits
                refreshTraitPanel()
                redrawStatsSkills()
            } else {
                showInfoCard('Traits', 'You may only pick 2 traits.')
                return
            }
            showInfoCard(capturedTrait, TRAIT_DESCRIPTIONS[capturedTrait], TRAIT_IMG[capturedTrait])
        }

        row.onclick = handleClick
        row.onmouseenter = () => {
            showInfoCard(capturedTrait, TRAIT_DESCRIPTIONS[capturedTrait], TRAIT_IMG[capturedTrait])
        }

        container.appendChild(row)
        traitRowEls.push(row)
        traitToggleImgs.push(toggleImg)
    }
    refreshTraitPanel()

    const optionalTraitsLabelEl = document.createElement('div')
    Object.assign(optionalTraitsLabelEl.style, {
        position: 'absolute',
        left: '48px',
        top: '327px',
        pointerEvents: 'none',
    })
    font3.onLoad(() => {
        optionalTraitsLabelEl.appendChild(font3.renderText('Optional Traits', '#FFD700'))
    })
    characterWindow.elem.appendChild(optionalTraitsLabelEl)
    characterWindow.elem.appendChild(leftColEl)
    characterWindow.elem.appendChild(rightColEl)

    // ── Render helpers ────────────────────────────────────────────────────────
    const CONDITION_LABELS = [
        'Poisoned', 'Radiated', 'Eye Damage',
        'Crippled Right Arm', 'Crippled Left Arm',
        'Crippled Right Leg', 'Crippled Left Leg',
    ]

    const renderPanel2 = () => {
        while (panel2El.firstChild) panel2El.removeChild(panel2El.firstChild)

        const computedMaxHP = newStatSet.get('Max HP')
        const hp = document.createElement('div')
        hp.textContent = `Hit Points: ${computedMaxHP} / ${computedMaxHP}`
        panel2El.appendChild(hp)

        for (const label of CONDITION_LABELS) {
            const line = document.createElement('div')
            line.textContent = label
            line.style.opacity = '0.3'  // new character: no conditions
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

    // ── Tag Skills counter ────────────────────────────────────────────────────
    const tagLabelEl = document.createElement('div')
    Object.assign(tagLabelEl.style, {
        position: 'absolute',
        left: '417px',
        top: '233px',
        pointerEvents: 'none',
    })
    font3.onLoad(() => {
        tagLabelEl.appendChild(font3.renderText('Tag Skills', '#FFD700'))
    })
    characterWindow.elem.appendChild(tagLabelEl)

    const tagBignumContainer = document.createElement('div')
    Object.assign(tagBignumContainer.style, {
        position: 'absolute',
        left: '523px',
        top: '228px',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(tagBignumContainer)

    const updateTagBignum = () => {
        while (tagBignumContainer.firstChild) tagBignumContainer.removeChild(tagBignumContainer.firstChild)
        tagBignumContainer.appendChild(renderBignum(3 - newSkillSet.tagged.length, 2))
    }
    updateTagBignum()

    const redrawStatsSkills = () => {
        // Rebuild skill rows
        while (skillRowsEl.firstChild) skillRowsEl.removeChild(skillRowsEl.firstChild)
        for (const skill of SKILLS) {
            const isTagged = newSkillSet.isTagged(skill)
            const val = newSkillSet.get(skill, newStatSet, skillOpts)
            const color = isTagged ? '#FFB000' : 'rgb(0,255,0)'

            const row = document.createElement('div')
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '3px',
                cursor: 'pointer', color,
            })

            const toggleBtn = document.createElement('div')
            Object.assign(toggleBtn.style, {
                width: '17px', height: '11px',
                backgroundImage: `url('art/intrface/${isTagged ? 'tgsklon' : 'tgskloff'}.png')`,
                backgroundRepeat: 'no-repeat', backgroundSize: '17px 11px',
                flexShrink: '0',
            })
            toggleBtn.onmousedown  = () => { toggleBtn.style.backgroundImage = "url('art/intrface/tgsklon.png')" }
            toggleBtn.onmouseup    = () => { toggleBtn.style.backgroundImage = `url('art/intrface/${isTagged ? 'tgsklon' : 'tgskloff'}.png')` }
            toggleBtn.onmouseleave = () => { toggleBtn.style.backgroundImage = `url('art/intrface/${isTagged ? 'tgsklon' : 'tgskloff'}.png')` }

            const capturedSkill = skill
            toggleBtn.onclick = (e) => {
                e.stopPropagation()
                if (newSkillSet.isTagged(capturedSkill)) {
                    newSkillSet.untag(capturedSkill)
                } else {
                    if (newSkillSet.tagged.length >= newSkillSet.getMaxTaggedSkills()) return
                    newSkillSet.tag(capturedSkill)
                }
                redrawStatsSkills()
            }

            const nameSpan = document.createElement('span')
            nameSpan.textContent = skill
            Object.assign(nameSpan.style, {
                flex: '1', textAlign: 'left',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            })

            const pctSpan = document.createElement('span')
            pctSpan.textContent = `${val}%`
            Object.assign(pctSpan.style, { textAlign: 'right', minWidth: '36px' })

            row.appendChild(toggleBtn)
            row.appendChild(nameSpan)
            row.appendChild(pctSpan)

            row.onmouseenter = () => {
                showInfoCard(capturedSkill, SKILL_DESCRIPTIONS[capturedSkill] ?? capturedSkill, SKILL_IMG[capturedSkill])
            }

            skillRowsEl.appendChild(row)
        }

        for (let i = 0; i < STATS.length; i++) {
            const el = statValueWidgets[i]
            while (el.firstChild) el.removeChild(el.firstChild)
            const base = newStatSet.getBase(STATS[i])
            el.appendChild(renderBignum(base, 2))
            statCommentLabels[i].setText(STAT_COMMENTS[Math.max(1, Math.min(10, base))])
        }

        renderPanel2()
        renderPanel3()
        updatePoolLabel()
        updateTagBignum()
    }

    // ── DONE button ───────────────────────────────────────────────────────────
    doneBtn.onClick(() => {
        if (pool > 0) {
            showInfoCard('Character', `You have ${pool} unspent attribute point${pool !== 1 ? 's' : ''}.`)
            return
        }
        if (newSkillSet.tagged.length < 3) {
            const need = 3 - newSkillSet.tagged.length
            showInfoCard('Tag Skills', `Tag ${need} more skill${need !== 1 ? 's' : ''}.`)
            return
        }
        if (!playerName.trim()) {
            showInfoCard('Name', 'Please enter a character name.')
            return
        }

        player.applyCreationStats(newStatSet, newSkillSet, playerName.trim(), playerAge, playerSex, selectedTraits)
        characterWindow.close()
        onDone()
    })

    // ── CANCEL button ─────────────────────────────────────────────────────────
    cancelBtn.onClick(() => {
        characterWindow.close()
        onCancel()
    })

    // ESC also cancels
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && characterWindow.showing) {
            characterWindow.close()
            onCancel()
            e.preventDefault()
        }
    }
    document.addEventListener('keydown', escHandler)
    // Clean up ESC handler when window closes
    const origClose = characterWindow.close.bind(characterWindow)
    characterWindow.close = () => {
        document.removeEventListener('keydown', escHandler)
        origClose()
    }

    // ── Initial render ────────────────────────────────────────────────────────
    redrawStatsSkills()
    showInfoCard(SPECIAL_FULL_NAMES['STR'], SPECIAL_DESCRIPTIONS['STR'], SPECIAL_IMG['STR'])
}
