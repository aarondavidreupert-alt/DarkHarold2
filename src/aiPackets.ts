/*
AI Packet system — parse data/data/ai.txt into typed AiPacket records.

Intentionally has NO imports from the game module tree to avoid circular
dependency chains (util → object → combat → aiPackets → util).
*/

// ── String union types ────────────────────────────────────────────────────────

export type Disposition = 'aggressive' | 'berserk' | 'coward' | 'none' | 'custom'
export type AttackWho = 'closest' | 'strongest' | 'weakest' | 'whomever' | 'whomever_attacking_me'
export type BestWeapon = 'melee' | 'ranged' | 'unarmed' | 'melee_over_ranged' | 'random' | 'never'
export type AreaAttackMode = 'no_pref' | 'be_careful' | 'be_sure' | 'be_absolutely_sure' | 'sometimes'
export type DistanceMode = 'charge' | 'snipe' | 'stay' | 'on_your_own' | 'random'
export type RunAwayMode = 'never' | 'none' | 'bleeding' | 'finger_hurts' | 'not_feeling_good' | 'coward'
export type ChemUse = 'clean' | 'anytime' | 'stims_when_hurt_little' | 'stims_when_hurt_lots' | 'sometimes'

// ── AiPacket interface ────────────────────────────────────────────────────────

export interface AiPacket {
    packetNum: number
    name: string
    aggression: number
    disposition: Disposition
    attackWho: AttackWho
    bestWeapon: BestWeapon
    areaAttackMode: AreaAttackMode
    distance: DistanceMode
    runAwayMode: RunAwayMode
    hurtTooMuch: string[]       // e.g. ['crippled', 'blind']
    minHp: number               // flee when HP% drops to or below this
    minToHit: number            // skip attack if hit chance < this
    maxDist: number             // max pursuit hex distance
    calledFreq: number
    secondaryFreq: number
    chance: number              // taunt roll %
    chemUse: ChemUse
    chemPrimaryDesire: number[] // PIDs; -1 entries filtered out
}

// ── Numeric → string maps (fallout2-ce ai.h enum order) ──────────────────────

const DISPOSITION_MAP: Disposition[]      = ['none', 'custom', 'berserk', 'aggressive', 'coward']
// FO2: 0=whomever 1=closest 2=weakest 3=strongest 4=which_side_most_hurt 5=whoever_attacking_me
const ATTACK_WHO_MAP: AttackWho[]         = ['whomever', 'closest', 'weakest', 'strongest', 'closest', 'whomever_attacking_me']
// FO2: 0=no_pref 1=melee 2=melee_over_ranged 3=ranged 4=ranged_over_melee 5=unarmed 6=random 7=never
const BEST_WEAPON_MAP: BestWeapon[]       = ['melee', 'melee', 'melee_over_ranged', 'ranged', 'ranged', 'unarmed', 'random', 'never']
const AREA_ATTACK_MODE_MAP: AreaAttackMode[] = ['no_pref', 'be_careful', 'be_sure', 'be_absolutely_sure', 'sometimes']
// FO2: 0=on_your_own 1=charge 2=snipe 3=stay 4=random
const DISTANCE_MAP: DistanceMode[]        = ['on_your_own', 'charge', 'snipe', 'stay', 'random']
// FO2 stored as -1…4; we normalise -1→'never', 0→'none', 1–4 follow
const RUN_AWAY_MODE_MAP: RunAwayMode[]    = ['never', 'none', 'bleeding', 'finger_hurts', 'not_feeling_good', 'coward']
// FO2: 0=clean 1=stims_when_hurt_little 2=stims_when_hurt_lots 3=sometimes 4=anytime
const CHEM_USE_MAP: ChemUse[]             = ['clean', 'stims_when_hurt_little', 'stims_when_hurt_lots', 'sometimes', 'anytime']

// ── Valid string sets ─────────────────────────────────────────────────────────

const DISPOSITIONS: ReadonlySet<string>      = new Set<Disposition>(['aggressive', 'berserk', 'coward', 'none', 'custom'])
const ATTACK_WHOS: ReadonlySet<string>       = new Set<AttackWho>(['closest', 'strongest', 'weakest', 'whomever', 'whomever_attacking_me'])
const BEST_WEAPONS: ReadonlySet<string>      = new Set<BestWeapon>(['melee', 'ranged', 'unarmed', 'melee_over_ranged', 'random', 'never'])
const AREA_ATTACK_MODES: ReadonlySet<string> = new Set<AreaAttackMode>(['no_pref', 'be_careful', 'be_sure', 'be_absolutely_sure', 'sometimes'])
const DISTANCE_MODES: ReadonlySet<string>    = new Set<DistanceMode>(['charge', 'snipe', 'stay', 'on_your_own', 'random'])
const RUN_AWAY_MODES: ReadonlySet<string>    = new Set<RunAwayMode>(['never', 'none', 'bleeding', 'finger_hurts', 'not_feeling_good', 'coward'])
const CHEM_USES: ReadonlySet<string>         = new Set<ChemUse>(['clean', 'anytime', 'stims_when_hurt_little', 'stims_when_hurt_lots', 'sometimes'])

