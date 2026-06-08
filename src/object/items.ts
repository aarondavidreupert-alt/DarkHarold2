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

// Item / WeaponObj / Scenery / Door subclasses split out of object.ts.
// See wiki/ts-split-refactor.md §2.

import { Weapon } from '../critter.js'
import { getLstId } from '../data.js'
import { getMessage } from '../util.js'
import { Obj, SerializedObj } from './Obj.js'

export class Item extends Obj {
    type = 'item'

    static fromPID(pid: number, sid?: number): Item {
        return Obj.fromPID_(new Item(), pid, sid)
    }

    static fromMapObject(mobj: any, deserializing = false): Item {
        return Obj.fromMapObject_(new Item(), mobj, deserializing)
    }

    init() {
        super.init()

        // load item inventory art
        if (this.pro === null) {
            return
        }
        this.name = getMessage('pro_item', this.pro.textID)

        const invPID = this.pro.extra.invFRM & 0xffff
        if (invPID !== 0xffff) {
            this.invArt = 'art/inven/' + getLstId('art/inven/inven', invPID).split('.')[0]
        }
    }
}

export class WeaponObj extends Item {
    weapon?: Weapon = null

    // CE ref: item.cc:357 _item_identical — two weapons stack only if their loaded
    // state (ammo PID + remaining rounds) matches. Prevents loaded and unloaded
    // copies of the same weapon PID from merging into one stack.
    approxEq(obj: Obj): boolean {
        if (this.pid !== obj.pid) return false
        const a = this.pro?.extra
        const b = obj.pro?.extra
        return (a?.ammoPID ?? 0) === (b?.ammoPID ?? 0)
            && (a?.rounds ?? 0) === (b?.rounds ?? 0)
    }

    static fromPID(pid: number, sid?: number): WeaponObj {
        return Obj.fromPID_(new WeaponObj(), pid, sid)
    }

    static fromMapObject(mobj: any, deserializing = false): WeaponObj {
        const obj = Obj.fromMapObject_(new WeaponObj(), mobj, deserializing)
        if (deserializing && mobj.weaponMode && obj.weapon) {
            obj.weapon.mode = mobj.weaponMode
        }
        return obj
    }

    serialize(): SerializedObj {
        const obj = super.serialize() as any
        // CE ref: item.cc — persist firing mode so reload state survives save/load
        if (this.weapon) obj.weaponMode = this.weapon.mode
        return obj
    }

    init() {
        super.init()
        this.weapon = new Weapon(this)
    }
}

export class Scenery extends Obj {
    type = 'scenery'

    static fromPID(pid: number, sid?: number): Scenery {
        return Obj.fromPID_(new Scenery(), pid, sid)
    }

    static fromMapObject(mobj: any, deserializing = false): Scenery {
        return Obj.fromMapObject_(new Scenery(), mobj, deserializing)
    }

    init() {
        super.init()
        //console.log("Scenery init")

        if (!this.pro) {
            return
        }

        const subtypeMap: { [subtype: number]: string } = {
            0: 'door',
            1: 'stairs',
            2: 'elevator',
            3: 'ladder',
            4: 'ladder',
            5: 'generic',
        }
        this.subtype = subtypeMap[this.pro.extra.subType]
    }
}

export class Door extends Scenery {
    static fromPID(pid: number, sid?: number): Door {
        return Obj.fromPID_(new Door(), pid, sid)
    }

    static fromMapObject(mobj: any, deserializing = false): Door {
        return Obj.fromMapObject_(new Door(), mobj, deserializing)
    }

    init() {
        super.init()
        //console.log("Door init")
    }
}
