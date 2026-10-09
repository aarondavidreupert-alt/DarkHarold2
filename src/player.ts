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

import { SkillSet, StatSet } from './char.js'
import { dbg } from './logger.js'
import { clamp, getMessage } from './util.js'
import { Events } from './events.js'
import { Point } from './geometry.js'
import globalState from './globalState.js'
import { Critter, createObjectWithPID, Obj, WeaponObj } from './object.js'
import { centerCamera } from './renderer.js'
import { fromTileNum } from './tile.js'
import { uiLog, uiWorldMap } from './ui.js'

// Contains the Player class and relevant initialization logic

export class Player extends Critter {
    name = 'Player'

    // CE ref: proto.cc _proto_dude_init → _obj_inven_free — a new game's dude has an
    // empty inventory and nothing equipped (the debug kit above is for ?<map> starts);
    // anything the Chosen One carries is given by the game's scripts.
    resetInventoryForNewGame(): void {
        this.inventory = []
        this.leftHand = undefined
        this.rightHand = undefined
        this.armor = null
        this.activeHand = 'leftHand'
        this.updateNativeLook()
    }

    // CE ref: proto.cc:847 _proto_dude_update_gender — the unarmored look is tribal
    // (hmwarr / hfprim) until the VSUIT movie has been seen, then the vault jumpsuit
    // (hmjmps / hfjmps), by gender. With armor on, only the look to restore changes.
    updateNativeLook(): void {
        const MOVIE_VSUIT = 3 // gameMovie.ts
        const female = this.gender === 'female'
        const look = globalState.seenMovies?.has(MOVIE_VSUIT)
            ? (female ? 'hfjmps' : 'hmjmps')
            : (female ? 'hfprim' : 'hmwarr')
        const art = 'art/critters/' + look + 'aa'
        const self = this as any
        if (this.armor) {
            self._baseArt = art
        } else {
            this.art = art
            self._baseArt = null
        }
    }

    // CE ref: stat.cc critterGetStat → trait.cc traitGetStatModifier for the dude.
    // The SPECIAL parts (Gifted, Bruiser STR, Small Frame AGI) are baked into the
    // base stats at creation (applyCreationStats); the derived ones apply here.
    getStat(stat: string): number {
        const value = super.getStat(stat)
        const t = this.traits ?? []
        switch (stat) {
            case 'AP': return t.includes('Bruiser') ? value - 2 : value
            case 'AC': return t.includes('Kamikaze') ? 0 : value // -critterGetBaseStat(AC)
            case 'Melee': return t.includes('Heavy Handed') ? value + 4 : value
            case 'Carry': return t.includes('Small Frame') ? value - 10 * this.stats.getBase('STR') : value
            case 'Sequence': return t.includes('Kamikaze') ? value + 5 : value
            case 'Healing Rate': return t.includes('Fast Metabolism') ? value + 2 : value
            case 'Critical Chance': return t.includes('Finesse') ? value + 10 : value
            case 'Better Criticals': return t.includes('Heavy Handed') ? value - 30 : value
            case 'DR Radiation': case 'DR Poison': return t.includes('Fast Metabolism') ? 0 : value
        }
        return value
    }

    isPlayer = true
    isSneaking = false
    // CE ref: critter.cc:149 _sneak_working — true when the last periodic sneak roll passed.
    // Set by the sneak-event timer in skillUse.ts. Used by isWithinPerception (÷4 path).
    sneakWorking = false
    art = 'art/critters/hmjmpsaa'

    stats = new StatSet({ AGI: 8, INT: 8, STR: 8, CHA: 8, HP: 100 })
    skills = new SkillSet(undefined, undefined, 10) // Start off with 10 skill points

    teamNum = 0

    position = { x: 94, y: 109 }
    orientation = 3
    gender = 'male'
    leftHand = <WeaponObj>createObjectWithPID(9) // 10mm SMG
    armor: Obj | null = null
    activeHand: 'leftHand' | 'rightHand' = 'leftHand'

