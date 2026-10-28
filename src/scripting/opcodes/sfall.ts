// Script opcodes: the sfall extensions: arrays, file I/O, globals, hooks, ini settings, proto and stat access (sfall_opcodes.cc, sfall_arrays.cc).
// Methods of the Script class (scripting.ts), kept here by topic and installed on its prototype
// there; vm_bridge.ts and the Lua prelude call them as before (wiki/code_quality.md Q16).

import type { Script } from '../../scripting.js'
import { Config } from '../../config.js'
import * as CriticalEffects from '../../criticalEffects.js'
import { Critter, Obj } from '../../object.js'
import * as GameTime from '../../gametime.js'
import * as GlobalScripts from '../../sfallGlobalScripts.js'
import { SCREEN_HEIGHT, SCREEN_WIDTH, screenToWorld } from '../../renderer.js'
import * as SfallArrays from '../../sfallArrays.js'
import * as SfallFs from '../../sfallFs.js'
import * as SfallHooks from '../../sfallHooks.js'
import { UIMode } from '../../uiMode.js'
import * as Worldmap from '../../worldmap.js'
import { ammoGetQuantity, ammoSetQuantity, weaponGetAmmoTypePid, weaponSetAmmoTypePid } from '../../weaponAmmo.js'
import { combatGetData } from '../../combat.js'
import { critterAdjustRadiation } from '../../radiation.js'
import { currentUnarmed } from '../../unarmed.js'
import { getMessage } from '../../util.js'
import globalState from '../../globalState.js'
import { heart } from '../../heart.js'
import { hexFromScreen } from '../../geometry.js'
import { loadPRO, lookupArt } from '../../pro.js'
import { scriptNumberOf } from '../../data.js'
import { sfallIniGetInt, sfallIniGetString, sfallIniSet } from '../../sfallIni.js'
import { sfallKeyPressed, sfallMouseButtons } from '../../sfallInput.js'
import { showAlert } from '../../ui_dialog.js'
import { toTileNum } from '../../tile.js'
import {
    ATTACK_FIELDS_BY_OFFSET,
    SFALL_HIT_LOCATIONS,
    SFALL_PROTO_MESSAGE_FILES,
    SFALL_STANDARD_MESSAGE_FILES,
    critterAdjustHitPoints,
    currentMapID,
    isGameObject,
    objectEnterMap,
    scriptingState,
    sfallLists,
    statMap,
    traitSpecialPart,
    warn,
} from '../../scripting.js'

