// app/src/drawing/DrawingPage.tsx
import { createResource, createSignal, Index, onCleanup, Show } from 'solid-js'
import { api } from '../api'
import { debounce } from '../debounce'
import {
    emptyDoc,
    parseDoc,
    PAGE_W,
    PAGE_H,
    type DrawingDoc,
    type ImageEl,
    type PaperBg,
} from '../../../core/src/drawing/model'
import { fitImage } from '../../../core/src/drawing/pageInk'
import { createDrawingStore } from './store'
import { DrawingCanvas, type ToolState } from './DrawingCanvas'
import { Toolbar } from './Toolbar'
import { IconTextButton } from '../ui/IconTextButton'
import { Loading } from '../ui/EmptyState'
import FilePicker from '../ui/FilePicker'
import { pushToast } from '../Toast'
import styles from './DrawingPage.module.css'

// --- Image intake (import button / paste / drag-drop) ---------------------------------
// A placed image is stored as a self-contained `data:` URL inside the `.draw` so the file
// stays portable + headless-exportable. These helpers turn a File/blob into a centered,
// page-fit ImageEl in 816×1056 logical space (`fitImage` lives in core/src/drawing/pageInk.ts,
// shared with the in-place image/PDF ink that maps the same page box).
const IMAGE_NAME_RE = /\.(png|jpe?g|gif|webp|svg)$/i
const isImageFile = (f: File): boolean =>
    f.type.startsWith('image/') || IMAGE_NAME_RE.test(f.name)

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(fr.result as string)
        fr.onerror = () => reject(fr.error ?? new Error('read failed'))
        fr.readAsDataURL(blob)
    })
}
function decodeSize(src: string): Promise<{ w: number; h: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () =>
            resolve({
                w: img.naturalWidth || PAGE_W,
                h: img.naturalHeight || PAGE_H,
            })
        img.onerror = () => reject(new Error('decode failed'))
        img.src = src
    })
}
async function imageElFromSrc(
    src: string,
    maxScale = Infinity,
): Promise<ImageEl> {
    const { w, h } = await decodeSize(src)
    return { src, ...fitImage(w, h, maxScale) }
}

// size defaults to one of the 5 discrete toolbar levels so a button reads as active;
// smoothMode picks how the finished stroke is relaxed (default "smooth" — relax once on release).
const DEFAULT_TOOLS: ToolState = {
    tool: 'pen',
    color: 'fg',
    size: 5,
    smoothMode: 'smooth',
    holdToStraighten: true,
    holdDelayMs: 900,
}

// Transient zoom bounds (NOT persisted). Shared with the Toolbar so its disabled
// guards can't drift from the clamp here.
export const ZOOM_MIN = 0.25,
    ZOOM_MAX = 4

export function DrawingPage(props: { path: string }) {
    const [loaded] = createResource(
        () => props.path,
        async (p): Promise<DrawingDoc> => {
            try {
                return parseDoc(await api.read(p))
            } catch {
                return emptyDoc()
            }
        },
    )
    return (
        <Show
            when={loaded()}
            keyed
            fallback={<Loading>Loading drawing…</Loading>}
        >
            {initial => <DrawingEditor path={props.path} initial={initial} />}
        </Show>
    )
}

