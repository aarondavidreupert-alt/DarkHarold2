// sfall ini settings — a port of fallout2-ce sfall_ini.cc (sfall_ini_get_int /
// sfall_ini_get_string) for get_ini_setting (sfall 0x81AC). A setting is named
// "file|section|key", the file relative to the game folder (the Unofficial Patch asks
// "mods\upu.ini|main|wipe_inventory"). The asset pipeline copies the install's
// ddraw.ini into data/ and a mod's mods/<mod>.ini into its mod folder
// (mods/<mod>/data/mods/<mod>.ini, tools/setup.py build_mods), so the file is read as
// data/<file> through the mod asset overlay (modAssets.ts). Files are read once per
// page load.

import { getFileText, parseIni } from './util.js'

const cache = new Map<string, { [section: string]: { [key: string]: string } } | null>()

function readIni(file: string): { [section: string]: { [key: string]: string } } | null {
    const path = 'data/' + file.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!cache.has(path)) {
        let ini = null
        try {
            const parsed = parseIni(getFileText(path))
            // section / key names case-insensitively, as CE's config reader matches them
            ini = {} as { [section: string]: { [key: string]: string } }
            for (const sec in parsed) {
                const s: { [key: string]: string } = {}
                for (const k in parsed[sec]) s[k.toLowerCase()] = String(parsed[sec][k])
                ini[sec.toLowerCase()] = s
            }
        } catch (_) {
            ini = null
        }
        cache.set(path, ini)
    }
    return cache.get(path) ?? null
}

// CE sfall_ini.cc parse_ini_triplet: file and section end at the first two '|'; the key is
// the rest, '|' included. null when there are fewer than two separators.
function parseIniTriplet(triplet: string): [string, string, string] | null {
    const s = String(triplet ?? '')
    const a = s.indexOf('|')
    if (a < 0) return null
    const b = s.indexOf('|', a + 1)
    if (b < 0) return null
    return [s.slice(0, a), s.slice(a + 1, b), s.slice(b + 1)]
}

/** CE sfall_ini_get_string: the setting's text; '' for a missing file, section or key;
 *  null when `triplet` is not "file|section|key". */
export function sfallIniGetString(triplet: string): string | null {
    const parts = parseIniTriplet(triplet)
    if (!parts || !parts[0] || !parts[1] || !parts[2]) return null
    const ini = readIni(parts[0])
    return ini?.[parts[1].toLowerCase()]?.[parts[2].toLowerCase()] ?? ''
}

/** CE op_get_ini_setting → sfall_ini_get_int: atol() of the setting (0 when it is missing),
 *  -1 only when the name cannot be parsed. */
export function sfallIniGetInt(triplet: string): number {
    const text = sfallIniGetString(triplet)
    if (text === null) return -1
    const n = parseInt(text.trim(), 10)
    return Number.isFinite(n) ? n | 0 : 0
}

/** sfall set_ini_setting (sfall_func2 "set_ini_setting"; sfall IniFiles.cpp writes the
 *  file): DH2 cannot write the install's files, so the value holds for this page load
 *  only (as fallout2.cfg changes live in localStorage, not in the file). */
export function sfallIniSet(triplet: string, value: any): void {
    const parts = parseIniTriplet(triplet)
    if (!parts || !parts[0] || !parts[1] || !parts[2]) return
    const path = 'data/' + parts[0].replace(/\\/g, '/').replace(/^\/+/, '')
    readIni(parts[0])
    const ini = cache.get(path) ?? {}
    const section = (ini[parts[1].toLowerCase()] ??= {})
    section[parts[2].toLowerCase()] = String(value)
    cache.set(path, ini)
}
