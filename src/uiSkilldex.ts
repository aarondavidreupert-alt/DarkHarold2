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

// FO2-CE ref: skilldex.cc — Skilldex panel: 8 usable skills with keyboard
// shortcuts (1–8), skill-value readouts, and targeting cursor handoff.

import { Config } from './config.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Skills, SKILL_NAMES } from './skills.js'
import { skillUse } from './skillUse.js'
import { Widget } from './uiWidget.js'
import { CE_COLOR, font3, FontWidget, FoText, renderBignum } from './uiFont.js'
import { getMessage } from './util.js'
import { WindowFrame, SmallButton } from './uiComponents.js'
import { makePanelDraggable } from './uiDrag.js'
import { UIMode } from './uiMode.js'
import { assetUrl } from './modAssets.js'

let skilldexWindow: WindowFrame
// CE game_mouse.cc action menu USE_SKILL: skilldexOpen, then actionUseSkill on the
// menu's object instead of the targeting cursor.
let onSkillPicked: ((skill: Skills) => void) | null = null

export function getSkilldexWindow(): WindowFrame | null {
    return skilldexWindow ?? null
}

// FO2-CE ref: skilldex.cc — skilldexOpen() / skilldexWindowInit()
// Skilldex window showing 8 usable skills with current values and keyboard shortcuts
export function initSkilldex(): void {
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
            const picked = onSkillPicked
            onSkillPicked = null
            skilldexWindow.close()
            if (picked && !isPassiveSkill(skill)) {
                picked(skill)
                return
            }

            if (isPassiveSkill(skill)) {
                // Passive/self skills: execute immediately, no target selection needed
                const skillName = SKILL_NAMES[skill - 1]
                const player = globalState.player
                if (!player) return
                skillUse(player, player, skillName)
                dbg('skills', `[UI] Passive skill executed: ${skillName}`)
                return
            }

            beginSkillTargeting(skill)
        }
    }

    // CE ref: skilldex.cc skilldexWindowInit — skldxbox (185x368) right-aligned over
    // the 640-wide interface bar, 4 px right / 6 px bottom margin above the bar.
    const BAR_LEFT = (Config.ui.screenWidth - 640) / 2
    skilldexWindow = new WindowFrame(
        'art/intrface/skldxbox',
        {
            x: BAR_LEFT + 640 - 185 - 4,
            y: Config.ui.screenHeight - 99 - 1 - 368 - 6,
        },
        185,
        368,
    )
        // "SKILLDEX" title: skilldex.msg 100, font 103 at (55, 14), _colorTable[18979]
        .add(new FontWidget(55, 14, getMessage('skilldex', 100) ?? 'SKILLDEX', font3, CE_COLOR.label))

    // FO2-CE ref: skilldex.cc SkilldexSkill enum — 8 skills in order
    const skilldexSkills: [string, Skills][] = [
        ['Sneak', Skills.Sneak],
        ['Lockpick', Skills.Lockpick],
        ['Steal', Skills.Steal],
        ['Traps', Skills.Traps],
        ['First Aid', Skills.FirstAid],
        ['Doctor', Skills.Doctor],
        ['Science', Skills.Science],
        ['Repair', Skills.Repair],
    ]

    // CE skilldex.cc skilldexWindowInit: buttons skldxoff (up, buffer index*2) / skldxon
    // (down, index*2+1), 86x33, at x 15, y 45 + 36*i; the
    // name (skilldex.msg 102+i, font 103) centred: x = (86 - w) / 2 + 1,
    // y = (33 - lineHeight) / 2 + 1, colour 18979 up / 14723 down. Values: big
    // numbers at x 110, y 48 + 36*i.
    const BTN_W = 86
    const BTN_H = 33
    new Image().src = assetUrl('art/intrface/skldxon.png') // preload the pressed state
    for (let i = 0; i < skilldexSkills.length; i++) {
        const [name, skill] = skilldexSkills[i]
        const btn = new Widget('art/intrface/skldxoff.png', { x: 15, y: 45 + i * 36, w: BTN_W, h: BTN_H })
            .mouseDownBG('art/intrface/skldxon.png')
            .css({ cursor: 'pointer' })
            .onClick(useSkill(skill))
        skilldexWindow.add(btn)

        const text = getMessage('skilldex', 102 + i) ?? name.toUpperCase()
        const label = new FoText(font3, text, CE_COLOR.label)
        font3.onLoad(() => {
            const x = Math.max(0, Math.trunc((BTN_W - font3.measureText(text)) / 2) + 1)
            const y = Math.trunc((BTN_H - font3.lineHeight) / 2) + 1
            Object.assign(label.elem.style, {
                position: 'absolute',
                left: x + 'px',
                top: y + 'px',
                pointerEvents: 'none',
            })
            btn.elem.appendChild(label.elem)
        })
        btn.elem.addEventListener('mousedown', () => {
            label.color = CE_COLOR.labelPressed
        })
        for (const ev of ['mouseup', 'mouseleave'])
            btn.elem.addEventListener(ev, () => {
                label.color = CE_COLOR.label
            })

        const valWidget = new Widget(null, { x: 110, y: 48 + i * 36, w: 42, h: 28 })
        skillValueElems.push(valWidget.elem)
        skilldexWindow.add(valWidget)
    }

    // CANCEL: skilldex.msg 101 at (72, 337), little red button at (48, 338).
    skilldexWindow.add(
        new SmallButton(48, 338).onClick(() => {
            skilldexWindow.close()
        }),
    )
    skilldexWindow.add(
        new FontWidget(72, 337, getMessage('skilldex', 101) ?? 'CANCEL', font3, CE_COLOR.label).css({
            pointerEvents: 'none',
        }),
    )

    Object.assign(skilldexWindow.elem.style, {
        backgroundImage: `url('${assetUrl(skilldexWindow.background + '.png')}')`,
        backgroundRepeat: 'no-repeat',
        zIndex: '20',
        cursor: 'default',
    })

    // Drag-to-reposition from non-interactive areas of the skilldex frame,
    // matching the PipBoy / automap / inventory / character panels.
    makePanelDraggable(skilldexWindow.elem, 'skilldex')

    // FO2-CE ref: skilldex.cc — update skill values when the skilldex is shown
    const origShow = skilldexWindow.show.bind(skilldexWindow)
    skilldexWindow.show = function () {
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
    // CE skilldexOpen runs its own input loop: the map is frozen and no game key reaches
    // gameHandleKey while the window is open
    skilldexWindow.onShow = () => {
        globalState.uiMode = UIMode.skilldex
    }
    skilldexWindow.onClose = () => {
        if (globalState.uiMode === UIMode.skilldex) globalState.uiMode = UIMode.none
    }
}

