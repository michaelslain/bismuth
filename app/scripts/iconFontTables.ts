// app/scripts/iconFontTables.ts
//
// A minimal, dependency-free reader for the four sfnt tables that answer ONE question about the
// generated icon font: "is there a real glyph behind this codepoint, or is it tofu?"
//
// WHY THIS EXISTS AT ALL — the trap it is built to close. A missing glyph is not a missing
// element. The renderer substitutes `.notdef` (glyph id 0), which is a drawn rectangle with a
// perfectly ordinary width and height, sometimes with the codepoint in tiny hex digits inside it.
// So every cheap check passes on a completely broken font: the element exists, it has a bounding
// box, its width is non-zero, the story screenshots without an error. The ONLY signal that
// separates "the font has this glyph" from "the font has nothing and the box is a placeholder" is
// the character-to-glyph mapping itself, and glyph id 0 is `.notdef` BY DEFINITION in the OpenType
// spec (§ the `loca`/`glyf` contract) — not by convention, not per-font. That makes
// `cmap lookup === 0` an exact, un-fudgeable tofu test, which is why this file parses `cmap`
// rather than measuring anything.
//
// WHY IT LIVES IN scripts/ AND NOT IN src/. It reads `node:zlib` and `node:fs`, which nothing
// under app/src may statically import — the mobile build swaps the filesystem seam precisely so no
// Bun/node builtin is reachable from app code (see CLAUDE.md "Mobile / iPad"). It is build-and-test
// tooling, the same category as build-pixel-icons.ts and logoMarks.ts.
//
// WHAT IT DOES NOT DO. It is not a font library. It reads `cmap` (formats 4 and 12), `maxp`,
// `hhea` and `hmtx`, and it refuses loudly on anything it does not understand rather than
// returning a plausible-looking empty result — a silently-empty glyph map would make the tofu check
// pass vacuously, which is the exact failure it exists to prevent.
import { brotliDecompressSync } from 'node:zlib'

/** The 63 table tags WOFF2 encodes as a 6-bit index instead of 4 bytes, in spec order. Only the
 *  four this file reads and the two transformable ones (glyf/loca) are load-bearing; the rest have
 *  to be here anyway because the directory is walked in order to accumulate offsets. */
const KNOWN_TAGS = [
    'cmap',
    'head',
    'hhea',
    'hmtx',
    'maxp',
    'name',
    'OS/2',
    'post',
    'cvt ',
    'fpgm',
    'glyf',
    'loca',
    'prep',
    'CFF ',
    'VORG',
    'EBDT',
    'EBLC',
    'gasp',
    'hdmx',
    'kern',
    'LTSH',
    'PCLT',
    'VDMX',
    'vhea',
    'vmtx',
    'BASE',
    'GDEF',
    'GPOS',
    'GSUB',
    'EBSC',
    'JSTF',
    'MATH',
    'CBDT',
    'CBLC',
    'COLR',
    'CPAL',
    'SVG ',
    'sbix',
    'acnt',
    'avar',
    'bdat',
    'bloc',
    'bsln',
    'cvar',
    'fdsc',
    'feat',
    'fmtx',
    'fvar',
    'gvar',
    'hsty',
    'just',
    'lcar',
    'mort',
    'morx',
    'opbd',
    'prop',
    'trak',
    'Zapf',
    'Silf',
    'Glat',
    'Gloc',
    'Feat',
    'Sill',
]

export type FontTables = {
    /** Table tag -> its decompressed bytes. Only untransformed tables are usable as-is. */
    tables: Map<string, Uint8Array>
    /** "woff2" or "sfnt" — recorded so a caller can say WHICH artifact it measured. */
    container: 'woff2' | 'sfnt'
}

const be16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!
const be32 = (b: Uint8Array, o: number) =>
    b[o]! * 0x1000000 + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!
const tag4 = (b: Uint8Array, o: number) =>
    String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!)

/** WOFF2's variable-length integer. Multiplication, not `<< 7`: a shift is a 32-bit SIGNED op in
 *  JS and would wrap to negative on a large length instead of throwing. */
function readUIntBase128(
    b: Uint8Array,
    pos: number,
): [value: number, next: number] {
    let value = 0
    for (let i = 0; i < 5; i++) {
        const byte = b[pos++]
        if (byte === undefined)
            throw new Error('UIntBase128 ran past end of buffer')
        if (i === 0 && byte === 0x80)
            throw new Error('UIntBase128 has a leading zero')
        value = value * 128 + (byte & 0x7f)
        if (!(byte & 0x80)) return [value, pos]
    }
    throw new Error('UIntBase128 longer than 5 bytes')
}

