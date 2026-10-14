// core/src/drawing/pdfLight.ts
// A light PDF reader + incremental-update writer for highlight edits.
//
// `PDFDocument.load` parses every object (every image stream of a 90 MB scan is copied) and a save
// re-serializes all of it. A highlight edit touches one page's /Annots and adds two small objects, so
// this module reads only the xref chain, the page tree and the touched pages (objects are parsed on
// demand, streams stay subarray views of the input), and appends a standard PDF incremental update:
// the original bytes stay a byte-identical prefix.
//
// PURE: pdf-lib only, no node:fs, no Bun, no Buffer. Mobile runs this in-process.
import {
    PDFArray,
    PDFContext,
    PDFDict,
    PDFName,
    PDFNumber,
    PDFObjectParser,
    PDFRawStream,
    PDFRef,
    decodePDFRawStream,
    type PDFObject,
} from 'pdf-lib'

/** Something this reader does not handle; callers fall back to a full pdf-lib load. */
export class LightPdfError extends Error {}

export type LightPage = { ref: PDFRef | null; dict: PDFDict }

export type LightPdf = {
    bytes: Uint8Array
    context: PDFContext
    encrypted: boolean
    catalog: PDFDict
    pages: LightPage[]
    /** newest trailer (or xref-stream dictionary) */
    trailer: PDFDict
    /** offset the last `startxref` points at: the new section's /Prev */
    prevXref: number
    /** the newest xref section is a cross-reference stream, so the increment writes one too */
    xrefStream: boolean
    /** first object number no existing xref entry or /Size claims */
    nextNum: number
}

const N = (s: string) => PDFName.of(s)
const latin1 = new TextDecoder('latin1')

function ascii(s: string): Uint8Array {
    const b = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff
    return b
}

const isWs = (c: number) =>
    c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0

function skipWs(b: Uint8Array, p: number): number {
    while (p < b.length && isWs(b[p])) p++
    return p
}

function startsWith(b: Uint8Array, p: number, s: string): boolean {
    if (p < 0 || p + s.length > b.length) return false
    for (let i = 0; i < s.length; i++) if (b[p + i] !== s.charCodeAt(i)) return false
    return true
}

function token(b: Uint8Array, p: number): [string, number] {
    p = skipWs(b, p)
    const start = p
    while (p < b.length && !isWs(b[p])) p++
    return [latin1.decode(b.subarray(start, p)), p]
}

function findEndstream(b: Uint8Array, from: number): number {
    let i = from
    for (;;) {
        i = b.indexOf(101, i) // 'e'
        if (i < 0) throw new LightPdfError('unterminated stream')
        if (startsWith(b, i, 'endstream')) return i
        i++
    }
}

type Indirect = { num: number; gen: number; obj: PDFObject }

function parseIndirectAt(bytes: Uint8Array, ctx: PDFContext, off: number): Indirect {
    if (!(off >= 0 && off < bytes.length)) throw new LightPdfError('offset out of range')
    const m = /^\s*(\d+)\s+(\d+)\s+obj/.exec(
        latin1.decode(bytes.subarray(off, off + 48)),
    )
    if (!m) throw new LightPdfError('no object at offset')
    const num = Number(m[1]),
        gen = Number(m[2])
    const body = off + m[0].length
    const parser = PDFObjectParser.forBytes(bytes.subarray(body), ctx)
    const obj = parser.parseObject()
    if (!(obj instanceof PDFDict)) return { num, gen, obj }
    let p = skipWs(bytes, body + (parser as any).bytes.offset())
    if (!startsWith(bytes, p, 'stream')) return { num, gen, obj }
    p += 6
    if (bytes[p] === 13 && bytes[p + 1] === 10) p += 2
    else if (bytes[p] === 10 || bytes[p] === 13) p++
    const lv = obj.get(N('Length'))
    const l = lv instanceof PDFRef ? ctx.lookup(lv) : lv
    let end = -1
    if (l instanceof PDFNumber) {
        const len = l.asNumber()
        if (len >= 0 && p + len <= bytes.length) {
            const q = skipWs(bytes, p + len)
            if (startsWith(bytes, q, 'endstream')) end = p + len
        }
    }
    if (end < 0) {
        end = findEndstream(bytes, p)
        if (bytes[end - 1] === 10) end--
        if (bytes[end - 1] === 13) end--
    }
    return { num, gen, obj: PDFRawStream.of(obj, bytes.subarray(p, end)) }
}

