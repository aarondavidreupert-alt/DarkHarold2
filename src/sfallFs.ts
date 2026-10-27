// sfall's virtual file system (fs_copy, fs_seek, fs_read_short, fs_write_short, …) — a
// DH2 addition after sfall FileSystem.cpp; CE has none. Scripts copy a game file into
// memory, edit its bytes, and with UseFileSystemOverride the engine loads the edited copy
// instead. The Unofficial Patch uses it for two cosmetic options (upu.ini
// goris_derobing_speed, critters_walk_faster): it raises the frame rate in the header of
// a few critter animations (gl_k_goris_derobing, gl_k_walking_speed).
//
// DH2 has no .frm files at run time — art is PNG plus art/imageMap.json. An art FRM
// copied here is therefore a synthesized header (version, fps, action frame, frames per
// direction; FRM layout, big-endian like sfall's fs_read/fs_write), and a write to it
// updates that image's entry in globalState.imageInfo (fps, actionFrame). Other files are
// read as they are (data/<path>).

import globalState from './globalState.js'
import { getFileBinarySync } from './util.js'
import { dbg } from './logger.js'

interface VFile {
    path: string // normalized: lower case, '/'
    data: Uint8Array | null // null: deleted
    pos: number
}

const files: VFile[] = []

const FRM_HEADER_SIZE = 0x3e // version, fps, action frame, frames/dir, 6 shiftX, 6 shiftY, 6 offsets, size

function normalize(path: string): string {
    return String(path ?? '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .toLowerCase()
}

/** "art/critters/marobeag.frm" -> the imageInfo key "art/critters/marobeag" */
function artKey(path: string): string | null {
    const m = /^(art\/.+)\.fr[m0-5]$/.exec(path)
    return m ? m[1] : null
}

function load(path: string): Uint8Array | null {
    const key = artKey(path)
    if (key) {
        const info = globalState.imageInfo?.[key]
        if (!info) return null
        const data = new Uint8Array(FRM_HEADER_SIZE)
        const dv = new DataView(data.buffer)
        dv.setUint32(0, 4) // FRM version
        dv.setUint16(4, info.fps ?? 10)
        dv.setUint16(6, (info.actionFrame as number) ?? 0) // a per-direction list writes 0 (known_bugs CA46)
        dv.setUint16(8, info.numFrames ?? 1)
        return data
    }
    try {
        const dv = getFileBinarySync('data/' + path)
        return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice()
    } catch (_) {
        return null
    }
}

/** an edited art FRM header -> the image's fps / action frame */
function apply(f: VFile): void {
    const key = artKey(f.path)
    const info = key ? globalState.imageInfo?.[key] : null
    if (!f.data || !info || f.data.length < 10) return
    const dv = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength)
    const fps = dv.getUint16(4)
    const actionFrame = dv.getUint16(6)
    if (info.fps !== fps || info.actionFrame !== actionFrame) {
        info.fps = fps
        info.actionFrame = actionFrame
        dbg('script', `fs: ${key} fps ${fps}`)
    }
}

const file = (id: number): VFile | null => (id >= 0 && id < files.length && files[id].data ? files[id] : null)

export function sfallFsReset(): void {
    files.length = 0
}

/** fs_find(path): the file's id, or -1 */
export function fsFind(path: string): number {
    const p = normalize(path)
    return files.findIndex((f) => f.path === p && f.data !== null)
}

/** fs_copy(path, source): a copy of `source` named `path` (the existing one if `path`
 *  is already in the file system); -1 when the source cannot be read. */
export function fsCopy(path: string, source: string): number {
    const found = fsFind(path)
    if (found !== -1) return found
    const data = load(normalize(source))
    if (!data) return -1
    files.push({ path: normalize(path), data, pos: 0 })
    return files.length - 1
}

export function fsDelete(id: number): void {
    const f = file(id)
    if (f) f.data = null
}

export function fsSize(id: number): number {
    return file(id)?.data!.length ?? 0
}

export function fsPos(id: number): number {
    return file(id)?.pos ?? -1
}

export function fsSeek(id: number, pos: number): void {
    const f = file(id)
    if (f) f.pos = Math.max(0, Math.min(pos | 0, f.data!.length))
}

export function fsResize(id: number, size: number): void {
    const f = file(id)
    if (!f) return
    const data = new Uint8Array(Math.max(0, size | 0))
    data.set(f.data!.subarray(0, data.length))
    f.data = data
    f.pos = Math.min(f.pos, data.length)
}

/** big-endian read of `n` bytes at the file position (sfall FSread_*); 0 past the end */
function read(id: number, n: 1 | 2 | 4): number {
    const f = file(id)
    if (!f || f.pos + n > f.data!.length) return 0
    const dv = new DataView(f.data!.buffer, f.data!.byteOffset + f.pos, n)
    f.pos += n
    return n === 1 ? dv.getUint8(0) : n === 2 ? dv.getInt16(0) : dv.getInt32(0)
}

/** big-endian write at the file position (sfall FSwrite_*); nothing past the end */
function write(id: number, n: 1 | 2 | 4, value: number): void {
    const f = file(id)
    if (!f || f.pos + n > f.data!.length) return
    const dv = new DataView(f.data!.buffer, f.data!.byteOffset + f.pos, n)
    if (n === 1) dv.setUint8(0, value & 0xff)
    else if (n === 2) dv.setUint16(0, value & 0xffff)
    else dv.setUint32(0, value >>> 0)
    f.pos += n
    apply(f)
}

export const fsReadByte = (id: number) => read(id, 1)
export const fsReadShort = (id: number) => read(id, 2)
export const fsReadInt = (id: number) => read(id, 4)
export const fsWriteByte = (id: number, v: number) => write(id, 1, v)
export const fsWriteShort = (id: number, v: number) => write(id, 2, v)
export const fsWriteInt = (id: number, v: number) => write(id, 4, v)
