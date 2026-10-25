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

import { perkNameById } from './perks.js'
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

// CE proto.cc _proto_dude_init: the dude proto has DR EMP 100
const newPlayerStats = () => new StatSet({ AGI: 8, INT: 8, STR: 8, CHA: 8, HP: 100, 'DR EMP': 100 })
const newPlayerSkills = () => new SkillSet(undefined, undefined, 10) // Start off with 10 skill points

export class Player extends Critter {
    name = 'Player'

    // CE ref: proto.cc _proto_dude_init → _obj_inven_free — a new game's dude has an
    // empty inventory and nothing equipped (the debug kit above is for ?<map> starts);
    // anything the Chosen One carries is given by the game's scripts.
    // CE ref: game.cc gameReset — statsReset / skillsReset / perksReset / traitsReset /
    // critterReset / _inven_reset_dude for the dude: the next character starts from a
    // clean slate (no XP, perks, traits, conditions or items of the previous game).
    resetForNewGame(): void {
        this.stats = newPlayerStats()
        this.skills = newPlayerSkills()
        this.perks = []
        this.traits = []
        this.pendingPerkPick = false
        this.levelUpAvailable = false
        this._script = undefined // a new obj_dude at the next map entry (Scripting.ensureDudeScript)
        if (this.dead) {
            this.anim = 'idle'
            this.frame = 0
        }
        this.dead = false
        this.crippledLeftArm = this.crippledRightArm = false
        this.crippledLeftLeg = this.crippledRightLeg = false
        this.isBlinded = false
        this.poisonLevel = 0
        this.radiationLevel = 0
        this.radiated = false
        this.addictions = []
        this.addictedState = false
        this.injuryFlags = 0 // CE combat.results (cripples, blind, knocked out/down)
        this.isSneaking = false
        this.sneakWorking = false
        this.stealthActive = false
        // CE object.cc objectsInit: gDude->flags |= OBJECT_LIGHT_THRU (his body casts no light shadow)
        this.flags = ((this.flags ?? 0) | 0x20000000) >>> 0
        this.resetInventoryForNewGame()
    }

    resetInventoryForNewGame(): void {
        this.inventory = []
        this.leftHand = undefined
        this.rightHand = undefined
        this.armor = null
        this.activeHand = 'leftHand'
        this.updateNativeLook()
    }

