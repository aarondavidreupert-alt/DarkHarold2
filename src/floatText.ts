/*
Copyright 2026 DarkHarold2 contributors

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

// Floating text over critters — CE text_object.cc textObjectAdd: the string in the
// given interface font (101, 103 for warnings), word-wrapped at 200 px, every line
// centred and lineHeight + 1 apart, drawn into a black buffer (so the soft AAF edges
// darken instead of turning see-through) and outlined by bufferOutline (draw.cc).
// Shown as canvases in a DOM layer over the game canvas.

import { Point } from './geometry.js'
import { world } from './state/world.js'
import { uiState } from './state/uiState.js'
import { font1, font3 } from './uiFont.js'
import type { FontRenderer } from './ui/fontCore.js'

const WRAP_WIDTH = 200
const TEXT_OBJECTS_MAX_COUNT = 20

// CE text_object.cc textObjectAdd: at most 20 messages (sfall fix); a new message of an
// owner replaces its old one (textObjectsRemoveByOwner); the text stays on the tile the
// owner stood on (no owner: the centre tile, unbounded). False when not added.
export function addFloatMessage(fm: any): boolean {
    const list = uiState.floatMessages as any[]
    if (list.length >= TEXT_OBJECTS_MAX_COUNT) return false
    if (!fm.msg) return false
    for (let i = list.length - 1; i >= 0; i--) if (list[i].obj === fm.obj) list.splice(i, 1)
    fm.tile = fm.obj?.position ? { ...fm.obj.position } : null
    list.push(fm)
    return true
}

// CE text_object.cc textObjectsReset: every floating text goes (a dialogue starts)
export function resetFloatMessages(): void {
    ;(uiState.floatMessages as any[]).length = 0
}

// CE float_msg colours (interpreter_extra.cc opFloatMessage, FLOATING_MESSAGE_TYPE_*),
// color.pal entries of the _colorTable values.
export const FLOAT_MSG_COLOR: { [type: number]: string } = {
    [-2]: '#fc0000', // WARNING (font 103) — 31744
    0: '#fcfc7c', // NORMAL — 32747
    1: '#545454', // BLACK — 10570
    2: '#fc0000', // RED — 31744
    3: '#3cf800', // GREEN — 992
    4: '#30588c', // BLUE — 31
    5: '#545454', // PURPLE — 10570
    6: '#a0a0a0', // NEAR_WHITE — 21140
    7: '#fc4848', // LIGHT_RED — 32074
    8: '#fcfc7c', // YELLOW — 32747
    9: '#fcfcfc', // WHITE — 32767
    10: '#545454', // GREY — 10570
    11: '#3c3c3c', // DARK_GREY — 8456
    12: '#747474', // LIGHT_GREY — 15855
}
export const FLOAT_OUTLINE_BLACK = '#000000' // _colorTable[0]

// Old DH2 colour names still passed by some callers.
const NAMED: { [name: string]: string } = {
    white: '#fcfcfc',
    yellow: '#fcfc7c',
    red: '#fc0000',
    green: '#3cf800',
    blue: '#30588c',
    black: '#545454',
    purple: '#545454',
    'dark gray': '#3c3c3c',
    'light gray': '#747474',
}

interface FloatSpec {
    msg: string
    color: string
    outline?: string | null
    font?: 101 | 103
}

// CE word_wrap.cc wordWrap (WRAP-01): a line breaks after the last space (any whitespace,
// '\n' included) or hyphen that still fits; a word wider than the line breaks mid-word.
function wordWrap(font: FontRenderer, text: string, width: number): string[] {
    if (font.measureText(text) < width) return [text]
    const gap = font.letterSpacing
    const lines: string[] = []
    let start = 0
    let accum = 0
    let prevBreak = -1
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        accum += gap + font.measureText(ch)
        if (accum <= width) {
            if (/\s/.test(ch) || ch === '-') prevBreak = i
            continue
        }
        if (prevBreak >= 0) {
            lines.push(text.slice(start, prevBreak + 1)) // word wrap
            start = prevBreak + 1
            i = prevBreak
        } else {
            lines.push(text.slice(start, i)) // character wrap
            start = i
            i--
        }
        prevBreak = -1
        accum = 0
    }
    lines.push(text.slice(start))
    // the drawn line leaves out the break character's trailing blank / newline
    return lines.map((l) => l.replace(/\s+$/, ''))
}

function hexRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function buildCanvas(spec: FloatSpec, fm?: any): HTMLCanvasElement | null {
    const font = spec.font === 103 ? font3 : font1
    if (!font.isLoaded()) return null
    const color = NAMED[spec.color] ?? spec.color
    const lines = wordWrap(font, spec.msg, WRAP_WIDTH)
    if (fm) fm.lines = lines.length // CE linesCount, used for the display time
    const lineCanvases = lines.map((l) => font.renderCanvas(l, color))
    const step = font.lineHeight + 1
    const pad = spec.outline ? 1 : 0
    const w = Math.max(1, ...lineCanvases.map((c) => c.width)) + 2 * pad
    const h = lines.length * step + 2 * pad
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    lineCanvases.forEach((c, i) => ctx.drawImage(c, pad + Math.trunc((w - 2 * pad - c.width) / 2), pad + i * step))

    // Blend onto black like CE's zero-filled buffer: soft pixels become dark but opaque.
    const img = ctx.getImageData(0, 0, w, h)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3]
        if (a === 0) continue
        d[i] = Math.round((d[i] * a) / 255)
        d[i + 1] = Math.round((d[i + 1] * a) / 255)
        d[i + 2] = Math.round((d[i + 2] * a) / 255)
        d[i + 3] = 255
    }
    // draw.cc bufferOutline: the pixel before and after every horizontal and vertical run.
    if (spec.outline) {
        const [or, og, ob] = hexRgb(spec.outline)
        const filled = new Uint8Array(w * h)
        for (let p = 0; p < w * h; p++) filled[p] = d[p * 4 + 3] ? 1 : 0
        const mark = new Uint8Array(w * h)
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const f = filled[y * w + x],
                    prev = x > 0 ? filled[y * w + x - 1] : 0
                if (f && !prev && x > 0) mark[y * w + x - 1] = 1
                else if (!f && prev) mark[y * w + x] = 1
            }
        }
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                const f = filled[y * w + x],
                    prev = y > 0 ? filled[(y - 1) * w + x] : 0
                if (f && !prev && y > 0) mark[(y - 1) * w + x] = 1
                else if (!f && prev) mark[y * w + x] = 1
            }
        }
        for (let p = 0; p < w * h; p++) {
            if (mark[p] && !filled[p]) {
                d[p * 4] = or
                d[p * 4 + 1] = og
                d[p * 4 + 2] = ob
                d[p * 4 + 3] = 255
            }
        }
    }
    ctx.putImageData(img, 0, 0)
    canvas.style.position = 'absolute'
    canvas.style.imageRendering = 'pixelated'
    return canvas
}

let layer: HTMLDivElement | null = null
const canvases = new Map<object, HTMLCanvasElement>()

function ensureLayer(): HTMLDivElement {
    if (layer) return layer
    layer = document.createElement('div')
    layer.id = 'floatTextLayer'
    Object.assign(layer.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
    })
    font1.onLoad(() => {})
    font3.onLoad(() => {})
    const cnv = document.getElementById('cnv')
    ;(cnv?.parentElement ?? document.body).insertBefore(layer, cnv?.nextSibling ?? null)
    return layer
}

// CE textObjectFindPlacement: centred 60 px above the tile, else shifted left / right,
// beside it, or on it — the first spot inside the window; the offset from the tile is
// kept. (tx, ty) is the tile's screen position, z the zoom of the world offsets.
function findPlacement(
    w: number,
    h: number,
    tx: number,
    ty: number,
    unbounded: boolean,
    z: number,
    viewW: number,
    viewH: number,
): Point {
    const fits = (x: number, y: number) => x >= 0 && x + w - 1 < viewW && y >= 0 && y + h - 1 < viewH
    let x = tx + 16 * z - Math.trunc(w / 2)
    let y = ty
    if (!unbounded) y -= h + 60 * z
    const tries: [number, number][] = []
    tries.push([x, y])
    x -= Math.trunc(w / 2)
    tries.push([x, y])
    x += w
    tries.push([x, y])
    x = tx - 16 * z - w
    y = ty - 16 * z - h
    tries.push([x, y])
    x += w + 64 * z
    tries.push([x, y])
    x = tx + 16 * z - Math.trunc(w / 2)
    y = ty
    tries.push([x, y])
    x -= Math.trunc(w / 2)
    tries.push([x, y])
    x += w
    tries.push([x, y])
    for (const [px, py] of tries) if (fits(px, py)) return { x: px - tx, y: py - ty }
    return { x: tx + 16 * z - Math.trunc(w / 2) - tx, y: -(h + 60 * z) }
}

// Called once per frame by the renderer: `tileScreen` gives a tile's screen position
// (CE tileToScreenXY) in canvas pixels, `z` the zoom, viewW / viewH the game view.
export function updateFloatText(tileScreen: (tile: Point) => Point, z: number, viewW: number, viewH: number): void {
    const live = new Set<object>()
    const parent = ensureLayer()
    for (const fm of uiState.floatMessages as any[]) {
        let c = canvases.get(fm)
        const tile: Point = fm.tile ?? world.centerTile
        const ts = tileScreen(tile)
        if (!c) {
            const built = buildCanvas(
                {
                    msg: fm.msg,
                    color: fm.color ?? FLOAT_MSG_COLOR[0],
                    outline: fm.outline === undefined ? FLOAT_OUTLINE_BLACK : fm.outline,
                    font: fm.font,
                },
                fm,
            )
            if (!built) continue
            c = built
            canvases.set(fm, c)
            parent.appendChild(c)
            fm.offset = findPlacement(c.width, c.height, ts.x, ts.y, !fm.tile, z, viewW, viewH)
        }
        live.add(fm)
        c.style.display = 'block'
        c.style.left = Math.round(ts.x + fm.offset.x) + 'px'
        c.style.top = Math.round(ts.y + fm.offset.y) + 'px'
    }
    for (const [fm, c] of canvases) {
        if (!live.has(fm)) {
            c.remove()
            canvases.delete(fm)
        }
    }
}
