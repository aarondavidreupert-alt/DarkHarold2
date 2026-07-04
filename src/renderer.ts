/*
Copyright 2015 darkf

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

/* eslint-disable @typescript-eslint/no-empty-function */

import { heart } from './heart.js'
import { BoundingBox, hexFromScreen, hexesInRadius, hexToScreen, Point, pointInBoundingBox } from './geometry.js'
import globalState from './globalState.js'
import { lazyLoadImage } from './images.js'
import { dbg } from './logger.js'
import { Obj } from './object.js'
import { tileFromScreen } from './tile.js'
import { Config } from './config.js'
import { WindowFrame } from './ui.js'
import { Font } from './formats/fon.js'
import { Lightmap } from './lightmap.js'
import {
    SCREEN_WIDTH,
    SCREEN_HEIGHT,
    getZoom,
    screenToWorld,
    worldToScreen,
    getWorldViewWidth,
    getWorldViewHeight,
} from './render/camera.js'

// Camera/zoom/screen helpers live in render/camera.ts per
// wiki/ts-split-refactor.md §16; re-exported here so existing import sites
// (`from './renderer.js'`) keep working.
export {
    SCREEN_WIDTH,
    SCREEN_HEIGHT,
    ZOOM_MIN,
    ZOOM_MAX,
    setScreenSize,
    getZoom,
    screenToWorld,
    worldToScreen,
    getWorldViewWidth,
    getWorldViewHeight,
    clampCameraPosition,
    centerCamera,
    MAP_WORLD_BOUNDS,
} from './render/camera.js'

// Abstract game renderer

// CE ref: tile.cc tile_fill_roof / roof_fill_off_process_task — flood-fill
// from the player's roof-grid position, collecting all contiguous non-empty
// roof tiles that form the same building section. The fill stops at 'grid000'
// (gap / no roof), isolating each structure exactly as CE does.
// Returns a Set of "x,y" keys for tiles that should NOT be rendered.
function roofFloodFill(roof: TileMap, startX: number, startY: number): Set<string> {
    const hidden = new Set<string>()
    const H = roof.length
    const W = roof[0]?.length ?? 0
    if (startX < 0 || startX >= W || startY < 0 || startY >= H) return hidden
    if (roof[startY][startX] === 'grid000') return hidden

    const stack: [number, number][] = [[startX, startY]]
    const visited = new Set<string>()
    while (stack.length > 0) {
        const [x, y] = stack.pop()!
        const key = `${x},${y}`
        if (visited.has(key)) continue
        visited.add(key)
        if (x < 0 || x >= W || y < 0 || y >= H) continue
        if (roof[y][x] === 'grid000') continue
        hidden.add(key)
        stack.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1])
    }
    return hidden
}

let _animLogLast = { art: '', frame: -1 }

export type TileMap = string[][]

interface ObjectRenderInfo {
    x: number
    y: number
    spriteX: number
    frameWidth: number
    frameHeight: number
    uniformFrameWidth: number
    uniformFrameHeight: number
    spriteFrameNum: number
    artInfo: any
    visible: boolean
}

export class Renderer {
    private windows: WindowFrame[] = []
    private objects: Obj[]
    roofTiles: TileMap
    floorTiles: TileMap
    fonts: Font[]

    initData(roof: TileMap, floor: TileMap, objects: Obj[]): void {
        this.roofTiles = roof
        this.floorTiles = floor
        this.objects = objects
    }

    clearTileCache(): void {}

    addWindow(window: WindowFrame) {
        this.windows.push(window)
    }

