// Fetch what loading a map reads synchronously — its JSON, image list, map variables and the
// scripts of the map, its spatials and its objects — before GameMap.loadMap runs, so the load
// finds them in memory (fileCache.ts) instead of blocking on one request per file
// (wiki/code_quality.md Q13). loadMap itself is unchanged and still works without it.

import { Config } from '../config.js'
import { lookupScriptName } from '../data.js'
import { dbg } from '../logger.js'
import { loadPRO } from '../pro.js'
import { getFileJSON, prefetchAssets } from '../util.js'

/** The parts of a map JSON object (tools/fomap.py) that name its script. */
interface MapObjectJSON {
    pid: number
    pidID: number
    script?: string
    inventory?: MapObjectJSON[]
}
interface MapJSON {
    levels?: { objects?: MapObjectJSON[]; spatials?: { script?: string }[] }[]
}

/** The file a script's name loads from on the running backend (scripting.ts loadScript /
 *  loadLuaScript). */
function scriptFile(name: string): string {
    return `data/scripts/${name.toLowerCase()}.${Config.scripting.backend === 'lua' ? 'lua' : 'int'}`
}

/** The script of a map object as Obj.loadScript finds it: its own, else its proto's. */
function objectScriptName(mobj: MapObjectJSON): string | null {
    if (mobj.script) {
        return mobj.script
    }
    const pro = loadPRO(mobj.pid, mobj.pidID)
    const sid = pro?.extra?.scriptPID ?? pro?.extra?.scriptID ?? -1
    if (sid < 0) {
        return null
    }
    try {
        return lookupScriptName((sid & 0xffff) + 1)
    } catch {
        return null
    }
}

export async function prefetchMap(mapName: string): Promise<void> {
    const started = performance.now()
    await prefetchAssets([
        'maps/' + mapName + '.json',
        'maps/' + mapName + '.images.json',
        'data/maps/' + mapName.toLowerCase() + '.mvars.json',
        scriptFile(mapName),
    ])
    let map: MapJSON
    try {
        map = getFileJSON('maps/' + mapName + '.json')
    } catch {
        return // loadMap reports it
    }
    const names = new Set<string>()
    const visit = (mobj: MapObjectJSON) => {
        const name = objectScriptName(mobj)
        if (name) {
            names.add(name)
        }
        for (const item of mobj.inventory ?? []) {
            visit(item)
        }
    }
    for (const level of map.levels ?? []) {
        for (const mobj of level.objects ?? []) {
            visit(mobj)
        }
        for (const spatial of level.spatials ?? []) {
            if (spatial.script) {
                names.add(spatial.script)
            }
        }
    }
    await prefetchAssets([...names].map(scriptFile))
    dbg('map', `[prefetch] ${mapName}: ${names.size} scripts in ${Math.round(performance.now() - started)} ms`)
}
