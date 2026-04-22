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

// Elevator panel: floor-button overlay used when the player steps on an
// elevator tile. Picks an art frame for the elevator type, optionally a
// label strip, and wires per-floor buttons that load the corresponding
// map / change elevation.

import globalState from './globalState.js'
import { Elevator } from './data.js'
import { lookupInterfaceArt } from './pro.js'
import { fromTileNum } from './tile.js'
import { UIMode } from './ui_panels.js'

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function $qa(selector: string): HTMLElement[] {
    return Array.from(document.querySelectorAll(selector))
}

function showv($el: HTMLElement): void {
    $el.style.visibility = 'visible'
}

function hidev($el: HTMLElement): void {
    $el.style.visibility = 'hidden'
}

function uiElevatorDone() {
    globalState.uiMode = UIMode.none
    hidev($id('elevatorBox'))

    // flip all buttons to hidden
    for (const $elevatorButton of $qa('.elevatorButton')) {
        hidev($elevatorButton)
        $elevatorButton.onclick = null
    }
    hidev($id('elevatorLabel'))
}

export function uiElevator(elevator: Elevator) {
    globalState.uiMode = UIMode.elevator
    const art = lookupInterfaceArt(elevator.type)
    console.log('[Elevator] art: ' + art)
    console.log('[Elevator] buttons: ' + elevator.buttonCount)

    if (elevator.labels !== -1) {
        const labelArt = lookupInterfaceArt(elevator.labels)
        console.log('[Elevator] label art: ' + labelArt)

        const $elevatorLabel = $id('elevatorLabel')
        showv($elevatorLabel)
        $elevatorLabel.style.backgroundImage = `url('${labelArt}.png')`
    }

    const $elevatorBox = $id('elevatorBox')
    showv($elevatorBox)
    $elevatorBox.style.backgroundImage = `url('${art}.png')`

    // flip the buttons we need visible
    for (let i = 1; i <= elevator.buttonCount; i++) {
        const $elevatorButton = $id('elevatorButton' + i)
        showv($elevatorButton)
        $elevatorButton.onclick = () => {
            // button `i` pushed
            // todo: animate positioner/spinner (and come up with a better name for that)

            const mapID = elevator.buttons[i - 1].mapID
            const level = Number(elevator.buttons[i - 1].level) || 0
            const position = fromTileNum(elevator.buttons[i - 1].tileNum)

            if (mapID !== globalState.gMap.mapID) {
                // different map
                console.log(`[Elevator] → map ${mapID}, level ${level} @ (${position.x}, ${position.y})`)
                globalState.gMap.loadMapByID(mapID, position, level)
            } else if (level !== globalState.currentElevation) {
                // same map, different elevation
                console.log(`[Elevator] → level ${level} @ (${position.x}, ${position.y})`)
                globalState.player.move(position)
                globalState.gMap.changeElevation(level, true)
            }

            // else, same elevation, do nothing
            uiElevatorDone()
        }
    }
}
