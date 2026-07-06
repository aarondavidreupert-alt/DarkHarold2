// DecompressionStream is in the WHATWG Streams spec but not yet in TypeScript's es2021+dom lib.
declare class DecompressionStream {
    constructor(format: string)
    readonly writable: WritableStream
    readonly readable: ReadableStream<Uint8Array>
}

// CE ref: cycle.cc colorCycleTicker() — palette entries 229–254 cycle at runtime.
// Groups: slime (229-232, 5fps), monitors (233-237, 10fps), fire_slow (238-242, 5fps),
//         fire_fast (243-247, 7fps), shoreline (248-253, 5fps), bobber (254, 30fps).
//
// Since the art pipeline discards palette indices (bakes FRMs → RGBA PNGs), we
// recover them by re-fetching the PNG as an ArrayBuffer and parsing the raw indexed
// pixel data before WebGL converts it to RGBA.  Only palette indices 229-254 matter
// for cycling; all others are stored as 0 (no cycle).

export interface CycleMask {
    data: Uint8Array  // (paletteIndex - 228) per pixel; 0 = not a cycling pixel
    width: number
    height: number
}

// Returns a group code 1-26 for palette indices 229-254, else 0.
function cycleCode(palIdx: number): number {
    return (palIdx >= 229 && palIdx <= 254) ? palIdx - 228 : 0
}

async function decompressZlib(data: Uint8Array): Promise<Uint8Array> {
    // PNG IDAT is zlib-wrapped deflate; DecompressionStream('deflate') handles the header.
    const ds = new DecompressionStream('deflate')
    const writer = ds.writable.getWriter()
    const reader = ds.readable.getReader()
    writer.write(data)
    writer.close()

    const chunks: Uint8Array[] = []
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
    }

    let total = 0
    for (const c of chunks) total += c.length
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    return out
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) return a
    if (pb <= pc) return b
    return c
}

export async function parsePNGCycleMask(url: string): Promise<CycleMask | null> {
    let buf: ArrayBuffer
    try {
        const resp = await fetch(url)
        if (!resp.ok) return null
        buf = await resp.arrayBuffer()
    } catch {
        return null
    }

    const bytes = new Uint8Array(buf)
    const view = new DataView(buf)

    // PNG signature
    const sig = [137, 80, 78, 71, 13, 10, 26, 10]
    for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null

    let pos = 8
    let width = 0, height = 0, colorType = -1
    const idatParts: Uint8Array[] = []

    while (pos + 12 <= bytes.length) {
        const len = view.getUint32(pos, false)
        const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7])
        const data = bytes.slice(pos + 8, pos + 8 + len)
        pos += 12 + len

        if (type === 'IHDR') {
            width  = view.getUint32(8, false)  // position 8 from file start is wrong; use data
            width  = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0
            height = (data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]) >>> 0
            colorType = data[9]
            if (colorType !== 3) return null  // only indexed PNGs have palette-indexed pixels
        } else if (type === 'IDAT') {
            idatParts.push(data)
        } else if (type === 'IEND') {
            break
        }
    }

    if (colorType !== 3 || width === 0 || height === 0) return null

    // Concatenate IDAT chunks
    let totalLen = 0
    for (const c of idatParts) totalLen += c.length
    const idat = new Uint8Array(totalLen)
    let off = 0
    for (const c of idatParts) { idat.set(c, off); off += c.length }

    let raw: Uint8Array
    try {
        raw = await decompressZlib(idat)
    } catch {
        return null
    }

    // Reconstruct filtered rows; for indexed (8bpp) each row is 1 filter byte + width index bytes.
    const mask = new Uint8Array(width * height)
    let hasCycle = false
    const prev = new Uint8Array(width)
    let rp = 0  // read position in raw

    for (let y = 0; y < height; y++) {
        if (rp >= raw.length) break
        const filter = raw[rp++]
        const row = new Uint8Array(width)

        for (let x = 0; x < width; x++) {
            if (rp >= raw.length) break
            const r = raw[rp++]
            const a = x > 0 ? row[x - 1] : 0
            const b = prev[x]
            const c = x > 0 ? prev[x - 1] : 0

            let v: number
            switch (filter) {
                case 0: v = r; break
                case 1: v = (r + a) & 0xff; break
                case 2: v = (r + b) & 0xff; break
                case 3: v = (r + ((a + b) >> 1)) & 0xff; break
                case 4: v = (r + paeth(a, b, c)) & 0xff; break
                default: v = r; break
            }
            row[x] = v

            const code = cycleCode(v)
            if (code > 0) {
                mask[y * width + x] = code
                hasCycle = true
            }
        }
        prev.set(row)
    }

    if (!hasCycle) return null
    return { data: mask, width, height }
}
