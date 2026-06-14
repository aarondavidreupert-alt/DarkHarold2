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

// Save / Load window (FO2-CE ref: loadsave.cc lsgFileList / lsgSelectFileList).

import globalState from './globalState.js'
import { formatSaveDate, load, save, SaveGame, saveList } from './saveload.js'
import { Widget } from './ui_widget.js'
import { WindowFrame, SmallButton, Label, List } from './ui_components.js'
import { UIMode } from './ui_panels.js'
import { showConfirm, showInput } from './ui_dialog.js'

export function uiSaveLoad(isSave: boolean): void {
    globalState.uiMode = UIMode.saveLoad

    const listOfSaves = new List({ x: 55, y: 50, w: 'auto', h: 'auto' })
    const saveInfo = new Label(404, 262, '', '#00FF00')
    // TODO: CSSBoundingBox's width and height should be optional (and default to `auto`), then Label can accept one
    Object.assign(saveInfo.elem.style, {
        width: '154px',
        height: '33px',
        fontSize: '8pt',
        overflow: 'hidden',
    })

    const saveLoadWindow = new WindowFrame('art/intrface/lsgame.png', { x: 80, y: 20 }, 640, 480)
        .add(new Widget('art/intrface/lscover.png', { x: 340, y: 40, w: 275, h: 173 }))
        .add(new Label(50, 26, isSave ? 'Save Game' : 'Load Game'))
        .add(new SmallButton(391, 349).onClick(selected))
        .add(new Label(391 + 18, 349, 'Done'))
        .add(new SmallButton(495, 349).onClick(done))
        .add(new Label(495 + 18, 349, 'Cancel'))
        .add(saveInfo)
        .add(listOfSaves)
        .show()

    if (isSave) {
        listOfSaves.select(
            listOfSaves.addItem({
                text: '<New Slot>',
                id: -1,
                onSelected: () => {
                    saveInfo.setText('New save')
                },
            })
        )
    }

    // List saves, and write them to the UI list
    saveList((saves: SaveGame[]) => {
        for (const save of saves) {
            listOfSaves.addItem({
                text: save.name,
                id: save.id,
                onSelected: () => {
                    // CE ref: loadsave.cc — show the saved thumbnail alongside
                    // the date/map metadata so the player can preview each slot.
                    const thumb = save.screenshot
                        ? `<img src="${save.screenshot}" style="display:block;margin-top:4px;width:160px;height:100px;object-fit:cover;border:1px solid #555;">`
                        : ''
                    saveInfo.setText(formatSaveDate(save) + '<br>' + save.currentMap + thumb)
                },
            })
        }
    })

    function done() {
        globalState.uiMode = UIMode.none
        saveLoadWindow.close()
    }

    async function selected() {
        const item = listOfSaves.getSelection()
        if (!item) return

        const saveID = item.id
        console.log('[UI] %s save #%d.', isSave ? 'Saving' : 'Loading', saveID)

        if (isSave) {
            // CE ref: loadsave.cc — message 131: "Save game already exists, overwrite?"
            if (saveID !== -1) {
                const ok = await showConfirm('Save game already exists.\nOverwrite?')
                if (!ok) return
            }
            const name = await showInput('Save Name?')
            if (name === null) return
            save(name, saveID === -1 ? undefined : saveID, done)
        } else {
            load(saveID)
            done()
        }
    }
}