// CE game.cc: gameMouseSetCursor(MOUSE_CURSOR_USE_CROSSHAIR) + gameMouseSetMode(
// GAME_MOUSE_MODE_USE_<skill>) — the next click uses the skill on what is under it.
// (Sneak toggles at once: _action_skill_use(SKILL_SNEAK).)
export function beginSkillTargeting(skill: Skills): void {
    if (skill === Skills.Sneak) {
        const player = globalState.player
        if (!player) return
        skillUse(player, player, SKILL_NAMES[skill - 1])
        return
    }
    globalState.uiMode = UIMode.useSkill
    globalState.skillMode = skill
    globalState.cursorMode = 'useSkill'
    // CSS cursor fallback — crosshair visible even if WebGL crossuse asset is missing
    const cnv = document.getElementById('cnv')
    if (cnv) cnv.style.cursor = "url('" + assetUrl('art/intrface/crossuse.png') + "') 11 11, crosshair"
    dbg('skills', `[UI] Skill targeting mode: ${SKILL_NAMES[skill - 1]}`)
}

/** Open the skilldex panel. No-op if initSkilldex() hasn't been called yet. */
export function showSkilldex(onPick: ((skill: Skills) => void) | null = null): void {
    onSkillPicked = onPick
    skilldexWindow?.show()
}

/** Close the skilldex panel if it's open. */
export function closeSkilldex(): void {
    skilldexWindow?.close()
}
