// sfall arrays — a port of fallout2-ce sfall_arrays.cc (CE's reimplementation of sfall's
// arrays). Scripts address arrays by integer id: lists (index 0..n-1) and associative
// maps (keyed by int, float, string or object). Temporary arrays (temp_array, the
// arrays list_as_array / string_split return) are freed after each game tick (CE
// scripts.cc scriptsHandleRequests → DeleteAllTempArrays); all are dropped by a new
// game (game.cc gameReset → sfallArraysReset). Like CE, arrays are not saved.
//
// Values are kept as script values: numbers, strings, game objects. CE's element types
// order INT < FLOAT < STRING < POINTER for sorting; DH2 tells int from float by
// Number.isInteger (the VM keeps no separate float type once a value is popped).
// Used by the Unofficial Patch's scripts (wiki/upu_support.md); no vanilla script.

const ARRAY_MAX_STRING = 255 // CE: a string key / value keeps at most 254 characters
const ARRAY_MAX_SIZE = 100000
const FLAG_ASSOC = 1 // SFALL_ARRAYFLAG_ASSOC
const FLAG_CONSTVAL = 2 // SFALL_ARRAYFLAG_CONSTVAL: don't update a key that exists
// array_resize actions (CE ARRAY_ACTION_*)
const ACTION_SORT = -2
const ACTION_RSORT = -3
const ACTION_REVERSE = -4
const ACTION_SHUFFLE = -5

type Element = number | string | object

function elementType(v: Element): number {
    if (typeof v === 'number') return Number.isInteger(v) ? 0 : 1 // INT, FLOAT
    if (typeof v === 'string') return 2 // STRING
    return 3 // POINTER
}

// CE ArrayElement(ProgramValue): strings are copied and cut to ARRAY_MAX_STRING - 1
function toElement(v: any): Element {
    if (typeof v === 'string') return v.length >= ARRAY_MAX_STRING ? v.slice(0, ARRAY_MAX_STRING - 1) : v
    if (typeof v === 'number') return v
    if (v !== null && typeof v === 'object') return v
    return 0
}

// CE ArrayElement::operator== / operator<
function same(a: Element, b: Element): boolean {
    return elementType(a) === elementType(b) && a === b
}
function less(a: Element, b: Element): boolean {
    const ta = elementType(a)
    const tb = elementType(b)
    if (ta !== tb) return ta < tb
    if (ta === 3) return false // pointers: no meaningful order in DH2
    return a < b
}

function listSort<T>(arr: T[], action: number, lessFn: (a: T, b: T) => boolean): void {
    const cmp = (a: T, b: T) => (lessFn(a, b) ? -1 : lessFn(b, a) ? 1 : 0)
    switch (action) {
        case ACTION_SORT:
            arr.sort(cmp)
            break
        case ACTION_RSORT:
            arr.sort((a, b) => -cmp(a, b))
            break
        case ACTION_REVERSE:
            arr.reverse()
            break
        case ACTION_SHUFFLE: // CE: std::shuffle with a random_device seed (not the game RNG)
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1))
                ;[arr[i], arr[j]] = [arr[j], arr[i]]
            }
            break
    }
}

interface SfallArray {
    flags: number
    size(): number
    getKey(index: number): Element
    get(key: any): Element
    set(key: any, val: any, allowUnset: boolean): void
    resize(newLen: number): void
    scan(val: any): Element
}

// CE SFallArrayList
class ListArray implements SfallArray {
    values: Element[]
    constructor(
        len: number,
        public flags: number,
    ) {
        this.values = new Array(len).fill(0)
    }
    size() {
        return this.values.length
    }
    getKey(index: number): Element {
        if (index < -1 || index > this.size()) return 0
        if (index === -1) return 0 // -1: "is it associative?" — no
        return index
    }
    get(key: any): Element {
        const i = typeof key === 'number' ? Math.trunc(key) : 0
        return i >= 0 && i < this.size() ? this.values[i] : 0
    }
    set(key: any, val: any): void {
        if (typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < this.size())
            this.values[key] = toElement(val)
    }
    resize(newLen: number): void {
        if (newLen === -1 || this.size() === newLen) return
        if (newLen === 0) this.values = []
        else if (newLen > 0) {
            const n = Math.min(newLen, ARRAY_MAX_SIZE)
            if (n < this.values.length) this.values.length = n
            else while (this.values.length < n) this.values.push(0)
        } else if (newLen >= ACTION_SHUFFLE) listSort(this.values, newLen, less)
    }
    scan(val: any): Element {
        const el = toElement(val)
        for (let i = 0; i < this.size(); i++) if (same(el, this.values[i])) return i
        return -1
    }
}

