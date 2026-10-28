// Mod asset overlay — a DH2 addition modelled on sfall's mods/ load order (sfall
// LoadOrder.cpp: mods_order.txt top to bottom, a later line taking priority; CE itself
// only reads master.dat, critter.dat and patchXXX.dat).
//
// A mod is a folder mods/<name>/ that mirrors the project layout (art/**.png,
// proto/, maps/, data/scripts/*.int|.lua, data/text/**.msg, audio/, lut/ …) with a
// manifest.json listing the files it has. tools/setup.py's build_mods stage converts
// an install's mods/*.dat (the Unofficial Patch) into such a folder; a hand-written
// Lua mod needs no manifest (mods/<name>/scripts/<script>.lua, see
// scripting.ts loadLuaScript). The vanilla files under the project root are never
// changed, so switching a mod off is a line in mods/mods_order.txt.
//
// Every asset load asks assetUrl(path) for the file to fetch: the highest-priority
// active mod whose manifest lists the path, else the path itself. Two files are not
// replaced but merged, because they index every image / proto of the game and a mod
// only lists its own: art/imageMap.json and proto/pro.json (mergeModJSON). Stylesheet
// rules that use an overridden image are rewritten once at start (overrideStylesheets).
// See wiki/upu_support.md → "Mod folders".

import { dbg, dbgWarn } from './logger.js'

/** mods/<name>/manifest.json */
interface ModManifest {
    name?: string
    source?: string // what the pipeline built it from, e.g. "mods/upu.dat"
    files: string[] // paths relative to the mod folder (= the project path it overrides)
    merge?: string[] // files merged into the vanilla one instead of replacing it
}

interface ModLayer {
    name: string
    files: Map<string, string> // lower-case path -> the path as the manifest spells it
    merge: Map<string, string>
}

/** active mods, lowest priority first */
let layers: ModLayer[] = []

/** files merged rather than replaced (mergeModJSON) */
export const MERGED_FILES = ['art/imageMap.json', 'proto/pro.json']

function normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
}

/** Reads mods/<name>/manifest.json for every active mod (Config.scripting.mods, load
 *  order). A mod without a manifest adds no assets (a Lua-only mod). main.ts awaits it
 *  before any asset loads. */
export async function initModAssets(mods: string[]): Promise<void> {
    layers = []
    // fetched together, applied in load order
    const manifests = await Promise.all(
        mods.map(async (name): Promise<ModManifest | null> => {
            try {
                const response = await fetch(`mods/${name}/manifest.json`)
                return response.status === 200 ? JSON.parse(await response.text()) : null
            } catch (e) {
                dbgWarn('load', `mods/${name}/manifest.json: ${e}`)
                return null
            }
        }),
    )
    for (const [i, name] of mods.entries()) {
        const manifest = manifests[i]
        if (!manifest || !Array.isArray(manifest.files)) {
            dbg('load', `mod ${name}: no manifest (scripts only)`)
            continue
        }
        layers.push({
            name,
            files: new Map(manifest.files.map((f) => [normalize(f), f.replace(/\\/g, '/')])),
            merge: new Map((manifest.merge ?? []).map((f) => [normalize(f), f.replace(/\\/g, '/')])),
        })
        dbg('load', `mod ${name}: ${manifest.files.length} files${manifest.source ? ' from ' + manifest.source : ''}`)
    }
}

/** The active mods that have asset folders, lowest priority first. */
export function activeAssetMods(): string[] {
    return layers.map((l) => l.name)
}

/** The paths the active mods have that match `pattern` (lower case, each once). */
export function assetFiles(pattern: RegExp): string[] {
    const out = new Set<string>()
    for (const l of layers) for (const key of l.files.keys()) if (pattern.test(key)) out.add(key)
    return Array.from(out)
}

/** Which layer provides `path`: the index of the mod in activeAssetMods(), or -1 for the
 *  vanilla file. */
export function assetLayer(path: string): number {
    if (layers.length === 0) return -1
    const key = normalize(path.split('?')[0])
    for (let i = layers.length - 1; i >= 0; i--) if (layers[i].files.has(key)) return i
    return -1
}

