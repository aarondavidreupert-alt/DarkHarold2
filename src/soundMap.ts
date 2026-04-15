// soundMap.ts
// Fallout 2 Sound ID Mapping
// Weapon sound filenames follow the pattern:
//   wa<id>1xxx1.wav (attack)
//   wh<id>1<material>xx<variant>.wav (impact — material: f=flesh, m=metal, s=stone, w=wood)
//   wr<id>1xxx1.wav (reload)
//   wo<id>1xxx1.wav (empty / out of ammo)
// Sound ID is the ASCII character stored in the weapon_sound_id field of the .pro file.
// All filenames on disk are lowercase.

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
    // Doors (FO2 format: sodoors + action letter)
    'door_open':    'sodoorsa',
    'door_close':   'sodoorsc',
    'door_locked':  'sodoorsl',
    'door_try':     'sodoorso',

    // Items
    'item_pickup':  'ipickup1',
    'item_drop':    'iputdown',
    'item_use':     'icsxxxx1',

    // Combat generic — 'wh#' is the placeholder weapon-sound used for generic impacts
    'miss':         'whu1fxx1',   // unarmed flesh miss-hit (closest to a "swing-through" whoosh)
    'hit_flesh':    'wh#1fxx1',   // generic flesh impact
    'hit_metal':    'wh#1mxx1',   // generic metal impact
    'critter_die':  ['hmxxxxba', 'hmxxxxbb', 'hmxxxxbd'], // human male death vocalizations

    // UI
    'ui_click':     'butin1',
    'ui_open_inv':  'butin2',
    'levelup':      'levelup',
}

export interface WeaponSounds {
    attack: string
    attack_alt: string
    impact: string
    reload: string
    empty: string
}

/** Returns filenames for all sound variants of a weapon given its sound-ID character.
 *  `material` controls which impact sample is returned (default: flesh, variant 1). */
export function getWeaponSounds(soundId: string, material: ImpactMaterial = 'flesh'): WeaponSounds {
    const id = soundId.toLowerCase()
    const mat = MATERIAL_CODE[material]
    return {
        attack:     `wa${id}1xxx1`,
        attack_alt: `wa${id}1xxx2`,
        impact:     `wh${id}1${mat}xx1`,
        reload:     `wr${id}1xxx1`,
        empty:      `wo${id}1xxx1`,
    }
}

// Resolves a sound entry -- picks randomly if it's an array
export function resolveSound(sound: string | string[]): string {
    if (Array.isArray(sound)) {
        return sound[Math.floor(Math.random() * sound.length)]
    }
    return sound
}
