/*
Copyright 2014 darkf, Stratege
Copyright 2017 darkf

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

import {
    skillDependencies, skillImprovementCost, statDependencies,
    SKILL_MAX_VALUE, DEFAULT_TAGGED_SKILLS, MAX_TAGGED_SKILLS,
    perkGetSkillModifier, traitGetSkillModifier, skillGetGameDifficultyModifier,
} from "./skills.js";
import { clamp } from "./util.js";

// Character Stats and Skills

// TODO: "Melee Weapons" skill is called "Melee" in the PRO

// FO2-CE ref: skill.cc skillGetValue() — player-only modifiers are passed via options
export interface SkillCalcOptions {
    isPlayer?: boolean;
    perks?: string[];
    traits?: string[];
    hasTagPerk?: boolean; // Tag! perk: allows 4th tagged skill (no +20 bonus on that slot)
}

export class SkillSet {
    baseSkills: { [name: string]: number } = {};
    tagged: string[] = [];
    skillPoints: number = 0;
    hasTagPerk: boolean = false; // Tag! perk acquired

    constructor(baseSkills?: { [name: string]: number }, tagged?: string[], skillPoints?: number) {
        // Copy construct a SkillSet
        if(baseSkills) this.baseSkills = baseSkills;
        if(tagged) this.tagged = tagged;
        if(skillPoints) this.skillPoints = skillPoints;
    }

    clone(): SkillSet {
        // FO2-CE ref: deep copy so character screen edits don't mutate the original
        const c = new SkillSet(
            Object.assign({}, this.baseSkills),
            this.tagged.slice(),
            this.skillPoints,
        );
        c.hasTagPerk = this.hasTagPerk;
        return c;
    }

    static fromPro(skills: any): SkillSet {
        return new SkillSet(skills);
    }

    // FO2-CE ref: skill.cc skillGetBaseValue() — raw invested points from proto
    // In DarkHarold2, baseSkills stores startValue + invested (startValue is baked in on first inc).
    // getBase returns the raw stored value, falling back to startValue if nothing invested yet.
    getBase(skill: string): number {
        const skillDep = skillDependencies[skill];

        if(!skillDep)
            throw Error(`No dependencies for skill '${skill}'`);

        return this.baseSkills[skill] !== undefined ? this.baseSkills[skill] : skillDep.startValue;
    }

    // FO2-CE ref: skill.cc skillGetValue()
    // Formula: value = defaultValue + statModifier * (stat1 [+ stat2]) + investedPoints
    //   if player & tagged:  value += investedPoints + 20  (doubles invested; Tag! 4th slot: no +20)
    //   if player:           value += traitMod + perkMod + difficultyMod
    //   cap at SKILL_MAX_VALUE (300)
    //
    // In DarkHarold2, baseSkills[skill] stores (startValue + invested) as a unit.
    // So: investedPoints = base - startValue, defaultValue = startValue.
    // Effective = base + statBonus  (for non-tagged)
    // Effective = startValue + 2*invested + 20 + statBonus  (for tagged)
    get(skill: string, stats: StatSet, options?: SkillCalcOptions): number {
        const base = this.getBase(skill);
        const skillDep = skillDependencies[skill];

        if(!skillDep)
            throw Error(`No dependencies for skill '${skill}'`);

        const isPlayer = options?.isPlayer ?? false;

        // Stat bonus: sum of stat * multiplier for each dependency
        let statBonus = 0;
        for(const dep of skillDep.dependencies) {
            if(dep.statType)
                statBonus += Math.floor(stats.get(dep.statType) * dep.multiplier);
        }

        // investedPoints = raw base minus the startValue default
        const invested = base - skillDep.startValue;
        let value = skillDep.startValue + statBonus + invested;

        // FO2-CE ref: skill.cc — tagged bonus only for player (critter == gDude)
        if(isPlayer && this.isTagged(skill)) {
            // Double the invested points
            value += invested;
            // +20 bonus, unless this is the Tag! perk's 4th slot
            const isTagPerk4thSlot = (options?.hasTagPerk || this.hasTagPerk)
                && this.tagged.length >= 4
                && this.tagged[3] === skill;
            if(!isTagPerk4thSlot) {
                value += 20;
            }
        }

        // Player-only modifiers: traits, perks, game difficulty
        if(isPlayer) {
            if(options?.traits && options.traits.length > 0) {
                value += traitGetSkillModifier(options.traits, skill);
            }
            if(options?.perks && options.perks.length > 0) {
                value += perkGetSkillModifier(options.perks, skill);
            }
            value += skillGetGameDifficultyModifier(skill);
        }

        // FO2-CE ref: skill.cc — cap at 300
        if(value > SKILL_MAX_VALUE) {
            value = SKILL_MAX_VALUE;
        }

        return value;
    }

    setBase(skill: string, skillValue: number) {
        this.baseSkills[skill] = skillValue;
    }

    // FO2-CE ref: skill.cc skillAdd() — cost based on *effective* skill value
    incBase(skill: string, stats: StatSet, options?: SkillCalcOptions, useSkillPoints: boolean = true): boolean {
        const effectiveValue = this.get(skill, stats, options);

        // FO2-CE ref: skill.cc — cannot increment past SKILL_MAX_VALUE
        if(effectiveValue >= SKILL_MAX_VALUE) {
            return false;
        }

        if(useSkillPoints) {
            const cost = skillImprovementCost(effectiveValue);

            if(this.skillPoints < cost) {
                return false;
            }

            this.skillPoints -= cost;
        }

        const base = this.getBase(skill);
        this.setBase(skill, base + 1);
        return true;
    }

    // FO2-CE ref: skill.cc skillSub() — refund based on effective value *after* decrement
    decBase(skill: string, stats: StatSet, options?: SkillCalcOptions, useSkillPoints: boolean = true) {
        const base = this.getBase(skill);
        const skillDep = skillDependencies[skill];

        // Cannot decrement below startValue (no invested points left)
        if(base <= skillDep.startValue) {
            return;
        }

        this.setBase(skill, base - 1);

        if(useSkillPoints) {
            // Refund: cost of the new (lower) effective value
            const newEffective = this.get(skill, stats, options);
            const cost = skillImprovementCost(newEffective);
            this.skillPoints += cost;
        }
    }

    isTagged(skill: string): boolean {
        return this.tagged.indexOf(skill) !== -1;
    }

    // FO2-CE ref: skill_defs.h — DEFAULT_TAGGED_SKILLS = 3, MAX_TAGGED_SKILLS = 4 (via Tag! perk)
    getMaxTaggedSkills(): number {
        return this.hasTagPerk ? MAX_TAGGED_SKILLS : DEFAULT_TAGGED_SKILLS;
    }

    tag(skill: string): boolean {
        if(this.isTagged(skill)) return false;
        if(this.tagged.length >= this.getMaxTaggedSkills()) return false;
        this.tagged.push(skill);
        return true;
    }

    untag(skill: string) {
        if(this.isTagged(skill))
            this.tagged.splice(this.tagged.indexOf(skill), 1);
    }
}

export class StatSet {
    baseStats: { [name: string]: number } = {};
    useBonuses: boolean;

    constructor(baseStats?: { [name: string]: number }, useBonuses: boolean=true) {
        // Copy construct a StatSet
        if(baseStats) this.baseStats = baseStats;
        this.useBonuses = useBonuses;
    }

    clone(): StatSet {
        return new StatSet(Object.assign({}, this.baseStats), this.useBonuses);
    }

    static fromPro(pro: any): StatSet {
        // console.log("stats fromPro: %o", pro);

        const { baseStats, bonusStats } = pro.extra;

        const stats = Object.assign({}, baseStats);

        for(const stat in stats) {
            if(bonusStats[stat] !== undefined)
                stats[stat] += bonusStats[stat];
        }

        // TODO: armor, appears to be hardwired into the proto?

        // Define Max HP = HP if it does not exist
        if(stats["Max HP"] === undefined && stats["HP"] !== undefined)
            stats["Max HP"] = stats["HP"];

        // Define HP = Max HP if it does not exist
        if(stats["HP"] === undefined && stats["Max HP"] !== undefined)
            stats["HP"] = stats["Max HP"];

        return new StatSet(stats, false);
    }

    getBase(stat: string): number {
        const statDep = statDependencies[stat];

        if(!statDep)
            throw Error(`No dependencies for stat '${stat}'`);

        return this.baseStats[stat] || statDep.defaultValue;
    }

    get(stat: string): number {
        const base = this.getBase(stat);

        const statDep = statDependencies[stat];

        if(!statDep)
            throw Error(`No dependencies for stat '${stat}'`);

        let statValue = base;
        if(this.useBonuses) {
            for(const dep of statDep.dependencies) {
                if(dep.statType)
                    statValue += Math.floor(this.get(dep.statType) * dep.multiplier);
            }
        }

        return clamp(statDep.min, statDep.max, statValue);
    }

    setBase(stat: string, statValue: number) {
        this.baseStats[stat] = statValue;
    }

    modifyBase(stat: string, change: number) {
        this.setBase(stat, this.getBase(stat) + change);
    }
}
