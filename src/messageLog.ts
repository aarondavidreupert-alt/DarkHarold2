// The HUD's message window (CE display_monitor.cc): uiLog and friends. Its own module, importing
// only the DOM helpers and globalState, so the game logic that reports to the player does not
// import the HUD (wiki/code_quality.md Q14); ui_hud.ts re-exports it.

import globalState from './globalState.js'
import { $id } from './ui_dom.js'

const LOG_LINE_HEIGHT = 13 // approx px per line for 8pt font

// CE display_monitor.cc displayMonitorAddMessage: plain text (a message is never markup),
// the last DISPLAY_MONITOR_LINES_CAPACITY (100) lines kept. Each line carries its number
// (data-seq) for readers that follow the log (uiLogCount, the story crawler).
const LOG_CAPACITY = 100
let logSeq = 0
// CE display_monitor.cc displayMonitorAddMessage: each message starts with the '\x95' knob
// (•); out of combat a new one sounds "monitor", at most every 500 ms
// (DISPLAY_MONITOR_BEEP_DELAY); 100 lines are kept
let lastMonitorBeep = -Infinity
export function uiLog(msg: string): void {
    const $log = $id('displayLog')
    if (!globalState.inCombat) {
        const now = performance.now()
        if (now - lastMonitorBeep >= 500) {
            lastMonitorBeep = now
            globalState.audioEngine?.playSfxByName?.('monitor')
        }
    }
    const li = document.createElement('li')
    li.textContent = '\u2022' + msg
    li.dataset.seq = String(logSeq++)
    $log.appendChild(li)
    while ($log.children.length > LOG_CAPACITY) {
        $log.removeChild($log.firstChild!)
    }
    $log.scrollTop = $log.scrollHeight
}

/** CE displayMonitorReset (interfaceReset, from gameReset): the log is emptied. */
export function uiLogReset(): void {
    const $log = document.getElementById('displayLog')
    if ($log) {
        $log.innerHTML = ''
    }
}

/** How many lines the message window has received so far. */
export function uiLogCount(): number {
    return logSeq
}

export function initLogScrollZones(): void {
    const log = document.getElementById('displayLog')
    const up = document.getElementById('logScrollUp')
    const down = document.getElementById('logScrollDown')
    if (!log || !up || !down) {
        return
    }
    up.addEventListener('click', () => {
        log.scrollTop -= LOG_LINE_HEIGHT
    })
    down.addEventListener('click', () => {
        log.scrollTop += LOG_LINE_HEIGHT
    })
}