/** The stream's decoded bytes. pdf-lib's decoders ignore /Predictor, which xref and object streams
 *  from qpdf/OCRmyPDF use (PNG "Up", 12), so undo it here. */
function decodeData(s: PDFRawStream): Uint8Array {
    const data = decodePDFRawStream(s).decode()
    let parms: PDFObject | undefined = s.dict.lookup(N('DecodeParms'))
    if (parms instanceof PDFArray) parms = parms.lookup(parms.size() - 1)
    if (!(parms instanceof PDFDict)) return data
    const num = (k: string, d: number) => {
        const v = parms.lookup(N(k))
        return v instanceof PDFNumber ? v.asNumber() : d
    }
    const predictor = num('Predictor', 1)
    if (predictor <= 1) return data
    if (predictor < 10) throw new LightPdfError('TIFF predictor')
    const colors = num('Colors', 1),
        bpc = num('BitsPerComponent', 8),
        cols = num('Columns', 1)
    const rowLen = Math.ceil((colors * bpc * cols) / 8)
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8))
    const rows = Math.floor(data.length / (rowLen + 1))
    const out = new Uint8Array(rows * rowLen)
    for (let r = 0; r < rows; r++) {
        const tag = data[r * (rowLen + 1)]
        const src = r * (rowLen + 1) + 1
        const dst = r * rowLen
        for (let i = 0; i < rowLen; i++) {
            const x = data[src + i]
            const a = i >= bpp ? out[dst + i - bpp] : 0
            const b = r > 0 ? out[dst - rowLen + i] : 0
            const c = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0
            let v: number
            if (tag === 0) v = x
            else if (tag === 1) v = x + a
            else if (tag === 2) v = x + b
            else if (tag === 3) v = x + ((a + b) >> 1)
            else if (tag === 4) {
                const pa = Math.abs(b - c),
                    pb = Math.abs(a - c),
                    pc = Math.abs(a + b - 2 * c)
                v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
            } else throw new LightPdfError('bad PNG predictor tag')
            out[dst + i] = v & 0xff
        }
    }
    return out
}

type Entry = { t: 1; off: number; gen: number } | { t: 2; stm: number; idx: number } | null

/** An indirectObjects map that parses an object the first time it is asked for. */
class LazyObjects extends Map<PDFRef, PDFObject> {
    loader: (ref: PDFRef) => PDFObject | undefined = () => undefined
    private misses = new Set<PDFRef>()
    override get(ref: PDFRef): PDFObject | undefined {
        const hit = super.get(ref)
        if (hit) return hit
        if (this.misses.has(ref)) return undefined
        const o = this.loader(ref)
        if (o) super.set(ref, o)
        else this.misses.add(ref)
        return o
    }
}

function nums(a: PDFArray | undefined): number[] {
    const out: number[] = []
    if (!a) return out
    for (let i = 0; i < a.size(); i++) {
        const v = a.lookup(i)
        if (!(v instanceof PDFNumber)) throw new LightPdfError('bad number array')
        out.push(v.asNumber())
    }
    return out
}

function lastStartxref(bytes: Uint8Array): number {
    const tail = latin1.decode(bytes.subarray(Math.max(0, bytes.length - 8192)))
    const i = tail.lastIndexOf('startxref')
    if (i < 0) throw new LightPdfError('no startxref')
    const m = /^startxref\s+(\d+)/.exec(tail.slice(i))
    if (!m) throw new LightPdfError('bad startxref')
    return Number(m[1])
}

