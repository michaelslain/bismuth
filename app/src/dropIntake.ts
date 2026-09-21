// app/src/dropIntake.ts
// Pure planner for "something landed on a note from outside the app" — a Tauri drag pasteboard
// or a browser DataTransfer, normalised to one shape (`DragPasteboard`) and turned into a single
// prioritised list of actions (`DropAction[]`). No DOM, no CodeMirror, no framework imports — the
// editor decides how to execute an action; this module only decides which one.

import { imageMimeFromName } from './fileIntake'

/** The union every drop/paste surface normalises into. On macOS the Tauri `read_drag_pasteboard`
 *  command fills `files`/`images` from the OS pasteboard; a browser `DataTransfer` (see
 *  `pasteboardFromTransfer`) can only ever populate `urls`/`html`/`text` — a web page has no way
 *  to hand over raw file bytes or paths on drop. */
export type DragPasteboard = {
    files: string[]
    images: { name: string; base64: string }[]
    urls: string[]
    html: string | null
    text: string | null
}

export type DropAction =
    | { kind: 'paths'; paths: string[] }
    | { kind: 'bytes'; name: string; base64: string }
    | { kind: 'url-image'; url: string; name: string }
    | { kind: 'link'; url: string }
    | { kind: 'text'; text: string }

/** True when `nameOrUrl` (a filename, or a URL's path segment) carries an extension the app can
 *  embed directly as an image. Reuses `fileIntake`'s allowlist rather than a second one, so the
 *  two never drift. */
function hasImageExtension(nameOrUrl: string): boolean {
    return imageMimeFromName(nameOrUrl) !== null
}

/** `pathname` of a URL, tolerating a string that isn't a valid absolute URL (falls back to the
 *  raw string, which is still good enough for an extension check). */
function pathnameOf(url: string): string {
    try {
        return new URL(url).pathname
    } catch {
        return url
    }
}

function looksLikeImageUrl(url: string): boolean {
    return hasImageExtension(pathnameOf(url))
}

/**
 * Normalises a browser `DataTransfer` (or anything shaped like one) into a `DragPasteboard`.
 * `files`/`images` are always `[]` here — a web page's DataTransfer never carries raw pasteboard
 * bytes or filesystem paths for a non-`File` drag; only the Tauri command produces those.
 *
 * Only http(s) lines of `text/uri-list` are kept: `file:` lines belong to
 * `fileIntake.filePathsFromTransfer`, which already owns that flavour for Finder-style drops.
 *
 * `getData` throws when called outside a genuine drop/paste (e.g. during `dragover`), so each
 * flavour is read inside its own try/catch — one throwing must not blank out the others.
 */
export function pasteboardFromTransfer(
    dt: { getData(format: string): string } | null | undefined,
): DragPasteboard {
    const empty: DragPasteboard = { files: [], images: [], urls: [], html: null, text: null }
    if (!dt) return empty

    const urls: string[] = []
    try {
        const raw = dt.getData('text/uri-list') || ''
        for (const line of raw.split(/\r?\n/)) {
            const url = line.trim()
            if (!url || url.startsWith('#')) continue
            if (/^https?:/i.test(url)) urls.push(url)
        }
    } catch {
        // getData threw — leave urls as whatever was collected before the throw ([] here)
    }

    let html: string | null = null
    try {
        html = dt.getData('text/html') || null
    } catch {
        html = null
    }

    let text: string | null = null
    try {
        text = dt.getData('text/plain') || null
    } catch {
        text = null
    }

    return { files: [], images: [], urls, html, text }
}

const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i

function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
}

/** The first `<img src="…">`/`'…'` in a fragment of clipboard HTML, HTML-entity-decoded. Only
 *  http(s) and `data:image/…` sources are returned — anything else (a relative path with no
 *  usable base, `blob:`, …) is not something this app can fetch or embed. */
export function imageSrcFromHtml(html: string): string | null {
    const m = IMG_SRC_RE.exec(html)
    if (!m) return null
    const raw = m[2] ?? m[3] ?? ''
    const src = decodeHtmlEntities(raw).trim()
    if (!src) return null
    if (/^https?:/i.test(src) || /^data:image\//i.test(src)) return src
    return null
}

/** The file extension implied by a `data:image/…` URL's MIME type, e.g. `jpeg` → `jpg`,
 *  `svg+xml` → `svg`. `null` when `url` isn't a `data:image/…` URL. */
function extFromDataImageMime(url: string): string | null {
    const m = /^data:image\/([a-z0-9.+-]+)/i.exec(url)
    if (!m) return null
    const sub = m[1].toLowerCase()
    if (sub === 'svg+xml') return 'svg'
    if (sub === 'jpeg') return 'jpg'
    return sub
}

/**
 * A safe filename for an image reached by URL: the last path segment, query/fragment stripped,
 * percent-decoded, and reduced to a single path-free segment. Appends an extension when the
 * segment doesn't already carry one the app recognises as an image — the `data:` URL's own MIME
 * type when it's a data URL, `.png` otherwise. An empty/unusable segment falls back to
 * `image-<Date.now()>.<ext>`.
 */
export function nameForImageUrl(url: string): string {
    const dataExt = extFromDataImageMime(url)

    let seg = ''
    if (!url.startsWith('data:')) {
        let path = pathnameOf(url)
        path = path.split('?')[0].split('#')[0]
        const last = path.split('/').filter(Boolean).pop() ?? ''
        try {
            seg = decodeURIComponent(last)
        } catch {
            seg = last
        }
        seg = seg.replace(/[\\/]/g, '_').trim()
    }

    if (!seg) return `image-${Date.now()}.${dataExt ?? 'png'}`
    if (!hasImageExtension(seg)) seg += `.${dataExt ?? 'png'}`
    return seg
}

/** Decodes a base64 string (as produced by the pasteboard/`data:` URL) into raw bytes. */
export function bytesFromBase64(b64: string): Uint8Array {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
}

function base64FromDataUrl(url: string): string {
    const comma = url.indexOf(',')
    return comma >= 0 ? url.slice(comma + 1) : ''
}

/**
 * Decides what a drop/paste should do, in priority order: real files/paths beat raw pasteboard
 * image bytes beat an `<img>` found in dragged HTML beat a URL that looks like an image beat any
 * other URL (as a plain link) beat plain text. `[]` means nothing usable was found — the caller
 * must toast, never insert nothing silently.
 */
export function planDrop(p: DragPasteboard): DropAction[] {
    if (p.files.length > 0) return [{ kind: 'paths', paths: p.files }]

    if (p.images.length > 0) {
        return p.images.map(img => ({ kind: 'bytes', name: img.name, base64: img.base64 }))
    }

    const htmlImageSrc = p.html ? imageSrcFromHtml(p.html) : null
    const imageUrl = htmlImageSrc ?? p.urls.find(looksLikeImageUrl) ?? null
    if (imageUrl) {
        if (imageUrl.startsWith('data:')) {
            return [{ kind: 'bytes', name: nameForImageUrl(imageUrl), base64: base64FromDataUrl(imageUrl) }]
        }
        return [{ kind: 'url-image', url: imageUrl, name: nameForImageUrl(imageUrl) }]
    }

    if (p.urls.length > 0) return [{ kind: 'link', url: p.urls[0] }]

    if (p.text) return [{ kind: 'text', text: p.text }]

    return []
}
