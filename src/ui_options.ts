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

// FO2-CE ref: options.cc — in-game Options panel (Save / Load / Preferences /
// Quit / Done) plus its keyboard shortcuts.
// FO2-CE ref: preferences.cc — Preferences sub-panel with difficulty, volume, etc.
//
// Preferences persistence (SavedPreferences, PREFS_KEY, loadPreferences,
// savePreferences, getVolumeValue) lives in ui_options/preferences.ts per
// wiki/ts-split-refactor.md §24; re-exported here.

import { Config } from './config.js'
import { Widget } from './ui_widget.js'
import { font3, FontWidget } from './ui_font.js'
import { WindowFrame } from './ui_components.js'
import { makePanelDraggable } from './ui_drag.js'
import { uiSaveLoad } from './ui_saveload.js'
import globalState from './globalState.js'
import { getVolumeValue, savePreferences } from './ui_options/preferences.js'

// FO2-CE ref: preferences.cc TargetHighlight enum — 0=off, 1=targeting-only, 2=all-enemies.
type TargetHighlight = 'off' | 'targeting-only' | 'on'

export { SavedPreferences, PREFS_KEY, loadPreferences } from './ui_options/preferences.js'

let optionsWindow: WindowFrame

export function getOptionsWindow(): WindowFrame | null {
    return optionsWindow ?? null
}

// ---------------------------------------------------------------------------
// Preferences panel — FO2-CE ref: preferences.cc
// ---------------------------------------------------------------------------

let prefsPanel: HTMLElement | null = null

/** Build and attach the preferences panel.
 * CE ref: preferences.cc preferencesWindowInit() — pixel-accurate layout over prefscrn.png.
 * Window: 640×480. All coordinates sourced from gPreferenceDescriptions[] in preferences.cc.
 */
