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
// targeting overlay. Crippled limbs are greyed out and unclickable.

import { Combat } from './combat.js'
import globalState from './globalState.js'
import { Critter } from './object.js'
import { drawDigits } from './ui_hud.js'
import { UIMode } from './ui_panels.js'

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

function $qa(selector: string): HTMLElement[] {
    return Array.from(document.querySelectorAll(selector))
}

function show($el: HTMLElement): void {
    $el.style.display = 'block'
}

function hide($el: HTMLElement): void {
    $el.style.display = 'none'
}

interface ElementOptions {
    id?: string
    src?: string
    classes?: string[]
    click?: (e: MouseEvent) => void
    style?: { [key in keyof CSSStyleDeclaration]?: string }
    children?: HTMLElement[]
    attrs?: { [key: string]: string | number }
}

function makeEl(tag: string, options: ElementOptions): HTMLElement {
    const $el = document.createElement(tag)

    if (options.id !== undefined) {
        $el.id = options.id
    }
    if (options.src !== undefined) {
        ;($el as HTMLImageElement).src = options.src
    }
    if (options.classes !== undefined) {
        $el.className = options.classes.join(' ')
    }
    if (options.click !== undefined) {
        $el.onclick = options.click
    }
    if (options.style !== undefined) {
        Object.assign($el.style, options.style)
    }
    if (options.children !== undefined) {
        for (const child of options.children) {
            $el.appendChild(child)
        }
    }
    if (options.attrs !== undefined) {
        for (const prop in options.attrs) {
            $el.setAttribute(prop, options.attrs[prop] + '')
        }
    }

    return $el
}

/**
 * Wire the static called-shot panel: pre-create the two digit divs inside
 * each .calledShotChance container, and bind the cancel button. Call once
 * during uiInit().
 */
export function initCalledShot(): void {
    for (let i = 0; i < 2; i++) {
        for (const $chance of Array.from(document.querySelectorAll('#calledShotBox .calledShotChance'))) {
            $chance.appendChild(
                makeEl('div', { classes: ['number'], style: { left: i * 9 + 'px' }, id: 'digit' + (i + 1) })
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
        let chance: any = Combat.prototype.getHitChance(globalState.player, target, region).hit
        console.log('[UI] called shot: id: %s | chance: %d', '#calledShot-' + region + '-chance #digit', chance)
        if (chance <= 0) {
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

    $id('calledShotBackground').style.backgroundImage = `url('${art}.png')`

    // Map region name to the Critter's crippled flag
    const crippledFlags: { [region: string]: keyof Critter } = {
        leftArm:  'crippledLeftArm',
        rightArm: 'crippledRightArm',
        leftLeg:  'crippledLeftLeg',
        rightLeg: 'crippledRightLeg',
    }

    for (const $label of $qa('.calledShotLabel')) {
        const id = ($label as HTMLElement).id
        const regionHit = id.split('-')[1]
        const crippledKey = crippledFlags[regionHit]
        const isCrippled = crippledKey ? !!(target as any)[crippledKey] : false

        if (isCrippled) {
            // Gray out crippled parts so the player knows they're already damaged
            Object.assign(($label as HTMLElement).style, {
                color: '#666666',
                textDecoration: 'line-through',
                cursor: 'default',
                pointerEvents: 'none',
            })
            const $chance = $id('calledShot-' + regionHit + '-chance')
            if ($chance) Object.assign(($chance as HTMLElement).style, { opacity: '0.4' })
        } else {
            // Reset styles (in case uiCalledShot is called multiple times)
            Object.assign(($label as HTMLElement).style, {
                color: '',
                textDecoration: '',
                cursor: '',
                pointerEvents: '',
            })
            $label.onclick = (evt: MouseEvent) => {
                const clickedRegion = (evt.target as HTMLElement).id.split('-')[1]
                console.log('[UI] called shot: clicked region %s', clickedRegion)
                if (callback) {
                    callback(clickedRegion)
                }
            }
        }
    }
}