    inventory = [
        // Money
        createObjectWithPID(41).setAmount(5000),

        // Armor
        createObjectWithPID(2),   // Leather Jacket
        createObjectWithPID(3),   // Leather Armor
        createObjectWithPID(28),  // Combat Armor

        // Weapons
        createObjectWithPID(9),   // 10mm SMG       (ammo: 10mm JHP/AP)
        createObjectWithPID(15),  // Hunting Rifle  (ammo: .223 FMJ)
        createObjectWithPID(23),  // Laser Rifle    (ammo: Micro Fusion Cell)

        // Ammo
        createObjectWithPID(33).setAmount(200),  // 10mm JHP
        createObjectWithPID(36).setAmount(200),  // .223 FMJ
        createObjectWithPID(43).setAmount(200),  // Micro Fusion Cell

        // Drugs & chems
        createObjectWithPID(40).setAmount(5),    // Stimpak
        createObjectWithPID(144).setAmount(2),   // Super Stimpak
        createObjectWithPID(110).setAmount(3),   // Psycho
        createObjectWithPID(87).setAmount(3),    // Buffout
        createObjectWithPID(53).setAmount(3),    // Mentats
        createObjectWithPID(259).setAmount(3),   // Jet
        createObjectWithPID(48).setAmount(3),    // Rad-Away
        createObjectWithPID(260),                // Jet Antidote

        // Misc items
        (() => { const o = createObjectWithPID(52); o.miscCharges = 200; return o })(),  // Geiger Counter I
        (() => { const o = createObjectWithPID(54); o.miscCharges = 50;  return o })(),  // Stealth Boy I
    ]

    lightRadius = 4
    lightIntensity = 65536

    traits: string[] = []

    toString() {
        return 'The Dude'
    }

    // FO2-CE ref: stat.cc pcGetExperienceForLevel()
    // XP required to *reach* a given level: level * (level - 1) / 2 * 1000
    static xpForLevel(level: number): number {
        return Math.floor(level * (level - 1) / 2) * 1000
    }

    addExperience(xp: number) {
        // CE ref: stat.cc:735 pcAddExperienceWithOptions — Swift Learner: +5% per rank.
        const swiftRanks = this.perks.filter((p) => p === 'Swift Learner').length
        xp += Math.trunc(swiftRanks * 5 * xp / 100)
        this.stats.modifyBase('Experience', xp)

        // FO2-CE ref: stat.cc — loop handles gaining multiple levels at once
        const totalXP = this.stats.get('Experience')
        let currentLevel = this.stats.get('Level')

        while (currentLevel < 99) {
            const xpForNextLevel = Player.xpForLevel(currentLevel + 1)
            if (totalXP < xpForNextLevel) break

            this.stats.modifyBase('Level', 1)
            currentLevel++

            globalState.audioEngine.playSfxByName('levelup')
            // CE stat.cc:757 — stat.msg 600 "You have gone up a level."
            const lvlMsg = getMessage('stat', 600)
            if (lvlMsg) uiLog(lvlMsg)

            // FO2-CE ref: stat.cc — Skill points: 5 + 2*INT per level
            // Educated perk +2; Skilled trait +5; Gifted trait -5
            let skillPointGain = 5 + this.getStat('INT') * 2
            if (this.hasPerk('Educated'))          skillPointGain += 2
            if (this.traits.includes('Skilled'))   skillPointGain += 5
            if (this.traits.includes('Gifted'))    skillPointGain -= 5
            this.skills.skillPoints += skillPointGain

            // FO2-CE ref: stat.cc — HP per level: floor(END / 2) + 2
            // Lifegiver perk: +4 per rank
            let hpGain = Math.floor(this.getStat('END') / 2) + 2
            hpGain += this.perks.filter((p) => p === 'Lifegiver').length * 4 // CE: perkGetRank(LIFEGIVER) * 4
            this.stats.modifyBase('Max HP', hpGain)
            this.stats.modifyBase('HP', hpGain)

            // FO2-CE ref: editor.cc — perk every 3 levels (Skilled trait: every 4)
            const perkRate = this.traits.includes('Skilled') ? 4 : 3
            if (currentLevel % perkRate === 0) {
                this.pendingPerkPick = true
                // Do NOT open the selector here — editorRun() checks the flag
                // when the character screen is opened (FO2-CE ref: editor.cc).
            }

            dbg('object', `Level up! Now level ${currentLevel}. Gained ${skillPointGain} skill points, ${hpGain} HP.`)

            // CE ref: stat.cc:789 — party members may level with the player.
            globalState.gParty?.incLevels()
        }
    }

    // Set to true when a perk pick is available (at character screen)
    pendingPerkPick = false