    render(): void {
        this.clear(127, 127, 127)

        if (globalState.isLoading) {
            this.color(0, 0, 0)
            const w = 256,
                h = 40
            const w2 = (globalState.loadingAssetsLoaded / globalState.loadingAssetsTotal) * w
            // draw a loading progress bar
            this.rectangle(SCREEN_WIDTH / 2 - w / 2, SCREEN_HEIGHT / 2, w, h, false)
            this.rectangle(SCREEN_WIDTH / 2 - w / 2 + 2, SCREEN_HEIGHT / 2 + 2, w2 - 4, h - 4)
            return
        }

        this.color(255, 255, 255)

        const mousePos = heart.mouse.getPosition()
        // Mouse picking works in world coordinates — undo zoom + camera.
        const mouseWorld = screenToWorld(mousePos[0], mousePos[1])
        const mouseHex = hexFromScreen(mouseWorld.x, mouseWorld.y)
        const mouseSquare = tileFromScreen(mouseWorld.x, mouseWorld.y)
        //var mouseTile = tileFromScreen(mousePos[0] + cameraX, mousePos[1] + cameraY)

        if (Config.ui.showFloor) {
            this.renderFloor(this.floorTiles)
        }

        // Beta egg mode: colored floor-hex overlay — verifies hex radius shape on
        // the game field without any wall transparency. Drawn on textCtx (the same
        // 2D canvas used for floating damage text) immediately after the floor so
        // objects render on top of it. No shader changes needed.
        if (Config.ui.eggMode === 'beta' && globalState.player) {
            const z = getZoom()
            const radius = Config.ui.eggRadius ?? 8
            const ctx = (this as any).textCtx as CanvasRenderingContext2D | undefined
            if (ctx) {
                ctx.save()
                ctx.fillStyle = 'rgba(0,255,0,0.3)'
                for (const pos of hexesInRadius(globalState.player.position, radius)) {
                    const scr = hexToScreen(pos.x, pos.y)
                    const s = worldToScreen(scr.x - 16, scr.y - 12)
                    // Flat-topped hex tile in isometric view: draw a simple filled rhombus
                    // whose corners match the four cardinal points of the 32×16 hex cell.
                    const w = 32 * z, h = 16 * z
                    ctx.beginPath()
                    ctx.moveTo(s.x + w / 2, s.y)          // top
                    ctx.lineTo(s.x + w,     s.y + h / 2)  // right
                    ctx.lineTo(s.x + w / 2, s.y + h)      // bottom
                    ctx.lineTo(s.x,         s.y + h / 2)  // left
                    ctx.closePath()
                    ctx.fill()
                }
                ctx.restore()
            }
        }
        if (Config.ui.showCursor && globalState.cursorMode === 'move') {
            // hex_outline is a world-anchored overlay — project its world
            // position through the zoom and scale the image dimensions too
            // so it lines up with the (zoomed) hex grid underneath.
            const z = getZoom()
            const hexImg = globalState.images['hex_outline']
            const hexW = hexImg?.naturalWidth ?? 32
            const hexH = hexImg?.naturalHeight ?? 16
            const scr = hexToScreen(mouseHex.x, mouseHex.y)
            const screen = worldToScreen(scr.x - 16, scr.y - 12)
            this.renderImage('hex_outline', screen.x, screen.y, hexW * z, hexH * z)
        }

        if (Config.ui.showObjects && this.objects) {
            this.renderObjects(this.objects)
        }
        if (Config.ui.showRoof) {
            // CE ref: object.cc:1462 tile_fill_roof(roofX, roofY, elev, false) —
            // hide only the connected roof section the player is standing under.
            let hideSet: Set<string> | null = null
            if (globalState.player) {
                const scr = hexToScreen(globalState.player.position.x, globalState.player.position.y)
                const own = tileFromScreen(scr.x, scr.y)   // = hexToTile(player); CE behavior
                hideSet = roofFloodFill(this.roofTiles, own.x, own.y)
                // Roofs draw 96px up, so the roof sprite that visually COVERS the
                // player when they stand behind (north of) a building belongs to a
                // tile ~2-3 squares south — the player's own tile is roofless there,
                // so CE's flood-from-own hides nothing and the character stays
                // occluded. Also flood from the roof tile at the player's screen
                // position shifted down by the roof offset so behind-building roofs
                // reveal the character. DH2 extension (setRoofPeek() to disable).
                if (Config.ui.roofPeek !== false) {
                    const cover = tileFromScreen(scr.x, scr.y + 96)
                    for (const k of roofFloodFill(this.roofTiles, cover.x, cover.y)) hideSet.add(k)
                }
            }
            this.renderRoof(this.roofTiles, hideSet)
        }

        // CE ref: object.cc:874 _obj_render_post_roof() — outlined objects
        // (combat target highlights, item-pickup highlight) are redrawn as a
        // flat silhouette here, after walls/roofs, so they stay visible
        // through occluding geometry instead of respecting normal z-order.
        if (Config.ui.showObjects && this.objects) {
            this.renderOutlinePass(this.objects)
        }

        for (const window of this.windows.filter((w) => w.showing)) {
            this.renderWindow(window)
        }

        if (Config.ui.showFonts) {
            let currentYOffset = 0
            for (const font of this.fonts) {
                this.renderFont(font, 0, currentYOffset)
                currentYOffset += font.height
            }
        }

        if (globalState.inCombat) {
            const whose = globalState.combat.inPlayerTurn
                ? 'player'
                : globalState.combat.combatants[globalState.combat.whoseTurn].name
            const AP = globalState.combat.inPlayerTurn
                ? globalState.player.AP
                : globalState.combat.combatants[globalState.combat.whoseTurn].AP
            this.renderText(
                '[turn ' + globalState.combat.turnNum + ' of ' + whose + ' AP: ' + AP.getAvailableMoveAP() + ']',
                SCREEN_WIDTH - 200,
                15
            )
        }

        if (Config.ui.showSpatials && Config.engine.doSpatials) {
            globalState.gMap.getSpatials().forEach((spatial) => {
                const scr = hexToScreen(spatial.position.x, spatial.position.y)
                //heart.graphics.draw(hexOverlay, scr.x - 16 - cameraX, scr.y - 12 - cameraY)
                const s = worldToScreen(scr.x - 10, scr.y - 3)
                this.renderText(spatial.script, s.x, s.y)
            })
        }

        this.renderText('x: ' + mouseHex.x, 5, 15)
        this.renderText('y: ' + mouseHex.y, 60, 15)
        const _hudTile = mouseHex.y * 200 + mouseHex.x
        const _hudLit = (_hudTile >= 0 && _hudTile < 40000) ? Lightmap.tile_intensity[_hudTile] : 0
        this.renderText('tile: ' + _hudTile, 115, 15)
        this.renderText('mt: ' + mouseSquare.x + ',' + mouseSquare.y, 225, 15)
        this.renderText('m: ' + mousePos[0] + ', ' + mousePos[1], 325, 15)
        this.renderText('lit: ' + _hudLit, 5, 30)

        //this.text("fps: " + heart.timer.getFPS(), SCREEN_WIDTH - 50, 15)

        // Group float messages by anchor object so stacked messages don't
        // overlap. CE ref: actions.cc _show_damage_to_object — textObjectAdd
        // queues vertically with collision avoidance.
        const stackIndex = new Map<any, number>()
        for (let i = 0; i < globalState.floatMessages.length; i++) {
            const fm = globalState.floatMessages[i]
            const bbox = objectBoundingBox(fm.obj)
            if (bbox === null) continue
            // Float messages are anchored to world objects but kept at a
            // fixed text size. Project their anchor through the zoom then
            // render with normal screen-space text.
            const anchor = worldToScreen(bbox.x + bbox.w / 2, bbox.y)
            const stack = stackIndex.get(fm.obj) ?? 0
            stackIndex.set(fm.obj, stack + 1)
            this.renderText(fm.msg, anchor.x, anchor.y - 16 - stack * 16, 'center', fm.color)
        }

        if (globalState.player.dead) {
            this.color(255, 0, 0, 50)
            this.rectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT)
        }

