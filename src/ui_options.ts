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
import { CE_COLOR, font1, font3, font4, FontWidget, FontRenderer, FoText } from './ui_font.js'
import { WindowFrame } from './ui_components.js'
import { makePanelDraggable } from './ui_drag.js'
import { uiSaveLoad } from './ui_saveload.js'
import globalState from './globalState.js'
import { applyBrightness, getVolumeValue, savePreferences } from './ui_options/preferences.js'
import { showConfirm } from './ui_dialog.js'
import { getMessage } from './util.js'

// FO2-CE ref: preferences.cc TargetHighlight enum — 0=off, 1=targeting-only, 2=all-enemies.
type TargetHighlight = 'off' | 'targeting-only' | 'on'

export { SavedPreferences, PREFS_KEY, loadPreferences, savePreferences } from './ui_options/preferences.js'
export { loadFallout2Cfg, parseCfg, applyCfg, parseModList } from './ui_options/fallout2Cfg.js'

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

    // Labels container — appended first so it is BELOW all controls in document stacking order.
    // CE ref: preferences.cc — text is written into the background buffer before interactive
    // widgets (knobs, sliders) are placed on top.
    const labelsContainer = document.createElement('div')
    Object.assign(labelsContainer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    panel.appendChild(labelsContainer)

    /** Place a bitmap text label at CE pixel coordinates.
     *  CE ref: preferences.cc fontDrawText() calls in preferencesWindowInit() / _UpdateThing().
     *  align: 'left' = anchorX is left edge; 'center' = anchorX is horizontal centre;
     *         'right' = anchorX is right edge (CE: anchorX - fontGetStringWidth(str)).
     */
    // `splitFirstWord`: CE preferences.cc:599 _UpdateThing — a primary preference's
    // value label is aligned by its full width, then drawn as the first word and,
    // one line (fontGetLineHeight) lower at the same x, the rest.
    function label(renderer: FontRenderer, text: string, anchorX: number, y: number, align: 'left' | 'center' | 'right' = 'left', splitFirstWord = false): void {
        const space = text.indexOf(' ')
        if (splitFirstWord && space !== -1) {
            renderer.onLoad(() => {
                const w = renderer.measureText(text)
                const x = align === 'right'  ? anchorX - w
                        : align === 'center' ? anchorX - Math.floor(w / 2)
                        : anchorX
                const lineH = renderer.lineHeight || 10
                for (const [part, py] of [[text.slice(0, space), y], [text.slice(space + 1), y + lineH]] as [string, number][]) {
                    const ft = new FoText(renderer, part, '#907824')
                    Object.assign(ft.elem.style, { position: 'absolute', left: x + 'px', top: py + 'px' })
                    labelsContainer.appendChild(ft.elem)
                }
            })
            return
        }
        // FoText uses renderBitmapText internally: pixel-scanned actual glyph heights
        // give correct baseline alignment, unlike renderText (div-per-glyph) where all
        // JSON h values are cell_h so top offsets collapse to 0.
        const ft = new FoText(renderer, text, '#907824')
        // FoText queues its redraw onLoad first; this callback fires after, so ft.width is set.
        renderer.onLoad(() => {
            const w = ft.width
            const x = align === 'right'  ? anchorX - w
                    : align === 'center' ? anchorX - Math.floor(w / 2)
                    : anchorX
            Object.assign(ft.elem.style, { position: 'absolute', left: x + 'px', top: y + 'px' })
            labelsContainer.appendChild(ft.elem)
        })
    }

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

    // ── Primary knobs (prfbknbs.png) ─────────────────────────────────────────
    // CE ref: gPreferenceDescriptions[] — knobX=76 for all, varying knobY.

    // Game Difficulty: knobY=71, CE 0=Easy/1=Normal/2=Hard → Config 75/100/125.
    // FO2-CE ref: preferences.cc game_difficulty — affects skill checks, barter, worldmap encounters.
    const gameDiffFrame = (): number => Config.combat.gameDifficultyModifier === 75 ? 0 : Config.combat.gameDifficultyModifier === 100 ? 1 : 2
    primaryKnob(76, 71, gameDiffFrame, () => {
        const next = (gameDiffFrame() + 1) % 3
        Config.combat.gameDifficultyModifier = next === 0 ? 75 : next === 1 ? 100 : 125
    })

    // Combat Difficulty: knobY=149, CE 0=Easy/1=Normal/2=Hard → Config 75/100/125.
    // FO2-CE ref: preferences.cc combat_difficulty — affects combat damage scaling only.
    const combDiffFrame = (): number => Config.combat.difficultyModifier === 75 ? 0 : Config.combat.difficultyModifier === 100 ? 1 : 2
    primaryKnob(76, 149, combDiffFrame, () => {
        const next = (combDiffFrame() + 1) % 3
        Config.combat.difficultyModifier = next === 0 ? 75 : next === 1 ? 100 : 125
    })

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

    // Combat Looks: knobY=387, 2-way. CE ref: game_mouse.cc:745.
    primaryKnob(76, 387, () => Config.ui.combatLooks ? 1 : 0, () => { Config.ui.combatLooks = !Config.ui.combatLooks })

    // ── Secondary knobs (prflknbs.png) ───────────────────────────────────────
    // CE ref: gPreferenceDescriptions[] — knobX=299 for all, varying knobY.

    // Combat Messages: knobY=74.
    // CE display is inverted (value^1): brief(1)→frame 0 off, verbose(0)→frame 1 on.
    secondaryKnob(299, 74,
        () => Config.ui.combatMessages === 'brief' ? 0 : 1,
        () => { Config.ui.combatMessages = Config.ui.combatMessages === 'brief' ? 'verbose' : 'brief' },
    )

    // Combat Taunts: knobY=141. CE ref: combat_ai.cc:3308 _combatai_msg.
    secondaryKnob(299, 141, () => Config.ui.combatTaunts ? 1 : 0, () => { Config.ui.combatTaunts = !Config.ui.combatTaunts })

    // Language Filter: knobY=207. CE ref: preferences.cc PREF_LANGUAGE_FILTER.
    secondaryKnob(299, 207, () => Config.ui.languageFilter ? 1 : 0, () => { Config.ui.languageFilter = !Config.ui.languageFilter })

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

    // Brightness: knobY=400, CE 1.0–1.18 — applied live (colorSetBrightness).
    rangeSlider(
        400,
        () => Config.ui.brightness,
        v => { Config.ui.brightness = v; applyBrightness() },
        0, 100,
        (v: number) => Math.round((v - 1.0) * (219 / 0.18)) + 384,
        (v: number) => Math.round((v - 1.0) * (100 / 0.18)),
        (n: number) => 1.0 + Math.max(0, Math.min(0.18, n * 0.18 / 100)),
    )

    // Mouse Sensitivity: knobY=451, CE 1.0–2.5 (stored only — the browser owns the pointer).
    rangeSlider(
        451,
        () => Config.ui.mouseSensitivity,
        v => { Config.ui.mouseSensitivity = v },
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
        Config.combat.gameDifficultyModifier = 100
        Config.combat.difficultyModifier = 100
        Config.combat.violenceLevel = 3
        Config.ui.targetHighlight = 'targeting-only'
        Config.ui.combatLooks = false
        Config.ui.combatMessages = 'verbose' // CE combat_messages = 1 (msg 211 Verbose)
        Config.ui.combatTaunts = true
        Config.ui.languageFilter = false
        Config.engine.doAlwaysRun = false
        Config.ui.subtitles = false
        Config.ui.itemHighlight = true
        Config.combat.combatSpeed = 0
        Config.engine.playerSpeedup = false
        Config.ui.textBaseDelay = 3.5
        Config.ui.brightness = 1.0
        Config.ui.mouseSensitivity = 1.0
        // CE: the four volumes back to 22281 of 32767
        for (const v of ['master', 'music', 'sfx', 'speech'] as const) globalState.audioEngine.setVolume(v, Math.round(22281 * 100 / 32767))
        applyBrightness()
        refreshFns.forEach(f => f())
    })

    // DONE — persist and close.
    redButton(148, 450, () => {
        savePreferences()
        closePrefsPanel()
    })

    // CANCEL — CE _RestoreSettings: back to the values the window opened with.
    redButton(263, 450, () => {
        prefsRestore?.()
        closePrefsPanel()
        // rebuilt on the next open so the controls show the restored values
        prefsPanel?.remove()
        prefsPanel = null
    })

    // ── Text labels ───────────────────────────────────────────────────────────
    // All coordinates sourced from preferences.cc fontDrawText() calls.
    // Fonts: CE 101→font1 (9px), CE 103→font3 (16px), CE 104→font4 (22px).
    // Widths used in right/centre formulae measured from art/fonts/font1_aaf.json
    //   via fontCore.ts measureText() logic (glyph.w + 1px GLYPH_GAP, minus 1 at end).

    // Title: fontSetCurrent(104)→font4; CE buffer offset y=10, x=74. Msg #100.
    label(font4, 'GAME PREFERENCES', 74, 10)

    // Primary section names: fontSetCurrent(103)→font3; centred at x=99; row1Ytab[].
    // CE ref: preferences.cc lines 1023-1028. Msg IDs 101-105.
    label(font3, 'GAME DIFFICULTY',   99, 48,  'center')
    label(font3, 'COMBAT DIFFICULTY', 99, 125, 'center')
    label(font3, 'VIOLENCE LEVEL',    99, 203, 'center')
    label(font3, 'TARGET HIGHLIGHT',  99, 286, 'center')
    label(font3, 'COMBAT LOOKS',      99, 363, 'center')

    // Secondary section names: fontSetCurrent(103)→font3; left at x=206; row2Ytab[].
    // CE ref: preferences.cc lines 1030-1033. Msg IDs 106-111.
    label(font3, 'COMBAT MESSAGES', 206, 49)
    label(font3, 'COMBAT TAUNTS',   206, 116)
    label(font3, 'LANGUAGE FILTER', 206, 181)
    label(font3, 'RUNNING',         206, 247)
    label(font3, 'SUBTITLES',       206, 313)
    label(font3, 'ITEM HIGHLIGHT',  206, 380)

    // Range section names: fontSetCurrent(103)→font3; left at x=384; row3Ytab[].
    // CE ref: preferences.cc lines 1035-1038. Msg IDs 112-119.
    label(font3, 'COMBAT SPEED',         384, 19)
    label(font3, 'TEXT DELAY',           384, 94)
    label(font3, 'MASTER AUDIO VOLUME',  384, 165)
    label(font3, 'MUSIC/MOVIE VOLUME',   384, 216)
    label(font3, 'SOUND EFFECTS VOLUME', 384, 268)
    label(font3, 'SPEECH VOLUME',        384, 319)
    label(font3, 'BRIGHTNESS LEVEL',     384, 369)
    label(font3, 'MOUSE SENSITIVITY',    384, 420)

    // Button labels: active font after _UpdateThing loop is 101→font1.
    // CE ref: preferences.cc lines 1040-1050. Msg #120 DEFAULT, #4 DONE, #121 CANCEL.
    // Buttons (lilredup) at y=450; text at y=449 (1 px above button top).
    // Text is to the RIGHT of its red-dot button (decorative bullet + label layout).
    label(font1, 'DEFAULT', 43,  449)
    label(font1, 'DONE',    169, 449)
    label(font1, 'CANCEL',  283, 449)

    // "Affect player speed": fontSetCurrent(101)→font1; CE buffer offset y=72, x=405. Msg #122.
    label(font1, 'Affect player speed', 405, 72)

    // ── Primary knob value labels (font 101 → font1) ─────────────────────────
    // CE ref: _UpdateThing() for PRIMARY prefs.
    // x = knobX + word_48FBF6[i] {2,25,46,46} ± fontWidth adjustments.
    // y = knobY + word_48FBFE[i] {10,-4,10,31}.
    // Alignment per index: 0=right-at-(knobX+2), 1=centre-at-(knobX+25), 2/3=left-at-(knobX+46).

    // Game Difficulty (knobX=76, knobY=71). Msg: 203=Easy, 204=Normal, 205=Hard.
    label(font1, 'Easy',   78,  81, 'right')
    label(font1, 'Normal', 101, 67, 'center')
    label(font1, 'Hard',   122, 81)

    // Combat Difficulty (knobX=76, knobY=149). Msg: 206=Wimpy, 204=Normal, 208=Rough.
    label(font1, 'Wimpy',  78,  159, 'right')
    label(font1, 'Normal', 101, 145, 'center')
    label(font1, 'Rough',  122, 159)

    // Violence Level (knobX=76, knobY=226). Msg: 214=None, 215=Minimal, 204=Normal, 216=Maximum Blood.
    label(font1, 'None',          78,  236, 'right')
    label(font1, 'Minimal',       101, 222, 'center')
    label(font1, 'Normal',        122, 236)
    label(font1, 'Maximum Blood', 122, 257, 'left', true)

    // Target Highlight (knobX=76, knobY=309). Msg: 202=Off, 201=On, 213=Targeting Only.
    label(font1, 'Off',           78,  319, 'right')
    label(font1, 'On',            101, 305, 'center')
    label(font1, 'Targeting Only',122, 319, 'left', true)

    // Combat Looks (knobX=76, knobY=387, valuesCount=2). Msg: 202=Off, 201=On.
    label(font1, 'Off', 78,  397, 'right')
    label(font1, 'On',  101, 383, 'center')

    // ── Secondary knob value labels (font 101 → font1) ───────────────────────
    // CE ref: _UpdateThing() for SECONDARY prefs.
    // Label 0: right-aligned at knobX+4=303. Label 1: left at knobX+21=320.
    // y = knobY - 5 for all. knobX=299 for every secondary pref.

    // Combat Messages (knobY=74). Msg: 211=Verbose, 212=Brief.
    label(font1, 'Verbose', 303, 69, 'right')
    label(font1, 'Brief',   320, 69)

    // Combat Taunts (knobY=141). Msg: 202=Off, 201=On.
    label(font1, 'Off', 303, 136, 'right')
    label(font1, 'On',  320, 136)

    // Language Filter (knobY=207). Msg: 202=Off, 201=On.
    label(font1, 'Off', 303, 202, 'right')
    label(font1, 'On',  320, 202)

    // Running (knobY=271). Msg: 209=Normal, 219=Always.
    label(font1, 'Normal', 303, 266, 'right')
    label(font1, 'Always', 320, 266)

    // Subtitles (knobY=338). Msg: 202=Off, 201=On.
    label(font1, 'Off', 303, 333, 'right')
    label(font1, 'On',  320, 333)

    // Item Highlight (knobY=404). Msg: 202=Off, 201=On.
    label(font1, 'Off', 303, 399, 'right')
    label(font1, 'On',  320, 399)

    // ── Range slider value labels (font 101 → font1) ─────────────────────────
    // CE ref: _UpdateThing() for RANGE prefs. Labels at y = knobY - 12.
    // Positions per CE formulae (see preferences.cc _UpdateThing switch):
    //   v0: x=384 (exact).
    //   v1 (2-way): x = 624 − width.
    //   v1 (3-way): x = 504 − ⌊width/2⌋ − 2.
    //   v1 (4-way): x = 444 + ⌊width/2⌋ − 8.
    //   v2 (3-way): x = 624 − width.
    //   v2 (4-way): x = 564 − width − 4.
    //   v3 (4-way): x = 624 − width.
    // All widths measured from font1_aaf.json using fontCore measureText logic.

    // Combat Speed (knobY=50, 2-way). Msg: 207=Normal(38), 210=Fastest(48).
    label(font1, 'Normal',  384, 38)
    label(font1, 'Fastest', 576, 38)  // 624-48

    // Text Delay (knobY=125, 3-way). Msg: 217=Slow(25), 209=Normal(38), 218=Faster(40).
    label(font1, 'Slow',   384, 113)
    label(font1, 'Normal', 483, 113)  // 504-19-2  (⌊38/2⌋=19)
    label(font1, 'Faster', 584, 113)  // 624-40

    // Master Audio Volume (knobY=196, 4-way). Msg: 202=Off(19), 221=Quiet(31), 209=Normal(38), 222=Loud(27).
    label(font1, 'Off',    384, 184)
    label(font1, 'Quiet',  451, 184)  // 444+15-8  (⌊31/2⌋=15)
    label(font1, 'Normal', 522, 184)  // 564-38-4
    label(font1, 'Loud',   597, 184)  // 624-27

    // Music/Movie Volume (knobY=247, 4-way). Same labels.
    label(font1, 'Off',    384, 235)
    label(font1, 'Quiet',  451, 235)
    label(font1, 'Normal', 522, 235)
    label(font1, 'Loud',   597, 235)

    // Sound Effects Volume (knobY=298, 4-way). Same labels.
    label(font1, 'Off',    384, 286)
    label(font1, 'Quiet',  451, 286)
    label(font1, 'Normal', 522, 286)
    label(font1, 'Loud',   597, 286)

    // Speech Volume (knobY=349, 4-way). Same labels.
    label(font1, 'Off',    384, 337)
    label(font1, 'Quiet',  451, 337)
    label(font1, 'Normal', 522, 337)
    label(font1, 'Loud',   597, 337)

    // Brightness Level (knobY=400, 2-way). Msg: 207=Normal(38), 223=Brighter(50).
    label(font1, 'Normal',   384, 388)
    label(font1, 'Brighter', 574, 388)  // 624-50

    // Mouse Sensitivity (knobY=451, 2-way). Msg: 207=Normal(38), 218=Faster(40).
    label(font1, 'Normal', 384, 439)
    label(font1, 'Faster', 584, 439)  // 624-40

    return panel
}

