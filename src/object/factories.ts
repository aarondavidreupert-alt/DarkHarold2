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

// PID-dispatched object factory functions split out of object.ts.
// See wiki/ts-split-refactor.md §2.

import { loadPRO } from '../pro.js'
import { Obj, SerializedObj } from './Obj.js'
import { Critter } from './Critter.js'
import { Door, Item, Scenery, WeaponObj } from './items.js'

// Creates an object of a relevant type from a Prototype ID and an optional Script ID
export function createObjectWithPID(pid: number, sid?: number) {
    const pidType = (pid >> 24) & 0xff
    if (pidType == 1) {
        // critter
        return Critter.fromPID(pid, sid)
    } else if (pidType == 0) {
        // item
        const pro = loadPRO(pid, pid & 0xffff)
        if (pro && pro.extra && pro.extra.subType == 3) {
            return WeaponObj.fromPID(pid, sid)
        } else {
            return Item.fromPID(pid, sid)
        }
    } else if (pidType == 2) {
        // scenery
        const pro = loadPRO(pid, pid & 0xffff)
        if (pro && pro.extra && pro.extra.subType == 0) {
            return Door.fromPID(pid, sid)
        } else {
            return Scenery.fromPID(pid, sid)
        }
    } else {
        return Obj.fromPID(pid, sid)
    }
}

export function objFromMapObject(mobj: any, deserializing = false) {
    const pid = mobj.pid
    const pidType = (pid >> 24) & 0xff

    if (pidType == 1) {
        // critter
        return Critter.fromMapObject(mobj, deserializing)
    } else if (pidType == 0) {
        // item
        const pro = mobj.pro || loadPRO(pid, pid & 0xffff)
        if (pro && pro.extra && pro.extra.subType == 3) {
            return WeaponObj.fromMapObject(mobj, deserializing)
        } else {
            return Item.fromMapObject(mobj, deserializing)
        }
    } else if (pidType == 2) {
        // scenery
        const pro = mobj.pro || loadPRO(pid, pid & 0xffff)
        if (pro && pro.extra && pro.extra.subType == 0) {
            return Door.fromMapObject(mobj, deserializing)
        } else {
            return Scenery.fromMapObject(mobj, deserializing)
        }
    } else {
        return Obj.fromMapObject(mobj, deserializing)
    }
}

export function deserializeObj(mobj: SerializedObj) {
    return objFromMapObject(mobj, true)
}
