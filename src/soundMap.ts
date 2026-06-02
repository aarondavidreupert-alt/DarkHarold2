// soundMap.ts
// Fallout 2 Sound ID Mapping
//
// Weapon sound filenames follow this exact pattern (all lowercase on disk,
// the game is case-insensitive):
//
//   wa<id>1xxx1.wav   single-shot attack, variant 1
//   wa<id>1xxx2.wav   single-shot attack, variant 2
//   wa<id>2xxx1.wav   burst attack, variant 1
//   wh<id>1fxx1.wav   hit — flesh
//   wh<id>1mxx1.wav   hit — metal
//   wh<id>1sxx1.wav   hit — stone
//   wh<id>1wxx1.wav   hit — wood
//   wr<id>1xxx1.wav   reload
//   wo<id>1xxx1.wav   empty / misfire click
//
// The fixed segments ("xxx", "fxx", "mxx", "sxx", "wxx") are LITERAL — not
// placeholders.  Only <id> is variable: it's a single ASCII character taken
// verbatim from the weapon_sound_id byte in the .pro file (see proto.py
// line 108 — stored as ord() of one byte).  Thus <id> can be any printable
// ASCII character: letters ('a'..'z'), digits ('0'..'9'), and the special
// placeholder glyphs '#' and '$' that ship with vanilla.

/** Reference list of known weapon sound-ID characters.  Purely documentary —
 *  the mapping from id→filename is mechanical (see getWeaponSounds).  */
export const WEAPON_SOUND_IDS: Record<string, string> = {
    'A': '10mm_pistol',
    'B': '14mm_pistol',
    'C': 'desert_eagle',
    'D': 'flamer',
    'E': 'rocket_launcher',
    'F': 'minigun',
    'G': 'gatling_laser',
    'H': 'plasma_pistol',
    'I': 'laser_pistol',
    'J': 'smg_10mm',
    'K': 'hunting_rifle',
    'L': 'minigun_alt',
    'M': 'combat_shotgun',
    'N': 'sniper_rifle',
    'O': 'assault_rifle',
    'P': 'plasma_rifle',
    'Q': 'laser_rifle',
    'R': 'bozar',
    'S': 'super_sledge',
    'T': 'spear',
    'U': 'knife',
    'V': 'crowbar',
    'W': 'sledgehammer',
    'X': 'cattle_prod',
    'Y': 'unarmed',
    'Z': 'throwing_knife',
    '#': 'generic_placeholder',
    '$': 'generic_placeholder_2',
}

/** Material hit by a projectile — drives which impact sample plays. */
export type ImpactMaterial = 'flesh' | 'metal' | 'stone' | 'wood'

const MATERIAL_CODE: Record<ImpactMaterial, string> = {
    flesh: 'f',
    metal: 'm',
    stone: 's',
    wood:  'w',
}

export const ACTION_SOUNDS: Record<string, string | string[]> = {
    // Doors (FO2 format: sodoors + action letter; 'o' = "not open"/try-locked)
    'door_open':    'sodoorsa',
    'door_close':   'sodoorsc',
    'door_locked':  'sodoorsl',
    'door_try':     'sodoorso',

    // Items
    'item_pickup':  'ipickup1',
    'item_drop':    'iputdown',
    'item_use':     'icsxxxx1',

    // Combat flow
    'combat_start': 'icombat1',
    'combat_end':   'icombat2',

    // Combat generic — 'wh#' is the placeholder weapon-sound used for generic impacts
    'miss':         'whu1fxx1',   // unarmed flesh miss-hit (closest to a "swing-through" whoosh)
    'hit_flesh':    'wh#1fxx1',   // generic flesh impact
    'hit_metal':    'wh#1mxx1',   // generic metal impact
    'critter_die':  ['hmxxxxba', 'hmxxxxbb', 'hmxxxxbd'], // human male death vocalizations

    // UI
    'ui_click':     'butin1',
    'ui_open_inv':  'butin2',
    'levelup':      'levelup',

    // Explosives
    'explosion':    'explo1',
}

export interface WeaponSounds {
    attack: string
    attack_alt: string
    attack_burst: string
    impact: string
    reload: string
    empty: string
}

/** Returns filenames for all sound variants of a weapon given its sound-ID character.
 *  `material` controls which impact sample is returned (default: flesh).
 *  The returned names are lowercase, with no extension — append '.wav' to load. */
export function getWeaponSounds(soundId: string, material: ImpactMaterial = 'flesh'): WeaponSounds {
    // Letters come out of the .pro file as uppercase ASCII; non-letters (digits,
    // '#', '$') pass through unchanged because toLowerCase is a no-op for them.
    const id = soundId.toLowerCase()
    const mat = MATERIAL_CODE[material]
    return {
        attack:       `wa${id}1xxx1`,
        attack_alt:   `wa${id}1xxx2`,
        attack_burst: `wa${id}2xxx1`,
        impact:       `wh${id}1${mat}xx1`,
        reload:       `wr${id}1xxx1`,
        empty:        `wo${id}1xxx1`,
    }
}

// Resolves a sound entry -- picks randomly if it's an array
export function resolveSound(sound: string | string[]): string {
    if (Array.isArray(sound)) {
        return sound[Math.floor(Math.random() * sound.length)]
    }
    return sound
}