// CE preferences.cc _SavePrefs / _RestoreSettings: the preferences as they were when the
// window opened, put back by CANCEL.
let prefsRestore: (() => void) | null = null
function snapshotPrefs(): () => void {
    const combat = {
        gameDifficultyModifier: Config.combat.gameDifficultyModifier, difficultyModifier: Config.combat.difficultyModifier,
        violenceLevel: Config.combat.violenceLevel, combatSpeed: Config.combat.combatSpeed,
    }
    const ui = {
        targetHighlight: Config.ui.targetHighlight, combatLooks: Config.ui.combatLooks, combatMessages: Config.ui.combatMessages,
        combatTaunts: Config.ui.combatTaunts, languageFilter: Config.ui.languageFilter, subtitles: Config.ui.subtitles,
        itemHighlight: Config.ui.itemHighlight, textBaseDelay: Config.ui.textBaseDelay, brightness: Config.ui.brightness,
        mouseSensitivity: Config.ui.mouseSensitivity,
    }
    const engine = { doAlwaysRun: Config.engine.doAlwaysRun, playerSpeedup: Config.engine.playerSpeedup }
    const volumes = (['master', 'music', 'sfx', 'speech'] as const).map((v) => [v, getVolumeValue(v)] as const)
    return () => {
        Object.assign(Config.combat, combat)
        Object.assign(Config.ui, ui)
        Object.assign(Config.engine, engine)
        for (const [v, value] of volumes) globalState.audioEngine.setVolume(v, value)
        applyBrightness()
    }
}

