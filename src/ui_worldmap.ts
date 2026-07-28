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

// World map: travel-screen overlay (worldmap canvas + per-area entrance
// view), plus the area label list down the right side.

import globalState from './globalState.js'
import { Area, loadAreas, lookupMapNameFromLookup } from './data.js'
import { Worldmap } from './worldmap.js'
import { UIMode } from './ui_panels.js'
import { $id, clearEl, show, hide, showv, hidev, appendHTML, makeEl } from './ui_dom.js'
import { dbg } from './logger.js'

// CE ref: worldmap.cc — label list visible height ~182px, each tab 27px.
// tabsBackgroundFrmImage.getHeight()=480, max scroll = 480-230=250, but we
// clamp dynamically to (labelCount*27 - visibleHeight).
const LABEL_STEP_PX = 27
const LABEL_VISIBLE_H = 182
let _labelScrollY = 0

function setLabelScroll(y: number): void {
    const outer = document.getElementById('worldMapLabels')
    if (!outer) return
    const inner = document.getElementById('worldMapLabelsInner')
    const labelCount = inner ? inner.querySelectorAll('.worldMapLabel').length : 0
    const maxScroll = Math.max(0, labelCount * LABEL_STEP_PX - LABEL_VISIBLE_H)
    _labelScrollY = Math.max(0, Math.min(y, maxScroll))
    outer.scrollTop = _labelScrollY
    // Sync background so wmtabs.png slot decorations stay aligned with labels.
    // CE ref: wmRefreshTabs reblits wmtabs.png starting at tabsScrollOffset.
    outer.style.backgroundPositionY = (-27 - _labelScrollY) + 'px'
}

// --- World map -------------------------------------------------------------

export function uiCloseWorldMap() {
    globalState.uiMode = UIMode.none

    hide($id('worldMapContainer'))
    hidev($id('areamap'))
    hidev($id('worldmap'))

    Worldmap.stop()
}

export function uiWorldMap(onAreaMap = false) {
    globalState.uiMode = UIMode.worldMap
    show($id('worldMapContainer'))

    if (!globalState.mapAreas) {
        globalState.mapAreas = loadAreas()
    }

    if (onAreaMap) {
        uiWorldMapAreaView()
    } else {
        uiWorldMapWorldView()
    }
    uiWorldMapLabels()

    // CE ref: worldmap.cc WM_TOWN_WORLD_SWITCH — toggle area/world view
    const viewBtn = document.getElementById('worldmapViewButton')
    if (viewBtn) {
        viewBtn.onclick = () => {
            const areaSel = document.getElementById('areamap')
            const onArea = areaSel && areaSel.style.visibility !== 'hidden' && areaSel.style.display !== 'none'
            if (onArea) {
                uiWorldMapWorldView()
            } else {
                const pos = Worldmap.getWorldmapPlayer()
                const area = pos ? Worldmap.withinArea(pos) : null
                if (area) uiWorldMapShowArea(area)
            }
        }
    }

    // CE ref: worldmap.cc WM_TOWN_LIST_SCROLL_UP/DOWN — scroll label list
    const upBtn = document.getElementById('wmLabelScrollUp')
    const dnBtn = document.getElementById('wmLabelScrollDown')
    if (upBtn) upBtn.onclick = () => setLabelScroll(_labelScrollY - LABEL_STEP_PX)
    if (dnBtn) dnBtn.onclick = () => setLabelScroll(_labelScrollY + LABEL_STEP_PX)
}

function uiWorldMapAreaView() {
    hidev($id('worldmap'))
    showv($id('areamap'))

    Worldmap.stop()
}

function uiWorldMapWorldView() {
    showv($id('worldmap'))
    hidev($id('areamap'))

    Worldmap.start()
}

