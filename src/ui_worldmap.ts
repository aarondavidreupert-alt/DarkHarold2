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

    for (const entrance of area.entrances) {
        console.log('[Worldmap] area entrance: ' + entrance.mapLookupName)
        const $entranceEl = makeEl('div', { classes: ['worldmapEntrance'] })
        const $hotspot = makeEl('div', { classes: ['worldmapEntranceHotspot'] })

        $hotspot.onclick = () => {
            // hotspot click -- travel to relevant map
            const mapName = lookupMapNameFromLookup(entrance.mapLookupName)
            console.log(`[Worldmap] hotspot → ${mapName} (via ${entrance.mapLookupName})`)
            globalState.gMap.loadMap(mapName, undefined, entrance.elevation)
            uiCloseWorldMap()
        }

        $entranceEl.appendChild($hotspot)
        appendHTML($entranceEl, entrance.mapLookupName)
        $entranceEl.style.left = entrance.x + 'px'
        $entranceEl.style.top = entrance.y + 'px'
        $id('areamap').appendChild($entranceEl)
    }
}

function uiWorldMapLabels() {
    $id('worldMapLabels').innerHTML = "<div id='worldMapLabelsBackground'></div>"

    let i = 0
    for (const areaID in globalState.mapAreas) {
        const area = globalState.mapAreas[areaID]
        if (!area.labelArt) {
            continue
        }

        const label = makeEl('img', { classes: ['worldMapLabelImage'], src: area.labelArt + '.png' })
        const labelButton = makeEl('div', {
            classes: ['worldMapLabelButton'],
            click: () => {
                uiWorldMapShowArea(globalState.mapAreas[areaID])
            },
        })

        const areaLabel = makeEl('div', {
            classes: ['worldMapLabel'],
            style: { top: 1 + i * 27 + 'px' },
            children: [label, labelButton],
        })
        $id('worldMapLabels').appendChild(areaLabel)
        i++
    }
}