function openPrefsPanel(): void {
    prefsRestore = snapshotPrefs()
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
// CE ref: options.cc optionsWindowInit / showOptions.
//   - opbase.frm (164x217) unscaled, centred, 60 px above the screen centre; no title text
//   - 5 buttons (opbtnoff/opbtnon, 137x34) at x=13, y=17 + i*(34+3)
//   - labels: options.msg 0-4 in font 103, centred (textX = (137 - width) / 2,
//     textY = (34 - lineHeight) / 2 + 1), _colorTable[18979] up / [14723] pressed
//   - keys: Esc/Return/O/D close, S save, L load, P preferences, +/= and -/_ brightness,
//     E / Ctrl-Q / Ctrl-X / F10 the quit confirmation (game.cc showQuitConfirmationDialog)
const OPTIONS_BG_W = 164
const OPTIONS_BG_H = 217
const OPTIONS_BTN_W = 137
const OPTIONS_BTN_H = 34
// CE preferences.cc brightnessIncrease / brightnessDecrease
const BRIGHTNESS_MAX = 1.17999267578125
const BRIGHTNESS_STEP = 0.01124954223632812

export function changeBrightness(dir: 1 | -1): void {
    const b = Config.ui.brightness + dir * BRIGHTNESS_STEP
    Config.ui.brightness = Math.max(1.0, Math.min(BRIGHTNESS_MAX, b))
    applyBrightness()
    savePreferences()
}

// game.cc showQuitConfirmationDialog — misc.msg 0 "Are you sure you want to quit?";
// yes leaves to the main menu (DH2: reload the page).
export async function quitConfirmation(): Promise<void> {
    const text = getMessage('misc', 0) ?? 'Are you sure you want to quit?'
    if (await showConfirm(text)) {
        optionsWindow?.close()
        window.location.reload()
    }
}

export function initOptionsMenu(): void {
    optionsWindow = new WindowFrame(
        'art/intrface/opbase',
        {
            x: Math.trunc((Config.ui.screenWidth - OPTIONS_BG_W) / 2),
            y: Math.trunc((Config.ui.screenHeight - OPTIONS_BG_H) / 2) - 60,
        },
        OPTIONS_BG_W,
        OPTIONS_BG_H
    )

    const handlers: (() => void)[] = [
        () => { optionsWindow.close(); uiSaveLoad(true) },   // 500 SAVE GAME
        () => { optionsWindow.close(); uiSaveLoad(false) },  // 501 LOAD GAME
        () => { openPrefsPanel() },                           // 502 PREFERENCES
        () => { void quitConfirmation() },                    // 503 EXIT GAME
        () => { optionsWindow.close() },                      // 504 DONE
    ]
    const fallback = ['SAVE GAME', 'LOAD GAME', 'PREFERENCES', 'EXIT GAME', 'DONE']
    new Image().src = 'art/intrface/opbtnon.png' // preload the pressed state (no blank first press)

    handlers.forEach((handler, i) => {
        const btnWidget = new Widget('art/intrface/opbtnoff.png', { x: 13, y: 17 + i * (OPTIONS_BTN_H + 3), w: OPTIONS_BTN_W, h: OPTIONS_BTN_H })
            .mouseDownBG('art/intrface/opbtnon.png')
            .css({ cursor: 'pointer' })
            .onClick(handler)
        optionsWindow.add(btnWidget)

        const text = getMessage('options', i) ?? fallback[i]
        const label = new FoText(font3, text, CE_COLOR.label)
        font3.onLoad(() => {
            const x = Math.max(0, Math.trunc((OPTIONS_BTN_W - font3.measureText(text)) / 2))
            const y = Math.trunc((OPTIONS_BTN_H - font3.lineHeight) / 2) + 1
            Object.assign(label.elem.style, { position: 'absolute', left: x + 'px', top: y + 'px', pointerEvents: 'none' })
            btnWidget.elem.appendChild(label.elem)
        })
        btnWidget.elem.addEventListener('mousedown', () => { label.color = CE_COLOR.labelPressed })
        for (const ev of ['mouseup', 'mouseleave']) {
            btnWidget.elem.addEventListener(ev, () => { label.color = CE_COLOR.label })
        }
    })

    Object.assign(optionsWindow.elem.style, {
        backgroundImage: `url('${optionsWindow.background}.png')`,
        backgroundRepeat: 'no-repeat',
        zIndex: '20',
        cursor: 'default',
    })

    makePanelDraggable(optionsWindow.elem, 'options')

    const optionsKeyHandler = (e: KeyboardEvent) => {
        if (!optionsWindow.showing) return
        const k = e.key
        if (k === 'Escape' || k === 'Enter' || /^[oOdD]$/.test(k)) {
            globalState.audioEngine?.playSfxByName?.('ib1p1xx1')
            optionsWindow.close()
        } else if (/^[sS]$/.test(k)) {
            handlers[0]()
        } else if (/^[lL]$/.test(k)) {
            handlers[1]()
        } else if (/^[pP]$/.test(k)) {
            globalState.audioEngine?.playSfxByName?.('ib1p1xx1')
            openPrefsPanel()
        } else if (k === '+' || k === '=') {
            changeBrightness(1)
        } else if (k === '-' || k === '_') {
            changeBrightness(-1)
        } else if (/^[eE]$/.test(k) || k === 'F10' || (e.ctrlKey && /^[qQxX]$/.test(k))) {
            void quitConfirmation()
        } else {
            return
        }
        e.preventDefault()
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
