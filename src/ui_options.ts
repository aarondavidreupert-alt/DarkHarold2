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

import { Config } from './config.js'
import { Widget } from './ui_widget.js'
import { font3, FontWidget } from './ui_font.js'
import { WindowFrame } from './ui_components.js'
import { makePanelDraggable } from './ui_drag.js'
import { uiSaveLoad } from './ui_saveload.js'

let optionsWindow: WindowFrame

export function getOptionsWindow(): WindowFrame | null {
    return optionsWindow ?? null
}

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
        ['Preferences',       () => { alert('Preferences not yet implemented.') }],
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
            case 'p': alert('Preferences not yet implemented.'); e.preventDefault(); break
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
