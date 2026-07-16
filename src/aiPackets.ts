/*
AI Packet system — parse data/data/ai.txt into typed AiPacket records.

Intentionally has NO imports from the game module tree to avoid circular
dependency chains (util → object → combat → aiPackets → util).
*/

// ── String union types ────────────────────────────────────────────────────────

export type Disposition = 'aggressive' | 'berserk' | 'coward' | 'defensive' | 'none' | 'custom'
export type AttackWho = 'closest' | 'strongest' | 'weakest' | 'whomever' | 'whomever_attacking_me'
export type BestWeapon =
    | 'no_pref'           // 0 — same ordering as -1 unset: RANGED > THROW > MELEE > UNARMED
    | 'melee'             // 1
    | 'melee_over_ranged' // 2
    | 'ranged_over_melee' // 3
    | 'ranged'            // 4
    | 'unarmed'           // 5
    | 'unarmed_over_throw'// 6
    | 'random'            // 7
    | 'never'             // 8
export type AreaAttackMode = 'no_pref' | 'be_careful' | 'be_sure' | 'be_absolutely_sure' | 'sometimes'
export type DistanceMode = 'charge' | 'snipe' | 'stay' | 'on_your_own' | 'random' | 'stay_close'
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
    teamNum: number             // team_num from ai.txt; -1 if absent
    wanderType: number          // 0=none, 1=small radius, 2=large radius, 3=unrestricted
    messageRanges: Partial<Record<string, [number, number]>> // combat taunt message ID ranges
}

// ── Numeric → string maps (fallout2-ce ai.h enum order) ──────────────────────

// CE ref: combat_ai_defs.h Disposition enum order — NONE,CUSTOM,COWARD,DEFENSIVE,AGGRESSIVE,BERKSERK.
// Numeric encoding isn't used by any real ai.txt entry (all use string keys),
// kept only as a defensive fallback to match CE's parser exactly.
const DISPOSITION_MAP: Disposition[]      = ['none', 'custom', 'coward', 'defensive', 'aggressive', 'berserk']
// FO2: 0=whomever 1=closest 2=weakest 3=strongest 4=which_side_most_hurt 5=whoever_attacking_me
const ATTACK_WHO_MAP: AttackWho[]         = ['whomever', 'closest', 'weakest', 'strongest', 'closest', 'whomever_attacking_me']
// FO2-CE enum: -1=unset→no_pref, 0=no_pref, 1=melee, 2=melee_over_ranged, 3=ranged_over_melee,
//              4=ranged, 5=unarmed, 6=unarmed_over_throw, 7=random, 8=never
// parseEnum maps -1 → index 0 ('no_pref'), matching _weapPrefOrderings[best_weapon+1] row 0.
const BEST_WEAPON_MAP: BestWeapon[] = [
    'no_pref', 'melee', 'melee_over_ranged', 'ranged_over_melee',
    'ranged', 'unarmed', 'unarmed_over_throw', 'random', 'never',
]
const AREA_ATTACK_MODE_MAP: AreaAttackMode[] = ['no_pref', 'be_careful', 'be_sure', 'be_absolutely_sure', 'sometimes']
// FO2: 0=on_your_own 1=charge 2=snipe 3=stay 4=random
const DISTANCE_MAP: DistanceMode[]        = ['on_your_own', 'charge', 'snipe', 'stay', 'random']
// FO2 stored as -1…4; we normalise -1→'never', 0→'none', 1–4 follow
const RUN_AWAY_MODE_MAP: RunAwayMode[]    = ['never', 'none', 'bleeding', 'finger_hurts', 'not_feeling_good', 'coward']
// FO2: 0=clean 1=stims_when_hurt_little 2=stims_when_hurt_lots 3=sometimes 4=anytime
export const CHEM_USE_MAP: ChemUse[]             = ['clean', 'stims_when_hurt_little', 'stims_when_hurt_lots', 'sometimes', 'anytime']

// ── Valid string sets ─────────────────────────────────────────────────────────

const DISPOSITIONS: ReadonlySet<string>      = new Set<Disposition>(['aggressive', 'berserk', 'coward', 'defensive', 'none', 'custom'])
const ATTACK_WHOS: ReadonlySet<string>       = new Set<AttackWho>(['closest', 'strongest', 'weakest', 'whomever', 'whomever_attacking_me'])
const BEST_WEAPONS: ReadonlySet<string>      = new Set<BestWeapon>([
    'no_pref', 'melee', 'melee_over_ranged', 'ranged_over_melee',
    'ranged', 'unarmed', 'unarmed_over_throw', 'random', 'never',
])
const AREA_ATTACK_MODES: ReadonlySet<string> = new Set<AreaAttackMode>(['no_pref', 'be_careful', 'be_sure', 'be_absolutely_sure', 'sometimes'])
const DISTANCE_MODES: ReadonlySet<string>    = new Set<DistanceMode>(['charge', 'snipe', 'stay', 'on_your_own', 'random', 'stay_close'])
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