export const sfallOpcodes = {
    // ── sfall arrays (CE sfall_opcodes.cc op*Array → sfall_arrays.cc; src/sfallArrays.ts).
    // Used by the Unofficial Patch's scripts, never by vanilla ones.
    // CE opCreateArray (0x822D) / opTempArray (0x8233): a negative length = associative
    create_array(this: Script, len: number, flags: number) {
        return SfallArrays.createArray(len, flags)
    },
    temp_array(this: Script, len: number, flags: number) {
        return SfallArrays.createTempArray(len, flags)
    },
    // CE opFixArray (0x8234) / opFreeArray (0x8230)
    fix_array(this: Script, id: number) {
        SfallArrays.fixArray(id)
    },
    free_array(this: Script, id: number) {
        SfallArrays.freeArray(id)
    },
    // CE opSetArray (0x822E): a 0 written to a map key removes it
    set_array(this: Script, id: number, key: any, value: any) {
        SfallArrays.setArray(id, key, value, true)
    },
    // CE opGetArray (0x822F): with a string instead of an array id, the character at key
    get_array(this: Script, id: any, key: any) {
        if (typeof id === 'string') return typeof key === 'number' && key >= 0 && key < id.length ? id[key] : ''
        return SfallArrays.getArray(id, key)
    },
    // CE opLenArray (0x8231): -1 for no such array; opResizeArray (0x8232): also sort / reverse / shuffle
    len_array(this: Script, id: number) {
        return SfallArrays.lenArray(id)
    },
    resize_array(this: Script, id: number, len: number) {
        SfallArrays.resizeArray(id, len)
    },
    // CE opScanArray (0x8239): a list's index / a map's key holding value, else -1
    scan_array(this: Script, id: number, value: any) {
        return SfallArrays.scanArray(id, value)
    },
    // CE opGetArrayKey (0x8256): the key at index (index -1: 1 if associative)
    array_key(this: Script, id: number, index: number) {
        return SfallArrays.arrayKey(id, index)
    },
    // CE opStackArray (0x8257): sslc's array literals, into the last created array
    arrayexpr(this: Script, key: any, value: any) {
        return SfallArrays.stackArray(key, value)
    },
    // CE opStringSplit (0x8235)
    string_split(this: Script, str: string, split: string) {
        return SfallArrays.stringSplit(String(str ?? ''), String(split ?? ''))
    },
    // CE op_list_as_array (0x8236) → sfall_lists.cc sfall_lists_fill: the map's objects of
    // a type (0 critters, 1 items, 2 scenery, 3 walls, 5 misc, 6 spatial, 9 all; 4 tiles:
    // nothing, as in sfall), every elevation, as a temporary list
    list_as_array(this: Script, type: number) {
        const map = globalState.gMap
        const out: object[] = []
        if (map && type === 6) {
            for (const level of (map.spatials ?? []) as any[][]) for (const s of level ?? []) out.push(s)
        } else if (map && type !== 4) {
            const kinds: { [t: number]: string } = { 0: 'critter', 1: 'item', 2: 'scenery', 3: 'wall', 5: 'misc' }
            for (const level of map.objects ?? []) {
                for (const o of level ?? []) if (type === 9 || o.type === kinds[type]) out.push(o)
            }
        }
        return SfallArrays.arrayFromObjects(out)
    },
    // ── other sfall functions the Unofficial Patch uses (CE sfall_opcodes.cc)
    // CE op_abs (0x81ED)
    abs(this: Script, v: number) {
        return Math.abs(Number(v) || 0)
    },
    // CE op_get_ini_setting (0x81AC) → sfall_ini.cc; src/sfallIni.ts
    get_ini_setting(this: Script, triplet: string) {
        return sfallIniGetInt(triplet)
    },
    set_self(this: Script, obj: Obj) {
        this.overriddenSelf = isGameObject(obj) ? obj : null
    },
    // CE op_get_proto_data / op_set_proto_data (0x8204 / 0x8205) read and write a proto
    // by byte offset. DH2's protos are JSON, so only the offsets the UPU uses map to a
    // field: an item's 96 (weapon d.max_ammo) and a critter's 388 (d.body). Others: -1.
    get_proto_data(this: Script, pid: number, offset: number) {
        const pro = loadPRO(pid, pid & 0xffff)
        if (!pro) return -1
        if (offset === 96 && pro.type === 0) return pro.extra?.maxAmmo ?? -1
        if (offset === 388 && pro.type === 1) return pro.extra?.bodyType ?? -1
        warn('get_proto_data: offset ' + offset + ' of pid ' + pid + ' is not mapped')
        return -1
    },
    set_proto_data(this: Script, pid: number, offset: number, value: number) {
        const pro = loadPRO(pid, pid & 0xffff)
        if (!pro || !pro.extra) return
        if (offset === 96 && pro.type === 0) pro.extra.maxAmmo = value
        else if (offset === 388 && pro.type === 1) pro.extra.bodyType = value
        else warn('set_proto_data: offset ' + offset + ' of pid ' + pid + ' is not mapped')
    },
    // CE opGetWeaponAmmoPid / opSetWeaponAmmoPid / opGetWeaponAmmoCount /
    // opSetWeaponAmmoCount (0x8217-0x821A): a weapon's loaded ammo (misc items:
    // their charges)
    get_weapon_ammo_pid(this: Script, obj: Obj) {
        if (!isGameObject(obj) || obj.type !== 'item') return -1
        if (obj.subtype === 'weapon') return weaponGetAmmoTypePid(obj)
        return -1
    },
    set_weapon_ammo_pid(this: Script, obj: Obj, pid: number) {
        if (isGameObject(obj) && obj.type === 'item' && obj.subtype === 'weapon') weaponSetAmmoTypePid(obj, pid)
    },
    get_weapon_ammo_count(this: Script, obj: Obj) {
        if (!isGameObject(obj) || obj.type !== 'item') return 0
        if (obj.subtype === 'weapon' || obj.subtype === 'ammo') return ammoGetQuantity(obj)
        if (obj.subtype === 'misc') return (obj as any).charges ?? 0
        return 0
    },
    set_weapon_ammo_count(this: Script, obj: Obj, count: number) {
        if (!isGameObject(obj) || obj.type !== 'item') return
        if (obj.subtype === 'weapon' || obj.subtype === 'ammo') ammoSetQuantity(obj, count)
        else if (obj.subtype === 'misc') (obj as any).charges = count
    },
    // CE op_set_pc_base_stat / op_get_pc_base_stat / opSetPcBonusStat / opGetPcBonusStat
    // (0x815A-0x815D) and sfall's critter forms (0x815F-0x8161; not in CE, same work)
    set_pc_base_stat(this: Script, stat: number, value: number) {
        this.setCritterStatPart(globalState.player as Critter, stat, value, false)
    },
    set_pc_extra_stat(this: Script, stat: number, value: number) {
        this.setCritterStatPart(globalState.player as Critter, stat, value, true)
    },
    get_pc_base_stat(this: Script, stat: number) {
        return this.getCritterStatPart(globalState.player as Critter, stat, false)
    },
    get_pc_extra_stat(this: Script, stat: number) {
        return this.getCritterStatPart(globalState.player as Critter, stat, true)
    },
    set_critter_extra_stat(this: Script, obj: Critter, stat: number, value: number) {
        this.setCritterStatPart(obj, stat, value, true)
    },
    get_critter_base_stat(this: Script, obj: Critter, stat: number) {
        return this.getCritterStatPart(obj, stat, false)
    },
    get_critter_extra_stat(this: Script, obj: Critter, stat: number) {
        return this.getCritterStatPart(obj, stat, true)
    },
    // CE stat.cc critterSetBonusStat / critterSetBaseStat (sfall set_*_extra_stat /
    // set_*_base_stat): current HP / poison / radiation (35-37) go through their adjust
    // functions — the bonus by the value, the base to the value; a derived stat's base
    // can't be set; a SPECIAL base outside 1..10 (less the dude's trait part) is refused.
    setCritterStatPart(this: Script, obj: Critter, stat: number, value: number, bonus: boolean) {
        if (!isGameObject(obj) || obj.type !== 'critter') return
        if (stat >= 35 && stat <= 37) {
            const current =
                stat === 35 ? obj.getStat('HP') : stat === 36 ? (obj.poisonLevel ?? 0) : (obj.radiationLevel ?? 0)
            const delta = bonus ? value : value - current
            if (stat === 35) critterAdjustHitPoints(obj, delta)
            else if (stat === 36) this.poison(obj, delta)
            else critterAdjustRadiation(obj, delta)
            return
        }
        const name = statMap[stat]
        if (!name) return
        if (bonus) {
            obj.stats.setBonus(name, value)
            return
        }
        if (stat > 6 && stat <= 32) return // -1: a derived stat
        if (stat <= 6) {
            const own = value - traitSpecialPart(obj, stat)
            if (own < 1 || own > 10) return // -2 / -3
        }
        obj.stats.setBase(name, value)
    },
    getCritterStatPart(this: Script, obj: Critter, stat: number, bonus: boolean): number {
        const name = statMap[stat]
        if (!isGameObject(obj) || obj.type !== 'critter' || !name) return 0
        if (bonus) return obj.stats.getBonus(name)
        // sfall get_pc_base_stat → critterGetBaseStat: the base without the dude's traits
        return obj.stats.getBase(name) - (stat <= 6 ? traitSpecialPart(obj, stat) : 0)
    },
    // CE op_get_script (0x81F5): the object's script number (scripts.lst line + 1), 0 for none
    get_script(this: Script, obj: Obj) {
        const name = isGameObject(obj) ? obj._script?.scriptName : null
        return name ? scriptNumberOf(name) : 0
    },
    // CE op_set_world_map_pos (0x8172) → worldmap.cc wmSetPartyWorldPos
    set_world_map_pos(this: Script, x: number, y: number) {
        Worldmap.setPlayerWorldPos(x, y)
    },
    // CE op_set_car_current_town (0x81B6) → wmCarSetCurrentArea
    set_car_current_town(this: Script, area: number) {
        Worldmap.setCarAreaId(area)
    },
    // sfall's virtual file system (0x81F8-0x820B; not in CE) → src/sfallFs.ts. The UPU
    // edits critter FRM frame rates (gl_k_goris_derobing, gl_k_walking_speed) and asks
    // whether a talking head exists (Cassidy's has_head: fs_copy(...) != -1).
    fs_copy(this: Script, path: string, source: string) {
        return SfallFs.fsCopy(path, source)
    },
    fs_find(this: Script, path: string) {
        return SfallFs.fsFind(path)
    },
    fs_delete(this: Script, id: number) {
        SfallFs.fsDelete(id)
    },
    fs_size(this: Script, id: number) {
        return SfallFs.fsSize(id)
    },
    fs_pos(this: Script, id: number) {
        return SfallFs.fsPos(id)
    },
    fs_seek(this: Script, id: number, pos: number) {
        SfallFs.fsSeek(id, pos)
    },
    fs_resize(this: Script, id: number, size: number) {
        SfallFs.fsResize(id, size)
    },
    fs_read_byte(this: Script, id: number) {
        return SfallFs.fsReadByte(id)
    },
    fs_read_short(this: Script, id: number) {
        return SfallFs.fsReadShort(id)
    },
    fs_read_int(this: Script, id: number) {
        return SfallFs.fsReadInt(id)
    },
    fs_write_byte(this: Script, id: number, v: number) {
        SfallFs.fsWriteByte(id, v)
    },
    fs_write_short(this: Script, id: number, v: number) {
        SfallFs.fsWriteShort(id, v)
    },
    fs_write_int(this: Script, id: number, v: number) {
        SfallFs.fsWriteInt(id, v)
    },
    // ── sfall global scripts, global variables and hooks (src/sfallGlobalScripts.ts,
    // CE sfall_global_scripts.cc / sfall_global_vars.cc; hooks: src/sfallHooks.ts,
    // not in CE)
    // CE op_game_loaded (0x8164)
    game_loaded(this: Script) {
        return GlobalScripts.globalScriptIsLoaded(this) ? 1 : 0
    },
    // CE op_set_global_script_repeat (0x816A) / op_set_global_script_type (0x819B)
    set_global_script_repeat(this: Script, frames: number) {
        GlobalScripts.setGlobalScriptRepeat(this, frames)
    },
    set_global_script_type(this: Script, type: number) {
        GlobalScripts.setGlobalScriptType(this, type)
    },
    // CE opSetGlobalVar / opGetGlobalInt (0x819D / 0x819E)
    set_sfall_global(this: Script, key: any, value: number) {
        GlobalScripts.setSfallGlobal(key, value)
    },
    get_sfall_global_int(this: Script, key: any) {
        return GlobalScripts.getSfallGlobal(key)
    },
    // CE opGetGameMode (0x81AF): sfall's loop flags
    get_game_mode(this: Script) {
        return SfallHooks.gameMode() | 0
    },
    // ── further sfall opcodes (CE sfall_opcodes.cc) ──
    // CE opReadByte (0x8156): only the target-highlight setting's address is answered
    read_byte(this: Script, addr: number) {
        if (addr === 0x56d38c) {
            const th = Config.ui.targetHighlight as string | boolean
            return th === 'on' || th === true ? 1 : th === 'targeting-only' ? 2 : 0 // combatGetTargetHighlight
        }
        warn(`read_byte: attempt to read 0x${(addr >>> 0).toString(16)}`)
        return 0
    },
    get_year(this: Script) {
        return GameTime.getDate().year
    },
    // CE op_get_year (0x8163)
    // CE op_force_encounter / op_force_encounter_with_flags (0x8171 / 0x8229) → wmForceEncounter
    force_encounter(this: Script, map: number) {
        Worldmap.forceEncounter(map, 0)
    },
    force_encounter_with_flags(this: Script, map: number, flags: number) {
        Worldmap.forceEncounter(map, flags)
    },
    key_pressed(this: Script, dik: number) {
        return sfallKeyPressed(dik) ? 1 : 0
    },
    // CE op_key_pressed (0x816C)
    in_world_map(this: Script) {
        return globalState.uiMode === UIMode.worldMap ? 1 : 0
    },
    // CE op_in_world_map (0x8170)
    // CE opGetCurrentHand (0x8193): interfaceGetCurrentHand, HAND_LEFT 0 / HAND_RIGHT 1
    active_hand(this: Script) {
        return globalState.player?.activeHand === 'rightHand' ? 1 : 0
    },
    get_uptime(this: Script) {
        return Math.trunc(window.performance.now())
    },
    // CE op_get_uptime (0x81B3): getTicks
    // CE op_get/set_bodypart_hit_modifier (0x81DF / 0x81E0): hit_location_penalty (negative)
    get_bodypart_hit_modifier(this: Script, location: number) {
        const region = SFALL_HIT_LOCATIONS[location]
        return region ? -(CriticalEffects.regionHitChanceDecTable[region] ?? 0) : 0
    },
    set_bodypart_hit_modifier(this: Script, location: number, penalty: number) {
        const region = SFALL_HIT_LOCATIONS[location]
        if (region) CriticalEffects.regionHitChanceDecTable[region] = -(Number(penalty) || 0)
    },
    // CE op_get_ini_string (0x81EB): the string, or -1
    get_ini_string(this: Script, triplet: string) {
        return sfallIniGetString(triplet) ?? -1
    },
    // CE opListBegin / opListNext / opListEnd (0x820D-0x820F) → sfall_lists.cc: a snapshot
    // of the map's objects of a list type (0 critters, 1 items, 2 scenery, 3 walls, 5 misc,
    // 6 spatial scripts, 9 all; 4 tiles is not implemented by sfall)
    list_begin(this: Script, type: number) {
        const gMap = globalState.gMap
        let objects: any[] = []
        if (gMap && type !== 4) {
            if (type === 6) objects = gMap.getSpatials ? gMap.getSpatials() : []
            else {
                const all = (gMap.objects ?? []).flat()
                const kind = ['critter', 'item', 'scenery', 'wall', '', 'misc'][type]
                objects = type === 9 ? all : all.filter((o: Obj) => o.type === kind)
            }
        }
        const id = scriptingState.nextSfallListId++
        sfallLists.set(id, { objects, next: 0 })
        return id
    },
    list_next(this: Script, id: number) {
        const list = sfallLists.get(id)
        if (!list || list.next >= list.objects.length) return 0
        return list.objects[list.next++]
    },
    list_end(this: Script, id: number) {
        sfallLists.delete(id)
    },
    // CE opGetVersionMajor / Minor / Patch (0x8210-0x8212): sfall 4.3.4
    sfall_ver_major(this: Script) {
        return 4
    },
    sfall_ver_minor(this: Script) {
        return 3
    },
    sfall_ver_build(this: Script) {
        return 4
    },
    get_mouse_x(this: Script) {
        return Math.trunc(heart.mouse.getPosition()[0])
    },
    // CE opGetMouseX (0x821C)
    get_mouse_y(this: Script) {
        return Math.trunc(heart.mouse.getPosition()[1])
    },
    // CE opGetMouseY (0x821D)
    get_mouse_buttons(this: Script) {
        return sfallMouseButtons()
    },
    // CE op_get_mouse_buttons (0x821E)
    get_screen_width(this: Script) {
        return SCREEN_WIDTH
    },
    // CE opGetScreenWidth (0x8220)
    get_screen_height(this: Script) {
        return SCREEN_HEIGHT
    },
    // CE opGetScreenHeight (0x8221)
    // CE op_create_message_window (0x8224): a message box, its text split at "\n"
    create_message_window(this: Script, text: string) {
        if (typeof text !== 'string' || text === '' || scriptingState.sfallMessageWindowOpen) return
        scriptingState.sfallMessageWindowOpen = true
        void showAlert(text).finally(() => {
            scriptingState.sfallMessageWindowOpen = false
        })
    },
    // CE op_get_attack_type (0x8228): the hit mode of the active hand's action — 0 / 1
    // left primary / secondary, 2 / 3 right, the unarmed modes for an empty hand
    get_attack_type(this: Script) {
        const player = globalState.player
        if (!player) return -1
        const hand: 'leftHand' | 'rightHand' = player.activeHand ?? 'leftHand'
        const item = player[hand]
        if (item && item.pid !== undefined && item.weapon)
            return (hand === 'leftHand' ? 0 : 2) + (item.weapon.usesSecondary?.() ? 1 : 0)
        return currentUnarmed(player).mode.hitMode
    },
    // CE opParseInt (0x8237): strtol(string, nullptr, 0) — decimal, 0x hex, 0 octal
    atoi(this: Script, text: any) {
        const m = /^\s*([+-]?)(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/.exec(String(text ?? ''))
        if (!m) return 0
        const body = m[2]
        const v = /^0[xX]/.test(body)
            ? parseInt(body.slice(2), 16)
            : body.length > 1 && body[0] === '0'
              ? parseInt(body, 8)
              : parseInt(body, 10)
        return (m[1] === '-' ? -v : v) | 0
    },
    // CE op_tile_under_cursor (0x824B)
    tile_under_cursor(this: Script) {
        const mouse = heart.mouse.getPosition()
        const world = screenToWorld(mouse[0], mouse[1])
        const hex = hexFromScreen(world.x, world.y)
        return toTileNum(hex)
    },
    // CE opSubstr (0x824E)
    substr(this: Script, text: any, start: number, length: number) {
        const str = String(text ?? '')
        const len = str.length
        let startPos = start | 0
        let count = length | 0
        if (startPos < 0) {
            startPos += len // from the end
            if (startPos < 0) startPos = 0
        }
        if (count < 0) {
            count += len - startPos // cut off at the end
            if (count === 0) return ''
            count = Math.abs(count)
        }
        if (startPos >= len) return ''
        if (count === 0 || count + startPos > len) count = len - startPos
        return str.substr(startPos, count)
    },
    strlen(this: Script, text: any) {
        return String(text ?? '').length
    },
    // CE opGetStringLength (0x824F)
    // CE opGetMessage (0x826B) → messageListRepositoryGetMsg: the standard message files
    // (0 combat … 19 worldmap), the proto lists from 0x1000
    message_str_game(this: Script, fileId: number, msgId: number) {
        const file =
            fileId >= 0x1000 ? SFALL_PROTO_MESSAGE_FILES[fileId - 0x1000] : SFALL_STANDARD_MESSAGE_FILES[fileId]
        return (file ? getMessage(file, msgId) : null) ?? 'Error'
    },
    // CE opArtExists (0x8274)
    art_exists(this: Script, fid: number) {
        try {
            const art = lookupArt(fid)
            return art && globalState.imageInfo?.[art] !== undefined ? 1 : 0
        } catch {
            return 0
        }
    },
    // CE op_tap_key (0x8162): a DirectInput key press. DH2 dispatches the key to the
    // page; only the keys scripts use are mapped (DIK_ESCAPE: gl_k_dogmeat_fix).
    tap_key(this: Script, dik: number) {
        const key = ({ 1: 'Escape', 28: 'Enter', 57: ' ' } as { [dik: number]: string })[dik]
        if (key === undefined) {
            warn('tap_key: DirectInput key ' + dik + ' is not mapped')
            return
        }
        for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }))
    },
    // sfall register_hook_proc (0x8262): `proc` a procedure of this script (a function on
    // both backends: vm_bridge.ts wraps the procedure number), 0 unregisters
    register_hook_proc(this: Script, hookId: number, proc: any) {
        SfallHooks.registerHookProc(hookId, this, typeof proc === 'function' ? () => proc.call(this) : null)
    },
    // sfall get_sfall_arg / set_sfall_return / get_sfall_args / set_sfall_arg
    // (0x81E4 / 0x81E5 / 0x823C / 0x823D)
    get_sfall_arg(this: Script) {
        return SfallHooks.hookArg()
    },
    set_sfall_return(this: Script, value: any) {
        SfallHooks.hookReturn(value)
    },
    get_sfall_args(this: Script) {
        return SfallArrays.arrayFromObjects(SfallHooks.hookArgs() as object[])
    },
    set_sfall_arg(this: Script, n: number, value: any) {
        SfallHooks.setHookArg(n, value)
    },
    // sfall set_script (0x81F4; not in CE, sfall Objects.cpp op_set_script): gives the
    // object script number `value` (scripts.lst line, 1-based) and runs its start, then
    // its map_enter_p_proc unless bit 0x80000000 is set
    set_script(this: Script, obj: Obj, value: number) {
        if (!isGameObject(obj)) return
        const index = (value >>> 0) & ~0xf0000000
        if (index === 0) {
            warn('set_script: invalid script index ' + index)
            return
        }
        ;(obj as any).script = undefined
        obj._script = undefined
        obj.loadScript(index)
        const script = obj._script as Script | undefined
        if (script && ((value >>> 0) & 0x80000000) === 0 && script.map_enter_p_proc !== undefined)
            objectEnterMap(obj, obj.elevation ?? 0, currentMapID ?? 0)
    },
    // sfall_func0-2 (0x8276-0x8278) → CE sfall_metarules.cc sfall_metarule, by name. The
    // UPU uses combat_data (mf_combat_data: the current attack while in combat),
    // get_object_data (mf_get_object_data: an int at a byte offset of an Attack or an
    // object, at sfall's 32-bit offsets — here only the fields the UPU reads),
    // dialog_obj (the critter the player talks to) and get_sfall_arg_at (hooks).
    sfall_func0(this: Script, name: string) {
        return this.sfallMetarule(name, [])
    },
    sfall_func1(this: Script, name: string, a: any) {
        return this.sfallMetarule(name, [a])
    },
    sfall_func2(this: Script, name: string, a: any, b: any) {
        return this.sfallMetarule(name, [a, b])
    },
    sfall_func3(this: Script, name: string, a: any, b: any, c: any) {
        return this.sfallMetarule(name, [a, b, c])
    },
    sfall_func4(this: Script, name: string, a: any, b: any, c: any, d: any) {
        return this.sfallMetarule(name, [a, b, c, d])
    },
    sfall_func5(this: Script, name: string, a: any, b: any, c: any, d: any, e: any) {
        return this.sfallMetarule(name, [a, b, c, d, e])
    },
    sfall_func6(this: Script, name: string, a: any, b: any, c: any, d: any, e: any, f: any) {
        return this.sfallMetarule(name, [a, b, c, d, e, f])
    },
    sfallMetarule(this: Script, name: string, args: any[]): any {
        switch (name) {
            case 'combat_data':
                return combatGetData()
            case 'dialog_obj':
                return scriptingState.currentDialogueObject ?? 0
            case 'set_ini_setting':
                sfallIniSet(args[0], args[1])
                return 0 // sfall IniFiles.cpp
            case 'get_sfall_arg_at':
                return SfallHooks.hookArgAt(args[0])
            case 'get_object_data': {
                const a: any = args[0]
                if (isGameObject(a)) {
                    // CE object_types.h Object, sfall define_extra.h OBJ_DATA_*
                    if (args[1] === 0x64) return a.pid ?? 0 // OBJ_DATA_PID
                    if (args[1] === 0x78 || args[1] === 0x80) {
                        // OBJ_DATA_SID / SCRIPT_INDEX
                        const name = a._script?.scriptName
                        const n = name ? scriptNumberOf(name) : 0
                        return n > 0 ? (args[1] === 0x80 ? n - 1 : n) : -1
                    }
                    warn('get_object_data: object offset ' + args[1] + ' is not mapped')
                    return 0
                }
                const field = ATTACK_FIELDS_BY_OFFSET[args[1]]
                if (a && field && field in a) {
                    const v = a[field]
                    return v ?? 0
                }
                warn('get_object_data: offset ' + args[1] + ' is not mapped')
                return 0
            }
        }
        warn('sfall_func: ' + name + ' is not supported')
        return 0
    },
}
