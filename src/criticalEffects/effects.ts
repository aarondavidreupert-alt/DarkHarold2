/*
Copyright 2014-2015 darkf, Stratege

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

// Hit-location accuracy penalties. The critical tables themselves are CE's
// (criticalEffects/ceTables.ts, generated from combat.cc), applied by the attack
// pipeline in combat/Combat.ts (attackComputeCriticalHit / attackComputeCriticalFailure).

// CE combat.cc hit_location_penalty_default, as positive penalties.
export const regionHitChanceDecTable: { [region: string]: number } = {
    torso: 0,
    leftLeg: 20,
    rightLeg: 20,
    leftArm: 30,
    rightArm: 30,
    head: 40,
    eyes: 60,   // CE combat.cc hit_location_penalty_default: HIT_LOCATION_EYES -60
    groin: 30,  // CE: HIT_LOCATION_GROIN -30
}
