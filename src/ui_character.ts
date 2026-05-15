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

// FO2-CE ref: editor.cc — Character screen (view) + character creator (creation).
// showCharacterScreen()  — in-game read-only view (unchanged from before refactor).
// showCharacterCreator() — NEW GAME creation mode: allocate SPECIAL, pick traits/tags.
//
// Common data (descriptions, images, arrays) lives at module level so both
// functions share it without duplication.

import { Config } from './config.js'
import globalState from './globalState.js'
import { Widget } from './ui_widget.js'
import { font1, font2, font3, font4, makeFontLabel, renderBignum } from './ui_font.js'
import { WindowFrame, SmallButton, Label, List } from './ui_components.js'
import { makePanelDraggable } from './ui_drag.js'
import { StatSet, SkillSet, SkillCalcOptions } from './char.js'
import { Events } from './events.js'
import { getValidPerks, getPerkRank, applyPerk, PERKS } from './perks.js'

// ── Module-level constants ────────────────────────────────────────────────────

const SPECIAL_FULL_NAMES: Record<string, string> = {
    STR: 'Strength', PER: 'Perception', END: 'Endurance',
    CHA: 'Charisma', INT: 'Intelligence', AGI: 'Agility', LUK: 'Luck',
}
const SPECIAL_DESCRIPTIONS: Record<string, string> = {
    STR: 'Raw physical strength. A high Strength is good for physical characters. Modifies: Hit Points, Melee Damage, and Carry Weight.',
    PER: 'The ability to see, hear, taste and notice unusual things. A high Perception is important for a sharpshooter.  Modifies: Sequence and ranged combat distance modifiers.',
    END: 'Stamina and physical toughness. A character with a high Endurance will survive where others may not. Modifies: Hit Points, Poison & Radiation Resistance, Healing Rate, and the additional hit points per level.',
    CHA: 'A combination of appearance and charm. A high Charisma is important for characters that want to influence people with words. Modifies: NPC reactions, and barter prices.',
    INT: 'Knowledge, wisdom and the ability to think quickly. A high Intelligence is important for any character. Modifies: the number of new skill points per level, dialogue options, and many skills.',
    AGI: 'Coordination and the ability to move well. A high Agility is important for any active character. Modifies: Action Points, Armor Class, Sequence, and many skills.',
    LUK: 'Fate. Karma. An extremely high or low Luck will affect the character - somehow. Events and situations will be changed by how lucky (or unlucky) your character is.',
}
const SKILL_DESCRIPTIONS: Record<string, string> = {
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
const DERIVED_DESCRIPTIONS: Record<string, string> = {
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
const CONDITION_DESCRIPTIONS: Record<string, string> = {
    'Poisoned':           'You are poisoned. Lose HP over time until treated.',
    'Radiated':           'You have absorbed radiation. High levels are fatal.',
    'Eye Damage':         'Your eyes are damaged. Perception is reduced.',
    'Crippled Right Arm': 'Your arm is crippled. Combat effectiveness reduced.',
    'Crippled Left Arm':  'Your arm is crippled. Combat effectiveness reduced.',
    'Crippled Right Leg': 'Your leg is crippled. Movement is impaired.',
    'Crippled Left Leg':  'Your leg is crippled. Movement is impaired.',
}
const TRAIT_DESCRIPTIONS: Record<string, string> = {
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
const SPECIAL_IMG: Record<string, string> = {
    STR: 'art/skilldex/strength.png',
    PER: 'art/skilldex/perceptn.png',
    END: 'art/skilldex/endur.png',
    CHA: 'art/skilldex/charisma.png',
    INT: 'art/skilldex/intel.png',
    AGI: 'art/skilldex/agility.png',
    LUK: 'art/skilldex/luck.png',
}
const SKILL_IMG: Record<string, string> = {
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
const DERIVED_IMG: Record<string, string> = {
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
const CONDITION_IMG: Record<string, string> = {
    'Poisoned':           'art/skilldex/poisoned.png',
    'Radiated':           'art/skilldex/radiated.png',
    'Eye Damage':         'art/skilldex/eyedamag.png',
    'Crippled Right Arm': 'art/skilldex/armright.png',
    'Crippled Left Arm':  'art/skilldex/armleft.png',
    'Crippled Right Leg': 'art/skilldex/legright.png',
    'Crippled Left Leg':  'art/skilldex/legleft.png',
}
const TRAIT_IMG: Record<string, string> = {
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
    'Chem Reliant':    'art/skilldex/chemrely.png',
    'Chem Resistant':  'art/skilldex/chemrst.png',
    'Sex Appeal':      'art/skilldex/sexappel.png',
    'Skilled':         'art/skilldex/skilled.png',
    'Gifted':          'art/skilldex/gifted.png',
}
// FO2-CE ref: character_editor.cc — perk FRM IDs in SKILLDEX.LST start at index 72.
// Filenames are lowercased 8.3 FRM names as produced by exportImages.py.
const PERK_IMG: Record<string, string> = {
    'Awareness':           'art/skilldex/awarenes.png',
    'Bonus HtH Attacks':   'art/skilldex/bthtatck.png',
    'Bonus HtH Damage':    'art/skilldex/bhthdam.png',
    'Bonus Move':          'art/skilldex/bhmove.png',
    'Bonus Ranged Damage': 'art/skilldex/bhrnddam.png',
    'Bonus Rate of Fire':  'art/skilldex/bhrof.png',
    'Earlier Sequence':    'art/skilldex/earlseq.png',
    'Faster Healing':      'art/skilldex/fastheal.png',
    'More Criticals':      'art/skilldex/morecrit.png',
    'Night Vision':        'art/skilldex/nightvis.png',
    'Presence':            'art/skilldex/presence.png',
    'Rad Resistance':      'art/skilldex/radresit.png',
    'Toughness':           'art/skilldex/toughnes.png',
    'Strong Back':         'art/skilldex/strgback.png',
    'Sharpshooter':        'art/skilldex/sharpsh.png',
    'Silent Running':      'art/skilldex/slntrun.png',
    'Survivalist':         'art/skilldex/survivl.png',
    'Master Trader':       'art/skilldex/mastrtrd.png',
    'Educated':            'art/skilldex/educatd.png',
    'Healer':              'art/skilldex/healer.png',
    'Fortune Finder':      'art/skilldex/fortune.png',
    'Better Criticals':    'art/skilldex/bttrcrit.png',
    'Empathy':             'art/skilldex/empathy.png',
    'Slayer':              'art/skilldex/slayer.png',
    'Sniper':              'art/skilldex/sniper.png',
    'Silent Death':        'art/skilldex/slntdth.png',
    'Action Boy':          'art/skilldex/actnboy.png',
    'Mental Block':        'art/skilldex/mntlblck.png',
    'Lifegiver':           'art/skilldex/lifegvr.png',
    'Dodger':              'art/skilldex/dodger.png',
    'Snakeater':           'art/skilldex/snakeatr.png',
    'Mr. Fixit':           'art/skilldex/mrfixit.png',
    'Medic':               'art/skilldex/medic.png',
    'Master Medic':        'art/skilldex/mstrmdic.png',
    'Ghost':               'art/skilldex/ghost.png',
    'Cult of Personality': 'art/skilldex/cultpers.png',
    'Scrounger':           'art/skilldex/scrnger.png',
    'Explorer':            'art/skilldex/explorer.png',
    'Flower Child':        'art/skilldex/flwrchld.png',
    'Pathfinder':          'art/skilldex/pathfndr.png',
    'Animal Friend':       'art/skilldex/anmfrnd.png',
    'Scout':               'art/skilldex/scout.png',
    'Mysterious Stranger': 'art/skilldex/myststrn.png',
    'Ranger':              'art/skilldex/ranger.png',
    'Quick Pockets':       'art/skilldex/qckpktc.png',
    'Smooth Talker':       'art/skilldex/smthtalr.png',
    'Swift Learner':       'art/skilldex/swftlrn.png',
    'Tag!':                'art/skilldex/taggerr.png',
    'Mutate!':             'art/skilldex/mutater.png',
    'Adrenaline Rush':     'art/skilldex/adrenlrs.png',
    'Chem Reliant':        'art/skilldex/chemrely.png',
    'Chem Resistant':      'art/skilldex/chemrst.png',
    'Demolition Expert':   'art/skilldex/demolexp.png',
    'Heave Ho!':           'art/skilldex/heaveho.png',
    'Friendly Foe':        'art/skilldex/frndlyfo.png',
    'Light Step':          'art/skilldex/lgtstep.png',
    'Quick Recovery':      'art/skilldex/qckrecvr.png',
    'Paralyzing Palm':     'art/skilldex/parlzplm.png',
    'Pyromaniac':          'art/skilldex/pyromanc.png',
    'Negotiator':          'art/skilldex/negotiat.png',
    'Master Thief':        'art/skilldex/mastrtft.png',
    'Speaker':             'art/skilldex/speaker.png',
    'Thief':               'art/skilldex/thief.png',
    'Salesman':            'art/skilldex/salesman.png',
}

// FO2-CE ref: editor.cc gCharacterEditorPrimaryStatDescriptions — value → adjective
const STAT_COMMENTS = [
    '', 'Terrible', 'Bad', 'Poor', 'Fair', 'Average',
    'Good', 'Very Good', 'Great', 'Excellent', 'Heroic',
]

const FOLDER_TABS = [
    { label: 'PERKS',  sprite: 'art/intrface/perksfdr.png' },
    { label: 'KARMA',  sprite: 'art/intrface/karmafdr.png' },
    { label: 'KILLS',  sprite: 'art/intrface/killsfdr.png' },
]

const STATS  = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']
const SKILLS = [
    'Small Guns', 'Big Guns', 'Energy Weapons', 'Unarmed', 'Melee Weapons',
    'Throwing', 'First Aid', 'Doctor', 'Sneak', 'Lockpick', 'Steal', 'Traps',
    'Science', 'Repair', 'Speech', 'Barter', 'Gambling', 'Outdoorsman',
]
const TRAITS = Object.keys(TRAIT_DESCRIPTIONS)

// ── Window singleton ──────────────────────────────────────────────────────────

let characterWindow: WindowFrame

export function getCharacterWindow(): WindowFrame | null {
    return characterWindow ?? null
}

export function closeCharacterScreen(): void {
    if (characterWindow && characterWindow.showing) {
        characterWindow.close()
    }
}

// ── showCharacterScreen() ─────────────────────────────────────────────────────
// In-game read-only view — behavior identical to original.

export function showCharacterScreen() {
    const player = globalState.player!

    // FO2-CE ref: stat.cc pcGetExperienceForLevel() — XP needed for next level
    const currentLevel = player.getStat('Level')
    const nextLevelXP = Math.floor((currentLevel + 1) * currentLevel / 2) * 1000

    // Skill point bignum container
    const skillPointBignumW = new Widget(null, { x: 523, y: 228, w: 28, h: 28 })
    const skillPointBignumEl = skillPointBignumW.elem

    // Panel 2: Hit Points + condition flags (upper status box)
    const panel2 = new Widget(null, { x: 196, y: 43, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel2El = panel2.elem

    // Panel 3: derived stats (lower status box)
    const panel3 = new Widget(null, { x: 196, y: 176, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel3El = panel3.elem

    // Slider widget elements (initially hidden)
    const sliderContainer = document.createElement('div')
    Object.assign(sliderContainer.style, {
        position: 'absolute',
        zIndex: '10',
    })

    const sliderBody = document.createElement('div')
    Object.assign(sliderBody.style, {
        position: 'absolute',
        width: '43px',
        height: '29px',
        backgroundImage: "url('art/intrface/slider.png')",
        backgroundRepeat: 'no-repeat',
        left: '-8px',
        top: '-10px',
    })

    const plusBtn = document.createElement('div')
    Object.assign(plusBtn.style, {
        position: 'absolute',
        width: '22px',
        height: '12px',
        backgroundImage: "url('art/intrface/splsoff.png')",
        backgroundRepeat: 'no-repeat',
        cursor: 'pointer',
        left: '14px',
        top: '-7px',
        zIndex: '1',
    })

    const minusBtn = document.createElement('div')
    Object.assign(minusBtn.style, {
        position: 'absolute',
        width: '22px',
        height: '12px',
        backgroundImage: "url('art/intrface/snegoff.png')",
        backgroundRepeat: 'no-repeat',
        cursor: 'pointer',
        left: '14px',
        top: '4px',
        zIndex: '1',
    })

    sliderContainer.appendChild(sliderBody)
    sliderContainer.appendChild(plusBtn)
    sliderContainer.appendChild(minusBtn)

    const doneButton = new SmallButton(455, 454)

    characterWindow = new WindowFrame(
        'art/intrface/edtredt.png',
        {
            x: Config.ui.screenWidth / 2 - 640 / 2,
            y: Config.ui.screenHeight - 99 - 480,
        },
        640,
        480
    )
        // FO2-CE ref: editor.cc — Print / Done / Cancel buttons
        .add(new SmallButton(345, 454))
        .add(makeFontLabel(345 + 18, 454, 'PRINT', font3).css({ pointerEvents: 'none' }))
        .add(doneButton)
        .add(makeFontLabel(455 + 18, 454, 'DONE', font3).css({ pointerEvents: 'none' }))
        .add(
            new SmallButton(552, 454).onClick(() => {
                characterWindow.close()
            })
        )
        .add(makeFontLabel(552 + 18, 454, 'CANCEL', font3).css({ pointerEvents: 'none' }))
        .add(
            new Label(33, 278, `Level: ${currentLevel}`).css({
                fontSize: '0.69em',
                color: '#00FF00',
            })
        )
        .add(
            new Label(33, 289, `Exp: ${player.getStat('Experience')}`).css({
                fontSize: '0.69em',
                color: '#00FF00',
            })
        )
        .add(
            new Label(33, 300, `Next Level: ${nextLevelXP}`).css({
                fontSize: '0.69em',
                color: '#00FF00',
            })
        )
        .add(makeFontLabel(380, 5, 'Skills', font3))
        .add(makeFontLabel(399, 233, 'Skill Points', font3))
        .add(panel2)
        .add(panel3)
        .add(skillPointBignumW)
        .show()

    const skillRowsEl = document.createElement('div')
    Object.assign(skillRowsEl.style, {
        position: 'absolute',
        left: '380px',
        top: '25px',
        fontSize: '0.69em',
    })
    characterWindow.elem.appendChild(skillRowsEl)

    characterWindow.elem.appendChild(sliderContainer)

    // ── Identity display: inert clones of creator trigger buttons ────────────
    // Name — nameoff.png sprite + font3 name text on top
    const screenNameBtn = document.createElement('div')
    Object.assign(screenNameBtn.style, {
        position: 'absolute', left: '11px', top: '0px',
        width: '145px', height: '35px',
        backgroundImage: "url('art/intrface/nameoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(screenNameBtn)

    const screenNameLbl = document.createElement('div')
    Object.assign(screenNameLbl.style, {
        position: 'absolute', left: '33px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })
    font3.onLoad(() => {
        screenNameLbl.appendChild(font3.renderText(player.name || 'none', '#FFD700'))
    })
    characterWindow.elem.appendChild(screenNameLbl)

    // Age — ageoff.png sprite + font3 age text on top
    const screenAgeBtn = document.createElement('div')
    Object.assign(screenAgeBtn.style, {
        position: 'absolute', left: '156px', top: '0px',
        width: '81px', height: '35px',
        backgroundImage: "url('art/intrface/ageoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(screenAgeBtn)

    const screenAgeLbl = document.createElement('div')
    Object.assign(screenAgeLbl.style, {
        position: 'absolute', left: '184px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })
    font3.onLoad(() => {
        screenAgeLbl.appendChild(font3.renderText(String(player.getStat('Age')), '#FFD700'))
    })
    characterWindow.elem.appendChild(screenAgeLbl)

    // Sex — sexoff.png sprite + font3 gender text on top
    const screenSexBtn = document.createElement('div')
    Object.assign(screenSexBtn.style, {
        position: 'absolute', left: '237px', top: '0px',
        width: '80px', height: '35px',
        backgroundImage: "url('art/intrface/sexoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(screenSexBtn)

    const screenSexLbl = document.createElement('div')
    Object.assign(screenSexLbl.style, {
        position: 'absolute', left: '248px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })
    font3.onLoad(() => {
        screenSexLbl.appendChild(font3.renderText(player.gender === 'female' ? 'Female' : 'Male', '#FFD700'))
    })
    characterWindow.elem.appendChild(screenSexLbl)

    // --- Folder tab strip (Perks / Karma / Kills) ---
    const tabStripEl = document.createElement('div')
    Object.assign(tabStripEl.style, {
        position: 'absolute',
        left: '15px',
        top: '330px',
    })

    const tabImg = document.createElement('img')
    tabImg.src = FOLDER_TABS[0].sprite
    tabImg.style.display = 'block'
    tabImg.style.pointerEvents = 'none'
    tabStripEl.appendChild(tabImg)

    const tabOverlayEl = document.createElement('div')
    Object.assign(tabOverlayEl.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        display: 'flex',
    })
    tabStripEl.appendChild(tabOverlayEl)

    const tabContentEl = document.createElement('div')
    Object.assign(tabContentEl.style, {
        position: 'absolute',
        left: '30px',
        top: '370px',
        fontSize: '0.69em',
        color: '#00FF00',
    })

    const folderPanels: HTMLElement[] = FOLDER_TABS.map((t, i) => {
        const panel = document.createElement('div')
        if (i === 0) {
            const perks = player.perks ?? []
            if (perks.length === 0) {
                const none = document.createElement('div')
                none.textContent = 'No perks.'
                none.style.color = '#00FF00'
                panel.appendChild(none)
            } else {
                const counts: Record<string, number> = {}
                for (const p of perks) counts[p] = (counts[p] ?? 0) + 1
                for (const [perkName, rank] of Object.entries(counts)) {
                    const def = PERKS.find(d => d.name === perkName)
                    const line = document.createElement('div')
                    line.textContent = rank > 1 ? `${perkName} (${rank})` : perkName
                    line.style.color = '#FFD700'
                    line.style.cursor = 'pointer'
                    line.onclick = () => showInfoCard(perkName, def?.description ?? perkName, undefined)
                    panel.appendChild(line)
                }
            }
        } else {
            panel.textContent = t.label
        }
        panel.style.display = i === 0 ? 'block' : 'none'
        tabContentEl.appendChild(panel)
        return panel
    })

    let activeFolder = 0
    const activateFolder = (idx: number) => {
        activeFolder = idx
        tabImg.src = FOLDER_TABS[idx].sprite
        folderPanels.forEach((p, i) => { p.style.display = i === idx ? 'block' : 'none' })
    }

    FOLDER_TABS.forEach((tab, idx) => {
        const region = document.createElement('div')
        Object.assign(region.style, {
            flex: '1',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        })
        region.onclick = () => activateFolder(idx)

        font3.onLoad(() => {
            const lbl = font3.renderText(tab.label, '#FFD700')
            lbl.style.pointerEvents = 'none'
            region.appendChild(lbl)
        })

        tabOverlayEl.appendChild(region)
    })

    characterWindow.elem.appendChild(tabStripEl)
    characterWindow.elem.appendChild(tabContentEl)

    makePanelDraggable(characterWindow.elem)

    // ── Info card ─────────────────────────────────────────────────────────────
    const cardImgEl = document.createElement('img') as HTMLImageElement
    Object.assign(cardImgEl.style, {
        position: 'absolute',
        left: '483px',
        top: '308px',
        width: '140px',
        height: '117px',
        objectFit: 'contain',
        visibility: 'hidden',
        cursor: 'grab',
    })
    cardImgEl.onload = () => { cardImgEl.style.visibility = 'visible' }
    cardImgEl.onerror = () => { cardImgEl.style.visibility = 'hidden' }
    characterWindow.elem.appendChild(cardImgEl)
    makePanelDraggable(cardImgEl)

    const cardTitleEl = document.createElement('div')
    Object.assign(cardTitleEl.style, {
        position: 'absolute',
        left: '348px',
        top: '274px',
        background: 'transparent',
        border: 'none',
        padding: '0',
        cursor: 'grab',
        pointerEvents: 'auto',
        width: '265px',
    })
    characterWindow.elem.appendChild(cardTitleEl)
    makePanelDraggable(cardTitleEl)

    const cardBodyEl = document.createElement('div')
    Object.assign(cardBodyEl.style, {
        position: 'absolute',
        left: '348px',
        top: '313px',
        width: '130px',
        background: 'transparent',
        border: 'none',
        padding: '0',
        cursor: 'grab',
        pointerEvents: 'auto',
    })
    characterWindow.elem.appendChild(cardBodyEl)
    makePanelDraggable(cardBodyEl)

    const cardDividerEl = document.createElement('hr')
    Object.assign(cardDividerEl.style, {
        border: 'none',
        borderTop: '2px solid #000000',
        margin: '2px 0',
        width: '100%',
    })
    cardTitleEl.appendChild(cardDividerEl)

    const cardDescEl = document.createElement('div')
    Object.assign(cardDescEl.style, {
        fontSize: '0.69em',
        color: '#000000',
        overflow: 'hidden',
        lineHeight: '1.3',
    })
    cardBodyEl.appendChild(cardDescEl)

    const showInfoCard = (title: string, desc: string, imgPath?: string): void => {
        if (cardTitleEl.firstChild && cardTitleEl.firstChild !== cardDividerEl) cardTitleEl.removeChild(cardTitleEl.firstChild)
        cardTitleEl.insertBefore(font2.renderText(title.toUpperCase(), '#000000'), cardDividerEl)
        cardDescEl.textContent = desc
        if (imgPath) {
            cardImgEl.src = imgPath
        } else {
            cardImgEl.src = ''
            cardImgEl.style.visibility = 'hidden'
        }
    }
    // ── end info card ──────────────────────────────────────────────────────────

    const statValueWidgets: HTMLElement[] = []
    const statCommentLabels: Label[] = []

    let selectedStat = STATS[0]

    let n = 0
    for (const stat of STATS) {
        const valW = new Widget(null, { x: 59, y: 37 + n, w: 28, h: 28 })
        valW.css({ cursor: 'pointer' }).onClick(() => {
            selectedStat = stat
            showInfoCard(SPECIAL_FULL_NAMES[stat], SPECIAL_DESCRIPTIONS[stat], SPECIAL_IMG[stat])
        })
        statValueWidgets.push(valW.elem)
        characterWindow.add(valW)

        const commentLbl = new Label(105, 43 + n, '', '#00FF00').css({ fontSize: '0.69em' }) as Label
        statCommentLabels.push(commentLbl)
        characterWindow.add(commentLbl)

        n += 33
    }

    const newStatSet = globalState.player!.stats.clone()
    const newSkillSet = globalState.player!.skills.clone()
    const playerSkillOpts = { isPlayer: true, perks: globalState.player!.perks }

    const openingBaseSkills: { [name: string]: number } = {}
    for (const skill of SKILLS) {
        openingBaseSkills[skill] = newSkillSet.getBase(skill)
    }

    let selectedSkill: string | null = SKILLS[0]

    const positionSlider = () => {
        if (!selectedSkill) {
            sliderContainer.style.display = 'none'
            return
        }
        const idx = SKILLS.indexOf(selectedSkill)
        if (idx === -1) {
            sliderContainer.style.display = 'none'
            return
        }
        const rowEl = skillRowsEl.children[idx] as HTMLElement | undefined
        if (!rowEl) {
            sliderContainer.style.display = 'none'
            return
        }
        sliderContainer.style.left = '602px'
        sliderContainer.style.top = `${skillRowsEl.offsetTop + rowEl.offsetTop}px`
        sliderContainer.style.display = 'block'
    }

    const updateSkillPointBignum = () => {
        while (skillPointBignumEl.firstChild) skillPointBignumEl.removeChild(skillPointBignumEl.firstChild)
        skillPointBignumEl.appendChild(renderBignum(newSkillSet.skillPoints, 2))
    }

    // FO2-CE ref: editor.cc EDITOR_* condition flags
    const CONDITIONS: Array<[string, () => boolean]> = [
        ['Poisoned',            () => player.getStat('Poison Level') > 0],
        ['Radiated',            () => player.getStat('Radiation Level') > 0],
        ['Eye Damage',          () => !!player.isBlinded],
        ['Crippled Right Arm',  () => !!player.crippledRightArm],
        ['Crippled Left Arm',   () => !!player.crippledLeftArm],
        ['Crippled Right Leg',  () => !!player.crippledRightLeg],
        ['Crippled Left Leg',   () => !!player.crippledLeftLeg],
    ]

    const renderPanel2 = () => {
        while (panel2El.firstChild) panel2El.removeChild(panel2El.firstChild)

        const hp = document.createElement('div')
        hp.textContent = `Hit Points: ${player.getStat('HP')} / ${player.getStat('Max HP')}`
        panel2El.appendChild(hp)

        for (const [label, active] of CONDITIONS) {
            const line = document.createElement('div')
            line.textContent = label
            line.style.opacity = active() ? '1' : '0.3'
            line.style.cursor = 'pointer'
            line.onclick = () => showInfoCard(label, CONDITION_DESCRIPTIONS[label] ?? label, CONDITION_IMG[label])
            panel2El.appendChild(line)
        }
    }

    const renderPanel3 = () => {
        while (panel3El.firstChild) panel3El.removeChild(panel3El.firstChild)

        const rows: Array<[string, string | number]> = [
            ['Armor Class',          newStatSet.get('AC')],
            ['Action Points',        newStatSet.get('AP')],
            ['Carry Weight',         newStatSet.get('Carry')],
            ['Melee Damage',         newStatSet.get('Melee')],
            ['Damage Resistance',    `${newStatSet.get('DR Normal')}%`],
            ['Poison Resistance',    `${newStatSet.get('DR Poison')}%`],
            ['Radiation Resistance', `${newStatSet.get('DR Radiation')}%`],
            ['Sequence',             newStatSet.get('Sequence')],
            ['Healing Rate',         newStatSet.get('Healing Rate')],
            ['Critical Chance',      `${newStatSet.get('Critical Chance')}%`],
        ]
        for (const [label, value] of rows) {
            const line = document.createElement('div')
            line.textContent = `${label}: ${value}`
            line.style.cursor = 'pointer'
            line.onclick = () => showInfoCard(label, DERIVED_DESCRIPTIONS[label] ?? label, DERIVED_IMG[label])
            panel3El.appendChild(line)
        }
    }

    const redrawStatsSkills = () => {
        while (skillRowsEl.firstChild) skillRowsEl.removeChild(skillRowsEl.firstChild)

        for (const skill of SKILLS) {
            const val = newSkillSet.get(skill, newStatSet, playerSkillOpts)
            const isTagged = newSkillSet.tagged.includes(skill)
            const row = document.createElement('div')
            Object.assign(row.style, {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                minWidth: '215px',
                cursor: 'pointer',
                color: isTagged ? '#FFD700' : '#00FF00',
            })
            const nameSpan = document.createElement('span')
            nameSpan.textContent = skill
            const valSpan = document.createElement('span')
            valSpan.textContent = `${val}%`
            row.appendChild(nameSpan)
            row.appendChild(valSpan)
            const capturedSkill = skill
            row.onclick = () => {
                selectedSkill = capturedSkill
                positionSlider()
                showInfoCard(capturedSkill, SKILL_DESCRIPTIONS[capturedSkill] ?? capturedSkill, SKILL_IMG[capturedSkill])
            }
            skillRowsEl.appendChild(row)
        }

        for (let i = 0; i < STATS.length; i++) {
            const el = statValueWidgets[i]
            while (el.firstChild) el.removeChild(el.firstChild)
            const value = newStatSet.get(STATS[i])
            el.appendChild(renderBignum(value, 2))

            const clamped = Math.max(1, Math.min(10, value))
            statCommentLabels[i].setText(STAT_COMMENTS[clamped])
        }

        updateSkillPointBignum()
        renderPanel2()
        renderPanel3()

        positionSlider()
    }

    const modifySkill = (inc: boolean) => {
        if (!selectedSkill) return

        if (inc) {
            const changed = newSkillSet.incBase(selectedSkill, newStatSet, playerSkillOpts)
            if (!changed) {
                console.warn('Not enough skill points or at skill cap!')
            }
        } else {
            const currentBase = newSkillSet.getBase(selectedSkill)
            if (currentBase <= openingBaseSkills[selectedSkill]) return
            newSkillSet.decBase(selectedSkill, newStatSet, playerSkillOpts)
        }

        redrawStatsSkills()
    }

    const wireSkillButton = (
        btn: HTMLElement,
        onSprite: string,
        offSprite: string,
        inc: boolean
    ) => {
        let repeatTimer: number | null = null
        const stopRepeat = () => {
            if (repeatTimer !== null) { clearInterval(repeatTimer); repeatTimer = null }
        }
        btn.onmousedown = () => {
            btn.style.backgroundImage = `url('${onSprite}')`
            modifySkill(inc)
            repeatTimer = window.setInterval(() => modifySkill(inc), 100)
        }
        btn.onmouseup = () => {
            btn.style.backgroundImage = `url('${offSprite}')`
            stopRepeat()
        }
        btn.onmouseleave = () => {
            btn.style.backgroundImage = `url('${offSprite}')`
            stopRepeat()
        }
    }

    wireSkillButton(plusBtn, 'art/intrface/splson.png', 'art/intrface/splsoff.png', true)
    wireSkillButton(minusBtn, 'art/intrface/snegon.png', 'art/intrface/snegoff.png', false)

    redrawStatsSkills()
    showInfoCard(SPECIAL_FULL_NAMES['STR'], SPECIAL_DESCRIPTIONS['STR'], SPECIAL_IMG['STR'])

    // Stat level up buttons (char creation only)
    const canChangeStats = false
    if (canChangeStats) {
        const modifyStat = (change: number) => {
            newStatSet.modifyBase(selectedStat, change)
            redrawStatsSkills()
        }

        characterWindow.add(
            new Label(115, 260, '-').onClick(() => { modifyStat(-1) })
        )
        characterWindow.add(
            new Label(135, 260, '+').onClick(() => { modifyStat(+1) })
        )
    }

    // FO2-CE ref: editor.cc — Done button: write cloned stats/skills back to player
    doneButton.onClick(() => {
        player.skills.baseSkills = Object.assign({}, newSkillSet.baseSkills)
        player.skills.tagged = newSkillSet.tagged.slice()
        player.skills.skillPoints = newSkillSet.skillPoints
        player.skills.hasTagPerk = newSkillSet.hasTagPerk

        if (canChangeStats) {
            player.stats.baseStats = Object.assign({}, newStatSet.baseStats)
        }

        console.log('[CharScreen] Changes saved.')
        characterWindow.close()
    })
}

// ── showCharacterCreator() ────────────────────────────────────────────────────
// FO2-CE ref: editor.cc editorRun() — character creation mode.
// Called from the main menu NEW GAME path via ui_charactercreator.ts.
//
// onDone   — called after valid DONE (player stats applied, start the game)
// onCancel — called when CANCEL is clicked (returns to main menu)

export function showCharacterCreator(onDone: () => void, onCancel: () => void): void {
    const player = globalState.player!

    // Fresh stat/skill sets — all SPECIAL at default (5); no invested points
    const newStatSet = new StatSet()
    const newSkillSet = new SkillSet()



    // Creation-mode state
    let pool = 5                                   // bonus SPECIAL points to allocate
    let selectedTraits: string[] = []
    let playerName = 'none'
    let playerAge = 25
    let playerSex: 'Male' | 'Female' = 'Male'

    // SkillCalcOptions — traits array updated live so skill list reflects Good Natured etc.
    const skillOpts: SkillCalcOptions = { isPlayer: true, perks: [], traits: selectedTraits }

    // ── Skill point pool bignum (not used in creation — tags only) ────────────
    const skillPointBignumW = new Widget(null, { x: 523, y: 228, w: 28, h: 28 })
    // In creation mode we show a pool label instead of skill points
    skillPointBignumW.css({ display: 'none' })

    // ── Panel 2: HP display (conditions all inactive for new character) ────────
    const panel2 = new Widget(null, { x: 196, y: 43, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel2El = panel2.elem

    // ── Panel 3: derived stats ────────────────────────────────────────────────
    const panel3 = new Widget(null, { x: 196, y: 176, w: 'auto', h: 'auto' })
        .css({ fontSize: '0.69em', color: '#00FF00', whiteSpace: 'pre', lineHeight: '1.2' })
    const panel3El = panel3.elem

    // ── Skill rows container (replaces List widget) ───────────────────────────
    const skillRowsEl = document.createElement('div')
    Object.assign(skillRowsEl.style, {
        position: 'absolute',
        left: '356px',
        top: '25px',
        width: '240px',
        fontSize: '0.69em',
    })

    // ── Build WindowFrame ─────────────────────────────────────────────────────
    const doneBtn = new SmallButton(455, 454)
    const cancelBtn = new SmallButton(552, 454)

    characterWindow = new WindowFrame(
        'art/intrface/edtrcrte.png',
        {
            x: Config.ui.screenWidth / 2 - 640 / 2,
            y: Config.ui.screenHeight - 99 - 480,
        },
        640,
        480
    )
        .add(doneBtn)
        .add(makeFontLabel(455 + 18, 454, 'DONE', font3).css({ pointerEvents: 'none' }))
        .add(cancelBtn)
        .add(makeFontLabel(552 + 18, 454, 'CANCEL', font3).css({ pointerEvents: 'none' }))
        .add(makeFontLabel(380, 5, 'Skills', font3))
        .add(panel2)
        .add(panel3)
        .add(skillPointBignumW)
        .show()

    characterWindow.elem.appendChild(skillRowsEl)
    makePanelDraggable(characterWindow.elem)

    // ── Info card ─────────────────────────────────────────────────────────────
    const cardImgEl = document.createElement('img') as HTMLImageElement
    Object.assign(cardImgEl.style, {
        position: 'absolute',
        left: '483px',
        top: '308px',
        width: '140px',
        height: '117px',
        objectFit: 'contain',
        visibility: 'hidden',
        cursor: 'grab',
    })
    cardImgEl.onload = () => { cardImgEl.style.visibility = 'visible' }
    cardImgEl.onerror = () => { cardImgEl.style.visibility = 'hidden' }
    characterWindow.elem.appendChild(cardImgEl)
    makePanelDraggable(cardImgEl)

    const cardTitleEl = document.createElement('div')
    Object.assign(cardTitleEl.style, {
        position: 'absolute',
        left: '348px',
        top: '274px',
        background: 'transparent',
        border: 'none',
        padding: '0',
        cursor: 'grab',
        pointerEvents: 'auto',
        width: '265px',
    })
    characterWindow.elem.appendChild(cardTitleEl)
    makePanelDraggable(cardTitleEl)

    const cardBodyEl = document.createElement('div')
    Object.assign(cardBodyEl.style, {
        position: 'absolute',
        left: '348px',
        top: '313px',
        width: '130px',
        background: 'transparent',
        border: 'none',
        padding: '0',
        cursor: 'grab',
        pointerEvents: 'auto',
    })
    characterWindow.elem.appendChild(cardBodyEl)
    makePanelDraggable(cardBodyEl)

    const cardDividerEl = document.createElement('hr')
    Object.assign(cardDividerEl.style, {
        border: 'none',
        borderTop: '2px solid #000000',
        margin: '2px 0',
        width: '100%',
    })
    cardTitleEl.appendChild(cardDividerEl)

    const cardDescEl = document.createElement('div')
    Object.assign(cardDescEl.style, {
        fontSize: '0.69em',
        color: '#000000',
        overflow: 'hidden',
        lineHeight: '1.3',
    })
    cardBodyEl.appendChild(cardDescEl)

    const showInfoCard = (title: string, desc: string, imgPath?: string): void => {
        if (cardTitleEl.firstChild && cardTitleEl.firstChild !== cardDividerEl) cardTitleEl.removeChild(cardTitleEl.firstChild)
        cardTitleEl.insertBefore(font2.renderText(title.toUpperCase(), '#000000'), cardDividerEl)
        cardDescEl.textContent = desc
        if (imgPath) {
            cardImgEl.src = imgPath
        } else {
            cardImgEl.src = ''
            cardImgEl.style.visibility = 'hidden'
        }
    }

    // ── Stat value widgets (bignum displays) ──────────────────────────────────
    const statValueWidgets: HTMLElement[] = []
    const statCommentLabels: Label[] = []

    let n = 0
    for (const stat of STATS) {
        const valW = new Widget(null, { x: 59, y: 37 + n, w: 28, h: 28 })
        valW.css({ cursor: 'pointer' }).onClick(() => {
            showInfoCard(SPECIAL_FULL_NAMES[stat], SPECIAL_DESCRIPTIONS[stat], SPECIAL_IMG[stat])
        })
        statValueWidgets.push(valW.elem)
        characterWindow.add(valW)

        const commentLbl = new Label(105, 43 + n, '', '#00FF00').css({ fontSize: '0.69em' }) as Label
        statCommentLabels.push(commentLbl)
        characterWindow.add(commentLbl)

        n += 33
    }

    // ── Pool display: "Skill Points" label + bignum value ────────────────────
    const poolTextEl = document.createElement('div')
    Object.assign(poolTextEl.style, {
        position: 'absolute',
        left: '15px',
        top: '287px',
        pointerEvents: 'none',
    })
    font3.onLoad(() => {
        poolTextEl.appendChild(font3.renderText('Char Points', '#FFD700'))
    })
    characterWindow.elem.appendChild(poolTextEl)

    const poolBignumContainer = document.createElement('div')
    Object.assign(poolBignumContainer.style, {
        position: 'absolute',
        left: '128px',
        top: '282px',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(poolBignumContainer)

    const updatePoolLabel = () => {
        while (poolBignumContainer.firstChild) poolBignumContainer.removeChild(poolBignumContainer.firstChild)
        poolBignumContainer.appendChild(renderBignum(pool, 2))
    }
    updatePoolLabel()

    // ── SPECIAL ± buttons (stplsoff/stplson · stnegoff/stnegon) ─────────────
    const wireEbut = (btn: HTMLElement, imgOff: string, imgOn: string, onPress: () => void) => {
        btn.onmousedown  = () => { btn.style.backgroundImage = `url('${imgOn}')`;  onPress() }
        btn.onmouseup    = () => { btn.style.backgroundImage = `url('${imgOff}')` }
        btn.onmouseleave = () => { btn.style.backgroundImage = `url('${imgOff}')` }
    }

    let si = 0
    for (const stat of STATS) {
        const upBtn = document.createElement('div')
        Object.assign(upBtn.style, {
            position: 'absolute',
            left: '149px',
            top: `${38 + si * 33}px`,
            width: '16px',
            height: '12px',
            backgroundImage: "url('art/intrface/stplsoff.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '16px 12px',
            cursor: 'pointer',
            zIndex: '2',
        })

        const dnBtn = document.createElement('div')
        Object.assign(dnBtn.style, {
            position: 'absolute',
            left: '149px',
            top: `${48 + si * 33}px`,
            width: '16px',
            height: '12px',
            backgroundImage: "url('art/intrface/stnegoff.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '16px 12px',
            cursor: 'pointer',
            zIndex: '2',
        })

        const capturedStat = stat
        wireEbut(upBtn, 'art/intrface/stplsoff.png', 'art/intrface/stplson.png', () => {
            if (pool <= 0) return
            const cur = newStatSet.getBase(capturedStat)
            if (cur >= 10) return
            newStatSet.setBase(capturedStat, cur + 1)
            pool--
            updatePoolLabel()
            redrawStatsSkills()
        })
        wireEbut(dnBtn, 'art/intrface/stnegoff.png', 'art/intrface/stnegon.png', () => {
            const cur = newStatSet.getBase(capturedStat)
            if (cur <= 1) return
            newStatSet.setBase(capturedStat, cur - 1)
            pool++
            updatePoolLabel()
            redrawStatsSkills()
        })

        characterWindow.elem.appendChild(upBtn)
        characterWindow.elem.appendChild(dnBtn)
        si++
    }

    // ── Popup helper ──────────────────────────────────────────────────────────
    let popupEscHandler: ((e: KeyboardEvent) => void) | null = null

    const closePopup = () => {
        const el = document.getElementById('creator-popup-overlay')
        if (el) el.remove()
        if (popupEscHandler) {
            document.removeEventListener('keydown', popupEscHandler)
            popupEscHandler = null
        }
    }

    const openCreatorPopup = (type: 'name' | 'age' | 'sex', onConfirm: () => void) => {
        closePopup()

        let applyFn: () => void = () => {}
        const confirmAndClose = () => { applyFn(); onConfirm(); closePopup() }

        const overlay = document.createElement('div')
        overlay.id = 'creator-popup-overlay'
        Object.assign(overlay.style, {
            position: 'fixed', zIndex: '2000',
            left: '0', top: '0', width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)',
        })
        overlay.onclick = (e) => { if (e.target === overlay) closePopup() }

        const box = document.createElement('div')
        Object.assign(box.style, {
            position: 'relative',
            backgroundImage: "url('art/intrface/charwin.png')",
            backgroundRepeat: 'no-repeat',
            backgroundSize: '100% 100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 12px 8px',
            minWidth: '139px',
            minHeight: '72px',
            boxSizing: 'border-box',
        })
        box.onclick = (e) => e.stopPropagation()

        const contentEl = document.createElement('div')
        Object.assign(contentEl.style, {
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '4px',
            flex: '1', width: '100%',
        })
        box.appendChild(contentEl)

        // ── DONE button row ──────────────────────────────────────────────────
        const doneRow = document.createElement('div')
        Object.assign(doneRow.style, {
            position: 'relative',
            left: '-13px', top: '-1px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'flex-end', width: '100%', gap: '4px',
        })

        const doneBoxEl = document.createElement('div')
        Object.assign(doneBoxEl.style, {
            position: 'absolute', left: '18px', top: '-3px',
            width: '108px', height: '24px',
            backgroundImage: "url('art/intrface/donebox.png')",
            backgroundRepeat: 'no-repeat', backgroundSize: '108px 24px',
            pointerEvents: 'none', zIndex: '0',
        })
        doneRow.appendChild(doneBoxEl)

        const doneLblEl = document.createElement('div')
        Object.assign(doneLblEl.style, { pointerEvents: 'none', zIndex: '1', position: 'relative' })
        font3.onLoad(() => { doneLblEl.appendChild(font3.renderText('DONE')) })

        const doneBtn = document.createElement('div')
        Object.assign(doneBtn.style, {
            width: '15px', height: '16px',
            backgroundImage: "url('art/intrface/lilredup.png')",
            backgroundRepeat: 'no-repeat', backgroundSize: '15px 16px',
            cursor: 'pointer', zIndex: '1', position: 'relative',
        })
        doneBtn.onmousedown  = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilreddn.png')" }
        doneBtn.onmouseup    = doneBtn.onmouseleave = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilredup.png')" }
        doneBtn.onclick      = () => confirmAndClose()

        doneRow.appendChild(doneLblEl)
        doneRow.appendChild(doneBtn)
        box.appendChild(doneRow)

        // ── Per-type content ─────────────────────────────────────────────────
        if (type === 'name') {
            const nameBoxBg = document.createElement('div')
            Object.assign(nameBoxBg.style, {
                position: 'absolute',
                width: '111px', height: '20px',
                backgroundImage: "url('art/intrface/namebox.png')",
                backgroundRepeat: 'no-repeat', backgroundSize: '111px 20px',
                pointerEvents: 'none', zIndex: '1',
            })
            contentEl.style.position = 'relative'
            contentEl.appendChild(nameBoxBg)

            const inp = document.createElement('input')
            Object.assign(inp, { type: 'text', maxLength: 11, value: playerName })
            Object.assign(inp.style, {
                position: 'relative', zIndex: '2',
                fontSize: '0.9em', color: '#FFD700',
                background: 'transparent', border: 'none',
                borderBottom: '1px solid #806814',
                fontFamily: 'monospace', outline: 'none',
                width: '110px', textAlign: 'center',
            })
            inp.addEventListener('keydown', (e) => {
                e.stopPropagation()
                if (e.key === 'Enter') confirmAndClose()
                if (e.key === 'Escape') closePopup()
            })
            inp.addEventListener('keyup',    (e) => e.stopPropagation())
            inp.addEventListener('keypress', (e) => e.stopPropagation())

            applyFn = () => { playerName = inp.value.trim() || playerName }
            contentEl.appendChild(inp)
            setTimeout(() => inp.focus(), 0)

        } else if (type === 'age') {
            let popupAge = playerAge
            const bignumEl = document.createElement('div')

            const refreshBignum = () => {
                while (bignumEl.firstChild) bignumEl.removeChild(bignumEl.firstChild)
                bignumEl.appendChild(renderBignum(popupAge, 2))
            }
            refreshBignum()

            const makeArrow = (upSrc: string, dnSrc: string, delta: number) => {
                const btn = document.createElement('div')
                Object.assign(btn.style, {
                    width: '20px', height: '18px',
                    backgroundImage: `url('art/intrface/${upSrc}')`,
                    backgroundRepeat: 'no-repeat', backgroundSize: '20px 18px',
                    cursor: 'pointer',
                    position: 'relative', zIndex: '3',
                })
                btn.onmousedown = () => { btn.style.backgroundImage = `url('art/intrface/${dnSrc}')` }
                btn.onmouseup = btn.onmouseleave = () => { btn.style.backgroundImage = `url('art/intrface/${upSrc}')` }
                btn.onclick = () => {
                    const next = popupAge + delta
                    if (next >= 16 && next <= 35) { popupAge = next; refreshBignum() }
                }
                return btn
            }

            Object.assign(bignumEl.style, { position: 'relative', zIndex: '3' })

            const ageBoxBg = document.createElement('div')
            Object.assign(ageBoxBg.style, {
                backgroundImage: "url('art/intrface/agebox.png')",
                backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
                pointerEvents: 'none', zIndex: '1',
                position: 'absolute',
                width: '124px', height: '29px',
            })
            contentEl.style.position = 'relative'
            contentEl.style.gap = '17px'
            contentEl.appendChild(ageBoxBg)

            applyFn = () => { playerAge = popupAge }
            contentEl.appendChild(makeArrow('slu.png', 'sld.png', -1))
            contentEl.appendChild(bignumEl)
            contentEl.appendChild(makeArrow('sru.png', 'srd.png', +1))

        } else { // sex
            const malEl = document.createElement('div')
            const femEl = document.createElement('div')

            const refreshSexBtns = () => {
                malEl.style.backgroundImage = `url('art/intrface/male${playerSex === 'Male' ? 'on' : 'off'}.png')`
                femEl.style.backgroundImage = `url('art/intrface/fem${playerSex === 'Female' ? 'on' : 'off'}.png')`
            }

            Object.assign(malEl.style, {
                width: '45px', height: '43px',
                backgroundImage: `url('art/intrface/male${playerSex === 'Male' ? 'on' : 'off'}.png')`,
                backgroundRepeat: 'no-repeat', cursor: 'pointer',
            })
            malEl.onclick = () => { playerSex = 'Male'; updateSexDisplay(); refreshSexBtns() }

            Object.assign(femEl.style, {
                width: '45px', height: '43px',
                backgroundImage: `url('art/intrface/fem${playerSex === 'Female' ? 'on' : 'off'}.png')`,
                backgroundRepeat: 'no-repeat', cursor: 'pointer',
            })
            femEl.onclick = () => { playerSex = 'Female'; updateSexDisplay(); refreshSexBtns() }

            contentEl.appendChild(malEl)
            contentEl.appendChild(femEl)
        }

        popupEscHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePopup() }
        document.addEventListener('keydown', popupEscHandler)
        overlay.appendChild(box)
        document.body.appendChild(overlay)
    }

    // ── Name button + font4 label ─────────────────────────────────────────────
    const nameBtn = document.createElement('div')
    Object.assign(nameBtn.style, {
        position: 'absolute', left: '11px', top: '0px',
        width: '145px', height: '35px',
        backgroundImage: "url('art/intrface/nameoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        cursor: 'pointer', zIndex: '1',
    })
    nameBtn.onmousedown  = () => { nameBtn.style.backgroundImage = "url('art/intrface/nameon.png')" }
    nameBtn.onmouseup    = nameBtn.onmouseleave = () => { nameBtn.style.backgroundImage = "url('art/intrface/nameoff.png')" }

    const nameLabelEl = document.createElement('div')
    Object.assign(nameLabelEl.style, {
        position: 'absolute', left: '33px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })

    const updateNameDisplay = () => {
        while (nameLabelEl.firstChild) nameLabelEl.removeChild(nameLabelEl.firstChild)
        nameLabelEl.appendChild(font3.renderText(playerName, '#FFD700'))
    }
    updateNameDisplay()
    nameBtn.onclick = () => openCreatorPopup('name', updateNameDisplay)

    characterWindow.elem.appendChild(nameBtn)
    characterWindow.elem.appendChild(nameLabelEl)

    // ── Age button + font4 label ──────────────────────────────────────────────
    const ageBtn = document.createElement('div')
    Object.assign(ageBtn.style, {
        position: 'absolute', left: '156px', top: '0px',
        width: '81px', height: '35px',
        backgroundImage: "url('art/intrface/ageoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        cursor: 'pointer', zIndex: '1',
    })
    ageBtn.onmousedown  = () => { ageBtn.style.backgroundImage = "url('art/intrface/ageon.png')" }
    ageBtn.onmouseup    = ageBtn.onmouseleave = () => { ageBtn.style.backgroundImage = "url('art/intrface/ageoff.png')" }

    const ageLabelEl = document.createElement('div')
    Object.assign(ageLabelEl.style, {
        position: 'absolute', left: '184px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })

    const updateAgeDisplay = () => {
        while (ageLabelEl.firstChild) ageLabelEl.removeChild(ageLabelEl.firstChild)
        ageLabelEl.appendChild(font3.renderText(String(playerAge), '#FFD700'))
    }
    updateAgeDisplay()
    ageBtn.onclick = () => openCreatorPopup('age', updateAgeDisplay)

    characterWindow.elem.appendChild(ageBtn)
    characterWindow.elem.appendChild(ageLabelEl)

    // ── Sex button + font4 label ──────────────────────────────────────────────
    const sexBtn = document.createElement('div')
    Object.assign(sexBtn.style, {
        position: 'absolute', left: '237px', top: '0px',
        width: '80px', height: '35px',
        backgroundImage: "url('art/intrface/sexoff.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: 'contain',
        cursor: 'pointer', zIndex: '1',
    })
    sexBtn.onmousedown  = () => { sexBtn.style.backgroundImage = "url('art/intrface/sexon.png')" }
    sexBtn.onmouseup    = sexBtn.onmouseleave = () => { sexBtn.style.backgroundImage = "url('art/intrface/sexoff.png')" }

    const sexLabelEl = document.createElement('div')
    Object.assign(sexLabelEl.style, {
        position: 'absolute', left: '248px', top: '6px',
        pointerEvents: 'none', zIndex: '2',
    })

    const updateSexDisplay = () => {
        while (sexLabelEl.firstChild) sexLabelEl.removeChild(sexLabelEl.firstChild)
        sexLabelEl.appendChild(font3.renderText(playerSex, '#FFD700'))
    }
    updateSexDisplay()
    sexBtn.onclick = () => openCreatorPopup('sex', updateSexDisplay)

    characterWindow.elem.appendChild(sexBtn)
    characterWindow.elem.appendChild(sexLabelEl)

    // ── Trait panel ───────────────────────────────────────────────────────────
    // Two columns × 8 rows. Clicking shows info card; max 2 selectable.
    const traitRowEls: HTMLElement[] = []
    const traitToggleImgs: HTMLImageElement[] = []

    const refreshTraitPanel = () => {
        for (let i = 0; i < TRAITS.length; i++) {
            const selected = selectedTraits.includes(TRAITS[i])
            traitToggleImgs[i].src = selected
                ? 'art/intrface/tgsklon.png'
                : 'art/intrface/tgskloff.png'
            traitRowEls[i].style.color = selected ? '#FFD700' : '#00FF00'
        }
    }

    const leftColEl = document.createElement('div')
    Object.assign(leftColEl.style, {
        position: 'absolute',
        left: '23px',
        top: '352px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        width: '163px',
    })

    const rightColEl = document.createElement('div')
    Object.assign(rightColEl.style, {
        position: 'absolute',
        left: '152px',
        top: '352px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        width: '163px',
    })

    for (let i = 0; i < TRAITS.length; i++) {
        const trait = TRAITS[i]
        const isRight = i >= 8
        const container = isRight ? rightColEl : leftColEl

        const row = document.createElement('div')
        Object.assign(row.style, {
            display: 'flex',
            alignItems: 'center',
            flexDirection: isRight ? 'row-reverse' : 'row',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '0.69em',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
        })

        const toggleImg = document.createElement('img') as HTMLImageElement
        toggleImg.src = 'art/intrface/tgskloff.png'
        Object.assign(toggleImg.style, {
            width: '17px',
            height: '11px',
            flexShrink: '0',
            imageRendering: 'pixelated',
        })

        const label = document.createElement('span')
        label.textContent = trait
        Object.assign(label.style, {
            flex: '1',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textAlign: isRight ? 'right' : 'left',
        })

        row.appendChild(toggleImg)
        row.appendChild(label)

        const capturedTrait = trait
        const handleClick = () => {
            if (selectedTraits.includes(capturedTrait)) {
                selectedTraits.splice(selectedTraits.indexOf(capturedTrait), 1)
                skillOpts.traits = selectedTraits
                refreshTraitPanel()
                redrawStatsSkills()
            } else if (selectedTraits.length < 2) {
                selectedTraits.push(capturedTrait)
                skillOpts.traits = selectedTraits
                refreshTraitPanel()
                redrawStatsSkills()
            } else {
                showInfoCard('Traits', 'You may only pick 2 traits.')
                return
            }
            showInfoCard(capturedTrait, TRAIT_DESCRIPTIONS[capturedTrait], TRAIT_IMG[capturedTrait])
        }

        row.onclick = handleClick
        row.onmouseenter = () => {
            showInfoCard(capturedTrait, TRAIT_DESCRIPTIONS[capturedTrait], TRAIT_IMG[capturedTrait])
        }

        container.appendChild(row)
        traitRowEls.push(row)
        traitToggleImgs.push(toggleImg)
    }
    refreshTraitPanel()

    const optionalTraitsLabelEl = document.createElement('div')
    Object.assign(optionalTraitsLabelEl.style, {
        position: 'absolute',
        left: '48px',
        top: '327px',
        pointerEvents: 'none',
    })
    font3.onLoad(() => {
        optionalTraitsLabelEl.appendChild(font3.renderText('Optional Traits', '#FFD700'))
    })
    characterWindow.elem.appendChild(optionalTraitsLabelEl)
    characterWindow.elem.appendChild(leftColEl)
    characterWindow.elem.appendChild(rightColEl)

    // ── Render helpers ────────────────────────────────────────────────────────
    const CONDITION_LABELS = [
        'Poisoned', 'Radiated', 'Eye Damage',
        'Crippled Right Arm', 'Crippled Left Arm',
        'Crippled Right Leg', 'Crippled Left Leg',
    ]

    const renderPanel2 = () => {
        while (panel2El.firstChild) panel2El.removeChild(panel2El.firstChild)

        const computedMaxHP = newStatSet.get('Max HP')
        const hp = document.createElement('div')
        hp.textContent = `Hit Points: ${computedMaxHP} / ${computedMaxHP}`
        panel2El.appendChild(hp)

        for (const label of CONDITION_LABELS) {
            const line = document.createElement('div')
            line.textContent = label
            line.style.opacity = '0.3'  // new character: no conditions
            line.style.cursor = 'pointer'
            line.onclick = () => showInfoCard(label, CONDITION_DESCRIPTIONS[label] ?? label, CONDITION_IMG[label])
            panel2El.appendChild(line)
        }
    }

    const renderPanel3 = () => {
        while (panel3El.firstChild) panel3El.removeChild(panel3El.firstChild)

        const rows: Array<[string, string | number]> = [
            ['Armor Class',          newStatSet.get('AC')],
            ['Action Points',        newStatSet.get('AP')],
            ['Carry Weight',         newStatSet.get('Carry')],
            ['Melee Damage',         newStatSet.get('Melee')],
            ['Damage Resistance',    `${newStatSet.get('DR Normal')}%`],
            ['Poison Resistance',    `${newStatSet.get('DR Poison')}%`],
            ['Radiation Resistance', `${newStatSet.get('DR Radiation')}%`],
            ['Sequence',             newStatSet.get('Sequence')],
            ['Healing Rate',         newStatSet.get('Healing Rate')],
            ['Critical Chance',      `${newStatSet.get('Critical Chance')}%`],
        ]
        for (const [label, value] of rows) {
            const line = document.createElement('div')
            line.textContent = `${label}: ${value}`
            line.style.cursor = 'pointer'
            line.onclick = () => showInfoCard(label, DERIVED_DESCRIPTIONS[label] ?? label, DERIVED_IMG[label])
            panel3El.appendChild(line)
        }
    }

    // ── Tag Skills counter ────────────────────────────────────────────────────
    const tagLabelEl = document.createElement('div')
    Object.assign(tagLabelEl.style, {
        position: 'absolute',
        left: '417px',
        top: '233px',
        pointerEvents: 'none',
    })
    font3.onLoad(() => {
        tagLabelEl.appendChild(font3.renderText('Tag Skills', '#FFD700'))
    })
    characterWindow.elem.appendChild(tagLabelEl)

    const tagBignumContainer = document.createElement('div')
    Object.assign(tagBignumContainer.style, {
        position: 'absolute',
        left: '523px',
        top: '228px',
        pointerEvents: 'none',
    })
    characterWindow.elem.appendChild(tagBignumContainer)

    const updateTagBignum = () => {
        while (tagBignumContainer.firstChild) tagBignumContainer.removeChild(tagBignumContainer.firstChild)
        tagBignumContainer.appendChild(renderBignum(3 - newSkillSet.tagged.length, 2))
    }
    updateTagBignum()

    const redrawStatsSkills = () => {
        // Rebuild skill rows
        while (skillRowsEl.firstChild) skillRowsEl.removeChild(skillRowsEl.firstChild)
        for (const skill of SKILLS) {
            const isTagged = newSkillSet.isTagged(skill)
            const val = newSkillSet.get(skill, newStatSet, skillOpts)
            const color = isTagged ? '#FFB000' : 'rgb(0,255,0)'

            const row = document.createElement('div')
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '3px',
                cursor: 'pointer', color,
            })

            const toggleBtn = document.createElement('div')
            Object.assign(toggleBtn.style, {
                width: '17px', height: '11px',
                backgroundImage: `url('art/intrface/${isTagged ? 'tgsklon' : 'tgskloff'}.png')`,
                backgroundRepeat: 'no-repeat', backgroundSize: '17px 11px',
                flexShrink: '0',
            })
            toggleBtn.onmousedown  = () => { toggleBtn.style.backgroundImage = "url('art/intrface/tgsklon.png')" }
            toggleBtn.onmouseup    = () => { toggleBtn.style.backgroundImage = `url('art/intrface/${isTagged ? 'tgsklon' : 'tgskloff'}.png')` }
            toggleBtn.onmouseleave = () => { toggleBtn.style.backgroundImage = `url('art/intrface/${isTagged ? 'tgsklon' : 'tgskloff'}.png')` }

            const capturedSkill = skill
            toggleBtn.onclick = (e) => {
                e.stopPropagation()
                if (newSkillSet.isTagged(capturedSkill)) {
                    newSkillSet.untag(capturedSkill)
                } else {
                    if (newSkillSet.tagged.length >= newSkillSet.getMaxTaggedSkills()) return
                    newSkillSet.tag(capturedSkill)
                }
                redrawStatsSkills()
            }

            const nameSpan = document.createElement('span')
            nameSpan.textContent = skill
            Object.assign(nameSpan.style, {
                flex: '1', textAlign: 'left',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            })

            const pctSpan = document.createElement('span')
            pctSpan.textContent = `${val}%`
            Object.assign(pctSpan.style, { textAlign: 'right', minWidth: '36px' })

            row.appendChild(toggleBtn)
            row.appendChild(nameSpan)
            row.appendChild(pctSpan)

            row.onmouseenter = () => {
                showInfoCard(capturedSkill, SKILL_DESCRIPTIONS[capturedSkill] ?? capturedSkill, SKILL_IMG[capturedSkill])
            }

            skillRowsEl.appendChild(row)
        }

        for (let i = 0; i < STATS.length; i++) {
            const el = statValueWidgets[i]
            while (el.firstChild) el.removeChild(el.firstChild)
            const base = newStatSet.getBase(STATS[i])
            el.appendChild(renderBignum(base, 2))
            statCommentLabels[i].setText(STAT_COMMENTS[Math.max(1, Math.min(10, base))])
        }

        renderPanel2()
        renderPanel3()
        updatePoolLabel()
        updateTagBignum()
    }

    // ── DONE button ───────────────────────────────────────────────────────────
    doneBtn.onClick(() => {
        if (pool > 0) {
            showInfoCard('Character', `You have ${pool} unspent attribute point${pool !== 1 ? 's' : ''}.`)
            return
        }
        if (newSkillSet.tagged.length < 3) {
            const need = 3 - newSkillSet.tagged.length
            showInfoCard('Tag Skills', `Tag ${need} more skill${need !== 1 ? 's' : ''}.`)
            return
        }
        if (!playerName.trim()) {
            showInfoCard('Name', 'Please enter a character name.')
            return
        }

        player.applyCreationStats(newStatSet, newSkillSet, playerName.trim(), playerAge, playerSex, selectedTraits)
        characterWindow.close()
        onDone()
    })

    // ── CANCEL button ─────────────────────────────────────────────────────────
    cancelBtn.onClick(() => {
        characterWindow.close()
        onCancel()
    })

    // ESC also cancels
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && characterWindow.showing) {
            characterWindow.close()
            onCancel()
            e.preventDefault()
        }
    }
    document.addEventListener('keydown', escHandler)
    // Clean up ESC handler when window closes
    const origClose = characterWindow.close.bind(characterWindow)
    characterWindow.close = () => {
        document.removeEventListener('keydown', escHandler)
        origClose()
    }

    // ── Initial render ────────────────────────────────────────────────────────
    redrawStatsSkills()
    showInfoCard(SPECIAL_FULL_NAMES['STR'], SPECIAL_DESCRIPTIONS['STR'], SPECIAL_IMG['STR'])
}

// ── Perk Selection Modal ──────────────────────────────────────────────────────
// Shown when player.pendingPerkPick is true after level-up.
// Blocking: CANCEL closes the overlay but does NOT clear pendingPerkPick —
// the player must eventually pick a perk.
// Layout: 573×230px perkwin.png background; button sprites baked into the PNG.
//   Left panel (list):  left 8px, top 15px, 260×165px
//   Right panel (card): title left 282 top 27; body left 282 top 60; img left 410 top 41
//   CANCEL button:      lilredup at left 47  top 187; label at left 64  top 186
//   DONE button:        lilredup at left 159 top 187; label at left 176 top 185

function showPerkModal(player: any): void {
    if (document.getElementById('perk-modal-overlay')) return

    const validPerks = getValidPerks(player)

    const overlay = document.createElement('div')
    overlay.id = 'perk-modal-overlay'
    Object.assign(overlay.style, {
        position: 'fixed', zIndex: '3000',
        left: '0', top: '0', width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
    })
    // No click-outside-to-close

    // ── Main window box: perkwin.png background, 573×230px ───────────────────
    const box = document.createElement('div')
    Object.assign(box.style, {
        position: 'relative',
        backgroundImage: "url('art/intrface/perkwin.png')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '573px 230px',
        width: '573px',
        height: '230px',
        boxSizing: 'border-box',
    })
    box.onclick = (e) => e.stopPropagation()

    // ── Left panel: scrollable perk list ─────────────────────────────────────
    const listEl = document.createElement('div')
    Object.assign(listEl.style, {
        position: 'absolute',
        left: '40px', top: '38px',
        width: '200px', height: '150px',
        overflowY: 'auto',
        backgroundColor: 'transparent',
    })
    box.appendChild(listEl)

    // ── Right panel: info card ────────────────────────────────────────────────
    // Title (font2, black — mirrors showCharacterScreen cardTitleEl exactly)
    const cardTitleEl = document.createElement('div')
    Object.assign(cardTitleEl.style, {
        position: 'absolute',
        left: '282px', top: '27px',
        width: '128px',
        background: 'transparent',
        padding: '0',
    })
    const cardDividerEl = document.createElement('hr')
    Object.assign(cardDividerEl.style, {
        border: 'none', borderTop: '2px solid #000000',
        margin: '2px 0', width: '100%',
    })
    cardTitleEl.appendChild(cardDividerEl)
    box.appendChild(cardTitleEl)

    // Body text (mirrors showCharacterScreen cardDescEl exactly)
    const cardDescEl = document.createElement('div')
    Object.assign(cardDescEl.style, {
        position: 'absolute',
        left: '282px', top: '60px',
        width: '128px', height: '140px',
        fontSize: '0.60em',
        color: '#000000',
        lineHeight: '1.2',
        overflow: 'hidden',
    })
    box.appendChild(cardDescEl)

    // Perk image (mirrors showCharacterScreen cardImgEl exactly)
    const cardImgEl = document.createElement('img') as HTMLImageElement
    Object.assign(cardImgEl.style, {
        position: 'absolute',
        left: '410px', top: '41px',
        width: '145px', height: '165px',
        objectFit: 'contain',
        visibility: 'hidden',
    })
    cardImgEl.onload = () => { cardImgEl.style.visibility = 'visible' }
    cardImgEl.onerror = () => { cardImgEl.style.visibility = 'hidden' }
    box.appendChild(cardImgEl)

    // ── State and helpers ─────────────────────────────────────────────────────
    let selectedPerk: string | null = validPerks.length > 0 ? validPerks[0].name : null

    const updateDoneBtn = () => {
        const enabled = !!selectedPerk
        doneBtn.style.opacity = enabled ? '1' : '0.4'
        doneBtn.style.pointerEvents = enabled ? 'auto' : 'none'
    }

    const showCard = (def: typeof validPerks[0]) => {
        while (cardTitleEl.firstChild && cardTitleEl.firstChild !== cardDividerEl) {
            cardTitleEl.removeChild(cardTitleEl.firstChild)
        }
        cardTitleEl.insertBefore(font2.renderText(def.name.toUpperCase(), '#000000'), cardDividerEl)
        cardDescEl.textContent = def.description
        cardImgEl.style.visibility = 'hidden'
        const imgPath = def.img ?? PERK_IMG[def.name]
        if (imgPath) {
            cardImgEl.src = imgPath
        } else {
            cardImgEl.src = ''
        }
    }

    // ── DONE button — sprite baked into perkwin.png, just the click region ───
    const doneBtn = document.createElement('div')
    Object.assign(doneBtn.style, {
        position: 'absolute',
        left: '159px', top: '187px',
        width: '15px', height: '16px',
        backgroundImage: "url('art/intrface/lilredup.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: '15px 16px',
        opacity: '0.4',
        pointerEvents: 'none',
        zIndex: '1',
    })
    doneBtn.onmousedown = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilreddn.png')" }
    doneBtn.onmouseup = doneBtn.onmouseleave = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilredup.png')" }
    doneBtn.onclick = () => {
        if (!selectedPerk) return
        applyPerk(player, selectedPerk)
        overlay.remove()
    }
    box.appendChild(doneBtn)

    const doneLblEl = document.createElement('div')
    Object.assign(doneLblEl.style, {
        position: 'absolute', left: '176px', top: '185px',
        pointerEvents: 'none', zIndex: '1',
    })
    font3.onLoad(() => { doneLblEl.appendChild(font3.renderText('DONE')) })
    box.appendChild(doneLblEl)

    // ── CANCEL button — always enabled; closes overlay without applying perk ──
    const cancelBtn = document.createElement('div')
    Object.assign(cancelBtn.style, {
        position: 'absolute',
        left: '47px', top: '187px',
        width: '15px', height: '16px',
        backgroundImage: "url('art/intrface/lilredup.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: '15px 16px',
        cursor: 'pointer',
        zIndex: '1',
    })
    cancelBtn.onmousedown = () => { cancelBtn.style.backgroundImage = "url('art/intrface/lilreddn.png')" }
    cancelBtn.onmouseup = cancelBtn.onmouseleave = () => { cancelBtn.style.backgroundImage = "url('art/intrface/lilredup.png')" }
    cancelBtn.onclick = () => { overlay.remove() }
    box.appendChild(cancelBtn)

    const cancelLblEl = document.createElement('div')
    Object.assign(cancelLblEl.style, {
        position: 'absolute', left: '64px', top: '186px',
        pointerEvents: 'none', zIndex: '1',
    })
    font3.onLoad(() => { cancelLblEl.appendChild(font3.renderText('CANCEL')) })
    box.appendChild(cancelLblEl)

    updateDoneBtn()

    // ── Build list rows ───────────────────────────────────────────────────────
    if (validPerks.length === 0) {
        const none = document.createElement('div')
        none.textContent = 'No eligible perks.'
        Object.assign(none.style, { color: '#00FF00', fontSize: '0.68em', padding: '4px 3px' })
        listEl.appendChild(none)
    }

    for (const def of validPerks) {
        const rank = getPerkRank(player, def.name)

        const row = document.createElement('div')
        Object.assign(row.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1px 3px',
            cursor: 'pointer',
            fontSize: '0.68em',
            color: '#00FF00',
            backgroundColor: def.name === selectedPerk ? 'rgba(0,255,0,0.2)' : 'transparent',
        })

        const nameSpan = document.createElement('span')
        nameSpan.textContent = def.name

        const rankSpan = document.createElement('span')
        rankSpan.textContent = `${rank + 1}/${def.maxRanks}`
        Object.assign(rankSpan.style, { color: '#70A070', fontSize: '0.9em' })

        row.appendChild(nameSpan)
        row.appendChild(rankSpan)

        row.onmouseenter = () => {
            if (selectedPerk !== def.name) row.style.backgroundColor = 'rgba(0,255,0,0.1)'
        }
        row.onmouseleave = () => {
            row.style.backgroundColor = selectedPerk === def.name ? 'rgba(0,255,0,0.2)' : 'transparent'
        }
        row.onclick = () => {
            selectedPerk = def.name
            listEl.querySelectorAll<HTMLElement>('[data-perk]').forEach(el => {
                el.style.backgroundColor = el.dataset.perk === def.name
                    ? 'rgba(0,255,0,0.2)' : 'transparent'
            })
            showCard(def)
            updateDoneBtn()
        }
        row.dataset.perk = def.name
        listEl.appendChild(row)
    }

    // Show first perk's info by default
    if (validPerks.length > 0) showCard(validPerks[0])

    overlay.appendChild(box)
    document.body.appendChild(overlay)
}

Events.on('pendingPerkPick', (player: any) => showPerkModal(player))
