// FO2-CE ref: src/perk.h (PERK_* enum), src/perk.cc (perk data tables)
// Perk registry: definitions, requirement checking, and application.

import { Player } from './player.js'

// FO2-CE: SPECIAL stat keys as used in StatSet/getStat()
type SPECIAL = 'STR' | 'PER' | 'END' | 'CHA' | 'INT' | 'AGI' | 'LUK'

export interface PerkDef {
    /** Stable identifier (snake_case). UI/serialization uses name. */
    id: string
    /** Display name — used as key in player.perks[] */
    name: string
    description: string
    /** Maximum number of times this perk may be taken. */
    maxRanks: number
    /** Character level required before the perk appears. */
    minLevel: number
    /** SPECIAL stat minimums required. */
    minStats?: Partial<Record<SPECIAL, number>>
    /** Effective skill minimums required (after all bonuses). */
    minSkills?: Partial<Record<string, number>>
    /**
     * Skilldex image path relative to the game root.
     * Lowercased 8.3 FRM name as produced by exportImages.py.
     * Undefined = no image available; UI hides the slot gracefully.
     */
    img?: string
}

// FO2-CE ref: perk.cc gPerkDescription[] — ordered by PERK_* enum value.
// Stat keys match statDependencies in skills.ts (LUK not LCK).
// Descriptions taken verbatim from the game's text resources.
export const PERKS: PerkDef[] = [
    // PERK_AWARENESS = 0
    {
        id: 'awareness',
        name: 'Awareness',
        img: 'art/skilldex/awarenes.png',
        description: 'With Awareness, you are provided with detailed information about any critter you examine. You see their exact hit points and what weapons they are equipped with.',
        maxRanks: 1,
        minLevel: 3,
        minStats: { PER: 5 },
    },
    // PERK_BONUS_HTH_ATTACKS = 1
    {
        id: 'bonus_hth_attacks',
        name: 'Bonus HtH Attacks',
        img: 'art/skilldex/bthtatck.png',
        description: 'You have learned the secret of the Ninja! Your hand-to-hand attacks cost 1 fewer action point to perform.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { AGI: 6 },
    },
    // PERK_BONUS_HTH_DAMAGE = 2
    {
        id: 'bonus_hth_damage',
        name: 'Bonus HtH Damage',
        img: 'art/skilldex/bhthdam.png',
        description: 'Each rank of this perk adds +2 points of bonus damage every time you successfully land a hand-to-hand or melee hit.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { STR: 6, AGI: 6 },
    },
    // PERK_BONUS_MOVE = 3
    {
        id: 'bonus_move',
        name: 'Bonus Move',
        img: 'art/skilldex/bhmove.png',
        description: 'For each rank of Bonus Move, you receive 2 free movement action points per combat turn.',
        maxRanks: 2,
        minLevel: 3,
        minStats: { AGI: 5 },
    },
    // PERK_BONUS_RANGED_DAMAGE = 4
    {
        id: 'bonus_ranged_damage',
        name: 'Bonus Ranged Damage',
        img: 'art/skilldex/bhrnddam.png',
        description: 'Each rank of this perk adds +2 points of bonus damage every time you successfully hit with a ranged weapon.',
        maxRanks: 2,
        minLevel: 6,
        minStats: { AGI: 6, PER: 6 },
    },
    // PERK_BONUS_RATE_OF_FIRE = 5
    {
        id: 'bonus_rate_of_fire',
        name: 'Bonus Rate of Fire',
        img: 'art/skilldex/bhrof.png',
        description: 'This perk allows you to fire 1 fewer action point per ranged weapon attack.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { PER: 6, INT: 6, AGI: 7 },
    },
    // PERK_EARLIER_SEQUENCE = 6
    {
        id: 'earlier_sequence',
        name: 'Earlier Sequence',
        img: 'art/skilldex/earlseq.png',
        description: '+2 to your Sequence for each rank of this perk, improving your initiative in combat.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { PER: 6 },
    },
    // PERK_FASTER_HEALING = 7
    {
        id: 'faster_healing',
        name: 'Faster Healing',
        img: 'art/skilldex/fastheal.png',
        description: '+1 to your Healing Rate for each rank of this perk, so you heal faster every time you rest.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { END: 6 },
    },
    // PERK_MORE_CRITICALS = 8
    {
        id: 'more_criticals',
        name: 'More Criticals',
        img: 'art/skilldex/morecrit.png',
        description: '+5% to your chance to cause a critical hit for each rank of this perk.',
        maxRanks: 3,
        minLevel: 6,
        minStats: { LUK: 6 },
    },
    // PERK_NIGHT_VISION = 9
    {
        id: 'night_vision',
        name: 'Night Vision',
        img: 'art/skilldex/nightvis.png',
        description: 'With the Night Vision perk, you can see in the dark better than most.',
        maxRanks: 1,
        minLevel: 3,
        minStats: { PER: 6 },
    },
    // PERK_PRESENCE = 10
    {
        id: 'presence',
        name: 'Presence',
        img: 'art/skilldex/presence.png',
        description: '+10% to your reaction from others for each rank of this perk.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { CHA: 6 },
    },
    // PERK_RAD_RESISTANCE = 11
    {
        id: 'rad_resistance',
        name: 'Rad Resistance',
        img: 'art/skilldex/radresit.png',
        description: '+15% Radiation Resistance for each rank of this perk.',
        maxRanks: 2,
        minLevel: 6,
        minStats: { END: 6 },
    },
    // PERK_TOUGHNESS = 12
    {
        id: 'toughness',
        name: 'Toughness',
        img: 'art/skilldex/toughnes.png',
        description: '+10% to your general damage resistance for each rank of this perk.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { END: 6 },
    },
    // PERK_STRONG_BACK = 13
    {
        id: 'strong_back',
        name: 'Strong Back',
        img: 'art/skilldex/strgback.png',
        description: '+50 lbs. to your Carry Weight for each rank of this perk.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { STR: 6, END: 6 },
    },
    // PERK_SHARPSHOOTER = 14
    {
        id: 'sharpshooter',
        name: 'Sharpshooter',
        img: 'art/skilldex/sharpsh.png',
        description: 'You have a talent for hitting things at range. +2 to your Perception for the purposes of ranged weapon range modifiers.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { PER: 7, INT: 6 },
    },
    // PERK_SILENT_RUNNING = 15
    {
        id: 'silent_running',
        name: 'Silent Running',
        img: 'art/skilldex/slntrun.png',
        description: 'With this perk, you now have the ability to move quickly and silently. You can now sneak and run at the same time.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { AGI: 6 },
        minSkills: { 'Sneak': 50 },
    },
    // PERK_SURVIVALIST = 16
    {
        id: 'survivalist',
        name: 'Survivalist',
        img: 'art/skilldex/survivl.png',
        description: '+25% to the Outdoorsman skill.',
        maxRanks: 1,
        minLevel: 3,
        minStats: { END: 6 },
        minSkills: { 'Outdoorsman': 40 },
    },
    // PERK_MASTER_TRADER = 17
    {
        id: 'master_trader',
        name: 'Master Trader',
        img: 'art/skilldex/mastrtrd.png',
        description: 'You have mastered the art of trading. +25% to the Barter skill.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { CHA: 7 },
        minSkills: { 'Barter': 75 },
    },
    // PERK_EDUCATED = 18
    {
        id: 'educated',
        name: 'Educated',
        img: 'art/skilldex/educatd.png',
        description: '+2 additional skill points for every new experience level for each rank of this perk.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { INT: 6 },
    },
    // PERK_HEALER = 19
    {
        id: 'healer',
        name: 'Healer',
        img: 'art/skilldex/healer.png',
        description: 'The healing of bodies comes naturally. Each rank of this perk improves the hit points healed by 4 when using First Aid or Doctor.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { PER: 7, INT: 5 },
        minSkills: { 'First Aid': 40 },
    },
    // PERK_FORTUNE_FINDER = 20
    {
        id: 'fortune_finder',
        name: 'Fortune Finder',
        img: 'art/skilldex/fortune.png',
        description: 'You have the talent of finding money. You will find more caps in random encounters.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { LUK: 8 },
    },
    // PERK_BETTER_CRITICALS = 21
    {
        id: 'better_criticals',
        name: 'Better Criticals',
        img: 'art/skilldex/bttrcrit.png',
        description: 'The critical hits you cause are more devastating. You gain a +20% bonus on the critical hit table, providing more "ouch" for your whack.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { PER: 6, AGI: 4, LUK: 6 },
    },
    // PERK_EMPATHY = 22
    {
        id: 'empathy',
        name: 'Empathy',
        img: 'art/skilldex/empathy.png',
        description: 'Reading other people and working with them is one of your primary talents.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { PER: 7 },
    },
    // PERK_SLAYER = 23
    {
        id: 'slayer',
        name: 'Slayer',
        img: 'art/skilldex/slayer.png',
        description: 'The Slayer walks the earth! In hand-to-hand combat, all of your hits are upgraded to critical hits.',
        maxRanks: 1,
        minLevel: 18,
        minStats: { AGI: 8 },
        minSkills: { 'Unarmed': 80 },
    },
    // PERK_SNIPER = 24
    {
        id: 'sniper',
        name: 'Sniper',
        img: 'art/skilldex/sniper.png',
        description: 'You have mastered the firearm as a source of pain. Any successful hit in combat with a ranged weapon will be upgraded to a critical hit.',
        maxRanks: 1,
        minLevel: 18,
        minStats: { AGI: 8 },
        minSkills: { 'Small Guns': 80 },
    },
    // PERK_SILENT_DEATH = 25
    {
        id: 'silent_death',
        name: 'Silent Death',
        img: 'art/skilldex/slntdth.png',
        description: 'While Sneaking, if you hit a critter in the back, you will cause double damage. The master of the backstab.',
        maxRanks: 1,
        minLevel: 18,
        minStats: { AGI: 10 },
        minSkills: { 'Sneak': 80 },
    },
    // PERK_ACTION_BOY = 26
    {
        id: 'action_boy',
        name: 'Action Boy',
        img: 'art/skilldex/actnboy.png',
        description: '+1 to your Action Points for each rank of this perk.',
        maxRanks: 2,
        minLevel: 9,
        minStats: { AGI: 5 },
    },
    // PERK_MENTAL_BLOCK = 27
    {
        id: 'mental_block',
        name: 'Mental Block',
        img: 'art/skilldex/mntlblck.png',
        description: 'You have the ability to tune out any outside mental interference. You are immune to the effects of the Psychic Nullifier.',
        maxRanks: 1,
        minLevel: 9,
    },
    // PERK_LIFEGIVER = 28
    {
        id: 'lifegiver',
        name: 'Lifegiver',
        img: 'art/skilldex/lifegivr.png',
        description: '+4 hit points gained per experience level for each rank of this perk.',
        maxRanks: 3,
        minLevel: 9,
        minStats: { END: 4 },
    },
    // PERK_DODGER = 29
    {
        id: 'dodger',
        name: 'Dodger',
        img: 'art/skilldex/dodger.png',
        description: '+5 to your Armor Class for each rank of this perk.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { AGI: 6 },
    },
    // PERK_SNAKEATER = 30
    {
        id: 'snakeater',
        name: 'Snakeater',
        img: 'art/skilldex/snakeatr.png',
        description: '+25% to your Poison Resistance for each rank of this perk.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { END: 3 },
    },
    // PERK_MR_FIXIT = 31
    {
        id: 'mr_fixit',
        name: 'Mr. Fixit',
        img: 'art/skilldex/mrfixit.png',
        description: '+10% to the Repair and Science skills.',
        maxRanks: 1,
        minLevel: 12,
        minStats: { INT: 4 },
    },
    // PERK_MEDIC = 32
    {
        id: 'medic',
        name: 'Medic',
        img: 'art/skilldex/medic.png',
        description: '+10% to the First Aid and Doctor skills.',
        maxRanks: 1,
        minLevel: 12,
        minStats: { INT: 5 },
        minSkills: { 'First Aid': 40, 'Doctor': 40 },
    },
    // PERK_MASTER_MEDIC = 33
    {
        id: 'master_medic',
        name: 'Master Medic',
        img: 'art/skilldex/mstrmdic.png',
        description: '+10% to the Doctor skill, plus you heal 4 more hit points when using the Doctor skill.',
        maxRanks: 1,
        minLevel: 15,
        minStats: { AGI: 6, INT: 5 },
        minSkills: { 'Doctor': 75 },
    },
    // PERK_GHOST = 34
    {
        id: 'ghost',
        name: 'Ghost',
        img: 'art/skilldex/ghost.png',
        description: '+20% to the Sneak skill when in poorly lit areas.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { AGI: 6 },
        minSkills: { 'Sneak': 60 },
    },
    // PERK_CULT_OF_PERSONALITY = 35
    {
        id: 'cult_of_personality',
        name: 'Cult of Personality',
        img: 'art/skilldex/cultpers.png',
        description: 'Your reputation means nothing to those around you. Good or evil, they all react the same.',
        maxRanks: 1,
        minLevel: 12,
        minStats: { CHA: 10 },
    },
    // PERK_SCROUNGER = 36
    {
        id: 'scrounger',
        name: 'Scrounger',
        img: 'art/skilldex/scrnger.png',
        description: 'You can find more ammo than the normal post-nuclear survivor.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { LUK: 8 },
    },
    // PERK_EXPLORER = 37
    {
        id: 'explorer',
        name: 'Explorer',
        img: 'art/skilldex/explorer.png',
        description: 'The lure of the open wasteland is always on your mind. The chance of finding a special encounter is increased.',
        maxRanks: 1,
        minLevel: 9,
    },
    // PERK_FLOWER_CHILD = 38
    {
        id: 'flower_child',
        name: 'Flower Child',
        img: 'art/skilldex/flwrchld.png',
        description: 'You are less likely to be addicted to drugs (50% less likely), and you suffer less from the withdrawal effects.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { END: 5 },
    },
    // PERK_PATHFINDER = 39
    {
        id: 'pathfinder',
        name: 'Pathfinder',
        img: 'art/skilldex/pathfndr.png',
        description: 'The time to travel on the world map is reduced by 25% for each rank of this perk.',
        maxRanks: 2,
        minLevel: 6,
        minStats: { END: 6 },
        minSkills: { 'Outdoorsman': 40 },
    },
    // PERK_ANIMAL_FRIEND = 40
    {
        id: 'animal_friend',
        name: 'Animal Friend',
        img: 'art/skilldex/anmfrnd.png',
        description: 'Animals simply won\'t attack you unless provoked.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { INT: 5 },
    },
    // PERK_SCOUT = 41
    {
        id: 'scout',
        name: 'Scout',
        img: 'art/skilldex/scout.png',
        description: 'Your sight range in combat is increased by 2 squares.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { PER: 8 },
    },
    // PERK_MYSTERIOUS_STRANGER = 42
    {
        id: 'mysterious_stranger',
        name: 'Mysterious Stranger',
        img: 'art/skilldex/myststrn.png',
        description: 'With this perk, you have gained the attention of a Mysterious Stranger who will appear to help you in random combat encounters.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { LUK: 4 },
    },
    // PERK_RANGER = 43
    {
        id: 'ranger',
        name: 'Ranger',
        img: 'art/skilldex/ranger.png',
        description: '+15% to the Outdoorsman skill.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { END: 6 },
        minSkills: { 'Outdoorsman': 40 },
    },
    // PERK_QUICK_POCKETS = 44
    {
        id: 'quick_pockets',
        name: 'Quick Pockets',
        img: 'art/skilldex/qckpktc.png',
        description: 'You have learned to keep your inventory better organized. Accessing your inventory in combat costs 2 fewer action points.',
        maxRanks: 1,
        minLevel: 3,
        minStats: { AGI: 5 },
    },
    // PERK_SMOOTH_TALKER = 45
    {
        id: 'smooth_talker',
        name: 'Smooth Talker',
        img: 'art/skilldex/smthtalr.png',
        description: '+1 temporary INT for dialogue purposes for each rank of this perk.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { INT: 4 },
    },
    // PERK_SWIFT_LEARNER = 46
    {
        id: 'swift_learner',
        name: 'Swift Learner',
        img: 'art/skilldex/swftlrn.png',
        description: '+5% bonus to all experience points earned for each rank of this perk.',
        maxRanks: 3,
        minLevel: 3,
        minStats: { INT: 4 },
    },
    // PERK_TAG = 47  (4th_trait slot)
    {
        id: 'tag',
        name: 'Tag!',
        img: 'art/skilldex/taggerr.png',
        description: 'Tag one more skill. Two skills are better than one, but three is better than two, and four is the best of all.',
        maxRanks: 1,
        minLevel: 12,
    },
    // PERK_MUTATE = 48
    {
        id: 'mutate',
        name: 'Mutate!',
        img: 'art/skilldex/mutater.png',
        description: 'The radiation of the wasteland has changed you! One of your traits will mutate into something else.',
        maxRanks: 1,
        minLevel: 9,
    },
    // Drug/addiction perks (script-granted, not selectable at level-up) are omitted.
    // The following are the remaining selectable perks from perk.h:

    // PERK_ADRENALINE_RUSH
    {
        id: 'adrenaline_rush',
        name: 'Adrenaline Rush',
        img: 'art/skilldex/adrenlrs.png',
        description: 'With this perk, you gain +1 to your Strength when your hit points fall below 50%.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { STR: 1 }, // requires STR < 10; enforced by getValidPerks
    },
    // PERK_CHEM_RELIANT
    {
        id: 'chem_reliant',
        name: 'Chem Reliant',
        img: 'art/skilldex/chemrely.png',
        description: 'You are more easily addicted to chems but recover twice as fast from withdrawal.',
        maxRanks: 1,
        minLevel: 9,
    },
    // PERK_CHEM_RESISTANT
    {
        id: 'chem_resistant',
        name: 'Chem Resistant',
        img: 'art/skilldex/chemrst.png',
        description: 'You are 50% less likely to be addicted to any chem.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { END: 6 },
    },
    // PERK_DEMOLITION_EXPERT
    {
        id: 'demolition_expert',
        name: 'Demolition Expert',
        img: 'art/skilldex/demolexp.png',
        description: 'You are an expert with explosives. All thrown explosives deal +25% more damage.',
        maxRanks: 1,
        minLevel: 9,
        minSkills: { 'Traps': 75 },
    },
    // PERK_HEAVE_HO
    {
        id: 'heave_ho',
        name: 'Heave Ho!',
        img: 'art/skilldex/heaveho.png',
        description: '+2 to your effective Strength for the purposes of calculating your Throwing range for each rank.',
        maxRanks: 3,
        minLevel: 3,
    },
    // PERK_FRIENDLY_FOE
    {
        id: 'friendly_foe',
        name: 'Friendly Foe',
        img: 'art/skilldex/frndlyfo.png',
        description: 'You will always recognize friend from foe: party members are highlighted in a different color than enemies.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { PER: 4 },
    },
    // PERK_LIGHT_STEP
    {
        id: 'light_step',
        name: 'Light Step',
        img: 'art/skilldex/lgtstep.png',
        description: 'You are agile and careful. Your chance of setting off a trap is halved.',
        maxRanks: 1,
        minLevel: 9,
        minStats: { AGI: 5 },
        minSkills: { 'Traps': 50 },
    },
    // PERK_QUICK_RECOVERY
    {
        id: 'quick_recovery',
        name: 'Quick Recovery',
        img: 'art/skilldex/qckrecvr.png',
        description: 'It only costs 1 action point to recover from being knocked down in combat.',
        maxRanks: 1,
        minLevel: 6,
        minStats: { AGI: 5 },
    },
    // PERK_PARALYZING_PALM
    {
        id: 'paralyzing_palm',
        name: 'Paralyzing Palm',
        img: 'art/skilldex/parlzplm.png',
        description: 'With Paralyzing Palm, you can paralyze any target when you make a successful hit in hand-to-hand combat.',
        maxRanks: 1,
        minLevel: 18,
        minSkills: { 'Unarmed': 70 },
    },
    // PERK_PYROMANIAC
    {
        id: 'pyromaniac',
        name: 'Pyromaniac',
        img: 'art/skilldex/pyromanc.png',
        description: '+5 damage when using fire-based weapons.',
        maxRanks: 1,
        minLevel: 9,
        minSkills: { 'Big Guns': 75 },
    },
    // PERK_NEGOTIATOR
    {
        id: 'negotiator',
        name: 'Negotiator',
        img: 'art/skilldex/negotiat.png',
        description: '+10% to the Speech and Barter skills.',
        maxRanks: 1,
        minLevel: 6,
        minSkills: { 'Speech': 50, 'Barter': 50 },
    },
    // PERK_MASTER_THIEF
    {
        id: 'master_thief',
        name: 'Master Thief',
        img: 'art/skilldex/mastrtft.png',
        description: '+15% to Lockpick and Steal skills.',
        maxRanks: 1,
        minLevel: 12,
        minSkills: { 'Lockpick': 80, 'Steal': 80 },
    },
    // PERK_SPEAKER
    {
        id: 'speaker',
        name: 'Speaker',
        img: 'art/skilldex/speaker.png',
        description: '+20% to the Speech skill.',
        maxRanks: 1,
        minLevel: 9,
        minSkills: { 'Speech': 50 },
    },
    // PERK_THIEF (lower-tier thief perk)
    {
        id: 'thief',
        name: 'Thief',
        img: 'art/skilldex/thief.png',
        description: '+10% to the Sneak, Lockpick, Steal, and Traps skills.',
        maxRanks: 1,
        minLevel: 3,
    },
    // PERK_SALESMAN
    {
        id: 'salesman',
        name: 'Salesman',
        img: 'art/skilldex/salesman.png',
        description: '+20% to the Barter skill.',
        maxRanks: 1,
        minLevel: 6,
        minSkills: { 'Barter': 40 },
    },
]

