// soundMap.ts
// Fallout 2 Sound ID Mapping
// Weapon sounds follow the pattern: WA<ID>1XXX1.wav (attack), WH<ID>1XXX1.wav (impact), WR<ID>1XXX1.wav (reload)
// Sound ID is the ASCII character stored in weapon_sound_id field of the .pro file

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

export const ACTION_SOUNDS: Record<string, string | string[]> = {
    // Doors (FO2 format: SO + DOORS + action letter)
    'door_open':    'SODOORSA',
    'door_close':   'SODOORSC',
    'door_locked':  'SODOORSL',
    'door_try':     'SODOORSO',

    // Items
    'item_pickup':  'IIPICKUP',
    'item_drop':    'IIDROP',
    'item_use':     'IIUSE',

    // Combat generic
    'miss':         'WHIMPACT',
    'hit_flesh':    'WHFLESHT',
    'hit_metal':    'WHMETAL',
    'critter_die':  ['DTHBODY1', 'DTHBODY2', 'DTHBODY3'],

    // UI
    'ui_click':     'IISWTCH1',
    'ui_open_inv':  'IISWTCH2',
    'levelup':      'LEVELUP',
}

// Returns the filenames for all sound variants of a weapon given its sound ID character
export function getWeaponSounds(soundId: string) {
    const id = soundId.toUpperCase()
    return {
        attack:     `WA${id}1XXX1`,
        attack_alt: `WA${id}1XXX2`,
        impact:     `WH${id}1XXX1`,
        reload:     `WR${id}1XXX1`,
        empty:      `WO${id}1XXX1`,
    }
}

// Resolves a sound entry -- picks randomly if it's an array
export function resolveSound(sound: string | string[]): string {
    if (Array.isArray(sound)) {
        return sound[Math.floor(Math.random() * sound.length)]
    }
    return sound
}