/** Read a plain sfnt (TTF/OTF): a 12-byte header then a 16-byte record per table. */
function readSfnt(b: Uint8Array): FontTables {
    const numTables = be16(b, 4)
    const tables = new Map<string, Uint8Array>()
    for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16
        tables.set(
            tag4(b, rec),
            b.subarray(be32(b, rec + 8), be32(b, rec + 8) + be32(b, rec + 12)),
        )
    }
    return { tables, container: 'sfnt' }
}

/**
 * Read a WOFF2. The header names a brotli stream holding every table's data end-to-end **in
 * directory order with no padding**, so the only way to find `cmap` is to walk the whole directory
 * accumulating lengths — which is why KNOWN_TAGS has to be complete even though four tags are used.
 *
 * `glyf` and `loca` are stored in a re-encoded form (and, inverted from every other table, a
 * transformVersion of 0 means TRANSFORMED for those two). This reader does not reverse that
 * transform and does not need to: the tofu question is answered entirely by cmap + hmtx, neither of
 * which is transformed in practice. A transformed `hmtx` is detected and reported rather than
 * misread, because reading a transformed table as a flat one yields confident nonsense.
 */
function readWoff2(b: Uint8Array): FontTables {
    const numTables = be16(b, 12)
    const totalCompressed = be32(b, 20)

    type Entry = { tag: string; length: number; transformed: boolean }
    const dir: Entry[] = []
    let p = 48
    for (let i = 0; i < numTables; i++) {
        const flags = b[p++]!
        const idx = flags & 0x3f
        let tag: string
        if (idx === 0x3f) {
            tag = tag4(b, p)
            p += 4
        } else {
            const known = KNOWN_TAGS[idx]
            if (known === undefined)
                throw new Error(
                    `woff2 table directory: unknown tag index ${idx}`,
                )
            tag = known
        }
        const transformVersion = (flags >> 6) & 0x03
        // The inversion: for glyf/loca, version 0 IS the transform and 3 means "stored as-is". For
        // everything else, 0 means as-is and anything non-zero is a transform.
        const isGlyfOrLoca = tag === 'glyf' || tag === 'loca'
        const transformed = isGlyfOrLoca
            ? transformVersion === 0
            : transformVersion !== 0
        let [length, next] = readUIntBase128(b, p)
        p = next
        if (transformed) {
            const [tLen, n2] = readUIntBase128(b, p)
            length = tLen
            p = n2
        }
        dir.push({ tag, length, transformed })
    }

    const stream = brotliDecompressSync(b.subarray(p, p + totalCompressed))
    const data = new Uint8Array(
        stream.buffer,
        stream.byteOffset,
        stream.byteLength,
    )

    const tables = new Map<string, Uint8Array>()
    let at = 0
    for (const e of dir) {
        if (!e.transformed) tables.set(e.tag, data.subarray(at, at + e.length))
        else if (e.tag !== 'glyf' && e.tag !== 'loca') {
            throw new Error(
                `woff2: table '${e.tag}' is transformed; this reader would misread it`,
            )
        }
        at += e.length
    }
    if (at !== data.length) {
        throw new Error(
            `woff2: table data is ${data.length} bytes but the directory accounts for ${at}`,
        )
    }
    return { tables, container: 'woff2' }
}

/** Parse a font file's table directory. Accepts WOFF2 (`wOF2`) or a plain sfnt; anything else
 *  throws, so a truncated download can never be measured as an empty-but-valid font. */
export function readFontTables(bytes: Uint8Array): FontTables {
    const sig = tag4(bytes, 0)
    if (sig === 'wOF2') return readWoff2(bytes)
    if (sig === 'wOFF') throw new Error('WOFF1 is not supported by this reader')
    if (
        sig === 'OTTO' ||
        sig === 'true' ||
        sig === 'ttcf' ||
        be32(bytes, 0) === 0x00010000
    ) {
        return readSfnt(bytes)
    }
    throw new Error(`not a font: signature ${JSON.stringify(sig)}`)
}

/**
 * Every codepoint -> glyph id the font maps, merged across its `cmap` subtables.
 *
 * Formats 4 (BMP) and 12 (full Unicode) only — deliberately. Nerd Font symbols live mostly in
 * Plane 15 (U+F0000..U+FFFFF, Supplementary Private Use Area-A), which format 4 CANNOT address, so
 * a reader that silently handled only format 4 would report every Material Design icon as missing.
 * Unrecognised subtable formats are skipped, but an empty result throws: "no glyphs at all" is a
 * broken parse or a broken font, never a pass.
 */