function DrawingEditor(props: { path: string; initial: DrawingDoc }) {
    const save = debounce((d: DrawingDoc) => {
        void api.saveDrawing(props.path, d)
    }, 600)
    const store = createDrawingStore(props.initial, save)
    const [tools, setToolsSig] = createSignal<ToolState>(DEFAULT_TOOLS)
    const setTools = (patch: Partial<ToolState>) =>
        setToolsSig(t => ({ ...t, ...patch }))

    // --- Image import: toolbar button (hidden file input), plus paste + drag-drop onto the
    // stage (mirrors Editor.tsx's attachment intake, filtered to images). Each image is placed
    // page-fit + centered, capped at natural size (no upscaling an import). Whole-doc undo covers
    // an insert (selection/move/delete of a placed image is a tracked followup — see store.removeImage).
    let fileInput!: HTMLInputElement
    async function importOne(file: File, pageIndex: number) {
        try {
            store.addImage(
                pageIndex,
                await imageElFromSrc(await blobToDataUrl(file), 1),
            )
        } catch (e) {
            pushToast(`Couldn't import image: ${(e as Error).message}`)
        }
    }
    const importFiles = (files: File[], pageIndex: number) => {
        for (const f of files) if (isImageFile(f)) void importOne(f, pageIndex)
    }
    const onPickFile = (files: FileList) => {
        importFiles([...files], 0)
    }
    // Which page an event landed on (drop), else page 0 (paste / toolbar button).
    const pageIndexFromTarget = (target: EventTarget | null): number => {
        const host = (target as HTMLElement | null)?.closest?.(
            '[data-page-index]',
        ) as HTMLElement | null
        const n = host ? Number(host.dataset.pageIndex) : 0
        return Number.isFinite(n) ? n : 0
    }
    const onDragOver = (e: DragEvent) => {
        const dt = e.dataTransfer
        if (dt?.types?.includes('Files') || dt?.items?.length)
            e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
        e.preventDefault() // never let the browser navigate to a dropped file
        const files = e.dataTransfer
            ? [...e.dataTransfer.files].filter(isImageFile)
            : []
        if (files.length) importFiles(files, pageIndexFromTarget(e.target))
    }
    const onPaste = (e: ClipboardEvent) => {
        const files: File[] = []
        for (const it of e.clipboardData?.items ?? []) {
            if (it.kind === 'file' && it.type.startsWith('image/')) {
                const f = it.getAsFile()
                if (f) files.push(f)
            }
        }
        if (files.length) {
            e.preventDefault()
            importFiles(files, 0)
        }
    }

    // Transient zoom (NOT persisted). Applied as a CSS WIDTH multiplier on a wrapper
    // around each page — DrawingCanvas.toLocal divides by getBoundingClientRect().width,
    // so pointer mapping stays correct at any zoom without touching the canvas code.
    // ZOOM_MIN/ZOOM_MAX are module-level (shared with the Toolbar's disabled guards).
    const [zoom, setZoom] = createSignal(1)
    const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
    const zoomBy = (factor: number) => setZoom(z => clampZoom(z * factor))
    // Button presses step by a fixed 5% (wheel/pinch stays smooth/multiplicative).
    const zoomStep = (delta: number) =>
        setZoom(z => clampZoom(Math.round((z + delta) * 100) / 100))
    // The app is dark-only (appearance.theme selects a Bismuth color palette, not a
    // light/dark mode), so the drawing canvas always renders dark.
    const theme = (): 'dark' | 'light' => 'dark'

    // Cmd/Ctrl + wheel (and trackpad pinch, which the browser reports as a ctrlKey
    // wheel) zooms. Registered non-passive so we can preventDefault the browser's own
    // page zoom; plain scroll falls through untouched.
    const onWheel = (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return
        e.preventDefault()
        zoomBy(Math.exp(-e.deltaY * 0.01))
    }
    // Focus the (tabindex=0) stage on interaction so a subsequent Cmd/Ctrl+V paste targets it
    // (a plain <div> only receives `paste` while focused). Harmless to drawing — the live canvas
    // still gets the pointerdown + capture.
    const focusStage = (el: HTMLDivElement) => () =>
        el.focus({ preventScroll: true })
    const attachStage = (el: HTMLDivElement) => {
        const onFocus = focusStage(el)
        el.addEventListener('wheel', onWheel, { passive: false })
        el.addEventListener('pointerdown', onFocus)
        el.addEventListener('dragover', onDragOver)
        el.addEventListener('drop', onDrop)
        el.addEventListener('paste', onPaste)
        onCleanup(() => {
            el.removeEventListener('wheel', onWheel)
            el.removeEventListener('pointerdown', onFocus)
            el.removeEventListener('dragover', onDragOver)
            el.removeEventListener('drop', onDrop)
            el.removeEventListener('paste', onPaste)
        })
    }

    return (
        <div class={styles['draw-app']}>
            <Toolbar
                tools={tools}
                setTools={setTools}
                bg={() => store.doc().paper.bg}
                setBackground={(bg: PaperBg) => store.setBackground(bg)}
                onUndo={() => store.undo()}
                onRedo={() => store.redo()}
                zoom={zoom}
                onZoomIn={() => zoomStep(0.05)}
                onZoomOut={() => zoomStep(-0.05)}
                onResetZoom={() => setZoom(1)}
                onImportImage={() => fileInput.click()}
            />
            <div class={styles['draw-stage']} tabindex={0} ref={attachStage}>
                <Index each={store.doc().pages}>
                    {(_page, i) => (
                        <div
                            class={styles['draw-page-zoom']}
                            data-page-index={i}
                            style={{
                                width: `${zoom() * 100}%`,
                                'max-width': `${zoom() * 1400}px`,
                            }}
                        >
                            <DrawingCanvas
                                doc={store.doc}
                                pageIndex={i}
                                tools={tools}
                                theme={theme}
                                onCommit={s => store.commitStroke(i, s)}
                                onEraseStroke={idx => store.eraseStroke(i, idx)}
                            />
                        </div>
                    )}
                </Index>
                <IconTextButton icon="Plus" onClick={() => store.addPage()}>
                    add page
                </IconTextButton>
            </div>
            {/* Hidden picker backing the toolbar's Import-image button. */}
            <FilePicker
                ref={el => (fileInput = el)}
                accept="image/*"
                onPick={onPickFile}
            />
        </div>
    )
}