        // Render Fallout-authentic cursor overlay — must be last so it's never occluded
        {
            const rawX = mousePos[0]
            const rawY = mousePos[1]
            const PAD = Config.ui.scrollPadding
            const W = SCREEN_WIDTH
            const H = SCREEN_HEIGHT

            if (globalState.cursorMode === 'command') {
                const actarrowImg = globalState.images['art/intrface/actarrow']
                this.renderImage('art/intrface/actarrow', rawX, rawY, actarrowImg?.naturalWidth ?? 28, actarrowImg?.naturalHeight ?? 13)
                if (globalState.showLookCursor) {
                    const looknImg = globalState.images['art/intrface/lookn']
                    this.renderImage('art/intrface/lookn', rawX + 40, rawY, looknImg?.naturalWidth ?? 32, looknImg?.naturalHeight ?? 32)
                }
            } else if (globalState.cursorMode === 'attack') {
                // Fallout 2 attack crosshair cursor (acrshair); centered on the mouse hotspot
                const attackImg = globalState.images['art/intrface/acrshair']
                const w = attackImg?.naturalWidth ?? 32
                const h = attackImg?.naturalHeight ?? 32
                this.renderImage('art/intrface/acrshair', rawX - Math.floor(w / 2), rawY - Math.floor(h / 2), w, h)
            } else if (globalState.cursorMode === 'interface') {
                const stdarrowImg = globalState.images['art/intrface/stdarrow']
                this.renderImage('art/intrface/stdarrow', rawX, rawY, stdarrowImg?.naturalWidth ?? 14, stdarrowImg?.naturalHeight ?? 17)
            } else if (globalState.cursorMode === 'useSkill') {
                // FO2-CE ref: crossuse.frm — yellow crosshair for skill targeting
                const crossuseImg = globalState.images['art/intrface/crossuse']
                if (crossuseImg) {
                    const w = crossuseImg.naturalWidth
                    const h = crossuseImg.naturalHeight
                    // Centered on mouse hotspot
                    this.renderImage('art/intrface/crossuse', rawX - Math.floor(w / 2), rawY - Math.floor(h / 2), w, h)
                } else {
                    // Fallback to actarrow if crossuse not available
                    const fallbackImg = globalState.images['art/intrface/actarrow']
                    this.renderImage('art/intrface/actarrow', rawX, rawY, fallbackImg?.naturalWidth ?? 28, fallbackImg?.naturalHeight ?? 13)
                }
            } else if (globalState.cursorMode === 'scroll') {
                const goN = rawY <= PAD
                const goS = rawY >= H - PAD
                const goE = rawX >= W - PAD
                const goW = rawX <= PAD

                let scrollCursor = 'art/intrface/stdarrow'
                if (goN && goE) scrollCursor = 'art/intrface/scrneast'
                else if (goN && goW) scrollCursor = 'art/intrface/scrnwest'
                else if (goS && goE) scrollCursor = 'art/intrface/scrseast'
                else if (goS && goW) scrollCursor = 'art/intrface/scrswest'
                else if (goN) scrollCursor = 'art/intrface/scrnorth'
                else if (goS) scrollCursor = 'art/intrface/scrsouth'
                else if (goE) scrollCursor = 'art/intrface/screast'
                else if (goW) scrollCursor = 'art/intrface/scrwest'

                const scrollImg = globalState.images[scrollCursor]
                this.renderImage(scrollCursor, rawX, rawY, scrollImg?.naturalWidth ?? 32, scrollImg?.naturalHeight ?? 32)
            }
            // 'move' mode: hex_outline handles cursor rendering (snapped to hex grid)
        }
    }

    objectRenderInfo(obj: Obj): ObjectRenderInfo | null {
        const scr = hexToScreen(obj.position.x, obj.position.y)
        let visible = obj.visible

        if (globalState.images[obj.art] === undefined) {
            lazyLoadImage(obj.art) // try to load it in
            return null
        }

        const info = globalState.imageInfo[obj.art]
        if (info === undefined) {
            throw 'No image map info for: ' + obj.art
        }

        if (!(obj.orientation in info.frameOffsets)) {
            obj.orientation = 0
        } // ...
        const frameInfo = info.frameOffsets[obj.orientation][obj.frame]
        if (!frameInfo) {
            return null
        }
        const dirOffset = info.directionOffsets[obj.orientation]

        // Anchored from the bottom center
        let offsetX = -((frameInfo.w / 2) | 0) + dirOffset.x
        let offsetY = -frameInfo.h + dirOffset.y

        // CE ref: object.cc _obj_offset() — use accumulated per-frame delta when walking,
        // fall back to the FRM header anchor (ox/oy) for static or walk-start (shift=null) frames.
        // artOffset carries the visual continuity correction across FRM art transitions (see
        // Critter.staticAnimation / clearAnim for the formula; resets to {0,0} on walk end).
        if (obj.shift !== null) {
            offsetX += obj.shift.x
            offsetY += obj.shift.y
        } else {
            offsetX += frameInfo.ox + obj.artOffset.x
            offsetY += frameInfo.oy + obj.artOffset.y
        }

        if (obj === globalState.player &&
                (obj.art !== _animLogLast.art || obj.frame !== _animLogLast.frame)) {
            _animLogLast.art = obj.art
            _animLogLast.frame = obj.frame
            dbg('animation',
                `[Render] t=${performance.now().toFixed(1)}`,
                `art=${obj.art} f=${obj.frame}`,
                `frameOx=${frameInfo.ox} frameOy=${frameInfo.oy}`,
                `artOffset=(${obj.artOffset.x},${obj.artOffset.y})`,
                `offsetXY=(${offsetX},${offsetY})`,
                `wh=(${frameInfo.w},${frameInfo.h})`,
            )
        }

        const scrX = scr.x + offsetX,
            scrY = scr.y + offsetY

        // Culling is done in world coordinates against the zoom-expanded
        // view bounds — zooming out shows more of the map, zooming in less.
        const viewW = getWorldViewWidth()
        const viewH = getWorldViewHeight()
        if (
            scrX + frameInfo.w < globalState.cameraPosition.x ||
            scrY + frameInfo.h < globalState.cameraPosition.y ||
            scrX >= globalState.cameraPosition.x + viewW ||
            scrY >= globalState.cameraPosition.y + viewH
        ) {
            visible = false
        } // out of screen bounds, no need to draw

        const spriteFrameNum = info.numFrames * obj.orientation + obj.frame
        const sx = spriteFrameNum * info.frameWidth

        return {
            x: scrX,
            y: scrY,
            spriteX: sx,
            frameWidth: frameInfo.w,
            frameHeight: frameInfo.h,
            uniformFrameWidth: info.frameWidth,
            uniformFrameHeight: info.frameHeight,
            spriteFrameNum: spriteFrameNum,
            artInfo: info,
            visible: visible,
        }
    }

    renderObjects(objs: Obj[]) {
        // DH2-specific QoL sweep (no CE equivalent) — when held, all ground
        // items get a temporary outline so players can see what's pickable.
        // Distinct from Config.ui.itemHighlight (the real CE preference for
        // single-item mouse-hover highlighting — see input.ts mousemoved).
        const highlightItems = globalState.highlightItemsKeyHeld === true
        for (const obj of objs) {
            if (!Config.ui.showWalls && obj.type === 'wall') {
                continue
            }
            const wantTempOutline = highlightItems && obj.type === 'item' && !obj.outline
            if (wantTempOutline) {
                const prev = obj.outline
                obj.outline = 'yellow'
                this.renderObjectOutlined(obj)
                obj.outline = prev
            } else if (obj.outline) {
                this.renderObjectOutlined(obj)
            } else {
                this.renderObject(obj)
            }
        }
    }

    // stubs to be overriden
    init(): void {}

    clear(r: number, g: number, b: number): void {}
    color(r: number, g: number, b: number, a = 255): void {}
    rectangle(x: number, y: number, w: number, h: number, filled = true): void {}
    renderText(txt: string, x: number, y: number, align: CanvasTextAlign = 'left', color?: string): void {}
    renderImage(imgPath: string, x: number, y: number, width: number, height: number): void {}

    renderRoof(roof: TileMap, hideSet?: Set<string> | null): void {}
    renderFloor(floor: TileMap): void {}
    renderObjectOutlined(obj: Obj): void {
        this.renderObject(obj)
    }
    renderObject(obj: Obj): void {}
    renderOutlinePass(objs: Obj[]): void {}
    renderWindow(window: WindowFrame): void {
        this.renderImage(window.background, window.position.x, window.position.y, window.width, window.height)
    }
    renderFont(font: Font, x: number, y: number) {}
}