export function readCmap(tables: Map<string, Uint8Array>): Map<number, number> {
    const cmap = tables.get('cmap')
    if (!cmap) throw new Error('font has no cmap table')
    const out = new Map<number, number>()
    const numSubtables = be16(cmap, 2)
    const seen = new Set<number>()
    for (let i = 0; i < numSubtables; i++) {
        const offset = be32(cmap, 4 + i * 8 + 4)
        if (seen.has(offset)) continue // platforms commonly share one subtable
        seen.add(offset)
        const format = be16(cmap, offset)
        if (format === 4) {
            const segX2 = be16(cmap, offset + 6)
            const ends = offset + 14
            const starts = ends + segX2 + 2
            const deltas = starts + segX2
            const ranges = deltas + segX2
            for (let s = 0; s < segX2 / 2; s++) {
                const end = be16(cmap, ends + s * 2)
                const start = be16(cmap, starts + s * 2)
                const delta = be16(cmap, deltas + s * 2)
                const rangeOffset = be16(cmap, ranges + s * 2)
                if (start > end) continue
                for (let c = start; c <= end && c !== 0x10000; c++) {
                    let gid: number
                    if (rangeOffset === 0) gid = (c + delta) & 0xffff
                    else {
                        const at =
                            ranges + s * 2 + rangeOffset + (c - start) * 2
                        const raw = be16(cmap, at)
                        gid = raw === 0 ? 0 : (raw + delta) & 0xffff
                    }
                    if (gid !== 0) out.set(c, gid)
                }
            }
        } else if (format === 12) {
            const nGroups = be32(cmap, offset + 12)
            for (let g = 0; g < nGroups; g++) {
                const rec = offset + 16 + g * 12
                const start = be32(cmap, rec)
                const end = be32(cmap, rec + 4)
                const startGid = be32(cmap, rec + 8)
                for (let c = start; c <= end; c++) {
                    const gid = startGid + (c - start)
                    // Skip glyph 0 here exactly as the format 4 branch does, so "absent from this map" means
                    // the same thing in both: not mapped, or mapped to `.notdef`. Without the symmetry, a
                    // caller reading `advance === null` as "tofu" would be right for one subtable format and
                    // wrong for the other.
                    if (gid !== 0) out.set(c, gid)
                }
            }
        }
    }
    if (out.size === 0)
        throw new Error(
            'cmap parsed to zero mappings (formats 4/12 not found?)',
        )
    return out
}

/** Advance width per glyph id, in font units. `hmtx` repeats the LAST entry implicitly for every
 *  monospaced tail glyph, which is exactly the case for a Mono symbols font — reading past
 *  `numberOfHMetrics` without that clamp gives garbage. */
export function readAdvanceWidths(tables: Map<string, Uint8Array>): number[] {
    const hhea = tables.get('hhea')
    const hmtx = tables.get('hmtx')
    const maxp = tables.get('maxp')
    if (!hhea || !hmtx || !maxp)
        throw new Error('font is missing hhea, hmtx or maxp')
    const numGlyphs = be16(maxp, 4)
    const numHMetrics = be16(hhea, 34)
    if (numHMetrics === 0) throw new Error('hhea says numberOfHMetrics is 0')
    const widths: number[] = []
    for (let g = 0; g < numGlyphs; g++)
        widths.push(be16(hmtx, Math.min(g, numHMetrics - 1) * 4))
    return widths
}

/** Units per em, so a font-unit advance can be stated as a fraction of the cell. */
export function readUnitsPerEm(tables: Map<string, Uint8Array>): number {
    const head = tables.get('head')
    if (!head) throw new Error('font has no head table')
    return be16(head, 18)
}

export type GlyphCheck = {
    codepoint: number
    /** 0 means the font maps this codepoint to `.notdef` — i.e. it renders as TOFU. */
    glyphId: number
    /** Advance width in font units, or null when the codepoint is unmapped entirely. */
    advance: number | null
    tofu: boolean
}

/**
 * The tofu check, as data. `glyphId === 0` (or absent from the cmap) is tofu; anything else is a
 * real outline. `notdefAdvance` is returned alongside so a caller can print the width it is NOT
 * allowed to be confused with — the whole point being that tofu measures like a glyph.
 */
export function checkGlyphs(
    bytes: Uint8Array,
    codepoints: number[],
): {
    results: GlyphCheck[]
    notdefAdvance: number
    unitsPerEm: number
    mappedCodepoints: number
    container: 'woff2' | 'sfnt'
} {
    const { tables, container } = readFontTables(bytes)
    const cmap = readCmap(tables)
    const widths = readAdvanceWidths(tables)
    const results = codepoints.map(codepoint => {
        const glyphId = cmap.get(codepoint) ?? 0
        return {
            codepoint,
            glyphId,
            advance: cmap.has(codepoint) ? (widths[glyphId] ?? null) : null,
            tofu: glyphId === 0,
        }
    })
    return {
        results,
        notdefAdvance: widths[0] ?? 0,
        unitsPerEm: readUnitsPerEm(tables),
        mappedCodepoints: cmap.size,
        container,
    }
}