// CE SFallArrayAssoc
class AssocArray implements SfallArray {
    pairs: { key: Element; value: Element }[] = []
    constructor(public flags: number) {}
    size() {
        return this.pairs.length
    }
    private find(key: Element): number {
        return this.pairs.findIndex((p) => same(p.key, key))
    }
    getKey(index: number): Element {
        if (index < -1 || index > this.size()) return 0
        if (index === -1) return 1 // -1: "is it associative?" — yes
        return this.pairs[index]?.key ?? 0
    }
    get(key: any): Element {
        const i = this.find(toElement(key))
        return i === -1 ? 0 : this.pairs[i].value
    }
    set(key: any, val: any, allowUnset: boolean): void {
        const k = toElement(key)
        const i = this.find(k)
        const readOnly = (this.flags & FLAG_CONSTVAL) !== 0
        if (i !== -1 && readOnly) return
        if (allowUnset && !readOnly && typeof val === 'number' && Number.isInteger(val) && val === 0) {
            // CE: a key set to 0 is removed (get_array answers 0 for a missing key)
            if (i !== -1) this.pairs.splice(i, 1)
        } else if (i === -1) {
            if (this.size() >= ARRAY_MAX_SIZE) return
            this.pairs.push({ key: k, value: toElement(val) })
        } else {
            this.pairs[i].value = toElement(val)
        }
    }
    resize(newLen: number): void {
        if (newLen === -1 || this.size() === newLen) return
        // only shrinking (adding a range of keys means nothing for a map)
        if (newLen >= 0 && newLen < this.size()) this.pairs.length = newLen
        else if (newLen < 0) {
            if (newLen < ACTION_SHUFFLE - 2) return
            let action = newLen
            let byValue = false
            if (action < ACTION_SHUFFLE) {
                action += 4
                byValue = true
            }
            listSort(this.pairs, action, byValue ? (a, b) => less(a.value, b.value) : (a, b) => less(a.key, b.key))
        }
    }
    scan(val: any): Element {
        const el = toElement(val)
        const p = this.pairs.find((x) => same(x.value, el))
        return p ? p.key : -1
    }
}

const INITIAL_ARRAY_ID = 1 // CE kInitialArrayId
const arrays = new Map<number, SfallArray>()
const temporary = new Set<number>()
let nextArrayId = INITIAL_ARRAY_ID

/** CE sfallArraysReset (game.cc gameReset). */
export function sfallArraysReset(): void {
    arrays.clear()
    temporary.clear()
    nextArrayId = INITIAL_ARRAY_ID
}

/** CE CreateArray: a negative length makes an associative array. */
export function createArray(len: number, flags: number): number {
    flags = flags & ~FLAG_ASSOC
    if (len < 0) flags |= FLAG_ASSOC
    else if (len > ARRAY_MAX_SIZE) len = ARRAY_MAX_SIZE
    const id = nextArrayId++
    arrays.set(id, flags & FLAG_ASSOC ? new AssocArray(flags) : new ListArray(len, flags))
    return id
}

export function createTempArray(len: number, flags: number): number {
    const id = createArray(len, flags)
    temporary.add(id)
    return id
}

export function arrayKey(id: number, index: number): Element {
    return arrays.get(id)?.getKey(index) ?? 0
}
export function lenArray(id: number): number {
    return arrays.get(id)?.size() ?? -1
}
export function getArray(id: number, key: any): Element {
    return arrays.get(id)?.get(key) ?? 0
}
export function setArray(id: number, key: any, val: any, allowUnset: boolean): void {
    arrays.get(id)?.set(key, val, allowUnset)
}
export function freeArray(id: number): void {
    arrays.delete(id)
    temporary.delete(id)
}
export function fixArray(id: number): void {
    temporary.delete(id)
}
export function resizeArray(id: number, newLen: number): void {
    arrays.get(id)?.resize(newLen)
}
export function scanArray(id: number, val: any): Element {
    return arrays.get(id)?.scan(val) ?? -1
}

/** CE DeleteAllTempArrays — after each game tick (scripts.cc scriptsHandleRequests). */
export function deleteAllTempArrays(): void {
    for (const id of temporary) arrays.delete(id)
    temporary.clear()
}

/** CE StackArray (sslc's array literals): a value into the last created array, growing a
 *  list by one when the key is its length. */
export function stackArray(key: any, val: any): number {
    const id = nextArrayId - 1
    const arr = arrays.get(id)
    if (!arr) return 0
    const size = arr.size()
    if (size >= ARRAY_MAX_SIZE) return 0
    if (typeof key === 'number' && key >= size) arr.resize(size + 1)
    arr.set(key, val, false)
    return 0
}

/** CE ListAsArray: the objects as a temporary list. */
export function arrayFromObjects(objects: object[]): number {
    const id = createTempArray(objects.length, 0)
    const arr = arrays.get(id) as ListArray
    objects.forEach((o, i) => {
        arr.values[i] = o
    })
    return id
}

/** CE StringSplit: a temporary list of the parts (an empty separator splits into characters). */
export function stringSplit(str: string, split: string): number {
    const parts = split === '' ? [...str] : str.split(split)
    const id = createTempArray(parts.length, 0)
    const arr = arrays.get(id) as ListArray
    parts.forEach((p, i) => {
        arr.values[i] = toElement(p)
    })
    return id
}
