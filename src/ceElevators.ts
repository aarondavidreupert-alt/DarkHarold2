/*
Copyright 2026

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

// The elevator tables, as fallout2-ce compiles them in (elevator.cc gElevatorBackgrounds,
// gElevatorLevels, gElevatorDescriptions, gElevatorLevelLabels; the original fallout2.exe
// has them at 0x43E95C-0x43EEFC). Generated from elevator.cc. DH2 used to read them out
// of the install's fallout2.exe (tools/parseElevatorTable.py -> lut/elevators.json).
//
// One entry per elevator type (the scenery's extra.type): `type` the background FRM
// (interface art id), `labels` the floor-label panel FRM (-1: none), the floors with the
// map, elevation and tile each button leads to, and the floors' labels (CE also uses them
// as the key bindings).

export interface Elevator {
    type: number
    labels: number
    buttonCount: number
    levelLabels: string
    buttons: { mapID: number; level: number; tileNum: number }[]
}

// elevator.cc gElevatorFrmIds: ebut_in.frm, ebut_out.frm, gaj000.frm
export const ELEVATOR_FRM_BUTTON_DOWN = 141
export const ELEVATOR_FRM_BUTTON_UP = 142
export const ELEVATOR_FRM_GAUGE = 149

export const CE_ELEVATORS: readonly Elevator[] = [
    { type: 143, labels: -1, buttonCount: 4, levelLabels: '1234', buttons: [{ mapID: 14, level: 0, tileNum: 18940 }, { mapID: 14, level: 1, tileNum: 18936 }, { mapID: 15, level: 0, tileNum: 21340 }, { mapID: 15, level: 1, tileNum: 21340 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: 'G1', buttons: [{ mapID: 13, level: 0, tileNum: 20502 }, { mapID: 14, level: 0, tileNum: 14912 }] },
    { type: 144, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 33, level: 0, tileNum: 12498 }, { mapID: 33, level: 1, tileNum: 20094 }, { mapID: 34, level: 0, tileNum: 17312 }] },
    { type: 144, labels: 145, buttonCount: 2, levelLabels: '34', buttons: [{ mapID: 34, level: 0, tileNum: 16140 }, { mapID: 34, level: 1, tileNum: 16140 }] },
    { type: 146, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 49, level: 0, tileNum: 14920 }, { mapID: 49, level: 1, tileNum: 15120 }, { mapID: 50, level: 0, tileNum: 12944 }] },
    { type: 146, labels: 147, buttonCount: 2, levelLabels: '34', buttons: [{ mapID: 50, level: 0, tileNum: 24520 }, { mapID: 50, level: 1, tileNum: 25316 }] },
    { type: 146, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 42, level: 0, tileNum: 22526 }, { mapID: 42, level: 1, tileNum: 22526 }, { mapID: 42, level: 2, tileNum: 22526 }] },
    { type: 146, labels: 151, buttonCount: 3, levelLabels: '346', buttons: [{ mapID: 42, level: 2, tileNum: 14086 }, { mapID: 43, level: 0, tileNum: 14086 }, { mapID: 43, level: 2, tileNum: 14086 }] },
    { type: 148, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 40, level: 0, tileNum: 14104 }, { mapID: 40, level: 1, tileNum: 22504 }, { mapID: 40, level: 2, tileNum: 17312 }] },
    { type: 146, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 9, level: 0, tileNum: 13704 }, { mapID: 9, level: 1, tileNum: 23302 }, { mapID: 9, level: 2, tileNum: 17308 }] },
    { type: 146, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 28, level: 0, tileNum: 19300 }, { mapID: 28, level: 1, tileNum: 19300 }, { mapID: 28, level: 2, tileNum: 20110 }] },
    { type: 146, labels: 147, buttonCount: 2, levelLabels: '34', buttons: [{ mapID: 28, level: 2, tileNum: 20118 }, { mapID: 29, level: 0, tileNum: 21710 }] },
    { type: 388, labels: -1, buttonCount: 4, levelLabels: '1234', buttons: [{ mapID: 28, level: 0, tileNum: 20122 }, { mapID: 28, level: 1, tileNum: 20124 }, { mapID: 28, level: 2, tileNum: 20940 }, { mapID: 29, level: 0, tileNum: 22540 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 12, level: 1, tileNum: 16052 }, { mapID: 12, level: 2, tileNum: 14480 }] },
    { type: 148, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 6, level: 0, tileNum: 14104 }, { mapID: 6, level: 1, tileNum: 22504 }, { mapID: 6, level: 2, tileNum: 17312 }] },
    { type: 148, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 30, level: 0, tileNum: 14104 }, { mapID: 30, level: 1, tileNum: 22504 }, { mapID: 30, level: 2, tileNum: 17312 }] },
    { type: 148, labels: -1, buttonCount: 3, levelLabels: '123', buttons: [{ mapID: 36, level: 0, tileNum: 13704 }, { mapID: 36, level: 1, tileNum: 23302 }, { mapID: 36, level: 2, tileNum: 17308 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 39, level: 0, tileNum: 17285 }, { mapID: 36, level: 0, tileNum: 19472 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 109, level: 2, tileNum: 10701 }, { mapID: 109, level: 1, tileNum: 10705 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 109, level: 2, tileNum: 14697 }, { mapID: 109, level: 1, tileNum: 15099 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 109, level: 2, tileNum: 23877 }, { mapID: 109, level: 1, tileNum: 25481 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 109, level: 2, tileNum: 26130 }, { mapID: 109, level: 1, tileNum: 24721 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 137, level: 0, tileNum: 23953 }, { mapID: 148, level: 1, tileNum: 16526 }] },
    { type: 143, labels: 150, buttonCount: 2, levelLabels: '12', buttons: [{ mapID: 62, level: 0, tileNum: 13901 }, { mapID: 63, level: 1, tileNum: 17923 }] },
]
