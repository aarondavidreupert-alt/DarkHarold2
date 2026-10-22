// sfall ini settings — a port of fallout2-ce sfall_ini.cc (sfall_ini_get_int /
// sfall_ini_get_string) for get_ini_setting (sfall 0x81AC). A setting is named
// "file|section|key", the file relative to the game folder (the Unofficial Patch asks
// "mods\upu.ini|main|wipe_inventory"). The asset pipeline copies the install's
// ddraw.ini and mods/*.ini into data/ (tools/setup.py copy_install_inis), so the file is
// read from data/<file>. Files are read once per page load.

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

/** CE sfall_ini_get_string: the setting's text; '' for a missing file, section or key;
 *  null when `triplet` is not "file|section|key". */
export function sfallIniGetString(triplet: string): string | null {
    const parts = String(triplet ?? '').split('|')
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
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