export function uiWorldMapShowArea(area: Area) {
    uiWorldMapAreaView()

    const $areamap = $id('areamap')
    $areamap.style.backgroundImage = `url('${area.mapArt}.png')`
    clearEl($areamap)

    // CE ref: worldmap.cc wmTownMapDraw — skips entrances whose state was set to 0
    // by script (metarule3 104). DH2 defaults all entrances to state=true; scripts
    // can still explicitly hide them. TODO: re-enable strict filter once map-open
    // scripts reliably run.
    const active = area.entrances.filter(e => e.state)

    // Entrances with x=0,y=0 in city.txt have no assigned position; after
    // subtracting the WM_VIEW offset (22,21) they'd land at/below (0,0) and
    // cluster in the top-left corner. Split and auto-distribute those.
    const WM_VIEW_X = 22
    const WM_VIEW_Y = 21
    const positioned = active.filter(e => e.x - WM_VIEW_X > 5 || e.y - WM_VIEW_Y > 5)
    const orphaned   = active.filter(e => e.x - WM_VIEW_X <= 5 && e.y - WM_VIEW_Y <= 5)

    function makeEntrance(entrance: typeof area.entrances[0], left: number, top: number): void {
        dbg('worldmap', '[Worldmap] area entrance:', entrance.mapLookupName, `@ (${left}, ${top})`)
        const $entranceEl = makeEl('div', { classes: ['worldmapEntrance'] })
        const $hotspot = makeEl('div', { classes: ['worldmapEntranceHotspot'] })

        $hotspot.onclick = () => {
            const mapName = lookupMapNameFromLookup(entrance.mapLookupName)
            dbg('worldmap', `[Worldmap] hotspot → ${mapName} (via ${entrance.mapLookupName})`)
            globalState.gMap.loadMap(mapName, undefined, entrance.elevation)
            uiCloseWorldMap()
        }

        $entranceEl.appendChild($hotspot)
        appendHTML($entranceEl, entrance.mapLookupName)
        $entranceEl.style.left = left + 'px'
        $entranceEl.style.top  = top + 'px'
        $areamap.appendChild($entranceEl)
    }

    for (const entrance of positioned) {
        // CE ref: worldmap.cc wmTownMapInit() — buttonCreate() places hotspots at
        // (entrance.x, entrance.y) in the 640×480 window frame, but the town FRM is
        // blitted at (WM_VIEW_X=22, WM_VIEW_Y=21). Subtract that offset so the hotspot
        // aligns with its rendered position on the FRM background image.
        makeEntrance(entrance, entrance.x - WM_VIEW_X, entrance.y - WM_VIEW_Y)
    }

    // Auto-distribute orphaned entrances (no valid city.txt coordinates) in a
    // horizontal row below the FRM background image, 3 per row × 150px columns.
    const ORPHAN_START_Y = 195
    const ORPHAN_COL_W   = 150
    const ORPHAN_ROW_H   = 30
    const COLS_PER_ROW   = 3
    for (let i = 0; i < orphaned.length; i++) {
        const col = i % COLS_PER_ROW
        const row = Math.floor(i / COLS_PER_ROW)
        makeEntrance(orphaned[i], 10 + col * ORPHAN_COL_W, ORPHAN_START_Y + row * ORPHAN_ROW_H)
    }
}

function uiWorldMapLabels() {
    _labelScrollY = 0
    const outer = $id('worldMapLabels')
    outer.scrollTop = 0
    outer.style.backgroundPositionY = '-27px'
    outer.innerHTML = "<div id='worldMapLabelsInner'></div>"
    const inner = $id('worldMapLabelsInner')

    // CE ref: worldmap.cc wmMakeTabsLabelList — areas with labelFid != -1, sorted
    // alphabetically. Sub-areas and encounter tables (id > 20) are excluded; those
    // are Destroyed Arroyo (22) and Raiders (25) which share Arroyo's label art.
    const areas = Object.values(globalState.mapAreas)
        .filter(a => a.id <= 20 && !!a.labelArt)
        .sort((a, b) => a.name.localeCompare(b.name))

    for (const area of areas) {
        const label = makeEl('img', { classes: ['worldMapLabelImage'], src: area.labelArt + '.png' })
        const labelButton = makeEl('div', {
            classes: ['worldMapLabelButton'],
            click: () => { uiWorldMapShowArea(area) },
        })
        const areaLabel = makeEl('div', {
            classes: ['worldMapLabel'],
            children: [label, labelButton],
        })
        inner.appendChild(areaLabel)
    }
}