// ── Parsing helpers ───────────────────────────────────────────────────────────

function parseEnum<T extends string>(
    raw: string | undefined,
    validSet: ReadonlySet<string>,
    numericMap: T[],
    fallback: T
): T {
    if (!raw || raw === '') return fallback
    const lower = raw.toLowerCase().trim()
    if (validSet.has(lower)) return lower as T
    // Try numeric code (handles both positive and -1 for run_away_mode)
    const n = parseInt(raw, 10)
    if (!isNaN(n)) {
        const idx = n < 0 ? 0 : n                   // -1 → index 0 for run_away_mode='never'
        if (idx >= 0 && idx < numericMap.length) return numericMap[idx]
    }
    return fallback
}

function parseIntField(raw: string | undefined, fallback: number): number {
    if (!raw || raw === '') return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) ? fallback : n
}

function parseStringList(raw: string | undefined): string[] {
    if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'none') return []
    return raw.split(',').map(s => s.trim()).filter(s => s !== '')
}

function parseIntList(raw: string | undefined): number[] {
    return parseStringList(raw)
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n) && n !== -1)
}

// ── Standalone file loader & INI parser (no game module imports) ──────────────

function loadText(path: string): string {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', path, false)
    xhr.send(null)
    if (xhr.status !== 200)
        throw new Error(`[aiPackets] HTTP ${xhr.status} loading '${path}'`)
    return xhr.responseText
}

function parseIniText(text: string): Record<string, Record<string, string>> {
    const ini: Record<string, Record<string, string>> = {}
    let section: string | null = null
    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/\r$/, '').replace(/\s*;.*/, '')
        if (line.trim() === '') continue
        if (line[0] === '[') {
            section = line.trim().slice(1, -1)
            continue
        }
        const eq = line.indexOf('=')
        if (eq === -1 || section === null) continue
        if (!ini[section]) ini[section] = {}
        ini[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
    }
    return ini
}

// ── Packet construction ───────────────────────────────────────────────────────

function buildPacket(sectionName: string, raw: Record<string, string>): AiPacket {
    return {
        packetNum:        parseIntField(raw['packet_num'], 0),
        name:             sectionName,
        aggression:       parseIntField(raw['aggression'], 0),
        disposition:      parseEnum(raw['disposition'],      DISPOSITIONS,      DISPOSITION_MAP,       'none'),
        attackWho:        parseEnum(raw['attack_who'],       ATTACK_WHOS,       ATTACK_WHO_MAP,        'closest'),
        bestWeapon:       parseEnum(raw['best_weapon'],      BEST_WEAPONS,      BEST_WEAPON_MAP,       'melee'),
        areaAttackMode:   parseEnum(raw['area_attack_mode'], AREA_ATTACK_MODES, AREA_ATTACK_MODE_MAP,  'no_pref'),
        distance:         parseEnum(raw['distance'],         DISTANCE_MODES,    DISTANCE_MAP,          'on_your_own'),
        runAwayMode:      parseEnum(raw['run_away_mode'],    RUN_AWAY_MODES,    RUN_AWAY_MODE_MAP,     'none'),
        hurtTooMuch:      parseStringList(raw['hurt_too_much']),
        minHp:            parseIntField(raw['min_hp'],            0),
        minToHit:         parseIntField(raw['min_to_hit'],        0),
        maxDist:          parseIntField(raw['max_dist'],          50),
        calledFreq:       parseIntField(raw['called_freq'],       0),
        secondaryFreq:    parseIntField(raw['secondary_freq'],    0),
        chance:           parseIntField(raw['chance'],            85),
        chemUse:          parseEnum(raw['chem_use'],         CHEM_USES,         CHEM_USE_MAP,          'clean'),
        chemPrimaryDesire: parseIntList(raw['chem_primary_desire']),
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const aiPackets: Map<number, AiPacket> = new Map()

let _initialized = false

function ensureInit(): void {
    if (_initialized) return
    _initialized = true
    try {
        const text = loadText('data/data/ai.txt')
        const ini = parseIniText(text)
        for (const section in ini) {
            const packet = buildPacket(section, ini[section])
            aiPackets.set(packet.packetNum, packet)
        }
        console.log(`[aiPackets] Loaded ${aiPackets.size} AI packets`)
    } catch (e) {
        console.warn('[aiPackets] Could not load ai.txt:', e)
    }
}

/** Safe fallback used when a packet number is not found and packet 0 is also absent. */
const FALLBACK_PACKET: AiPacket = {
    packetNum: 0,
    name: '_fallback',
    aggression: 0,
    disposition: 'none',
    attackWho: 'closest',
    bestWeapon: 'melee',
    areaAttackMode: 'no_pref',
    distance: 'on_your_own',
    runAwayMode: 'none',
    hurtTooMuch: [],
    minHp: 0,
    minToHit: 0,
    maxDist: 50,
    calledFreq: 0,
    secondaryFreq: 0,
    chance: 85,
    chemUse: 'clean',
    chemPrimaryDesire: [],
}

export function getAiPacket(num: number): AiPacket {
    ensureInit()
    return aiPackets.get(num) ?? aiPackets.get(0) ?? FALLBACK_PACKET
}
