// app/src/fileIntake.ts
// One classifier for every "a file arrived from outside the app" surface: chat drop, chat paste,
// note drop, note paste.
//
// Before this module each surface had its own private allowlist and each SILENTLY dropped
// anything it didn't recognise — which is what made dragging an ordinary file out of Finder look
// like a dead feature. Routing now happens in one pure, tested place, and every caller is
// obliged to handle all three kinds.
//
// Two independent things have to be classified, hence two halves:
//  • WHAT the file is — `classifyIntake` (image / heic / other), by extension. An OS drag hands
//    over a filesystem PATH and no MIME type at all, so extension is the only universal signal.
//  • WHERE it came from — `filePathsFromTransfer`, which reads the macOS clipboard/drag
//    `text/uri-list` flavour. Copying a file in Finder puts a file URL on the pasteboard, never a
//    `kind:"file"` item, so a paste handler that only inspects `items` finds nothing and the
//    paste appears to do nothing. Only Terminal.tsx read this flavour before; all four surfaces
//    share this parser now.

/** How a dropped/pasted file should be handled. `other` is a first-class outcome — a real file
 *  the surface must do something with — never a "reject" bucket. */
export type IntakeKind = 'image' | 'heic' | 'other'

/** Image types the chat composer can send as an SDK `image` content block. Deliberately narrow:
 *  these are the four the Anthropic API accepts, so widening it would produce turns the backend
 *  rejects. HEIC is NOT here — it routes through conversion first (see classifyIntake). */
const CHAT_IMAGE_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
}

/** Last path segment, for both `/` and `\` separators (a Windows drag yields the latter). */
export function basename(pathOrName: string): string {
    return pathOrName.split(/[\\/]/).pop() ?? pathOrName
}

/** Lowercase extension without the dot; "" when the name has none. Only looks at the final
 *  segment, so a directory named `photos.heic` can't make `photos.heic/notes.txt` a HEIC. */
export function extensionOf(pathOrName: string): string {
    const base = basename(pathOrName)
    const dot = base.lastIndexOf('.')
    return dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** The image MIME for a name the chat composer can attach directly, else null. */
export function imageMimeFromName(pathOrName: string): string | null {
    return CHAT_IMAGE_EXT[extensionOf(pathOrName)] ?? null
}

/** HEIC/HEIF by name — Apple's default camera format, and the reason a dragged photo used to
 *  vanish. Mirrors `core/src/heic.ts`'s `isHeicName` (the backend does the actual transcode). */
export function isHeicName(pathOrName: string): boolean {
    const ext = extensionOf(pathOrName)
    return ext === 'heic' || ext === 'heif'
}

/** `IMG_0042.HEIC` → `IMG_0042.jpg`. Non-HEIC names pass through untouched. */
export function jpegNameFor(pathOrName: string): string {
    if (!isHeicName(pathOrName)) return pathOrName
    return pathOrName.slice(0, pathOrName.lastIndexOf('.')) + '.jpg'
}

/** Route a dropped/pasted file by name. Total: every name lands in exactly one kind. */
export function classifyIntake(pathOrName: string): IntakeKind {
    if (isHeicName(pathOrName)) return 'heic'
    return imageMimeFromName(pathOrName) ? 'image' : 'other'
}

/** The subset of `DataTransfer` this module needs, so the parser is unit-testable without a DOM.
 *  Satisfied by both `DragEvent.dataTransfer` and `ClipboardEvent.clipboardData`. */
export type TransferLike = { getData(format: string): string }

/**
 * Absolute filesystem paths carried by a drag or clipboard as `text/uri-list`.
 *
 * This is how macOS hands over a file copied in Finder, and it is strictly better than the
 * `File` object route: a `File` exposes only a basename, while this is the REAL path — which is
 * what lets chat reference a dropped file in place instead of copying its bytes anywhere.
 *
 * Per RFC 2483 the list is CRLF-separated and `#` lines are comments. Non-`file:` URLs (a URL
 * dragged from a browser) are skipped — they are not files and must not be treated as such.
 */
export function filePathsFromTransfer(
    dt: TransferLike | null | undefined,
): string[] {
    if (!dt) return []
    let raw = ''
    try {
        raw = dt.getData('text/uri-list') || ''
    } catch {
        return [] // getData throws outside a real drop/paste (e.g. during dragover)
    }
    if (!raw) return []
    const paths: string[] = []
    for (const line of raw.split(/\r?\n/)) {
        const url = line.trim()
        if (!url || url.startsWith('#') || !/^file:/i.test(url)) continue
        try {
            // `new URL().pathname` is percent-encoded ("My%20Photo.heic"); decode to the real path.
            const decoded = decodeURIComponent(new URL(url).pathname)
            if (decoded) paths.push(decoded)
        } catch {
            /* unparseable entry — skip it rather than failing the whole drop */
        }
    }
    return paths
}
