import globalState from './globalState.js'
import { getPunchModes, getKickModes, getActivePunchMode, getActiveKickMode } from './unarmed.js'
import { uiDrawWeapon } from './ui_hud.js'

// Fallout 2 interface label images for each unarmed mode name.
const MODE_LABEL_IMAGES: Record<string, string> = {
    'punch':           'punch',
    'kick':            'kick',
    'strong punch':    'chopuch',
    'strong kick':     'kick',
    'palm strike':     'cm_plmst',
    'haymaker':        'cm_hymkr',
    'piercing strike': 'cm_pstrk',
    'hook kick':       'cm_hookk',
    'piercing kick':   'cm_prckk',
}

function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

let outsideClickListener: ((e: MouseEvent) => void) | null = null

export function openUnarmedModePanel(): void {
    if (!globalState.player) return
    const panel = $id('unarmedModePanel')
    const player = globalState.player
    const unarmedSkill = player.getSkill('Unarmed')
    const activeHand: 'leftHand' | 'rightHand' = (player as any).activeHand ?? 'leftHand'
    const leftWeapon = (player as any).leftHand?.weapon ?? null
    const rightWeapon = (player as any).rightHand?.weapon ?? null
    const bothHandsEmpty = !leftWeapon && !rightWeapon

    const isKickHand = activeHand === 'rightHand' && bothHandsEmpty
    const available = isKickHand ? getKickModes(unarmedSkill) : getPunchModes(unarmedSkill)
    const activeMode = isKickHand
        ? getActiveKickMode(unarmedSkill, globalState.kickModeIdx)
        : getActivePunchMode(unarmedSkill, globalState.punchModeIdx)

    panel.innerHTML = ''
    available.forEach((mode, idx) => {
        const row = document.createElement('div')
        row.className = 'unarmedModeRow'
        if (mode.name === activeMode.name) {
            row.classList.add('unarmedModeRow-active')
        }

        const img = document.createElement('img')
        img.src = `art/intrface/${MODE_LABEL_IMAGES[mode.name] ?? mode.icon}.png`
        img.className = 'unarmedModeLabel'
        img.setAttribute('draggable', 'false')

        const ap = document.createElement('span')
        ap.className = 'unarmedModeAP'
        ap.textContent = String(mode.apCost)

        row.appendChild(img)
        row.appendChild(ap)
        row.addEventListener('click', (e) => {
            e.stopPropagation()
            if (isKickHand) {
                globalState.kickModeIdx = idx
            } else {
                globalState.punchModeIdx = idx
            }
            uiDrawWeapon()
            closeUnarmedModePanel()
        })
        panel.appendChild(row)
    })

    panel.style.display = 'block'

    outsideClickListener = (e: MouseEvent) => {
        if (!panel.contains(e.target as Node)) {
            closeUnarmedModePanel()
        }
    }
    // defer so this click event doesn't immediately close the panel
    setTimeout(() => {
        document.addEventListener('click', outsideClickListener!, { once: true })
    }, 0)
}

export function closeUnarmedModePanel(): void {
    const panel = document.getElementById('unarmedModePanel')
    if (!panel) return
    panel.style.display = 'none'
    if (outsideClickListener) {
        document.removeEventListener('click', outsideClickListener)
        outsideClickListener = null
    }
}
