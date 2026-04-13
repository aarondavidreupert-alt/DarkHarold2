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
import { Events } from './events.js'
import { Point } from './geometry.js'
import globalState from './globalState.js'
import { Critter, createObjectWithPID, Obj, WeaponObj } from './object.js'
import { centerCamera } from './renderer.js'
import { fromTileNum } from './tile.js'
import { uiWorldMap } from './ui.js'

// Contains the Player class and relevant initialization logic

export class Player extends Critter {
    name = 'Player'

    isPlayer = true
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
        createObjectWithPID(41).setAmount(1337), // Money
        createObjectWithPID(4),                  // Combat Knife (melee)
        createObjectWithPID(15),                 // Hunting Rifle (small gun)
        createObjectWithPID(2),                  // Leather Jacket (armor)
        createObjectWithPID(3),                  // Leather Armor (armor)

        // --- Testing weapons ---
        createObjectWithPID(22),                 // Laser Pistol      (energy, uses Small Energy Cell)
        createObjectWithPID(23),                 // Laser Rifle       (energy, uses Micro Fusion Cell)
        createObjectWithPID(24),                 // Plasma Pistol     (energy, uses Micro Fusion Cell)
        createObjectWithPID(25),                 // Plasma Rifle      (energy, uses Micro Fusion Cell)
        createObjectWithPID(27),                 // Gatling Laser     (energy, uses Micro Fusion Cell)
        createObjectWithPID(19),                 // Minigun           (big gun, uses 5mm JHP)
        createObjectWithPID(20),                 // Rocket Launcher   (big gun, uses Rocket AP)
        createObjectWithPID(16),                 // Assault Rifle     (small gun, uses 5mm JHP)

        // --- Testing ammo ---
        createObjectWithPID(33).setAmount(200),  // 10mm JHP          (SMG / 10mm Pistol)
        createObjectWithPID(34).setAmount(200),  // 10mm AP           (SMG / 10mm Pistol)
        createObjectWithPID(42).setAmount(200),  // Small Energy Cell (Laser Pistol)
        createObjectWithPID(43).setAmount(200),  // Micro Fusion Cell (Laser Rifle, Plasma Pistol/Rifle, Gatling Laser)
        createObjectWithPID(38).setAmount(200),  // 5mm JHP           (Minigun, Assault Rifle)
        createObjectWithPID(36).setAmount(200),  // .223 FMJ          (Hunting Rifle, Sniper Rifle)
        createObjectWithPID(44).setAmount(20),   // Rocket AP         (Rocket Launcher)
        createObjectWithPID(45).setAmount(20),   // Rocket Explosive  (Rocket Launcher)
    ]

    lightRadius = 4
    lightIntensity = 65536

    toString() {
        return 'The Dude'
    }

    // FO2-CE ref: stat.cc pcGetExperienceForLevel()
    // XP required to *reach* a given level: level * (level - 1) / 2 * 1000
    static xpForLevel(level: number): number {
        return Math.floor(level * (level - 1) / 2) * 1000
    }

    addExperience(xp: number) {
        this.stats.modifyBase('Experience', xp)

        // FO2-CE ref: stat.cc — loop handles gaining multiple levels at once
        const totalXP = this.stats.get('Experience')
        let currentLevel = this.stats.get('Level')

        while (currentLevel < 99) {
            const xpForNextLevel = Player.xpForLevel(currentLevel + 1)
            if (totalXP < xpForNextLevel) break

            this.stats.modifyBase('Level', 1)
            currentLevel++

            // FO2-CE ref: stat.cc — Skill points: 5 + 2*INT per level
            // Educated perk: +2 per rank
            let skillPointGain = 5 + this.getStat('INT') * 2
            if (this.hasPerk('Educated')) skillPointGain += 2
            this.skills.skillPoints += skillPointGain

            // FO2-CE ref: stat.cc — HP per level: floor(END / 2) + 2
            // Lifegiver perk: +4 per rank
            let hpGain = Math.floor(this.getStat('END') / 2) + 2
            if (this.hasPerk('Lifegiver')) hpGain += 4
            this.stats.modifyBase('Max HP', hpGain)
            this.stats.modifyBase('HP', hpGain)

            // FO2-CE ref: editor.cc — perk every 3 levels (Skilled trait: every 4)
            const perkRate = this.hasPerk('Skilled') ? 4 : 3
            if (currentLevel % perkRate === 0) {
                this.pendingPerkPick = true
            }

            console.log(
                `Level up! Now level ${currentLevel}. `
                + `Gained ${skillPointGain} skill points, ${hpGain} HP.`
            )
        }
    }

    // Set to true when a perk pick is available (at character screen)
    pendingPerkPick = false

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
                    console.log('exit grid -> worldmap')
                    uiWorldMap()
                } else {
                    // another map
                    console.log(
                        'exit grid -> map ' +
                            exitMapID +
                            ' elevation ' +
                            startingElevation +
                            ' @ ' +
                            startingPosition.x +
                            ', ' +
                            startingPosition.y
                    )
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