export function openLightPdf(bytes: Uint8Array): LightPdf {
    // offsets are file offsets: a header that is not at byte 0 shifts them in some producers
    if (!startsWith(bytes, 0, '%PDF-')) throw new LightPdfError('no header at 0')
    const ctx = PDFContext.create()
    const objects = new LazyObjects()
    ;(ctx as any).indirectObjects = objects
    const xref = new Map<number, Entry>()
    // numbers a classic table marked free in the section being read: a hybrid file's /XRefStm
    // (PDF 1.5 7.5.8.4) overrides those, and only those
    let tableFree = new Set<number>()
    const put = (n: number, e: Entry) => {
        if (!xref.has(n) || (tableFree.has(n) && e)) xref.set(n, e)
    }

    const applyXrefStream = (s: PDFRawStream) => {
        const w = nums(s.dict.lookupMaybe(N('W'), PDFArray))
        if (w.length < 3) throw new LightPdfError('bad /W')
        const sizeObj = s.dict.lookup(N('Size'))
        const size = sizeObj instanceof PDFNumber ? sizeObj.asNumber() : 0
        const idxArr = s.dict.lookupMaybe(N('Index'), PDFArray)
        const index = idxArr ? nums(idxArr) : [0, size]
        const data = decodeData(s)
        let p = 0
        const rd = (n: number) => {
            let v = 0
            for (let i = 0; i < n; i++) v = v * 256 + data[p++]
            return v
        }
        for (let k = 0; k + 1 < index.length; k += 2) {
            for (let j = 0; j < index[k + 1]; j++) {
                if (p + w[0] + w[1] + w[2] > data.length) throw new LightPdfError('short xref stream')
                const t = w[0] ? rd(w[0]) : 1
                const a = rd(w[1])
                const b = rd(w[2])
                const num = index[k] + j
                put(num, t === 1 ? { t: 1, off: a, gen: b } : t === 2 ? { t: 2, stm: a, idx: b } : null)
            }
        }
    }

    const readTable = (off: number): PDFDict => {
        let [tok, p] = token(bytes, off)
        if (tok !== 'xref') throw new LightPdfError('bad xref table')
        for (;;) {
            ;[tok, p] = token(bytes, p)
            if (tok === 'trailer') break
            const start = Number(tok)
            let cs: string
            ;[cs, p] = token(bytes, p)
            const count = Number(cs)
            if (!Number.isFinite(start) || !Number.isFinite(count)) throw new LightPdfError('bad xref subsection')
            for (let i = 0; i < count; i++) {
                let a: string, g: string, f: string
                ;[a, p] = token(bytes, p)
                ;[g, p] = token(bytes, p)
                ;[f, p] = token(bytes, p)
                const had = xref.has(start + i)
                put(start + i, f === 'n' ? { t: 1, off: Number(a), gen: Number(g) } : null)
                if (f !== 'n' && !had) tableFree.add(start + i)
            }
        }
        const t = PDFObjectParser.forBytes(bytes.subarray(p), ctx).parseObject()
        if (!(t instanceof PDFDict)) throw new LightPdfError('bad trailer')
        return t
    }

    const startxref = lastStartxref(bytes)
    let newest: PDFDict | null = null
    let xrefStream = false
    const seen = new Set<number>()
    for (let off = startxref; ; ) {
        if (seen.has(off)) break
        seen.add(off)
        let trailer: PDFDict
        const isTable = /^\s*xref/.test(latin1.decode(bytes.subarray(off, off + 16)))
        if (isTable) {
            tableFree = new Set()
            trailer = readTable(off)
            const hybrid = trailer.lookupMaybe(N('XRefStm'), PDFNumber)
            if (hybrid) {
                const s = parseIndirectAt(bytes, ctx, hybrid.asNumber()).obj
                if (s instanceof PDFRawStream) applyXrefStream(s)
            }
            tableFree = new Set()
        } else {
            const s = parseIndirectAt(bytes, ctx, off).obj
            if (!(s instanceof PDFRawStream)) throw new LightPdfError('xref is not a stream')
            applyXrefStream(s)
            trailer = s.dict
        }
        if (!newest) {
            newest = trailer
            xrefStream = !isTable
        }
        const prev = trailer.lookupMaybe(N('Prev'), PDFNumber)
        if (!prev) break
        off = prev.asNumber()
    }
    if (!newest) throw new LightPdfError('no xref')

    let maxNum = 0
    for (const k of xref.keys()) if (k > maxNum) maxNum = k
    const sizeV = newest.lookupMaybe(N('Size'), PDFNumber)
    const nextNum = Math.max(sizeV ? sizeV.asNumber() : 0, maxNum + 1)
    const encrypted = newest.has(N('Encrypt'))
    const base = { bytes, context: ctx, trailer: newest, prevXref: startxref, xrefStream, nextNum }
    if (encrypted) {
        return { ...base, encrypted, catalog: PDFDict.withContext(ctx), pages: [] }
    }

    const stms = new Map<number, { data: Uint8Array; first: number; at: Map<number, number> }>()
    const objStm = (n: number) => {
        let o = stms.get(n)
        if (o) return o
        const s = ctx.lookup(PDFRef.of(n))
        if (!(s instanceof PDFRawStream)) throw new LightPdfError('object stream missing')
        const cnt = s.dict.lookup(N('N'))
        const first = s.dict.lookup(N('First'))
        if (!(cnt instanceof PDFNumber && first instanceof PDFNumber)) throw new LightPdfError('bad object stream')
        const data = decodeData(s)
        const at = new Map<number, number>()
        let p = 0
        for (let i = 0; i < cnt.asNumber(); i++) {
            let a: string, b: string
            ;[a, p] = token(data, p)
            ;[b, p] = token(data, p)
            at.set(Number(a), Number(b))
        }
        o = { data, first: first.asNumber(), at }
        stms.set(n, o)
        return o
    }
    objects.loader = ref => {
        const e = xref.get(ref.objectNumber)
        if (!e) return undefined
        if (e.t === 1) {
            const r = parseIndirectAt(bytes, ctx, e.off)
            return r.num === ref.objectNumber ? r.obj : undefined
        }
        const s = objStm(e.stm)
        const off = s.at.get(ref.objectNumber)
        if (off === undefined) return undefined
        return PDFObjectParser.forBytes(s.data.subarray(s.first + off), ctx).parseObject()
    }

    const rootRef = newest.get(N('Root'))
    const catalog = rootRef ? ctx.lookupMaybe(rootRef, PDFDict) : undefined
    if (!catalog) throw new LightPdfError('no catalog')
    const pages: LightPage[] = []
    const visited = new Set<PDFDict>()
    const walk = (node: PDFDict, ref: PDFRef | null, depth: number) => {
        if (visited.has(node) || depth > 64) return
        visited.add(node)
        const kids = node.lookupMaybe(N('Kids'), PDFArray)
        if (kids && node.get(N('Type')) !== N('Page')) {
            for (let i = 0; i < kids.size(); i++) {
                const raw = kids.get(i)
                const d = kids.lookupMaybe(i, PDFDict)
                // a skipped kid would shift every later page index
                if (!d) throw new LightPdfError('unresolved page')
                walk(d, raw instanceof PDFRef ? raw : null, depth + 1)
            }
        } else pages.push({ ref, dict: node })
    }
    const rawPages = catalog.get(N('Pages'))
    const root = catalog.lookupMaybe(N('Pages'), PDFDict)
    if (!root) throw new LightPdfError('no page tree')
    walk(root, rawPages instanceof PDFRef ? rawPages : null, 0)
    const count = root.lookupMaybe(N('Count'), PDFNumber)
    if (count && count.asNumber() !== pages.length) throw new LightPdfError('page count mismatch')
    return { ...base, encrypted, catalog, pages }
}