// The version of the art/ files: the image map's Last-Modified + size (main.ts sets it at boot).
// It goes on every art/ URL, so a pipeline re-export changes them all and the browser cannot
// combine a cached old sprite sheet with the new image map: `python -m http.server` sends no
// cache headers, and the browser reuses a cached file for a while without asking (known_bugs
// CA50). Between re-exports the URLs stay the same, so the files are cached as before.
let artVersion = ''

export function setArtVersion(stamp: string): void {
    artVersion = stamp ? encodeURIComponent(stamp) : ''
}

/** The URL to load for a project asset path: mods/<mod>/<path> when an active mod
 *  overrides it, else `path` unchanged (also for data:, blob: and empty URLs). A query
 *  string is kept; an art/ file without one gets the art version (setArtVersion). */
export function assetUrl(path: string): string {
    if (!path || /^[a-z]+:/i.test(path)) {
        return path
    }
    const url = modUrl(path)
    return artVersion && /^art\//i.test(path) && !path.includes('?') ? `${url}?v=${artVersion}` : url
}

function modUrl(path: string): string {
    if (layers.length === 0) {
        return path
    }
    const q = path.indexOf('?')
    const file = q < 0 ? path : path.slice(0, q)
    const i = assetLayer(file)
    if (i < 0) return path
    return `mods/${layers[i].name}/${layers[i].files.get(normalize(file))}${q < 0 ? '' : path.slice(q)}`
}

/** The mod copies of a merged file (MERGED_FILES), lowest priority first. */
export function modMergeUrls(path: string): string[] {
    const key = normalize(path)
    return layers.filter((l) => l.merge.has(key)).map((l) => `mods/${l.name}/${l.merge.get(key)}`)
}

/** Merges the active mods' copies of a merged file into the vanilla value: for
 *  art/imageMap.json image name -> info, for proto/pro.json type -> id -> proto; a
 *  later mod wins. `load` reads one JSON file. */
export function mergeModJSON(path: string, value: any, load: (url: string) => any): any {
    for (const url of modMergeUrls(path)) {
        let mod: any
        try {
            mod = load(url)
        } catch (e) {
            dbgWarn('load', `${url}: ${e}`)
            continue
        }
        if (!mod || typeof mod !== 'object') continue
        const twoLevels = normalize(path) === 'proto/pro.json'
        for (const k of Object.keys(mod)) {
            if (twoLevels && value[k] && typeof value[k] === 'object') Object.assign(value[k], mod[k])
            else value[k] = mod[k]
        }
        dbg('load', `${url}: merged ${Object.keys(mod).length} entries`)
    }
    return value
}

/** Rewrites the page's stylesheet rules whose url(...) names a file an active mod
 *  overrides (ui.css's interface art), so CSS-drawn interface pieces use the mod's
 *  image too. Same-origin sheets only. */
export function overrideStylesheets(): void {
    if (layers.length === 0 && !artVersion) {
        return // nothing to rewrite: no mod copies, no art version
    }
    let changed = 0
    const fix = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
            if ((rule as CSSGroupingRule).cssRules) fix((rule as CSSGroupingRule).cssRules)
            const style = (rule as CSSStyleRule).style
            if (!style) continue
            for (let i = 0; i < style.length; i++) {
                const prop = style[i]
                const value = style.getPropertyValue(prop)
                if (!value.includes('url(')) continue
                const next = value.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, quote, url) => {
                    // a sheet's url() is resolved against the sheet; ui.css is at the root
                    const rel = url.replace(/^(\.\/)+/, '').replace(new RegExp('^' + location.origin + '/'), '')
                    const to = assetUrl(rel)
                    return to === rel ? m : `url(${quote}${to}${quote})`
                })
                if (next !== value) {
                    style.setProperty(prop, next, style.getPropertyPriority(prop))
                    changed++
                }
            }
        }
    }
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            fix(sheet.cssRules)
        } catch (_) {
            // a cross-origin sheet (web fonts): not ours
        }
    }
    if (changed) dbg('load', `mod assets: ${changed} stylesheet images overridden`)
}