function buildPrefsPanel(): HTMLElement {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '640px',
        height: '480px',
        backgroundImage: "url('art/intrface/prefscrn.png')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '640px 480px',
        zIndex: '30',
        cursor: 'default',
        userSelect: 'none',
    })

    // All refresh callbacks — called by Default button to redraw every control.
    const refreshFns: Array<() => void> = []

    /** Position el absolutely within the panel and append it. */
    function abs(el: HTMLElement, x: number, y: number, w: number, h: number): void {
        Object.assign(el.style, {
            position: 'absolute',
            left: x + 'px',
            top: y + 'px',
            width: w + 'px',
            height: h + 'px',
        })
        panel.appendChild(el)
    }

    /** Primary 4-way knob — prfbknbs.png, 4 frames of 46×47 stacked vertically.
     *  CE ref: preferences.cc PREFERENCES_WINDOW_FRM_PRIMARY_SWITCH, frame = value.
     */
    function primaryKnob(x: number, y: number, getFrame: () => number, cycle: () => void): void {
        const el = document.createElement('div')
        Object.assign(el.style, {
            backgroundImage: "url('art/intrface/prfbknbs.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '46px 188px',
            cursor: 'pointer',
        })
        abs(el, x, y, 46, 47)
        const refresh = (): void => { el.style.backgroundPosition = `0px ${-getFrame() * 47}px` }
        refresh()
        el.addEventListener('click', () => { cycle(); refresh() })
        refreshFns.push(refresh)
    }

    /** Secondary 2-way knob — prflknbs.png, 2 frames of 22×25 stacked vertically.
     *  CE ref: preferences.cc PREFERENCES_WINDOW_FRM_SECONDARY_SWITCH.
     */
    function secondaryKnob(x: number, y: number, getFrame: () => number, toggle: () => void): void {
        const el = document.createElement('div')
        Object.assign(el.style, {
            backgroundImage: "url('art/intrface/prflknbs.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '22px 50px',
            cursor: 'pointer',
        })
        abs(el, x, y, 22, 25)
        const refresh = (): void => { el.style.backgroundPosition = `0px ${-getFrame() * 25}px` }
        refresh()
        el.addEventListener('click', () => { toggle(); refresh() })
        refreshFns.push(refresh)
    }

    /** Range slider — track baked into prefscrn.png at x=384 width=219.
     *  Knob sprite is prfsldof.png (21×12) positioned at computeKnobX(value).
     *  CE ref: preferences.cc _UpdateThing — knob x = (v-min)*219/(max-min)+384 for most.
     *
     *  @param computeKnobX  maps current value → left-edge pixel of knob
     *  @param valToInput    maps value → range <input> integer value
     *  @param inputToVal    maps range <input> integer → value (clamped)
     */
    function rangeSlider(
        knobY: number,
        getValue: () => number,
        setValue: (v: number) => void,
        inputMin: number,
        inputMax: number,
        computeKnobX: (v: number) => number,
        valToInput: (v: number) => number,
        inputToVal: (n: number) => number,
    ): void {
        const knobImg = document.createElement('img') as HTMLImageElement
        knobImg.src = 'art/intrface/prfsldof.png'
        Object.assign(knobImg.style, {
            position: 'absolute',
            top: knobY + 'px',
            width: '21px',
            height: '12px',
            pointerEvents: 'none',
        })
        panel.appendChild(knobImg)

        // Invisible <input type=range> covers track area for interaction.
        // CE ref: preferences.cc button registration x=384, y=knobY-12, w=240, h=23.
        const rangeEl = document.createElement('input')
        rangeEl.type = 'range'
        rangeEl.min = String(inputMin)
        rangeEl.max = String(inputMax)
        Object.assign(rangeEl.style, {
            position: 'absolute',
            left: '384px',
            top: (knobY - 12) + 'px',
            width: '240px',
            height: '24px',
            opacity: '0',
            cursor: 'pointer',
            margin: '0',
        })
        panel.appendChild(rangeEl)

        const refresh = (): void => {
            knobImg.style.left = computeKnobX(getValue()) + 'px'
            rangeEl.value = String(valToInput(getValue()))
        }
        refresh()
        rangeEl.addEventListener('input', () => {
            setValue(inputToVal(Number(rangeEl.value)))
            knobImg.style.left = computeKnobX(getValue()) + 'px'
        })
        refreshFns.push(refresh)
    }

    /** Standard slider where x = (v-min)*219/(max-min)+384. */
    function stdSlider(
        knobY: number, min: number, max: number,
        getValue: () => number, setValue: (v: number) => void,
    ): void {
        rangeSlider(
            knobY, getValue, setValue, min, max,
            (v: number) => Math.round((v - min) * 219 / (max - min)) + 384,
            (v: number) => Math.round(v),
            (n: number) => Math.max(min, Math.min(max, n)),
        )
    }

    /** Checkbox — prfxout.png=off, prfxin.png=on.
     *  CE ref: preferences.cc _plyrspdbid at x=383, y=68 (18×18 px).
     */
    function checkboxBtn(x: number, y: number, getValue: () => boolean, setValue: (v: boolean) => void): void {
        const el = document.createElement('img') as HTMLImageElement
        abs(el as unknown as HTMLElement, x, y, 18, 18)
        el.style.cursor = 'pointer'
        const refresh = (): void => { el.src = getValue() ? 'art/intrface/prfxin.png' : 'art/intrface/prfxout.png' }
        refresh()
        el.addEventListener('click', () => { setValue(!getValue()); refresh() })
        refreshFns.push(refresh)
    }

    /** Little red button — lilredup.png at rest, lilreddn.png pressed (15×16 px).
     *  CE ref: preferences.cc DEFAULT/DONE/CANCEL buttons.
     */
    function redButton(x: number, y: number, onClick: () => void): void {
        const el = document.createElement('div')
        Object.assign(el.style, {
            backgroundImage: "url('art/intrface/lilredup.png')",
            backgroundRepeat: 'no-repeat',
            cursor: 'pointer',
        })
        abs(el, x, y, 15, 16)
        el.addEventListener('mousedown', () => { el.style.backgroundImage = "url('art/intrface/lilreddn.png')" })
        el.addEventListener('mouseup', () => { el.style.backgroundImage = "url('art/intrface/lilredup.png')"; onClick() })
        el.addEventListener('mouseleave', () => { el.style.backgroundImage = "url('art/intrface/lilredup.png')" })
    }

    // ── Local state for prefs not yet in Config ───────────────────────────────
    // These are rendered faithfully but not persisted until Config fields are added.
    let combatDifficulty = 1   // CE COMBAT_DIFFICULTY_NORMAL
    let combatLooks = 0
    let combatTaunts = 1
    let languageFilter = 0
    let brightness = 1.0       // CE range 1.0–1.18 (preferences.cc dbl_50C168)
    let mouseSensitivity = 1.0 // CE range 1.0–2.5

    // ── Primary knobs (prfbknbs.png) ─────────────────────────────────────────
    // CE ref: gPreferenceDescriptions[] — knobX=76 for all, varying knobY.

    // Game Difficulty: knobY=71, CE 0=Easy/1=Normal/2=Hard → Config 75/100/125.
    const diffFrame = (): number => Config.combat.difficultyModifier === 75 ? 0 : Config.combat.difficultyModifier === 100 ? 1 : 2
    primaryKnob(76, 71, diffFrame, () => {
        const next = (diffFrame() + 1) % 3
        Config.combat.difficultyModifier = next === 0 ? 75 : next === 1 ? 100 : 125
    })

    // Combat Difficulty: knobY=149 (local state — no Config field yet).
    primaryKnob(76, 149, () => combatDifficulty, () => { combatDifficulty = (combatDifficulty + 1) % 3 })

    // Violence Level: knobY=226, CE 0=None/1=Min/2=Normal/3=Max.
    primaryKnob(76, 226,
        () => Config.combat.violenceLevel,
        () => { Config.combat.violenceLevel = ((Config.combat.violenceLevel + 1) % 4) as 0 | 1 | 2 | 3 },
    )

    // Target Highlight: knobY=309, CE 0=off/1=targeting-only/2=all-enemies.
    const thOrder: Array<'off' | 'targeting-only' | 'on'> = ['off', 'targeting-only', 'on']
    const thFrame = (): number => {
        const v = Config.ui.targetHighlight as string | boolean
        if (v === false || v === 'off') return 0
        if (v === 'targeting-only') return 1
        return 2
    }
    primaryKnob(76, 309, thFrame, () => { Config.ui.targetHighlight = thOrder[(thFrame() + 1) % 3] })

    // Combat Looks: knobY=387, 2-way (local state).
    primaryKnob(76, 387, () => combatLooks, () => { combatLooks = (combatLooks + 1) % 2 })

    // ── Secondary knobs (prflknbs.png) ───────────────────────────────────────
    // CE ref: gPreferenceDescriptions[] — knobX=299 for all, varying knobY.

    // Combat Messages: knobY=74.
    // CE display is inverted (value^1): brief(1)→frame 0 off, verbose(0)→frame 1 on.
    secondaryKnob(299, 74,
        () => Config.ui.combatMessages === 'brief' ? 0 : 1,
        () => { Config.ui.combatMessages = Config.ui.combatMessages === 'brief' ? 'verbose' : 'brief' },
    )

    // Combat Taunts: knobY=141 (local).
    secondaryKnob(299, 141, () => combatTaunts, () => { combatTaunts = 1 - combatTaunts })

    // Language Filter: knobY=207 (local).
    secondaryKnob(299, 207, () => languageFilter, () => { languageFilter = 1 - languageFilter })

    // Running: knobY=271.
    secondaryKnob(299, 271,
        () => Config.engine.doAlwaysRun ? 1 : 0,
        () => { Config.engine.doAlwaysRun = !Config.engine.doAlwaysRun },
    )

    // Subtitles: knobY=338.
    secondaryKnob(299, 338,
        () => Config.ui.subtitles ? 1 : 0,
        () => { Config.ui.subtitles = !Config.ui.subtitles },
    )

    // Item Highlight: knobY=404.
    secondaryKnob(299, 404,
        () => Config.ui.itemHighlight ? 1 : 0,
        () => { Config.ui.itemHighlight = !Config.ui.itemHighlight },
    )

    // ── Range sliders ─────────────────────────────────────────────────────────
    // CE ref: preferences.cc _UpdateThing — all track at x=384, width=219.

    // Combat Speed: knobY=50, CE 0–50.
    stdSlider(50, 0, 50, () => Config.combat.combatSpeed, v => { Config.combat.combatSpeed = v })

    // Text Base Delay: knobY=125, CE 1.0–6.0.
    // CE formula: x = (6.0 - delay) * 43.8 + 384  (inverted — high delay → knob left).
    // Range input maps input=10 → delay=6.0 (far left), input=60 → delay=1.0 (far right).
    rangeSlider(
        125,
        () => Config.ui.textBaseDelay,
        v => { Config.ui.textBaseDelay = v },
        10, 60,
        (v: number) => Math.round((6.0 - v) * 43.8) + 384,
        (v: number) => Math.round((6.0 - v) * 10 + 10),
        (n: number) => Math.max(1.0, Math.min(6.0, (70 - n) / 10)),
    )

    // Volumes: CE 0–32767, DH2 stored as 0–100 percent.
    stdSlider(196, 0, 100, () => getVolumeValue('master'), v => { globalState.audioEngine.setVolume('master', v) })
    stdSlider(247, 0, 100, () => getVolumeValue('music'),  v => { globalState.audioEngine.setVolume('music',  v) })
    stdSlider(298, 0, 100, () => getVolumeValue('sfx'),    v => { globalState.audioEngine.setVolume('sfx',    v) })
    stdSlider(349, 0, 100, () => getVolumeValue('speech'), v => { globalState.audioEngine.setVolume('speech', v) })

    // Brightness: knobY=400, CE 1.0–1.18 (local state).
    rangeSlider(
        400,
        () => brightness,
        v => { brightness = v },
        0, 100,
        (v: number) => Math.round((v - 1.0) * (219 / 0.18)) + 384,
        (v: number) => Math.round((v - 1.0) * (100 / 0.18)),
        (n: number) => 1.0 + Math.max(0, Math.min(0.18, n * 0.18 / 100)),
    )

    // Mouse Sensitivity: knobY=451, CE 1.0–2.5 (local state).
    rangeSlider(
        451,
        () => mouseSensitivity,
        v => { mouseSensitivity = v },
        0, 150,
        (v: number) => Math.round((v - 1.0) * (219 / 1.5)) + 384,
        (v: number) => Math.round((v - 1.0) * 100),
        (n: number) => 1.0 + Math.max(0, Math.min(1.5, n / 100)),
    )

    // ── Checkbox: Affect Player Speed ─────────────────────────────────────────
    // CE ref: preferences.cc _plyrspdbid at x=383, y=68.
    checkboxBtn(383, 68, () => Config.engine.playerSpeedup, v => { Config.engine.playerSpeedup = v })

    // ── Buttons ───────────────────────────────────────────────────────────────
    // CE ref: preferences.cc preferencesWindowInit() — DEFAULT x=23, DONE x=148, CANCEL x=263, all y=450.

    // DEFAULT — restore CE defaults from preferencesSetDefaults() in preferences.cc.
    redButton(23, 450, () => {
        Config.combat.difficultyModifier = 100
        combatDifficulty = 1
        Config.combat.violenceLevel = 3
        Config.ui.targetHighlight = 'targeting-only'
        combatLooks = 0
        Config.ui.combatMessages = 'brief'
        combatTaunts = 1
        languageFilter = 0
        Config.engine.doAlwaysRun = false
        Config.ui.subtitles = false
        Config.ui.itemHighlight = true
        Config.combat.combatSpeed = 0
        Config.engine.playerSpeedup = false
        Config.ui.textBaseDelay = 3.5
        brightness = 1.0
        mouseSensitivity = 1.0
        refreshFns.forEach(f => f())
    })

    // DONE — persist and close.
    redButton(148, 450, () => {
        savePreferences()
        closePrefsPanel()
    })

    // CANCEL — close without saving (live Config changes during session remain;
    // full CE cancel-restore would need a snapshot taken at panel open).
    redButton(263, 450, () => { closePrefsPanel() })

    return panel
}

