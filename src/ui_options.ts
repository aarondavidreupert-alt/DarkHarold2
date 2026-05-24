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

import { Config } from './config.js'
import { Widget } from './ui_widget.js'
import { font3, FontWidget } from './ui_font.js'
import { WindowFrame } from './ui_components.js'
import { makePanelDraggable } from './ui_drag.js'
import { uiSaveLoad } from './ui_saveload.js'
import globalState from './globalState.js'

let optionsWindow: WindowFrame

export function getOptionsWindow(): WindowFrame | null {
    return optionsWindow ?? null
}

// ---------------------------------------------------------------------------
// Preferences persistence — FO2-CE ref: preferences.cc preferencesSave/Load
// ---------------------------------------------------------------------------

interface SavedPreferences {
    difficultyModifier?: 75 | 100 | 125
    combatSpeed?: 1 | 2 | 4
    violenceLevel?: 0 | 1 | 2 | 3
    targetHighlight?: boolean
    combatMessages?: 'brief' | 'verbose'
    doAlwaysRun?: boolean
    subtitles?: boolean
    masterVolume?: number
    musicVolume?: number
    sfxVolume?: number
}

const PREFS_KEY = 'dh2_preferences'

/** Read persisted preferences from localStorage and apply them to Config + audioEngine. */
export function loadPreferences(): void {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return
    let prefs: SavedPreferences
    try {
        prefs = JSON.parse(raw) as SavedPreferences
    } catch {
        return
    }

    if (prefs.difficultyModifier !== undefined) Config.combat.difficultyModifier = prefs.difficultyModifier
    if (prefs.combatSpeed !== undefined) Config.combat.combatSpeed = prefs.combatSpeed
    if (prefs.violenceLevel !== undefined) Config.combat.violenceLevel = prefs.violenceLevel
    if (prefs.targetHighlight !== undefined) Config.ui.targetHighlight = prefs.targetHighlight
    if (prefs.combatMessages !== undefined) Config.ui.combatMessages = prefs.combatMessages
    if (prefs.doAlwaysRun !== undefined) Config.engine.doAlwaysRun = prefs.doAlwaysRun
    if (prefs.subtitles !== undefined) Config.ui.subtitles = prefs.subtitles

    // Audio volumes — applied after audioEngine may be set
    if (globalState.audioEngine) {
        if (prefs.masterVolume !== undefined) globalState.audioEngine.setVolume('master', prefs.masterVolume)
        if (prefs.musicVolume !== undefined) globalState.audioEngine.setVolume('music', prefs.musicVolume)
        if (prefs.sfxVolume !== undefined) globalState.audioEngine.setVolume('sfx', prefs.sfxVolume)
    }
}

// ---------------------------------------------------------------------------
// Preferences panel — FO2-CE ref: preferences.cc
// ---------------------------------------------------------------------------

let prefsPanel: HTMLElement | null = null

/** Returns the raw 0–100 volume value for the given channel. */
function getVolumeValue(channel: 'master' | 'music' | 'sfx'): number {
    const eng = globalState.audioEngine
    if (!eng || !('masterVolume' in eng)) return 100
    const he = (eng as unknown) as { masterVolume: number; musicVolume: number; sfxVolume: number }
    if (channel === 'master') return Math.round(he.masterVolume * 100)
    if (channel === 'music') return Math.round(he.musicVolume * 100)
    return Math.round(he.sfxVolume * 100)
}

