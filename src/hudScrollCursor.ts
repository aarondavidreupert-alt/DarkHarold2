// The screen-edge scroll arrow over the HUD (CE game_mouse.cc:2334 tests the whole screen, so
// the arrow shows over the interface bar too). The game draws its own cursor on the canvas, but
// the HUD covers the canvas, so over the HUD the arrow is an image element that follows the mouse
// (ui.css hides the CSS cursor there while #bar[data-scroll] is set). A CSS cursor image does not
// work at the screen edge: Chrome drops custom cursors over 32 px (page zoom and display scaling
// included) that would reach past the page, and shows the rule's fallback — the system's white
// resize arrow — instead.

import { assetUrl } from './modAssets.js'

// direction -> the arrow (art/intrface/) and its hotspot (the FRM's offset)
const ARROWS: { [dir: string]: { img: string; x: number; y: number } } = {
    s: { img: 'scrsouth', x: 16, y: 25 },
    sw: { img: 'scrswest', x: 0, y: 27 },
    se: { img: 'scrseast', x: 27, y: 27 },
    w: { img: 'scrwest', x: 0, y: 16 },
    e: { img: 'screast', x: 24, y: 16 },
}

let arrowEl: HTMLElement | null = null
let lastX = 0
let lastY = 0
let overBar = false

function arrow(): HTMLElement {
    if (!arrowEl) {
        arrowEl = document.createElement('div')
        Object.assign(arrowEl.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '100001',
            backgroundRepeat: 'no-repeat',
            display: 'none',
        })
        document.body.appendChild(arrowEl)
    }
    return arrowEl
}

/** Show the arrow for `dir` ('' = none) at the mouse while it is over the HUD bar. */
export function updateHudScrollCursor(dir: string): void {
    const a = ARROWS[dir]
    const el = arrow()
    if (!a || !overBar) {
        el.style.display = 'none'
        return
    }
    const url = `url('${assetUrl(`art/intrface/${a.img}.png`)}')`
    if (el.style.backgroundImage !== url) {
        el.style.backgroundImage = url
        const img = new Image()
        img.onload = () => {
            el.style.width = img.naturalWidth + 'px'
            el.style.height = img.naturalHeight + 'px'
        }
        img.src = assetUrl(`art/intrface/${a.img}.png`)
    }
    el.style.left = lastX - a.x + 'px'
    el.style.top = lastY - a.y + 'px'
    el.style.display = 'block'
}

/** Track the mouse (client coordinates) and whether it is over #bar; called once at start. */
export function installHudScrollCursor(): void {
    document.addEventListener(
        'mousemove',
        (e) => {
            lastX = e.clientX
            lastY = e.clientY
            const bar = document.getElementById('bar')
            overBar = !!bar && e.target instanceof Node && bar.contains(e.target)
            if (!overBar && arrowEl) {
                arrowEl.style.display = 'none'
            }
        },
        true,
    )
    document.addEventListener('mouseleave', () => {
        if (arrowEl) {
            arrowEl.style.display = 'none'
        }
    })
}