export function objectOnScreen(obj: Obj): boolean {
    const bbox = objectBoundingBox(obj)
    if (bbox === null) {
        return false
    }

    const viewW = getWorldViewWidth()
    const viewH = getWorldViewHeight()
    if (
        bbox.x + bbox.w < globalState.cameraPosition.x ||
        bbox.y + bbox.h < globalState.cameraPosition.y ||
        bbox.x >= globalState.cameraPosition.x + viewW ||
        bbox.y >= globalState.cameraPosition.y + viewH
    ) {
        return false
    }
    return true
}

export function objectTransparentAt(obj: Obj, position: Point) {
    const frame = obj.frame !== undefined ? obj.frame : 0
    const sx = globalState.imageInfo[obj.art].frameOffsets[obj.orientation][frame].sx

    if (!globalState.tempCanvasCtx) {
        throw Error()
    }

    globalState.tempCanvasCtx.clearRect(0, 0, 1, 1) // clear previous color
    globalState.tempCanvasCtx.drawImage(globalState.images[obj.art], sx + position.x, position.y, 1, 1, 0, 0, 1, 1)
    const pixelAlpha = globalState.tempCanvasCtx.getImageData(0, 0, 1, 1).data[3]

    return pixelAlpha === 0
}

// get an object's bounding box in screen-space (note: not camera-space)
export function objectBoundingBox(obj: Obj): BoundingBox | null {
    const scr = hexToScreen(obj.position.x, obj.position.y)

    if (globalState.images[obj.art] === undefined) {
        // no art
        return null
    }

    const info = globalState.imageInfo[obj.art]
    if (info === undefined) {
        throw 'No image map info for: ' + obj.art
    }

    let frameIdx = 0
    if (obj.frame !== undefined) {
        frameIdx += obj.frame
    }

    if (!(obj.orientation in info.frameOffsets)) {
        obj.orientation = 0
    } // ...
    const frameInfo = info.frameOffsets[obj.orientation][frameIdx]
    if (!frameInfo) {
        return null
    }
    const dirOffset = info.directionOffsets[obj.orientation]
    const offsetX = Math.floor(frameInfo.w / 2) - dirOffset.x - frameInfo.ox - obj.artOffset.x
    const offsetY = frameInfo.h - dirOffset.y - frameInfo.oy - obj.artOffset.y

    return { x: scr.x - offsetX, y: scr.y - offsetY, w: frameInfo.w, h: frameInfo.h }
}

export function getObjectUnderCursor(p: (obj: Obj) => boolean) {
    const mouse = heart.mouse.getPosition()
    // Undo zoom before applying camera so that object bboxes (which are
    // in world coordinates) are hit-tested in the same space.
    const mousePosition = screenToWorld(mouse[0], mouse[1])

    // reverse z-ordered search
    const objects = globalState.gMap.getObjects()
    for (let i = objects.length - 1; i > 0; i--) {
        const bbox = objectBoundingBox(objects[i])
        if (bbox === null) {
            continue
        }
        if (pointInBoundingBox(mousePosition, bbox)) {
            if (p === undefined || p(objects[i]) === true) {
                const mouseRel = { x: mousePosition.x - bbox.x, y: mousePosition.y - bbox.y }
                if (!objectTransparentAt(objects[i], mouseRel)) {
                    return objects[i]
                }
            }
        }
    }

    return null
}