/**
 * Returns all perks that the player meets the requirements for and has not
 * yet taken the maximum number of ranks.
 * FO2-CE ref: perk.cc perkIsValid() — level, stat, skill checks.
 */
export function getValidPerks(player: Player): PerkDef[] {
    const level = player.getStat('Level')
    return PERKS.filter(perk => {
        // Already at max rank — exclude
        if (getPerkRank(player, perk.name) >= perk.maxRanks) return false
        // Level requirement
        if (level < perk.minLevel) return false
        // SPECIAL stat requirements
        if (perk.minStats) {
            for (const [stat, req] of Object.entries(perk.minStats) as [SPECIAL, number][]) {
                if (player.getStat(stat) < req) return false
            }
        }
        // Skill requirements (effective value, after all bonuses)
        if (perk.minSkills) {
            for (const [skill, req] of Object.entries(perk.minSkills) as [string, number][]) {
                if (player.getSkill(skill) < req) return false
            }
        }
        return true
    })
}

/**
 * Returns the number of times the player has taken the named perk.
 * FO2-CE ref: perk.cc perkGetValue() — counts occurrences in the perk list.
 */
export function getPerkRank(player: Player, perkName: string): number {
    let count = 0
    for (const p of player.perks) {
        if (p === perkName) count++
    }
    return count
}

/**
 * Adds a perk to the player and clears pendingPerkPick.
 * Applies data-layer side-effects only (Tag! enabling 4th tag slot).
 * All other effects (Educated SP, Lifegiver HP, skill bonuses) are already
 * handled by the existing hasPerk() checks in addExperience() and getSkill().
 * FO2-CE ref: perk.cc perk_add().
 */
export function applyPerk(player: Player, perkName: string): void {
    const def = PERKS.find(p => p.name === perkName)
    if (!def) throw new Error(`applyPerk: unknown perk '${perkName}'`)

    const rank = getPerkRank(player, perkName)
    if (rank >= def.maxRanks) throw new Error(`applyPerk: '${perkName}' already at max rank ${def.maxRanks}`)

    player.perks.push(perkName)
    player.pendingPerkPick = false

    // Tag! enables the 4th tagged-skill slot in SkillSet
    if (perkName === 'Tag!') {
        player.skills.hasTagPerk = true
    }
}
