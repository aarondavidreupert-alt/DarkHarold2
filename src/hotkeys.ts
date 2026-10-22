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

// The game keyboard — CE game.cc gameHandleKey, plus combat.cc _combat_input (Space
// ends the turn, Return tries to end combat). Runs on the map only (no window open),
// as CE's windows run their own input loops.

import globalState from './globalState.js'
import { Combat } from './combat.js'
import { Config } from './config.js'
import * as GameTime from './gametime.js'
import { Skills } from './skills.js'
import { UIMode, closeAllPanels } from './ui_panels.js'
import { uiLog } from './ui_hud.js'
import { getMessage } from './util.js'
import { showAlert } from './ui_dialog.js'
import { centerCamera } from './render/camera.js'
import { showInventory } from './ui_inventory.js'
import { showCharacterScreen } from './ui_character.js'
import { showOptionsMenu, changeBrightness, quitConfirmation } from './ui_options.js'
import { openPipBoy, openPipBoyRest } from './ui_pipboy.js'
import { beginSkillTargeting, showSkilldex } from './ui_skilldex.js'
import { toggleAutomap } from './ui_automap.js'
import { uiQuickLoad, uiQuickSave, uiSaveLoad } from './ui_saveload.js'
import { getVolumeValue, savePreferences } from './ui_options/preferences.js'
import { swapHands, cycleActiveItemAction } from './ui.js'
import { assetUrl } from './modAssets.js'

const click = () => globalState.audioEngine?.playSfxByName?.('ib1p1xx1')

// CE interfaceBarEnabled: the bar is off while it isn't the player's combat turn.
function barEnabled(): boolean {
    return !globalState.inCombat || !!globalState.combat?.inPlayerTurn
}

// "Pipboy not available in combat!" (misc.msg 7)
function noPipboyInCombat(): void {
    globalState.audioEngine?.playSfxByName?.('iisxxxx1')
    void showAlert(getMessage('misc', 7) ?? 'Pipboy not available in combat!')
}

// CE game.cc showHelp — helpscrn (interface #297) over a black screen until any input.
function showHelp(): void {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:20000;display:flex;align-items:center;justify-content:center;'
    const img = document.createElement('img')
    img.src = assetUrl('art/intrface/helpscrn.png')
    img.style.cssText = 'width:640px;height:480px;image-rendering:pixelated;'
    overlay.appendChild(img)
    const prev = globalState.uiMode
    globalState.uiMode = UIMode.dialog
    const close = (e: Event) => {
        e.preventDefault(); e.stopPropagation()
        overlay.remove()
        globalState.uiMode = prev
        window.removeEventListener('keydown', close, true)
        overlay.removeEventListener('mousedown', close)
    }
    window.addEventListener('keydown', close, true)
    overlay.addEventListener('mousedown', close)
    document.body.appendChild(overlay)
}

// CE options.cc showPause — charwin (208) with PAUSED (options.msg 301) and DONE (300);
// +/- still change the brightness, any other key or the button closes it.
function showPause(): void {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;'
    const win = document.createElement('div')
    win.style.cssText = "position:relative;width:139px;height:72px;margin-top:-108px;background:url('" + assetUrl('art/intrface/charwin.png') + "');"
    const title = document.createElement('div')
    title.style.cssText = 'position:absolute;left:0;right:0;top:10px;text-align:center;color:#907824;font:bold 14px monospace;'
    title.textContent = getMessage('options', 301) ?? 'PAUSED'
    const done = document.createElement('div')
    done.style.cssText = "position:absolute;left:13px;top:42px;width:108px;height:24px;background:url('" + assetUrl('art/intrface/donebox.png') + "');"
    const btn = document.createElement('div')
    btn.style.cssText = "position:absolute;left:13px;top:4px;width:15px;height:16px;background:url('" + assetUrl('art/intrface/lilredup.png') + "');cursor:pointer;"
    const label = document.createElement('div')
    label.style.cssText = 'position:absolute;left:39px;top:4px;color:#907824;font:bold 12px monospace;'
    label.textContent = getMessage('options', 300) ?? 'DONE'
    done.append(btn, label)
    win.append(title, done)
    overlay.appendChild(win)
    const prev = globalState.uiMode
    globalState.uiMode = UIMode.dialog
    const close = () => {
        overlay.remove()
        globalState.uiMode = prev
        window.removeEventListener('keydown', onKey, true)
    }
    const onKey = (e: KeyboardEvent) => {
        e.preventDefault(); e.stopPropagation()
        if (e.key === '+' || e.key === '=') changeBrightness(1)
        else if (e.key === '-' || e.key === '_') changeBrightness(-1)
        else close()
    }
    btn.onmousedown = () => { btn.style.backgroundImage = "url('" + assetUrl('art/intrface/lilreddn.png') + "')" }
    btn.onclick = () => close()
    window.addEventListener('keydown', onKey, true)
    document.body.appendChild(overlay)
}

// CE KEY_SLASH: "<month>: <day>/<year> <time>" (editor.msg 500 + month − 1)
function showDate(): void {
    const { day, month, year } = GameTime.getDate()
    const name = getMessage('editor', 500 + month) ?? String(month + 1)
    uiLog(`${name}: ${day}/${year} ${GameTime.getTimeString()}`)
}