/** Build and attach the preferences panel. Called once; subsequent opens just toggle display. */
function buildPrefsPanel(): HTMLElement {
    const panel = document.createElement('div')
    Object.assign(panel.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: '#1a1a0e',
        border: '2px solid #8B7355',
        padding: '16px 20px',
        zIndex: '30',
        color: '#FFD700',
        fontFamily: 'monospace',
        fontSize: '13px',
        minWidth: '360px',
    })

    // Title
    const title = document.createElement('div')
    Object.assign(title.style, {
        textAlign: 'center',
        fontSize: '15px',
        fontWeight: 'bold',
        marginBottom: '12px',
        letterSpacing: '2px',
    })
    title.textContent = 'PREFERENCES'
    panel.appendChild(title)

    // Grid container
    const grid = document.createElement('div')
    Object.assign(grid.style, {
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        rowGap: '8px',
        columnGap: '8px',
        alignItems: 'center',
    })
    panel.appendChild(grid)

    // Helper: styled label cell
    function addLabel(text: string): void {
        const lbl = document.createElement('div')
        lbl.textContent = text
        lbl.style.color = '#C8B466'
        grid.appendChild(lbl)
    }

    // Helper: cycling button
    function addCycleButton<T>(values: T[], labels: string[], getter: () => T, setter: (v: T) => void): HTMLButtonElement {
        const btn = document.createElement('button')
        Object.assign(btn.style, {
            background: '#111107',
            color: '#FFD700',
            border: '1px solid #8B7355',
            padding: '3px 10px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '12px',
            textAlign: 'left',
        })
        const refresh = (): void => {
            const idx = values.indexOf(getter())
            btn.textContent = idx >= 0 ? labels[idx] : labels[0]
        }
        refresh()
        btn.onclick = (): void => {
            const cur = getter()
            const idx = values.indexOf(cur)
            const next = values[(idx + 1) % values.length]
            setter(next)
            refresh()
        }
        grid.appendChild(btn)
        return btn
    }

    // Helper: range slider
    function addSlider(getter: () => number, setter: (v: number) => void): HTMLInputElement {
        const wrap = document.createElement('div')
        Object.assign(wrap.style, { display: 'flex', alignItems: 'center', gap: '6px' })

        const slider = document.createElement('input')
        slider.type = 'range'
        slider.min = '0'
        slider.max = '100'
        slider.value = String(getter())
        Object.assign(slider.style, { flex: '1' })

        const numLbl = document.createElement('span')
        numLbl.style.minWidth = '28px'
        numLbl.textContent = String(getter())

        slider.oninput = (): void => {
            const v = Number(slider.value)
            numLbl.textContent = String(v)
            setter(v)
        }

        wrap.appendChild(slider)
        wrap.appendChild(numLbl)
        grid.appendChild(wrap)
        return slider
    }

    // ── 1. Game Difficulty ────────────────────────────────────────────────
    addLabel('Game Difficulty')
    addCycleButton<75 | 100 | 125>(
        [75, 100, 125],
        ['Easy', 'Normal', 'Hard'],
        () => Config.combat.difficultyModifier,
        v => { Config.combat.difficultyModifier = v }
    )

    // ── 2. Combat Speed ───────────────────────────────────────────────────
    addLabel('Combat Speed')
    addCycleButton<1 | 2 | 4>(
        [1, 2, 4],
        ['Slow', 'Normal', 'Fast'],
        () => Config.combat.combatSpeed,
        v => { Config.combat.combatSpeed = v }
    )

    // ── 3. Violence Level ─────────────────────────────────────────────────
    addLabel('Violence Level')
    addCycleButton<0 | 1 | 2 | 3>(
        [0, 1, 2, 3],
        ['None', 'Minimum', 'Normal', 'Maximum'],
        () => Config.combat.violenceLevel,
        v => { Config.combat.violenceLevel = v }
    )

    // ── 4. Target Highlight ───────────────────────────────────────────────
    addLabel('Target Highlight')
    addCycleButton<boolean>(
        [false, true],
        ['Off', 'On'],
        () => Config.ui.targetHighlight,
        v => { Config.ui.targetHighlight = v }
    )

    // ── 5. Combat Messages ────────────────────────────────────────────────
    addLabel('Combat Messages')
    addCycleButton<'brief' | 'verbose'>(
        ['brief', 'verbose'],
        ['Brief', 'Verbose'],
        () => Config.ui.combatMessages,
        v => { Config.ui.combatMessages = v }
    )

    // ── 6. Running ────────────────────────────────────────────────────────
    addLabel('Running')
    addCycleButton<boolean>(
        [true, false],
        ['On', 'Off'],
        () => Config.engine.doAlwaysRun,
        v => { Config.engine.doAlwaysRun = v }
    )

    // ── 7. Subtitles ──────────────────────────────────────────────────────
    addLabel('Subtitles')
    addCycleButton<boolean>(
        [false, true],
        ['Off', 'On'],
        () => Config.ui.subtitles,
        v => { Config.ui.subtitles = v }
    )

    // ── 8. Master Volume ──────────────────────────────────────────────────
    addLabel('Master Volume')
    addSlider(
        () => getVolumeValue('master'),
        v => globalState.audioEngine.setVolume('master', v)
    )

    // ── 9. Music Volume ───────────────────────────────────────────────────
    addLabel('Music Volume')
    addSlider(
        () => getVolumeValue('music'),
        v => globalState.audioEngine.setVolume('music', v)
    )

    // ── 10. SFX Volume ────────────────────────────────────────────────────
    addLabel('SFX Volume')
    addSlider(
        () => getVolumeValue('sfx'),
        v => globalState.audioEngine.setVolume('sfx', v)
    )

    // ── Done button ───────────────────────────────────────────────────────
    const doneRow = document.createElement('div')
    Object.assign(doneRow.style, { textAlign: 'center', marginTop: '14px' })

    const doneBtn = document.createElement('button')
    doneBtn.textContent = 'DONE'
    Object.assign(doneBtn.style, {
        background: '#111107',
        color: '#FFD700',
        border: '1px solid #8B7355',
        padding: '4px 24px',
        cursor: 'pointer',
        fontFamily: 'monospace',
        fontSize: '13px',
        letterSpacing: '1px',
    })

    doneBtn.onclick = (): void => {
        savePreferences()
        closePrefsPanel()
    }

    doneRow.appendChild(doneBtn)
    panel.appendChild(doneRow)

    return panel
}

function savePreferences(): void {
    const eng = globalState.audioEngine
    const hasVol = eng && 'masterVolume' in eng
    const he = hasVol ? ((eng as unknown) as { masterVolume: number; musicVolume: number; sfxVolume: number }) : null

    const prefs: SavedPreferences = {
        difficultyModifier: Config.combat.difficultyModifier,
        combatSpeed: Config.combat.combatSpeed,
        violenceLevel: Config.combat.violenceLevel,
        targetHighlight: Config.ui.targetHighlight,
        combatMessages: Config.ui.combatMessages,
        doAlwaysRun: Config.engine.doAlwaysRun,
        subtitles: Config.ui.subtitles,
        masterVolume: he ? Math.round(he.masterVolume * 100) : 100,
        musicVolume: he ? Math.round(he.musicVolume * 100) : 100,
        sfxVolume: he ? Math.round(he.sfxVolume * 100) : 100,
    }
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
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