    // CE trait.cc traitsSetSelected (Mutate!). CE applies trait SPECIAL modifiers live
    // (traitGetStatModifier); DH2 keeps Gifted (+1 all), Bruiser (+2 ST) and Small Frame
    // (+1 AG) in the base, so they come off and go on here.
    setTraits(traits: string[]): void {
        const SPECIALS = ['STR', 'PER', 'END', 'CHA', 'INT', 'AGI', 'LUK']
        const special = (t: string[], sign: 1 | -1) => {
            if (t.includes('Gifted')) for (const st of SPECIALS) this.stats.modifyBase(st, sign)
            if (t.includes('Bruiser')) this.stats.modifyBase('STR', 2 * sign)
            if (t.includes('Small Frame')) this.stats.modifyBase('AGI', sign)
        }
        special(this.traits ?? [], -1)
        this.traits = traits.slice(0, 2)
        special(this.traits, 1)
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
            this.setIdleArt() // CE keeps the fid's weapon code: stand with the weapon in hand
        }
    }

    // CE ref: stat.cc critterGetStat → trait.cc traitGetStatModifier for the dude.
    // The SPECIAL parts (Gifted, Bruiser STR, Small Frame AGI) are baked into the
    // base stats at creation (applyCreationStats); the derived ones apply here.
    getStat(stat: string): number {
        let value = super.getStat(stat)
        const t = this.traits ?? []
        const perk = (id: number) => { const n = perkNameById(id); return !!n && this.perks.includes(n) }
        // CE critterGetStat (critter == gDude): the live perk modifiers. (Gain <SPECIAL>
        // raises the base when taken — perkApplyEffect — so the derived stats follow.)
        switch (stat) {
            case 'STR':
                // PERK_ADRENALINE_RUSH: +1 below half HP
                if (perk(79) && this.getStat('HP') < Math.trunc(this.getStat('Max HP') / 2)) value = Math.min(10, value + 1)
                break
            case 'CHA': {
                // PROTO_ID_MIRRORED_SHADES in either hand: +1
                const shades = (this.leftHand as any)?.pid === 433 || (this.rightHand as any)?.pid === 433
                if (shades) value = Math.min(10, value + 1)
                break
            }
            case 'Max HP':
                if (perk(108)) value += 2 // PERK_ALCOHOL_RAISED_HIT_POINTS
                if (perk(109)) value += 4 // _II
                if (perk(110)) value -= 2 // PERK_ALCOHOL_LOWERED_HIT_POINTS
                if (perk(111)) value -= 4 // _II
                if (perk(112)) value += 2 // PERK_AUTODOC_RAISED_HIT_POINTS
                if (perk(113)) value += 4 // _II
                if (perk(114)) value -= 2 // PERK_AUTODOC_LOWERED_HIT_POINTS
                if (perk(115)) value -= 4 // _II
                break
            case 'DR Normal': case 'DR Explosive':
                if (perk(74)) value += 5 // PERK_DERMAL_IMPACT_ARMOR
                else if (perk(75)) value += 10 // PERK_DERMAL_IMPACT_ASSAULT_ENHANCEMENT
                break
            case 'DR Laser': case 'DR Fire': case 'DR Plasma':
                if (perk(76)) value += 5 // PERK_PHOENIX_ARMOR_IMPLANTS
                else if (perk(77)) value += 10 // PERK_PHOENIX_ASSAULT_ENHANCEMENT
                break
            case 'DR Radiation': case 'DR Poison':
                if (perk(78)) value += 10 // PERK_VAULT_CITY_INOCULATIONS
                break
        }
        switch (stat) {
            case 'AP': return Math.max(1, t.includes('Bruiser') ? value - 2 : value) // clamped like CE critterGetStat
            case 'AC': return t.includes('Kamikaze') ? 0 : value // -critterGetBaseStat(AC)
            case 'Melee': return t.includes('Heavy Handed') ? value + 4 : value
            // CE trait.cc: Small Frame −10 × critterGetBaseStat(ST) — the raw base, without the
            // traits' own +ST (Bruiser +2, Gifted +1) or any bonus
            case 'Carry': return t.includes('Small Frame')
                ? value - 10 * (this.stats.getBase('STR') - (t.includes('Bruiser') ? 2 : 0) - (t.includes('Gifted') ? 1 : 0))
                : value
            case 'Sequence': return t.includes('Kamikaze') ? value + 5 : value
            case 'Healing Rate': return t.includes('Fast Metabolism') ? value + 2 : value
            case 'Critical Chance': return t.includes('Finesse') ? value + 10 : value
            case 'Better Criticals': return t.includes('Heavy Handed') ? value - 30 : value
            // CE trait.cc: Fast Metabolism −critterGetBaseStat (the 2·EN / 5·EN part only); Rad-X's
            // bonus and the Inoculations stay
            case 'DR Radiation': case 'DR Poison':
                return t.includes('Fast Metabolism') ? Math.max(0, value - (this.stats.get(stat) - this.stats.getBonus(stat))) : value
        }
        return value
    }

    isPlayer = true
    isSneaking = false
    // CE ref: critter.cc:149 _sneak_working — true when the last periodic sneak roll passed.
    // Set by the sneak-event timer in skillUse.ts. Used by isWithinPerception (÷4 path).
    sneakWorking = false
    art = 'art/critters/hmjmpsaa'

    stats = newPlayerStats()
    skills = newPlayerSkills()

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
        createObjectWithPID(29).setAmount(10),   // 10mm JHP (boxes)
        createObjectWithPID(34).setAmount(10),   // .223 FMJ (boxes)
        createObjectWithPID(39).setAmount(10),   // Micro Fusion Cell (PROTO_ID_MICRO_FUSION_CELL, boxes)

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
            this.levelUpAvailable = true // CE stat.cc:764 DUDE_STATE_LEVEL_UP_AVAILABLE

            globalState.audioEngine.playSfxByName('levelup')
            // CE stat.cc:757 — stat.msg 600 "You have gone up a level."
            const lvlMsg = getMessage('stat', 600)
            if (lvlMsg) uiLog(lvlMsg)

            // CE character_editor.cc characterEditorUpdateLevel: 5 + 2 × base INT (with
            // traits, not drugs) + 2 per Educated rank + 5 with Skilled, − 5 with Gifted;
            // the unspent total stays within 0..99.
            const before = this.skills.skillPoints
            let sp = before + 5 + 2 * this.stats.getBase('INT')
            sp += 2 * this.perks.filter((p) => p === 'Educated').length
            if (this.traits.includes('Skilled')) sp += 5
            if (this.traits.includes('Gifted')) sp = Math.max(0, sp - 5)
            sp = Math.min(99, sp)
            this.skills.skillPoints = sp
            const skillPointGain = sp - before

            // CE stat.cc pcAddExperienceWithOptions — HP per level: base END (with traits,
            // not drugs) / 2 + 2, + 4 per Lifegiver rank
            let hpGain = Math.floor(this.stats.getBase('END') / 2) + 2
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
    // CE DUDE_STATE_LEVEL_UP_AVAILABLE: the LEVEL indicator, set on a level-up and cleared
    // when the character screen opens
    levelUpAvailable = false

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

        // CE stat.cc pcStatsReset: a new character has no unspent skill points; the first
        // ones come with level 2 (characterEditorUpdateLevel).
        skills.skillPoints = 0

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
                // CE object.cc (dude on an exit grid) → map.cc mapSetTransition / mapHandleTransition:
                // map 0 → -2; -1 the town map, -2 the world map; another map — or this one at the
                // current elevation — is (re)loaded; then a tile other than -1 / 0 places the dude
                // there with the grid's elevation and rotation (not on the Modoc B&B / Squat A maps:
                // the header start).
                const ex = objs[i].extra
                let exitMapID = Number(ex.exitMapID)
                if (!Number.isFinite(exitMapID) || exitMapID === 0) exitMapID = -2
                const tile = Number(ex.startingPosition ?? -1)
                const startingElevation = Number(ex.startingElevation) || 0
                const rotation = Number(ex.startingOrientation) || 0
                this.clearAnim()
                // CE mapSetTransition in combat: _game_user_wants_to_quit ends the fight first
                if (globalState.inCombat && exitMapID < 0) {
                    globalState.combat?.forceEnd()
                    globalState.inCombat = false
                }

                if (exitMapID === -1) {
                    dbg('map', 'exit grid -> town map')
                    uiWorldMap(true)
                } else if (exitMapID < 0) {
                    dbg('map', 'exit grid -> worldmap')
                    uiWorldMap()
                } else {
                    const gMap = globalState.gMap
                    const placeOnTile = tile !== -1 && tile !== 0 && exitMapID !== 19 /* MAP_MODOC_BEDNBREAKFAST */
                        && exitMapID !== 37 /* MAP_THE_SQUAT_A */ && startingElevation >= 0 && startingElevation <= 2
                    const position = placeOnTile ? fromTileNum(tile) : undefined
                    dbg('map', `exit grid -> map ${exitMapID} elevation ${startingElevation} @ ${tile}`)
                    if (exitMapID !== gMap.mapID || gMap.currentElevation === startingElevation) {
                        gMap.loadMapByID(exitMapID, position, placeOnTile ? startingElevation : undefined, placeOnTile ? rotation : undefined)
                        Events.emit('mapTransition', exitMapID) // CE mapHandleTransition → wmTeleportToArea
                    } else if (position) {
                        // same map, another elevation: no reload
                        gMap.changeElevation(startingElevation, true)
                        globalState.player.move(position)
                        globalState.player.orientation = rotation
                        centerCamera(globalState.player.position)
                    }
                }

                return false
            }
        }

        return true
    }
}