// CE KEY_COMMA / KEY_DOT: animationRegisterRotate(Counter)Clockwise(gDude)
function rotateDude(dir: 1 | -1): void {
    const p = globalState.player
    if (!p || (p.anim && p.anim !== 'idle')) return
    p.orientation = (p.orientation + (dir === 1 ? 1 : 5)) % 6
}

// CE KEY_F2 / KEY_F3: master volume ∓ 2047 of 32767
function changeMasterVolume(dir: 1 | -1): void {
    const eng = globalState.audioEngine
    if (!eng) return
    const v = Math.max(0, Math.min(100, getVolumeValue('master') + dir * (2047 / 32767) * 100))
    eng.setVolume('master', Math.round(v))
    savePreferences()
}

// CE KEY_HOME: back to the dude's elevation and scroll to him
function centerOnDude(): void {
    const p = globalState.player
    const map = globalState.gMap
    if (!p || !map) return
    if ((p.elevation ?? map.currentElevation) !== map.currentElevation) map.changeElevation(p.elevation ?? 0, true)
    centerCamera(p.position)
}

const SKILL_KEYS: { [k: string]: Skills } = {
    '1': Skills.Sneak, '2': Skills.Lockpick, '3': Skills.Steal, '4': Skills.Traps,
    '5': Skills.FirstAid, '6': Skills.Doctor, '7': Skills.Science, '8': Skills.Repair,
}
// Shift+digit (CE accepts both, e.g. KEY_1 / KEY_EXCLAMATION) — by physical key
const DIGIT_CODES: { [code: string]: string } = {
    Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8',
}

export type MouseModeCycler = () => void

// Returns true when the key was a game key.
export function gameHandleKey(e: KeyboardEvent, cycleMouseMode: MouseModeCycler): boolean {
    const key = e.key
    const lower = key.length === 1 ? key.toLowerCase() : key
    const ctrl = e.ctrlKey || e.metaKey
    const inCombat = globalState.inCombat
    const bar = barEnabled()

    // combat.cc _combat_input (the player's turn)
    if (inCombat && globalState.combat?.inPlayerTurn) {
        if (key === ' ') { globalState.combat.nextTurn(); return true }
        if (key === 'Enter') { globalState.combat.attemptEnd(); return true }
    }
    if (inCombat && !globalState.combat?.inPlayerTurn) return false // no input during AI turns

    if (ctrl) {
        switch (lower) {
            case 'q': case 'x': click(); void quitConfirmation(); return true
            case 'p': click(); showPause(); return true
            case 's': click(); uiSaveLoad(true); return true
            case 'l': click(); uiSaveLoad(false); return true
            case 'v': click(); uiLog('FALLOUT II 1.02d'); uiLog('Dec 11 1998 16:54:30'); return true
        }
        return false
    }
    if (e.altKey) return false

    const digit = DIGIT_CODES[e.code]
    if (digit && SKILL_KEYS[digit] !== undefined) {
        if (!bar) return true
        click()
        beginSkillTargeting(SKILL_KEYS[digit])
        return true
    }

    switch (key) {
        case 'F10': click(); void quitConfirmation(); return true
        case 'Tab': if (bar) { click(); closeAllPanels(); toggleAutomap() } return true
        case 'Escape': if (bar) { click(); closeAllPanels(); showOptionsMenu() } return true
        case 'Home': centerOnDude(); return true
        case 'F1': click(); showHelp(); return true
        case 'F2': changeMasterVolume(-1); return true
        case 'F3': changeMasterVolume(1); return true
        case 'F4': click(); uiSaveLoad(true); return true
        case 'F5': click(); uiSaveLoad(false); return true
        case 'F6': click(); uiQuickSave(); return true
        case 'F7': click(); uiQuickLoad(); return true
        case '-': case '_': changeBrightness(-1); return true
        case '=': case '+': changeBrightness(1); return true
        case ',': case '<': rotateDude(-1); return true
        case '.': case '>': rotateDude(1); return true
        case '/': case '?': click(); showDate(); return true
    }

    switch (lower) {
        case 'a': if (bar && !inCombat && Config.engine.doCombat) Combat.start(); return true
        case 'n': if (bar) { click(); cycleActiveItemAction() } return true
        case 'm': cycleMouseMode(); return true
        case 'b': if (bar) { click(); swapHands() } return true
        case 'c': if (bar) { click(); closeAllPanels(); showCharacterScreen() } return true
        case 'i': if (bar) { click(); closeAllPanels(); showInventory() } return true
        case 'o': if (bar) { click(); closeAllPanels(); showOptionsMenu() } return true
        case 'p':
            if (!bar) return true
            if (inCombat) { noPipboyInCombat(); return true }
            click(); closeAllPanels(); openPipBoy(); return true
        case 's': if (bar) { click(); closeAllPanels(); showSkilldex() } return true
        case 'z':
            if (!bar) return true
            if (inCombat) { noPipboyInCombat(); return true }
            click(); closeAllPanels(); openPipBoyRest(); return true
    }
    return false
}