/** Objects of one increment: object number -> generation + body. */
export type IncrementObjects = Map<number, { gen: number; body: PDFObject }>

function bytesOf(o: PDFObject): Uint8Array {
    const b = new Uint8Array(o.sizeInBytes())
    o.copyBytesInto(b, 0)
    return b
}

const pad = (n: number, w: number) => String(n).padStart(w, '0')

/** The bytes to append after `doc.bytes`: one incremental update holding `objects`. The original
 *  bytes stay an untouched prefix; the new xref section's /Prev is the previous startxref. */
export function buildIncrement(doc: LightPdf, objects: IncrementObjects, nextNum = doc.nextNum): Uint8Array {
    const base = doc.bytes
    const chunks: Uint8Array[] = []
    let pos = base.length
    const push = (b: Uint8Array) => {
        chunks.push(b)
        pos += b.length
    }
    const last = base[base.length - 1]
    if (last !== 10 && last !== 13) push(ascii('\n'))

    const entries: { num: number; off: number; gen: number }[] = []
    for (const num of [...objects.keys()].sort((a, b) => a - b)) {
        const { gen, body } = objects.get(num)!
        entries.push({ num, off: pos, gen })
        push(ascii(`${num} ${gen} obj\n`))
        push(bytesOf(body))
        push(ascii('\nendobj\n\n'))
    }
    let size = Math.max(nextNum, doc.nextNum)
    for (const e of entries) size = Math.max(size, e.num + 1)

    const scratch = PDFContext.create()
    const t = PDFDict.withContext(scratch)
    for (const k of ['Root', 'Info', 'ID']) {
        const v = doc.trailer.get(N(k))
        if (v) t.set(N(k), v)
    }
    t.set(N('Prev'), PDFNumber.of(doc.prevXref))

    const xrefOff = pos
    if (!doc.xrefStream) {
        let text = 'xref\n'
        for (let i = 0; i < entries.length; ) {
            let j = i
            while (j + 1 < entries.length && entries[j + 1].num === entries[j].num + 1) j++
            text += `${entries[i].num} ${j - i + 1}\n`
            for (let k = i; k <= j; k++) text += `${pad(entries[k].off, 10)} ${pad(entries[k].gen, 5)} n \n`
            i = j + 1
        }
        t.set(N('Size'), PDFNumber.of(size))
        push(ascii(text + 'trailer\n'))
        push(bytesOf(t))
        push(ascii(`\nstartxref\n${xrefOff}\n%%EOF\n`))
    } else {
        const xnum = size
        size = xnum + 1
        const all = [...entries, { num: xnum, off: xrefOff, gen: 0 }]
        const wOff = xrefOff > 0xffffffff ? 8 : 4
        const index: number[] = []
        for (let i = 0; i < all.length; ) {
            let j = i
            while (j + 1 < all.length && all[j + 1].num === all[j].num + 1) j++
            index.push(all[i].num, j - i + 1)
            i = j + 1
        }
        const data = new Uint8Array(all.length * (1 + wOff + 2))
        let p = 0
        for (const e of all) {
            data[p++] = 1
            for (let s = wOff - 1; s >= 0; s--) data[p++] = Math.floor(e.off / 2 ** (8 * s)) & 0xff
            data[p++] = (e.gen >> 8) & 0xff
            data[p++] = e.gen & 0xff
        }
        t.set(N('Type'), N('XRef'))
        t.set(N('Size'), PDFNumber.of(size))
        t.set(N('W'), scratch.obj([1, wOff, 2]))
        t.set(N('Index'), scratch.obj(index))
        t.set(N('Length'), PDFNumber.of(data.length))
        push(ascii(`${xnum} 0 obj\n`))
        push(bytesOf(t))
        push(ascii('\nstream\n'))
        push(data)
        push(ascii(`\nendstream\nendobj\nstartxref\n${xrefOff}\n%%EOF\n`))
    }

    const out = new Uint8Array(pos - base.length)
    let at = 0
    for (const c of chunks) {
        out.set(c, at)
        at += c.length
    }
    return out
}
