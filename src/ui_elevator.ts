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
import { hexesInRadius } from './geometry.js'
import { lookupInterfaceArt } from './pro.js'
import { fromTileNum } from './tile.js'
import { UIMode } from './ui_panels.js'
import { $id, $qa, showv, hidev } from './ui_dom.js'

// CE ref: elevator.cc — gauge sprite gaj000.png: 92×715, 13 rows (frames 0-12).
// Frame 0 = needle at bottom, frame 12 = needle at top.
// CE always spends ~276ms per gauge frame step regardless of elevator size.
const GAUGE_FRAME_H = 55   // 715 / 13
const GAUGE_FRAME_MS = 276 // CE: ~276ms per visible frame step

function gaugeFrameForFloor(floorIdx: number, levels: number): number {
    if (levels <= 1) return 0
    return Math.round(floorIdx * 12.0 / (levels - 1))
}

function setGaugeFrame(frame: number): void {
    const $g = $id('elevatorPositioner')
    $g.style.backgroundPositionY = -(frame * GAUGE_FRAME_H) + 'px'
}

function animateGauge(fromFloor: number, toFloor: number, levels: number, onDone: () => void): void {
    const fromFrame = gaugeFrameForFloor(fromFloor, levels)
    const toFrame   = gaugeFrameForFloor(toFloor,   levels)
    if (fromFrame === toFrame) { onDone(); return }
    const step = fromFrame < toFrame ? 1 : -1
    const totalSteps = Math.abs(toFrame - fromFrame)
    const delay = Math.max(16, Math.round(GAUGE_FRAME_MS))
    let cur = fromFrame
    function tick(): void {
        cur += step
        setGaugeFrame(cur)
        if (cur === toFrame) { setTimeout(onDone, 200); return }
        setTimeout(tick, delay)
    }
    setTimeout(tick, delay)
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

    // Determine current floor index for gauge init
    let currentFloorIdx = 0
    for (let i = 0; i < elevator.buttonCount; i++) {
        const b = elevator.buttons[i]
        if (b.mapID === globalState.gMap.mapID && (Number(b.level) || 0) === globalState.currentElevation) {
            currentFloorIdx = i
            break
        }
    }
    setGaugeFrame(gaugeFrameForFloor(currentFloorIdx, elevator.buttonCount))

    // flip the buttons we need visible
    for (let i = 1; i <= elevator.buttonCount; i++) {
        const $elevatorButton = $id('elevatorButton' + i)
        showv($elevatorButton)
        $elevatorButton.onclick = () => {
            const targetFloorIdx = i - 1
            const mapID    = elevator.buttons[targetFloorIdx].mapID
            const level    = Number(elevator.buttons[targetFloorIdx].level) || 0
            const position = fromTileNum(elevator.buttons[targetFloorIdx].tileNum)

            const proceed = (): void => {
                if (mapID !== globalState.gMap.mapID) {
                    // different map
                    console.log(`[Elevator] → map ${mapID}, level ${level} @ (${position.x}, ${position.y})`)
                    globalState.audioEngine.playSfxByName('selevdx1')
                    globalState.gMap.loadMapByID(mapID, position, level)
                } else if (level !== globalState.currentElevation) {
                    // same map, different elevation
                    // FO2-CE ref: elevator.cc — distance-based travel sound
                    // 1 floor = elv1_1, 2 floors = elv1_2, 3+ floors = elv1_3
                    const dist = Math.abs(level - globalState.currentElevation)
                    const elvSfx = dist === 1 ? 'elv1_1' : dist === 2 ? 'elv1_2' : 'elv1_3'
                    console.log(`[Elevator] → level ${level} @ (${position.x}, ${position.y})`)
                    globalState.audioEngine.playSfxByName(elvSfx)
                    globalState.player.move(position)
                    globalState.gMap.changeElevation(level, true)
                }

                // CE ref: scripts.cc:926 scriptsHandleRequests SCRIPT_REQUEST_ELEVATOR
                // reseats nearby elevator-door scenery to closed-frame on arrival.
                // Door scenery PIDs (CE): 0x99 = 153, 0x1A5 = 421, 0x1D6 = 470.
                const DOOR_PIDS = new Set([153, 421, 470])
                const arrivalHexes = hexesInRadius(position, 5)
                for (const h of arrivalHexes) {
                    for (const obj of globalState.gMap!.objectsAtPosition(h)) {
                        if (obj.type === 'scenery' && DOOR_PIDS.has(obj.pidID as number)) {
                            obj.frame = 0
                            obj.open = false
                        }
                    }
                }

                uiElevatorDone()
            }

            if (targetFloorIdx !== currentFloorIdx) {
                // CE ref: elevator.cc — animate gauge needle before map load
                animateGauge(currentFloorIdx, targetFloorIdx, elevator.buttonCount, proceed)
            } else {
                proceed()
            }
        }
    }
}
