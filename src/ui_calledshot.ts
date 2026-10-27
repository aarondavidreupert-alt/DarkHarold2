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

// Called-shot screen: per-region hit-chance readouts on the Pip-Boy-style
// targeting overlay (CE calledShotSelectHitLocation).

import { Combat } from './combat.js'
import globalState from './globalState.js'
import { dbg } from './logger.js'
import { Critter } from './object.js'
import { drawDigits } from './ui_hud.js'
import { UIMode } from './ui_panels.js'
import { $id, $qa, show, hide, makeEl } from './ui_dom.js'
import { assetUrl } from './modAssets.js'

/**
 * Wire the static called-shot panel: pre-create the two digit divs inside
 * each .calledShotChance container, and bind the cancel button. Call once
 * during uiInit().
 */
export function initCalledShot(): void {
    for (let i = 0; i < 2; i++) {
        for (const $chance of Array.from(document.querySelectorAll('#calledShotBox .calledShotChance'))) {
            $chance.appendChild(
                makeEl('div', { classes: ['number'], style: { left: i * 9 + 'px' }, id: 'digit' + (i + 1) }),
            )
        }
    }

    $id('calledShotCancelBtn').onclick = () => {
        uiCloseCalledShot()
    }
}

export function uiCloseCalledShot() {
    globalState.uiMode = UIMode.none
    hide($id('calledShotBox'))
}

export function uiCalledShot(art: string, target: Critter, callback?: (regionHit: string) => void) {
    globalState.uiMode = UIMode.calledShot
    show($id('calledShotBox'))

    function drawChance(region: string) {
        let chance: any = (globalState.combat ?? new Combat([])).getHitChance(globalState.player, target, region).hit
        dbg('combat', `[UI] called shot: id: #calledShot-${region}-chance #digit | chance: ${chance}`)
        // CE _print_tohit: two digits from 0 ("00"), dashes only below 0
        if (chance < 0) {
            chance = '--'
        }
        drawDigits('#calledShot-' + region + '-chance #digit', chance, 2, false)
    }

    drawChance('torso')
    drawChance('head')
    drawChance('eyes')
    drawChance('groin')
    drawChance('leftArm')
    drawChance('rightArm')
    drawChance('leftLeg')
    drawChance('rightLeg')

    $id('calledShotBackground').style.backgroundImage = `url('${assetUrl(art + '.png')}')`

    // CE calledShotSelectHitLocation: every location can be picked (a crippled limb too), and
    // the pick plays icsxxxx1
    for (const $label of $qa('.calledShotLabel')) {
        Object.assign(($label as HTMLElement).style, { color: '', textDecoration: '', cursor: '', pointerEvents: '' })
        $label.onclick = (evt: MouseEvent) => {
            const clickedRegion = (evt.target as HTMLElement).id.split('-')[1]
            dbg('combat', `[UI] called shot: clicked region ${clickedRegion}`)
            globalState.audioEngine?.playSfxByName?.('icsxxxx1')
            if (callback) {
                callback(clickedRegion)
            }
        }
    }
}