function openPrefsPanel(): void {
    if (!prefsPanel) {
        prefsPanel = buildPrefsPanel()
        document.body.appendChild(prefsPanel)
    }
    prefsPanel.style.display = 'block'
}

function closePrefsPanel(): void {
    if (prefsPanel) prefsPanel.style.display = 'none'
}

// ---------------------------------------------------------------------------
// Options menu — FO2-CE ref: options.cc
// ---------------------------------------------------------------------------

// FO2-CE ref: options.cc — in-game options panel with Save/Load/Preferences/Quit/Done
export function initOptionsMenu(): void {
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

    // FO2-CE ref: options.cc — button order matches original FO2: Save, Load, Preferences, Exit to Main, Done
    const optionButtons: [string, () => void][] = [
        ['Save Game',         () => { optionsWindow.close(); uiSaveLoad(true) }],
        ['Load Game',         () => { optionsWindow.close(); uiSaveLoad(false) }],
        ['Preferences',       () => { openPrefsPanel() }],
        ['Exit to Main Menu', () => {
            if (confirm('Return to the main menu?\nUnsaved progress will be lost.')) {
                optionsWindow.close()
                // Reload brings up the main menu (default startup path).
                window.location.reload()
            }
        }],
        ['Done',              () => { optionsWindow.close() }],
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
            case 'p': openPrefsPanel(); e.preventDefault(); break
            case 'x':
                if (confirm('Return to the main menu?\nUnsaved progress will be lost.')) {
                    optionsWindow.close(); window.location.reload()
                }
                e.preventDefault(); break
            case 'd':
            case 'escape': optionsWindow.close(); e.preventDefault(); break
        }
    }
    document.addEventListener('keydown', optionsKeyHandler)
}

/** Open the options panel. No-op if initOptionsMenu() hasn't been called yet. */
export function showOptionsMenu(): void {
    optionsWindow?.show()
}

/** Close the options panel if it's open. */
export function closeOptionsMenu(): void {
    optionsWindow?.close()
}
