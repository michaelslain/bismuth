// app/src/preview/previewViewMemory.ts
// Remembers where the reader was in each PDF and image — a PDF's zoom, bookmarks-panel-open state
// and scroll position; an image's zoom and the picture point at the centre of the view — so coming
// back to a preview by any route (a tab switch, Cmd+Shift+T, the file tree, a reload, an app
// restart) lands where they left it instead of at fit-width, page one.
//
// The state lives in a Map keyed by vault-relative path, which every save updates at once, and is
// mirrored into a storage backing (`attachPreviewViewStorage`; the app passes localStorage under a
// per-vault key) by a debounced write, flushed on `pagehide`. Storage is optional: with none
// attached the memory still holds for the session.
import type { PdfPosition } from './annotationTypes'
import { readCache, scopedKey, writeCache } from '../viewCache'

/** An image's view: its zoom (1 = fit) and the picture point under the centre of the view, as
 *  fractions of the rendered picture (0..1 across, 0..1 down; past either end when the view is
 *  scrolled against an edge and its centre sits in the gutter). */
export type ImageView = {
    zoom: number
    fx: number
    fy: number
}

export type PreviewViewState = {
    position?: PdfPosition
    zoom: number
    panelOpen: boolean
    image?: ImageView
}

/** Where the memory is persisted: `read` returns what `write` last stored (or nothing). */
export type PreviewViewStorage = {
    read: () => unknown
    write: (entries: [string, PreviewViewState][]) => void
}

/** The most paths remembered; the least recently saved one is dropped past this. */
export const PREVIEW_VIEW_CAP = 500
/** How long a burst of saves (a scroll) waits before one storage write. */
export const WRITE_DELAY_MS = 300

const viewByPath = new Map<string, PreviewViewState>()
let storage: PreviewViewStorage | undefined
let writeTimer: ReturnType<typeof setTimeout> | undefined

const isNum = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v)

function isPosition(v: unknown): v is PdfPosition {
    const p = v as PdfPosition
    return !!p && isNum(p.index) && isNum(p.yFraction) && isNum(p.xFraction)
}

function isImageView(v: unknown): v is ImageView {
    const i = v as ImageView
    return !!i && isNum(i.zoom) && isNum(i.fx) && isNum(i.fy)
}

/** One stored entry, or undefined when it is not a well-formed `[path, state]` pair. */
function parseEntry(raw: unknown): [string, PreviewViewState] | undefined {
    if (!Array.isArray(raw) || typeof raw[0] !== 'string') return undefined
    const s = raw[1] as PreviewViewState
    if (!s || !isNum(s.zoom) || typeof s.panelOpen !== 'boolean')
        return undefined
    const state: PreviewViewState = { zoom: s.zoom, panelOpen: s.panelOpen }
    if (isPosition(s.position)) state.position = s.position
    if (isImageView(s.image)) state.image = s.image
    return [raw[0], state]
}

/** Back the memory with `backing`: entries it holds are loaded (a path already saved this session
 *  keeps its newer state) and every later save is written back to it. */
export function attachPreviewViewStorage(backing: PreviewViewStorage): void {
    storage = backing
    const stored = backing.read()
    if (!Array.isArray(stored)) return
    const live = new Map(viewByPath)
    viewByPath.clear()
    for (const raw of stored) {
        const entry = parseEntry(raw)
        if (entry && !live.has(entry[0])) viewByPath.set(entry[0], entry[1])
    }
    for (const [k, v] of live) viewByPath.set(k, v)
    trim()
}

/** localStorage key prefix; `persistPreviewViewFor` scopes it to one vault backend. */
export const PREVIEW_VIEW_KEY = 'bismuth-preview-view'
let persistedFor: string | undefined

/** Back the memory with localStorage under this window's vault (`apiBase`). Called on every
 *  preview mount; only the first call for a backend reads storage. */
export function persistPreviewViewFor(apiBase: string): void {
    if (persistedFor === apiBase) return
    // Another vault took over this window: its paths name other files, so start from its store.
    if (persistedFor !== undefined) {
        flushPreviewView()
        viewByPath.clear()
    }
    persistedFor = apiBase
    const key = scopedKey(PREVIEW_VIEW_KEY, apiBase)
    attachPreviewViewStorage({
        read: () => readCache<unknown>(key),
        write: entries => writeCache(key, entries),
    })
}

/** Write any pending change to the attached storage now. */
export function flushPreviewView(): void {
    if (writeTimer !== undefined) clearTimeout(writeTimer)
    writeTimer = undefined
    storage?.write([...viewByPath])
}

function scheduleWrite(): void {
    if (!storage || writeTimer !== undefined) return
    writeTimer = setTimeout(flushPreviewView, WRITE_DELAY_MS)
}

function trim(): void {
    while (viewByPath.size > PREVIEW_VIEW_CAP) {
        const oldest = viewByPath.keys().next().value
        if (oldest === undefined) break
        viewByPath.delete(oldest)
    }
}

/** The remembered view state for a preview, or undefined if none. */
export function loadPreviewView(path: string): PreviewViewState | undefined {
    return viewByPath.get(path)
}

/** Merge `patch` into the remembered state for `path`, creating `{ zoom: 1, panelOpen: false }`
 *  first if nothing was stored yet. The path becomes the most recently saved one. */
export function savePreviewView(
    path: string,
    patch: Partial<PreviewViewState>,
): void {
    const current = viewByPath.get(path) ?? { zoom: 1, panelOpen: false }
    viewByPath.delete(path)
    viewByPath.set(path, { ...current, ...patch })
    trim()
    scheduleWrite()
}

/** Forget a preview's view state (e.g. on delete). */
export function clearPreviewView(path: string): void {
    if (viewByPath.delete(path)) scheduleWrite()
}

/** Re-key a remembered view state across a rename/move, so the renamed file keeps its place
 *  instead of resetting. No-op when nothing was stored for `from`. */
export function renamePreviewView(from: string, to: string): void {
    const v = viewByPath.get(from)
    if (v === undefined) return
    viewByPath.delete(from)
    viewByPath.set(to, v)
    scheduleWrite()
}

// Keep a preview's view state attached across a rename/move, forget it on delete — the same
// `bismuth-moved`/`bismuth-deleted` idiom `scrollMemory.ts` listens for — and write a pending
// change before the page goes away.
if (typeof window !== 'undefined') {
    window.addEventListener('bismuth-moved', e => {
        const { from, to } = (e as CustomEvent).detail as {
            from: string
            to: string
        }
        renamePreviewView(from, to)
    })
    window.addEventListener('bismuth-deleted', e => {
        const path = (e as CustomEvent).detail as string
        clearPreviewView(path)
    })
    window.addEventListener('pagehide', () => {
        if (writeTimer !== undefined) flushPreviewView()
    })
}