    // FO2-CE ref: editor.cc editorRun() — apply character-creation choices to player.
    // Called by showCharacterCreator() DONE handler after validation passes.
    applyCreationStats(
        stats: StatSet,
        skills: SkillSet,
        name: string,
        age: number,
        sex: 'Male' | 'Female',
        traits: string[]
    ): void {
        const SPECIALS = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']

        // Apply chosen SPECIAL bases
        for (const s of SPECIALS) {
            this.stats.setBase(s, stats.getBase(s))
        }

        // Apply trait SPECIAL modifiers (FO2-CE ref: trait.cc)
        this.traits = traits
        if (traits.includes('Gifted')) {
            for (const s of SPECIALS) this.stats.modifyBase(s, 1)
        }
        if (traits.includes('Bruiser')) {
            this.stats.modifyBase('STR', 2)
        }
        if (traits.includes('Small Frame')) {
            this.stats.modifyBase('AGI', 1)
        }

        // Clamp all SPECIAL to [1, 10] after trait modifications
        for (const s of SPECIALS) {
            this.stats.setBase(s, clamp(1, 10, this.stats.getBase(s)))
        }

        // Max HP is derived (skills.ts: 15 + 2×END + STR on a base of 0); a fresh
        // character starts at full HP (CE _proto_dude_init: critterAdjustHitPoints).
        this.stats.setBase('Max HP', 0)
        const maxHp = this.stats.get('Max HP')
        this.stats.setBase('HP', maxHp)

        // Derive initial skill points for level 1 (FO2: 5 + 2×INT; Gifted -5; Skilled +5)
        const int = this.stats.getBase('INT')
        let sp = 5 + 2 * int
        if (traits.includes('Gifted'))  sp -= 5
        if (traits.includes('Skilled')) sp += 5
        skills.skillPoints = Math.max(0, sp)

        // Apply skills and tags
        this.skills.baseSkills  = Object.assign({}, skills.baseSkills)
        this.skills.tagged      = skills.tagged.slice()
        this.skills.skillPoints = skills.skillPoints
        this.skills.hasTagPerk  = skills.hasTagPerk

        // Identity
        this.name = name
        this.stats.setBase('Age', age)
        this.gender = sex.toLowerCase()

        this.updateNativeLook() // CE _proto_dude_init → _proto_dude_update_gender
        dbg('object', `[CharCreator] Applied: ${name}, ${sex}, age ${age}, traits [${traits.join(', ')}], HP ${maxHp}, SP ${skills.skillPoints}`)
    }

    /*
    var obj = {position: {x: 94, y: 109}, orientation: 2, frame: 0, type: "critter",
                   art: "art/critters/hmjmpsaa", isPlayer: true, anim: "idle", lastFrameTime: 0,
                   path: null, animCallback: null,
                   leftHand: playerWeapon, rightHand: null, weapon: null, armor: null,
                   dead: false, name: "Player", gender: "male", inventory: [
                   {type: "misc", name: "Money", pid: 41, pidID: 41, amount: 1337, pro: {textID: 4100, extra: {cost: 1}, invFRM: 117440552}, invArt: 'art/inven/cap2'}
                   ], stats: null, skills: null, tempChanges: null}
    */

    move(position: Point, curIdx?: number, signalEvents: boolean = true): boolean {
        if (!super.move(position, curIdx, signalEvents)) return false

        if (signalEvents) Events.emit('playerMoved', position)

        // check if the player has entered an exit grid
        var objs = globalState.gMap.objectsAtPosition(this.position)
        for (var i = 0; i < objs.length; i++) {
            if (objs[i].type === 'misc' && objs[i].extra && objs[i].extra.exitMapID !== undefined) {
                // walking on an exit grid
                // todo: exit grids are likely multi-hex (maybe have a set?)
                var exitMapID = Number(objs[i].extra.exitMapID) || -1
                var startingPosition = fromTileNum(Number(objs[i].extra.startingPosition) || 0)
                var startingElevation = Number(objs[i].extra.startingElevation) || 0
                this.clearAnim()

                if (startingPosition.x === -1 || startingPosition.y === -1 || exitMapID < 0) {
                    // world map
                    dbg('map', 'exit grid -> worldmap')
                    uiWorldMap()
                } else {
                    // another map
                    dbg('map', `exit grid -> map ${exitMapID} elevation ${startingElevation} @ ${startingPosition.x}, ${startingPosition.y}`)
                    if (exitMapID === globalState.gMap.mapID) {
                        // same map, different elevation
                        globalState.gMap.changeElevation(Number(startingElevation) || 0, true)
                        globalState.player.move(startingPosition)
                        centerCamera(globalState.player.position)
                    } else globalState.gMap.loadMapByID(exitMapID, startingPosition, startingElevation)
                }

                return false
            }
        }

        return true
    }
}