function buildMessageRanges(raw: Record<string, string>): Partial<Record<string, [number, number]>> {
    const ranges: Partial<Record<string, [number, number]>> = {}
    const keys = ['run', 'move', 'attack', 'miss']
    for (const key of keys) {
        const start = parseIntField(raw[key + '_start'], 0)
        const end   = parseIntField(raw[key + '_end'],   0)
        if (start > 0 && end > 0) {
            ranges[key] = [start, end]
        }
    }
    return ranges
}

function buildPacket(sectionName: string, raw: Record<string, string>): AiPacket {
    return {
        packetNum:        parseIntField(raw['packet_num'], 0),
        name:             sectionName,
        aggression:       parseIntField(raw['aggression'], 0),
        disposition:      parseEnum(raw['disposition'],      DISPOSITIONS,      DISPOSITION_MAP,       'none'),
        attackWho:        parseEnum(raw['attack_who'],       ATTACK_WHOS,       ATTACK_WHO_MAP,        'closest'),
        bestWeapon:       parseEnum(raw['best_weapon'],      BEST_WEAPONS,      BEST_WEAPON_MAP,       'no_pref'),
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
        teamNum:          parseIntField(raw['team_num'], -1),
        wanderType:       parseIntField(raw['wander_type'], 0),
        messageRanges:    buildMessageRanges(raw),
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
            if (_firstPacket === null) _firstPacket = packet
        }
        console.log(`[aiPackets] Loaded ${aiPackets.size} AI packets`)
    } catch (e) {
        console.warn('[aiPackets] Could not load ai.txt:', e)
    }
}

// First packet parsed from ai.txt — returned by aiGetPacketByNum() when the
// requested packet_num is not found, matching fallout2-ce aiGetPacketByNum()
// which returns gAiPackets[0] (the first entry in the file).
let _firstPacket: AiPacket | null = null

/** Hard-coded last-resort fallback used only when ai.txt could not be loaded at all.
 *  All enum fields initialise to -1 semantics ('no_pref') as per aiPacketInit(). */
const FALLBACK_PACKET: AiPacket = {
    packetNum: 0,
    name: '_fallback',
    aggression: 0,
    disposition: 'none',
    attackWho: 'closest',
    bestWeapon: 'no_pref',   // -1 in FO2 → RANGED > THROW > MELEE > UNARMED
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
    teamNum: -1,
    wanderType: 0,
    messageRanges: {},
}

/** Return packet with packet_num === num, or the first packet in the file
 *  (matching fallout2-ce aiGetPacketByNum), or the hard FALLBACK_PACKET if
 *  ai.txt was not loaded. */
export function getAiPacket(num: number): AiPacket {
    ensureInit()
    return aiPackets.get(num) ?? _firstPacket ?? FALLBACK_PACKET
}

// ── Companion disposition switching ───────────────────────────────────────────
//
// CE ref: combat_ai.cc:903 aiSetDisposition — switches a critter's active AI
// packet by *packet_num arithmetic*: `packet_num - (newDisposition -
// ai->disposition)`. That only works if a companion's 5 disposition-variant
// packets are laid out in ai.txt with a perfectly consistent relative offset
// — which, on inspection of data/data/ai.txt, they are NOT (the on-disk block
// order is AGGRESSIVE, BERSERK, COWARD, CUSTOM, DEFENSIVE, which does not
// line up with the Disposition enum's numeric deltas). Rather than replicate
// that arithmetic (and its apparent fragility), DH2 uses the section header
// names directly: every companion disposition packet is titled
// "PARTY <NAME> <DISPOSITION>" (e.g. "PARTY BESS AGGRESSIVE", see
// data/data/ai.txt ~line 2625), so the sibling packet for a different
// disposition can be found by swapping the trailing word and looking up the
// exact name — robust regardless of file ordering.
const DISPOSITION_WORD: Record<Disposition, string> = {
    aggressive: 'AGGRESSIVE',
    berserk: 'BERSERK',
    coward: 'COWARD',
    defensive: 'DEFENSIVE',
    custom: 'CUSTOM',
    none: 'NONE',
}

let _packetsByName: Map<string, AiPacket> | null = null

function ensureNameIndex(): Map<string, AiPacket> {
    if (_packetsByName) return _packetsByName
    ensureInit()
    _packetsByName = new Map()
    for (const packet of aiPackets.values()) {
        _packetsByName.set(packet.name.toUpperCase(), packet)
    }
    return _packetsByName
}

/**
 * Given a companion's current AI packet, find the sibling packet for a
 * different disposition by swapping the trailing disposition word in its
 * section-header name (see comment above). Returns null if the packet's name
 * doesn't end with its own disposition word (i.e. it's not a companion
 * disposition-variant packet at all — an ordinary NPC's single packet, for
 * example) or no sibling packet exists for the requested disposition.
 */
export function findCompanionPacketForDisposition(currentPacket: AiPacket, disposition: Disposition): AiPacket | null {
    const currentWord = DISPOSITION_WORD[currentPacket.disposition]
    const upperName = currentPacket.name.toUpperCase()
    if (!upperName.endsWith(currentWord)) return null
    const prefix = upperName.slice(0, upperName.length - currentWord.length)
    const targetName = prefix + DISPOSITION_WORD[disposition]
    return ensureNameIndex().get(targetName) ?? null
}
