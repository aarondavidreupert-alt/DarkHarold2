// The wait cursor (CE game_mouse.cc MOUSE_CURSOR_WAIT_PLANET, intrface frm 278 "wait.frm":
// the spinning planet, 7 frames at 10 fps). CE sets it for a map load (map.cc mapLoad,
// mapLoadSaved) and a save load (loadsave.cc lsgLoadGameInSlot) until the map is up.
// DH2 draws its cursors in the WebGL frame, which the map fade's black overlay covers and
// which doesn't run while a map loads, so this one is a DOM element above that overlay
// (mapFade.ts, z-index 9000), shown while a map is loading or the screen is black for it.

import globalState from './globalState.js'
import { isMapFadeBlack } from './mapFade.js'
import { assetUrl } from './modAssets.js'

const SIZE = 64
const FRAMES = 7
let elem: HTMLElement | null = null
let shown = false
let mouseX = -1000
let mouseY = -1000

/** True while the wait cursor stands in for the game's own cursor. */
export function waitCursorShown(): boolean {
    return shown
}

function place(): void {
    if (!elem) {
        return
    }
    // CE mouseSetFrame: an animated cursor is centred on the hot spot
    elem.style.left = mouseX - SIZE / 2 + 'px'
    elem.style.top = mouseY - SIZE / 2 + 'px'
}

function update(): void {
    const want = globalState.isLoading || isMapFadeBlack()
    if (want !== shown) {
        shown = want
        if (!elem) {
            elem = document.createElement('div')
            elem.id = 'waitCursor'
            Object.assign(elem.style, {
                position: 'fixed',
                width: SIZE + 'px',
                height: SIZE + 'px',
                backgroundImage: `url('${assetUrl('art/intrface/wait.png')}')`,
                backgroundRepeat: 'no-repeat',
                pointerEvents: 'none',
                zIndex: '9001',
                animation: `dh2WaitCursor ${FRAMES / 10}s steps(${FRAMES}) infinite`,
            })
            const style = document.createElement('style')
            style.textContent = `@keyframes dh2WaitCursor { from { background-position: 0 0 } to { background-position: -${SIZE * FRAMES}px 0 } }`
            document.head.appendChild(style)
            document.body.appendChild(elem)
        }
        elem.style.display = shown ? 'block' : 'none'
        place()
    }
    requestAnimationFrame(update)
}

/** Start watching the load state (once, at boot). */
export function initWaitCursor(): void {
    if (typeof document === 'undefined') {
        return
    }
    document.addEventListener(
        'mousemove',
        (e) => {
            mouseX = e.clientX
            mouseY = e.clientY
            if (shown) {
                place()
            }
        },
        true,
    )
    requestAnimationFrame(update)
}
