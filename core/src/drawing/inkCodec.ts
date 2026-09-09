import type { Stroke } from './model'

// Compact, lossless encoding of a stroke list to the base64 payload stored inside a
// ```draw``` fence. Layout: [1 version byte][deflated JSON header][deflated point stream].
// Points are zigzag-varint delta-coded per stroke (x, y and pressure each their own running
// delta, reset at each stroke start) — strokes drawn with `roundStrokes` (whole-px x/y, a
// clamped 0-255 pressure byte) delta-code extremely well.

export const DRAW_PAYLOAD_VERSION = 1

interface StrokeHeader {
    t: Stroke['t']
    c: string
    w: number
    straight?: boolean
    n: number // number of points (triples) in this stroke
}

function zigzag(n: number): number {
    return (n << 1) ^ (n >> 31)
}

function unzigzag(n: number): number {
    return (n >>> 1) ^ -(n & 1)
}

function writeVarint(bytes: number[], value: number): void {
    let v = value >>> 0
    for (;;) {
        const b = v & 0x7f
        v >>>= 7
        if (v === 0) {
            bytes.push(b)
            break
        }
        bytes.push(b | 0x80)
    }
}

function readVarint(bytes: Uint8Array, pos: { i: number }): number {
    let result = 0
    let shift = 0
    for (;;) {
        const b = bytes[pos.i++]
        result |= (b & 0x7f) << shift
        if ((b & 0x80) === 0) break
        shift += 7
    }
    return result >>> 0
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export function encodeStrokes(strokes: Stroke[]): string {
    const headers: StrokeHeader[] = strokes.map(s => ({
        t: s.t,
        c: s.c,
        w: s.w,
        ...(s.straight ? { straight: true } : {}),
        n: s.pts.length / 3,
    }))
    const headerBytes = new TextEncoder().encode(JSON.stringify(headers))

    const pointBytes: number[] = []
    for (const s of strokes) {
        let prevX = 0
        let prevY = 0
        let prevP = 0
        for (let i = 0; i < s.pts.length; i += 3) {
            const x = s.pts[i]
            const y = s.pts[i + 1]
            const p = s.pts[i + 2]
            writeVarint(pointBytes, zigzag(x - prevX))
            writeVarint(pointBytes, zigzag(y - prevY))
            writeVarint(pointBytes, zigzag(p - prevP))
            prevX = x
            prevY = y
            prevP = p
        }
    }

    const deflatedHeader = Bun.deflateSync(headerBytes)
    const deflatedPoints = Bun.deflateSync(new Uint8Array(pointBytes))

    const out = new Uint8Array(1 + 4 + deflatedHeader.length + deflatedPoints.length)
    let off = 0
    out[off++] = DRAW_PAYLOAD_VERSION
    out[off++] = (deflatedHeader.length >>> 24) & 0xff
    out[off++] = (deflatedHeader.length >>> 16) & 0xff
    out[off++] = (deflatedHeader.length >>> 8) & 0xff
    out[off++] = deflatedHeader.length & 0xff
    out.set(deflatedHeader, off)
    off += deflatedHeader.length
    out.set(deflatedPoints, off)

    return bytesToBase64(out)
}

export function decodeStrokes(payload: string): Stroke[] {
    const bytes = base64ToBytes(payload)
    if (bytes.length < 5) throw new Error('drawing payload too short')
    const version = bytes[0]
    if (version !== DRAW_PAYLOAD_VERSION) {
        throw new Error(`unknown drawing payload version: ${version}`)
    }
    const headerLen =
        (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]
    let off = 5
    const deflatedHeader = bytes.slice(off, off + headerLen)
    off += headerLen
    const deflatedPoints = bytes.slice(off)

    const headerJson = new TextDecoder().decode(Bun.inflateSync(deflatedHeader))
    const headers: StrokeHeader[] = JSON.parse(headerJson)
    const pointBytes = Bun.inflateSync(deflatedPoints)

    const pos = { i: 0 }
    const strokes: Stroke[] = []
    for (const h of headers) {
        let x = 0
        let y = 0
        let p = 0
        const pts: number[] = []
        for (let i = 0; i < h.n; i++) {
            x += unzigzag(readVarint(pointBytes, pos))
            y += unzigzag(readVarint(pointBytes, pos))
            p += unzigzag(readVarint(pointBytes, pos))
            pts.push(x, y, p)
        }
        strokes.push({
            t: h.t,
            c: h.c,
            w: h.w,
            ...(h.straight ? { straight: true } : {}),
            pts,
        })
    }
    return strokes
}
