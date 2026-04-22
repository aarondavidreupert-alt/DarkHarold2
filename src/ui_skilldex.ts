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
import { Skills, SKILL_NAMES } from './skills.js'
import { skillUse } from './skillUse.js'
import { Widget } from './ui_widget.js'
import { font3, FontWidget, renderBignum } from './ui_font.js'
import { WindowFrame, SmallButton } from './ui_components.js'
import { makePanelDraggable } from './ui_drag.js'
import { UIMode } from './ui_panels.js'
import { drawHP, uiLog } from './ui_hud.js'

let skilldexWindow: WindowFrame

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

/** Open the skilldex panel. No-op if initSkilldex() hasn't been called yet. */
export function showSkilldex(): void {
    skilldexWindow?.show()
}

/** Close the skilldex panel if it's open. */
export function closeSkilldex(): void {
    skilldexWindow?.close()
}
