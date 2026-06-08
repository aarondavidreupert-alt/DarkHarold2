/*
Copyright 2014 darkf

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// Lookup tables shared by the character screen (viewer.ts), the new-game
// creator (creator.ts), and the perk-selection modal (perkModal.ts).
// Pure data; no logic.

// ── Module-level constants ────────────────────────────────────────────────────

export const SPECIAL_FULL_NAMES: Record<string, string> = {
    STR: 'Strength', PER: 'Perception', END: 'Endurance',
    CHA: 'Charisma', INT: 'Intelligence', AGI: 'Agility', LUK: 'Luck',
}
export const SPECIAL_DESCRIPTIONS: Record<string, string> = {
    STR: 'Raw physical strength. A high Strength is good for physical characters. Modifies: Hit Points, Melee Damage, and Carry Weight.',
    PER: 'The ability to see, hear, taste and notice unusual things. A high Perception is important for a sharpshooter.  Modifies: Sequence and ranged combat distance modifiers.',
    END: 'Stamina and physical toughness. A character with a high Endurance will survive where others may not. Modifies: Hit Points, Poison & Radiation Resistance, Healing Rate, and the additional hit points per level.',
    CHA: 'A combination of appearance and charm. A high Charisma is important for characters that want to influence people with words. Modifies: NPC reactions, and barter prices.',
    INT: 'Knowledge, wisdom and the ability to think quickly. A high Intelligence is important for any character. Modifies: the number of new skill points per level, dialogue options, and many skills.',
    AGI: 'Coordination and the ability to move well. A high Agility is important for any active character. Modifies: Action Points, Armor Class, Sequence, and many skills.',
    LUK: 'Fate. Karma. An extremely high or low Luck will affect the character - somehow. Events and situations will be changed by how lucky (or unlucky) your character is.',
}
export const SKILL_DESCRIPTIONS: Record<string, string> = {
    'Small Guns':     'The use, care and general knowledge of small firearms - pistols, SMGs and rifles.',
    'Big Guns':       'The operation and maintenance of really big guns - miniguns, rocket launchers, flamethrowers and such.',
    'Energy Weapons': 'The care and feeding of energy-based weapons.  How to arm and operate weapons that use laser or plasma technology.',
    'Unarmed':        'A combination of martial arts, boxing and other hand-to-hand martial arts.  Combat with your hands and feet.',
    'Melee Weapons':  'Using non-ranged weapons in hand-to-hand, or melee combat - knives, sledgehammers, spears, clubs and so on.',
    'Throwing':       'The skill of muscle-propelled ranged weapons, such as throwing knives, spears and grenades.',
    'First Aid':      'General healing skill.  Used to heal small cuts, abrasions and other minor ills.  In game terms, the use of first aid can heal more hit points over time than just rest.',
    'Doctor':         'The healing of major wounds and crippled limbs.  Without this skill, it will take a much longer period of time to restore crippled limbs to use.',
    'Sneak':          'Quiet movement, and the ability to remain unnoticed. If successful, you will be much harder to locate. You cannot run and sneak at the same time.',
    'Lockpick':       'The skill of opening locks without the proper key. The use of lockpicks or electronic lockpicks will greatly enhance this skill.',
    'Steal':          'The ability to make the things of others your own.  Can be used to steal from people or places.',
    'Traps':          'The finding and removal of traps.  Also the setting of explosives for demolition purposes.',
    'Science':        'Covers a variety of high technology skills, such as computers, biology, physics and geology.',
    'Repair':         'The practical application of the Science skill for fixing broken equipment, machinery and electronics.',
    'Speech':         'The ability to communicate in a practical and efficient manner. The skill of convincing others that your position is correct. The ability to lie and not get caught.',
    'Barter':         'Trading and trade-related tasks. The ability to get better prices for items you sell, and lower prices for items you buy.',
    'Gambling':       'The knowledge and practical skills related to wagering. The skill at cards, dice and other games.',
    'Outdoorsman':    'Practical knowledge of the outdoors, and the ability to live off the land. The knowledge of plants and animals.',
}
export const DERIVED_DESCRIPTIONS: Record<string, string> = {
    'Armor Class':          'Armor Class: reduces chance of being hit.',
    'Action Points':        'Action Points: how many actions you can take per turn.',
    'Carry Weight':         'Maximum weight you can carry.',
    'Melee Damage':         'Bonus damage added to melee attacks.',
    'Damage Resistance':    'Percentage of damage absorbed.',
    'Poison Resistance':    'Resistance to poison effects.',
    'Radiation Resistance': 'Resistance to radiation.',
    'Sequence':             'Determines order of action in combat.',
    'Healing Rate':         'HP recovered per rest period.',
    'Critical Chance':      'Base chance to score a critical hit.',
}
export const CONDITION_DESCRIPTIONS: Record<string, string> = {
    'Poisoned':           'You are poisoned. Lose HP over time until treated.',
    'Radiated':           'You have absorbed radiation. High levels are fatal.',
    'Eye Damage':         'Your eyes are damaged. Perception is reduced.',
    'Crippled Right Arm': 'Your arm is crippled. Combat effectiveness reduced.',
    'Crippled Left Arm':  'Your arm is crippled. Combat effectiveness reduced.',
    'Crippled Right Leg': 'Your leg is crippled. Movement is impaired.',
    'Crippled Left Leg':  'Your leg is crippled. Movement is impaired.',
}
export const TRAIT_DESCRIPTIONS: Record<string, string> = {
    'Fast Metabolism': 'Your metabolic rate is twice normal.  This means that you are much less resistant to radiation and poison, but your body heals faster.',
    'Bruiser':         'A little slower, but a little bigger.  You may not hit as often, but they will feel it when you do!  Your total action points are lowered, but your Strength is increased.',
    'Small Frame':     "You are not quite as big as the other villagers, but that never slowed you down.  You can't carry as much, but you are more agile.",
    'One Hander':      'One of your hands is very dominant.  You excel with single-handed weapons, but two-handed weapons cause a problem.',
    'Finesse':         'Your attacks show a lot of finesse.  You don\'t do as much damage, but you cause more critical hits.',
    'Kamikaze':        'By not paying attention to any threats, you can act a lot faster in a turn.  This lowers your armor class to just what you are wearing, but you sequence much faster in a combat turn.',
    'Heavy Handed':    'You swing harder, not better.  Your attacks are very brutal, but lack finesse.  You rarely cause a good critical, but you always do more melee damage.',
    'Fast Shot':       'You don\'t have time to aim for a targeted attack, because you attack faster than normal people.  It costs you one less action point for guns and thrown weapons.',
    'Bloody Mess':     'By some strange twist of fate, people around you die violently.  You always see the worst way a person can die.',
    'Jinxed':          'The good thing is that everyone around you has more critical failures in combat, the bad thing is so do you!',
    'Good Natured':    'You studied less-combative skills as you were growing up.  Your combat skills start at a lower level, but First Aid, Doctor, Speech and Barter are substantially improved.',
    'Chem Reliant':    'You are more easily influenced by chems.  Your chance to be reliant by chem use is twice normal, but you recover faster from their ill effects.',
    'Chem Resistant':  'Chems only affect you half as long as normal, but your chance to be reliant is also only 50% of normal.',
    'Sex Appeal':      'You\'ve got the "right" stuff.  Members of the opposite sex are attracted to you, but those of the same sex tend to become quite jealous.',
    'Skilled':         'Since you spent more time improving your skills than a normal person, you gain 5 additional skill points per experience level. The tradeoff is that you do not gain as many extra abilities. You gain a perk every four levels.',
    'Gifted':          'You have more innate abilities than most, so you have not spent as much time honing your skills.  Your primary statistics are each +1, but you lose -10% on all skills to start, and receive 5 less skill points per level.',
}

// FO2-CE ref: character_editor.cc — image paths used in characterEditorDrawCard()
export const SPECIAL_IMG: Record<string, string> = {
    STR: 'art/skilldex/strength.png',
    PER: 'art/skilldex/perceptn.png',
    END: 'art/skilldex/endur.png',
    CHA: 'art/skilldex/charisma.png',
    INT: 'art/skilldex/intel.png',
    AGI: 'art/skilldex/agility.png',
    LUK: 'art/skilldex/luck.png',
}
export const SKILL_IMG: Record<string, string> = {
    'Small Guns':     'art/skilldex/gunsml.png',
    'Big Guns':       'art/skilldex/gunbig.png',
    'Energy Weapons': 'art/skilldex/energywp.png',
    'Unarmed':        'art/skilldex/hnd2hnd.png',
    'Melee Weapons':  'art/skilldex/melee.png',
    'Throwing':       'art/skilldex/throwing.png',
    'First Aid':      'art/skilldex/firstaid.png',
    'Doctor':         'art/skilldex/doctor.png',
    'Sneak':          'art/skilldex/sneak.png',
    'Lockpick':       'art/skilldex/lockpick.png',
    'Steal':          'art/skilldex/pickpock.png',
    'Traps':          'art/skilldex/traps.png',
    'Science':        'art/skilldex/science.png',
    'Repair':         'art/skilldex/repair.png',
    'Speech':         'art/skilldex/speech.png',
    'Barter':         'art/skilldex/barter.png',
    'Gambling':       'art/skilldex/gambling.png',
    'Outdoorsman':    'art/skilldex/outdoors.png',
}
export const DERIVED_IMG: Record<string, string> = {
    'Armor Class':          'art/skilldex/armorcls.png',
    'Action Points':        'art/skilldex/actionpt.png',
    'Carry Weight':         'art/skilldex/carryamt.png',
    'Melee Damage':         'art/skilldex/meleedam.png',
    'Damage Resistance':    'art/skilldex/damresis.png',
    'Poison Resistance':    'art/skilldex/poisnres.png',
    'Radiation Resistance': 'art/skilldex/radresis.png',
    'Sequence':             'art/skilldex/sequence.png',
    'Healing Rate':         'art/skilldex/healrate.png',
    'Critical Chance':      'art/skilldex/critchnc.png',
}
export const CONDITION_IMG: Record<string, string> = {
    'Poisoned':           'art/skilldex/poisoned.png',
    'Radiated':           'art/skilldex/radiated.png',
    'Eye Damage':         'art/skilldex/eyedamag.png',
    'Crippled Right Arm': 'art/skilldex/armright.png',
    'Crippled Left Arm':  'art/skilldex/armleft.png',
    'Crippled Right Leg': 'art/skilldex/legright.png',
    'Crippled Left Leg':  'art/skilldex/legleft.png',
}
export const TRAIT_IMG: Record<string, string> = {
    'Fast Metabolism': 'art/skilldex/fastmeta.png',
    'Bruiser':         'art/skilldex/bruiser.png',
    'Small Frame':     'art/skilldex/smlframe.png',
    'One Hander':      'art/skilldex/onehand.png',
    'Finesse':         'art/skilldex/finesse.png',
    'Kamikaze':        'art/skilldex/kamikaze.png',
    'Heavy Handed':    'art/skilldex/heavyhnd.png',
    'Fast Shot':       'art/skilldex/fastshot.png',
    'Bloody Mess':     'art/skilldex/bldmess.png',
    'Jinxed':          'art/skilldex/jinxed.png',
    'Good Natured':    'art/skilldex/goodnatr.png',
    'Chem Reliant':    'art/skilldex/addict.png',    // LST 53 (no dedicated entry)
    'Chem Resistant':  'art/skilldex/drugrest.png',  // LST 67
    'Sex Appeal':      'art/skilldex/charisma.png',  // LST 3  (no dedicated entry)
    'Skilled':         'art/skilldex/skilled.png',
    'Gifted':          'art/skilldex/gifted.png',
}
// FO2-CE ref: character_editor.cc — perk FRM IDs from SKILLDEX.LST (0-indexed).
// Filenames are lowercased 8.3 FRM names as produced by exportImages.py.
// Keyed by the exact perk name strings in src/perks.ts PERKS[].
// Perks with no LST entry (Master Medic, Chem Reliant, etc.) fall back to
// def.img in showCard(); they are intentionally omitted here.
export const PERK_IMG: Record<string, string> = {
    'Awareness':           'art/skilldex/awarenes.png',  // LST 72
    'Bonus HtH Attacks':   'art/skilldex/hnd2hnd.png',  // LST 73
    'Bonus HtH Damage':    'art/skilldex/damage.png',   // LST 74
    'Bonus Move':          'art/skilldex/bonusmve.png', // LST 75
    'Bonus Ranged Damage': 'art/skilldex/bonusrng.png', // LST 76
    'Bonus Rate of Fire':  'art/skilldex/bonusrat.png', // LST 77
    'Earlier Sequence':    'art/skilldex/earlyseq.png', // LST 78
    'Faster Healing':      'art/skilldex/healrate.png', // LST 79
    'More Criticals':      'art/skilldex/morecrit.png', // LST 80
    'Night Vision':        'art/skilldex/nightviz.png', // LST 81
    'Presence':            'art/skilldex/presence.png', // LST 82
    'Rad Resistance':      'art/skilldex/radresis.png', // LST 83
    'Toughness':           'art/skilldex/toughnes.png', // LST 84
    'Sharpshooter':        'art/skilldex/sharpsht.png', // LST 86
    'Silent Running':      'art/skilldex/silntrun.png', // LST 87
    'Survivalist':         'art/skilldex/survival.png', // LST 88
    'Master Trader':       'art/skilldex/mstrtrad.png', // LST 89
    'Educated':            'art/skilldex/educated.png', // LST 90
    'Healer':              'art/skilldex/healer.png',   // LST 91
    'Fortune Finder':      'art/skilldex/fortunfd.png', // LST 92
    'Better Criticals':    'art/skilldex/betrcrit.png', // LST 93
    'Empathy':             'art/skilldex/empathy.png',  // LST 94
    'Slayer':              'art/skilldex/slayer.png',   // LST 95
    'Sniper':              'art/skilldex/sniper.png',   // LST 96
    'Silent Death':        'art/skilldex/silentd.png',  // LST 97
    'Action Boy':          'art/skilldex/action.png',   // LST 98
    'Mental Block':        'art/skilldex/mentalbk.png', // LST 99
    'Lifegiver':           'art/skilldex/lifegivr.png', // LST 100
    'Dodger':              'art/skilldex/dodger.png',   // LST 101
    'Snakeater':           'art/skilldex/snakeeat.png', // LST 102
    'Mr. Fixit':           'art/skilldex/mrfixit.png',  // LST 103
    'Medic':               'art/skilldex/medic.png',    // LST 104
    'Master Thief':        'art/skilldex/mtrthief.png', // LST 105
    'Speaker':             'art/skilldex/speaker.png',  // LST 106
    'Heave Ho!':           'art/skilldex/heaveho.png',  // LST 107
    'Friendly Foe':        'art/skilldex/frienfoe.png', // LST 108
    'Ghost':               'art/skilldex/ghost.png',    // LST 110
    'Cult of Personality': 'art/skilldex/cultoper.png', // LST 111
    'Scrounger':           'art/skilldex/scroungr.png', // LST 112
    'Explorer':            'art/skilldex/explorer.png', // LST 113
    'Flower Child':        'art/skilldex/flower.png',   // LST 114
    'Pathfinder':          'art/skilldex/pathfndr.png', // LST 115
    'Animal Friend':       'art/skilldex/animalfr.png', // LST 116
    'Scout':               'art/skilldex/scout.png',    // LST 117
    'Mysterious Stranger': 'art/skilldex/stranger.png', // LST 118
    'Ranger':              'art/skilldex/ranger.png',   // LST 119
    'Quick Pockets':       'art/skilldex/quikpock.png', // LST 120
    'Smooth Talker':       'art/skilldex/smoothtk.png', // LST 121
    'Swift Learner':       'art/skilldex/swftlern.png', // LST 122
    'Tag!':                'art/skilldex/tag.png',      // LST 123
    'Mutate!':             'art/skilldex/mutate.png',   // LST 124
    'Adrenaline Rush':     'art/skilldex/adrnrush.png', // LST 155
    'Light Step':          'art/skilldex/litestep.png', // LST 164
    'Pyromaniac':          'art/skilldex/pyromnac.png', // LST 169
    'Quick Recovery':      'art/skilldex/qwkrecov.png', // LST 170
    // Perks with no dedicated SKILLDEX.LST entry — use closest thematic image
    'Strong Back':         'art/skilldex/packanim.png', // LST 85  (Pack Animal)
    'Master Medic':        'art/skilldex/medic.png',    // LST 104
    'Chem Reliant':        'art/skilldex/addict.png',   // LST 53
    'Chem Resistant':      'art/skilldex/addict.png',   // LST 53
    'Demolition Expert':   'art/skilldex/traps.png',    // LST 39  (FO2-CE frmId=39)
    'Paralyzing Palm':     'art/skilldex/hnd2hnd.png',  // LST 73  (unarmed perk)
    'Negotiator':          'art/skilldex/barter.png',   // LST 43  (FO2-CE frmId=43)
    'Thief':               'art/skilldex/steal.png',    // LST 38
    'Salesman':            'art/skilldex/barter.png',   // LST 43
}

// FO2-CE ref: editor.cc gCharacterEditorPrimaryStatDescriptions — value → adjective
export const STAT_COMMENTS = [
    '', 'Terrible', 'Bad', 'Poor', 'Fair', 'Average',
    'Good', 'Very Good', 'Great', 'Excellent', 'Heroic',
]

export const FOLDER_TABS = [
    { label: 'PERKS',  sprite: 'art/intrface/perksfdr.png' },
    { label: 'KARMA',  sprite: 'art/intrface/karmafdr.png' },
    { label: 'KILLS',  sprite: 'art/intrface/killsfdr.png' },
]

export const STATS  = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']
export const SKILLS = [
    'Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons',
    'Throwing', 'First Aid', 'Doctor', 'Sneak', 'Lockpick', 'Steal', 'Traps',
    'Science', 'Repair', 'Speech', 'Barter', 'Gambling', 'Outdoorsman',
]
export const TRAITS = Object.keys(TRAIT_DESCRIPTIONS)
