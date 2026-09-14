// app/src/PreviewView.tsx
// PREVIEW tab for non-note files: images, PDFs, and code/text open here by default. Every kind
// exposes "Open in default app" / "Reveal" (Tauri) so binary formats we can't render
// (PSD/Figma/…) are still reachable in Photoshop/Figma/etc. Routing lives in PaneContent;
// classification in previewKind.
//
// Ink (images + PDFs) is drawn IN PLACE, the way note ink is: the same `toggle-draw-mode`
// keybinding, caught on a capture-phase keydown of the preview root exactly like Find below,
// flips `preview/PageInk` interactive over the rendered page(s); outside draw mode it only
// paints. The strokes live in the file's `<file>.draw` sidecar (core/src/drawing/pageInk.ts has
// the coordinate contract). An image is ONE page measured off the `<img>`'s painted rect; a PDF
// hands PageInk to PdfPages as its `overlay`, fed from PdfPages' `onLayout` boxes.
//
// Find (Cmd/Ctrl+F, rebindable via settings.keybindings.find — same key the editor uses) is
// handled per content kind, on a capture-phase keydown of the preview root (App.tsx has NO
// global find handler, and the editor only binds it when the editor is focused, so mirroring
// that here is what makes Cmd+F work when a preview tab is focused):
//   • code/text — a real find bar: highlight every match, next/prev + count, scroll-to-active.
//   • pdf       — PdfPages renders pdf.js's own text layer per page (selectable/copyable text),
//                 but there is no find-bar UI over it yet, so Find shows a one-line note instead
//                 of pretending to search. DOCUMENTED LIMITATION: no in-app PDF text search.
//   • image / external — no searchable text, so Find is a graceful no-op (never crashes).
import {
    createEffect,
    createMemo,
    createResource,
    createSignal,
    For,
    Match,
    on,
    onCleanup,
    onMount,
    Show,
    Switch,
} from 'solid-js'
import { api, apiBase } from './api'
import { previewKind, type PreviewKind } from './preview/previewKind'
import { buildAssetUrl } from './preview/assetUrl'
import { findMatches, segmentText, stepMatchIndex } from './preview/findMatches'
import PdfPages from './preview/PdfPages'
import PageInk, { type PageInkPage } from './preview/PageInk'
import CompanionFrontmatter from './preview/CompanionFrontmatter'
import type { PageBox, PageSize } from './preview/pageLayout'
import { containRect } from '../../core/src/drawing/pageInk'
import { inkSidecarFor } from '../../core/src/fileKinds'
import { Icon } from './icons/Icon'
import { IconButton } from './ui/IconButton'
import { Button } from './ui/Button'
import { IconTextButton } from './ui/IconTextButton'
import Label from './ui/Label'
import ViewBar, { Crumb } from './ui/ViewBar'
import EmptyState, { Loading } from './ui/EmptyState'
import { isTauri } from './nativeMenu'
import { openPathInDefaultApp, revealPath } from './appWindow'
import { pushToast } from './Toast'
import { settings } from './settings'
import { matchesKeybinding } from './keybindings'
import styles from './PreviewView.module.css'

const HEADER_ICON: Record<PreviewKind, string> = {
    image: 'Image',
    pdf: 'FileText',
    code: 'Code',
    external: 'File',
}

// Cap highlighted matches so a 1-char query in a huge file can't explode the DOM / stall
// the count. Beyond this we still show a "…+" count and highlight the first N.
const MAX_MATCHES = 2000

export function PreviewView(props: { path: string; tagNames: () => string[] }) {
    const kind = (): PreviewKind => previewKind(props.path) ?? 'external'
    const name = () => props.path.split('/').pop() ?? props.path
    // `src` for the image <img>: GET /asset, resolved filename-first by the backend. Built
    // through the pure, unit-tested `buildAssetUrl` so the space/U+202F/`/` encoding that lets
    // macOS-screenshot filenames load can never silently regress.
    const assetUrl = () => buildAssetUrl(apiBase(), props.path)
    const inkable = () => kind() === 'image' || kind() === 'pdf'

    // PdfPages' `load` data seam, as a MEMO rather than an inline closure: a plain
    // `() => fetch(assetUrl())…` function literal is a stable reference to Solid's compiler (a
    // function VALUE being passed, not a computed one), so it would never change identity when
    // switching between two PDFs while `kind()` stays 'pdf' — and PdfPages only reloads when
    // `props.load` itself changes identity. Wrapping the URL capture in `createMemo` forces a
    // brand-new closure exactly when `assetUrl()` (i.e. `props.path`) actually changes, and a
    // stable one otherwise (e.g. across zoom changes).
    const pdfLoad = createMemo(() => {
        const url = assetUrl()
        return () => fetch(url).then(r => r.arrayBuffer())
    })

    // Image load failure (a moved/renamed/unresolved src → 404) must NOT be a silent blank pane
    // — surface a clear state + the Open-externally affordance instead. Reset on every path
    // change so switching to a fresh image re-attempts the load.
    const [imgFailed, setImgFailed] = createSignal(false)

    // PDF zoom — transient (not a `.settings` key, per the plan's ruling), reset to fit-width
    // whenever a different file opens. 1 = fit width (PdfPages' own contract).
    const PDF_ZOOM_MIN = 0.25
    const PDF_ZOOM_MAX = 4
    const [pdfZoom, setPdfZoom] = createSignal(1)
    const zoomBy = (factor: number) =>
        setPdfZoom(z =>
            Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, z * factor)),
        )
    createEffect(on(() => props.path, () => setPdfZoom(1)))

    // Fetch the text body only for code/text kinds (GET /file returns "" for a missing file).
    const [code] = createResource(
        () => (kind() === 'code' ? props.path : undefined),
        p => api.read(p).catch(() => ''),
    )

    // --- Find state (code/text bar + pdf note) ---------------------------------------------
    const [findOpen, setFindOpen] = createSignal(false)
    const [query, setQuery] = createSignal('')
    const [caseSensitive, setCaseSensitive] = createSignal(false)
    const [activeIndex, setActiveIndex] = createSignal(0)

    let rootRef: HTMLDivElement | undefined
    let inputRef: HTMLInputElement | undefined
    let codeRef: HTMLPreElement | undefined
    let bodyRef: HTMLDivElement | undefined

    // --- In-place ink (image + pdf) ---------------------------------------------------------
    const [drawMode, setDrawMode] = createSignal(false)
    // One entry per rendered page, in PageInk's host coordinates (the host is `inset: 0` over
    // the body for an image, over PdfPages' scroll content for a PDF).
    const [imagePages, setImagePages] = createSignal<PageInkPage[]>([])
    const [pdfPages, setPdfPages] = createSignal<PageInkPage[]>([])
    const exitDraw = () => {
        setDrawMode(false)
        // Focus was on the ink host (or fell to body): hand it back to the preview root so the
        // toggle key works again immediately — but never steal it from another pane.
        const ae = document.activeElement
        if (ae === document.body || (ae && rootRef?.contains(ae))) {
            rootRef?.focus({ preventScroll: true })
        }
    }
    createEffect(
        on(
            () => props.path,
            () => {
                setDrawMode(false)
                setImagePages([])
                setPdfPages([])
            },
        ),
    )

    /** Where the `<img>` actually paints its pixels, relative to the body. `.preview-image`
     *  carries padding and `object-fit: contain`, so its border box is NOT the picture — the
     *  content box is, letterboxed to the natural aspect ratio. */
    const measureImage = (img: HTMLImageElement) => {
        const body = bodyRef
        const natW = img.naturalWidth
        const natH = img.naturalHeight
        if (!body || !img.isConnected || !natW || !natH) return
        const br = body.getBoundingClientRect()
        const ir = img.getBoundingClientRect()
        const cs = getComputedStyle(img)
        const px = (v: string) => parseFloat(v) || 0
        const padL = px(cs.borderLeftWidth) + px(cs.paddingLeft)
        const padT = px(cs.borderTopWidth) + px(cs.paddingTop)
        const padR = px(cs.borderRightWidth) + px(cs.paddingRight)
        const padB = px(cs.borderBottomWidth) + px(cs.paddingBottom)
        const content = {
            left: ir.left - br.left - body.clientLeft + body.scrollLeft + padL,
            top: ir.top - br.top - body.clientTop + body.scrollTop + padT,
            w: ir.width - padL - padR,
            h: ir.height - padT - padB,
        }
        setImagePages([
            {
                rendered: containRect(content, natW, natH),
                nat: { w: natW, h: natH },
            },
        ])
    }
    /** The image's ref: re-measure on load and whenever it or the body resizes (a pane resize
     *  can re-centre the picture without changing its size, hence both). */
    const attachImage = (img: HTMLImageElement) => {
        const ro = new ResizeObserver(() => measureImage(img))
        ro.observe(img)
        if (bodyRef) ro.observe(bodyRef)
        onCleanup(() => ro.disconnect())
    }
    const onPdfLayout = (l: { boxes: PageBox[]; sizes: PageSize[] }) =>
        setPdfPages(
            l.boxes.map((b, i) => ({
                rendered: { left: b.left, top: b.top, w: b.w, h: b.h },
                nat: l.sizes[i] ?? { w: b.w, h: b.h },
            })),
        )

    // Matches + segmented render, only for code/text with a live query.
    const matches = createMemo(() =>
        kind() === 'code' && query()
            ? findMatches(code() ?? '', query(), caseSensitive(), MAX_MATCHES)
            : [],
    )
    const capped = () => matches().length >= MAX_MATCHES
    const segments = createMemo(() =>
        kind() === 'code' && query() && matches().length
            ? segmentText(code() ?? '', matches())
            : null,
    )

    // Reset the active match + any prior image-load failure when the file (or its text) changes
    // so stale state never lingers and a new image re-attempts its load.
    createEffect(
        on([() => props.path, code], () => {
            setActiveIndex(0)
            setImgFailed(false)
        }),
    )
    // Keep the active index in range as the query narrows the match set.
    createEffect(() => {
        if (activeIndex() >= matches().length) setActiveIndex(0)
    })
    // Scroll the active match into view whenever it (or the query) changes.
    createEffect(() => {
        activeIndex()
        segments()
        if (kind() !== 'code' || !findOpen()) return
        queueMicrotask(() =>
            codeRef
                ?.querySelector<HTMLElement>('[data-find-match][data-active]')
                ?.scrollIntoView({
                    block: 'center',
                    inline: 'nearest',
                }),
        )
    })

    const step = (dir: 1 | -1) => {
        const n = matches().length
        if (n) setActiveIndex(stepMatchIndex(activeIndex(), n, dir))
    }

    const closeFind = () => {
        setFindOpen(false)
        rootRef?.focus()
    }

    const countLabel = () => {
        if (!query()) return ''
        const n = matches().length
        if (n === 0) return 'No results'
        return `${activeIndex() + 1}/${n}${capped() ? '+' : ''}`
    }

    // Focus the input whenever the code find bar opens (element mounts after the signal flips).
    createEffect(() => {
        if (findOpen() && kind() === 'code') {
            queueMicrotask(() => {
                inputRef?.focus()
                inputRef?.select()
            })
        }
    })

    // Cmd/Ctrl+F and toggle-draw-mode on the focused preview. Capture phase + stop/preventDefault
    // so they win before App.tsx's window-level shortcut handler and (dev) the browser's native
    // find. The ink host lives inside the root, so the toggle still lands here while drawing.
    const onKey = (e: KeyboardEvent) => {
        if (e.repeat) return
        // GATED, not stopPropagation-from-the-strip: this listener is registered CAPTURE-phase
        // below (`addEventListener('keydown', onKey, true)`), which fires top-down — by the time
        // a keystroke reaches CompanionFrontmatter's CodeMirror field (a descendant of rootRef),
        // THIS handler has already run. A `stopPropagation()` inside the strip could only stop
        // the event from continuing further down/back up; it cannot undo a check that already
        // happened at this ancestor. So the strip is exempted here instead, by a `data-*` hook
        // (never a class — the hashing trap under CLAUDE.md's Styling section) on its wrapper:
        // typing (including the toggle-draw-mode / find combos, e.g. a tag literally containing
        // them) inside the tags field must always just edit text, never toggle draw mode or open
        // Find.
        if (
            (e.target as HTMLElement | null)?.closest?.(
                '[data-companion-frontmatter]',
            )
        )
            return
        if (
            inkable() &&
            matchesKeybinding(e, settings.keybindings['toggle-draw-mode'])
        ) {
            e.preventDefault()
            e.stopPropagation()
            if (drawMode()) exitDraw()
            else setDrawMode(true)
            return
        }
        if (!matchesKeybinding(e, settings.keybindings.find)) return
        const k = kind()
        if (k === 'image' || k === 'external') return // no text — graceful no-op

        e.preventDefault()
        e.stopPropagation()
        if (k === 'pdf') {
            setFindOpen(true) // no in-app PDF search yet — see the note below
            return
        }
        // code/text
        if (findOpen()) {
            inputRef?.focus()
            inputRef?.select()
        } else {
            setFindOpen(true)
        }
    }
    onMount(() => {
        rootRef?.addEventListener('keydown', onKey, true)
        onCleanup(() => rootRef?.removeEventListener('keydown', onKey, true))
        // Focus the root so Cmd+F works immediately, before any click (mirrors Editor.tsx).
        queueMicrotask(() => rootRef?.focus())
    })

    // Resolve to an absolute path (backend, filename-first) then hand off to the OS opener.
    async function openExternal(reveal: boolean) {
        try {
            const { path } = await api.absPath(props.path)
            const ok = await (reveal
                ? revealPath(path)
                : openPathInDefaultApp(path))
            if (!ok) pushToast("Couldn't open — see console")
        } catch (e) {
            pushToast(`Couldn't open: ${(e as Error).message}`)
        }
    }

    return (
        <div class={styles['preview-app']} tabindex={-1} ref={rootRef}>
            <ViewBar
                identity={<Crumb icon={HEADER_ICON[kind()]}>{name()}</Crumb>}
                config={
                    <Show when={kind() === 'pdf'}>
                        <IconButton
                            icon="ZoomOut"
                            label="Zoom out"
                            iconSize={15}
                            onClick={() => zoomBy(1 / 1.2)}
                        />
                        <Label tone="muted" class={styles['preview-pdf-zoom-label']}>
                            {`${Math.round(pdfZoom() * 100)}%`}
                        </Label>
                        <IconButton
                            icon="ZoomIn"
                            label="Zoom in"
                            iconSize={15}
                            onClick={() => zoomBy(1.2)}
                        />
                        <Button kind="text" onClick={() => setPdfZoom(1)}>
                            FIT
                        </Button>
                    </Show>
                }
                actions={
                    <>
                        <Show when={isTauri()}>
                            <IconTextButton
                                icon="ExternalLink"
                                onClick={() => void openExternal(false)}
                            >
                                OPEN IN DEFAULT APP
                            </IconTextButton>
                            <IconTextButton
                                icon="FolderOpen"
                                onClick={() => void openExternal(true)}
                            >
                                REVEAL
                            </IconTextButton>
                        </Show>
                    </>
                }
            />

            {/* Tags live on the binary's companion note (core/src/fileKinds.ts's
                companionPathFor) — image/pdf only, mounted under the ViewBar so it reads like a
                note's own frontmatter sitting above the body. `data-companion-frontmatter` is the
                RUNTIME hook onKey above gates on — see its comment for why a class can't do this
                job and stopPropagation from inside the strip wouldn't either. */}
            <Show when={inkable()}>
                <div
                    data-companion-frontmatter
                    class={styles['preview-frontmatter']}
                >
                    <CompanionFrontmatter
                        binaryPath={props.path}
                        tagNames={props.tagNames}
                    />
                </div>
            </Show>

            <div
                class={styles['preview-body']}
                ref={bodyRef}
                onWheel={e => {
                    if (kind() !== 'pdf' || !(e.ctrlKey || e.metaKey)) return
                    e.preventDefault()
                    zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08)
                }}
            >
                {/* Find bar / note, overlaid top-right of the body (never for image/external). */}
                <Show
                    when={findOpen() && (kind() === 'code' || kind() === 'pdf')}
                >
                    <Switch>
                        <Match when={kind() === 'code'}>
                            <div
                                class={styles['preview-find']}
                                onKeyDown={e => e.stopPropagation()}
                            >
                                <input
                                    ref={inputRef}
                                    class={styles['preview-find-input']}
                                    placeholder="Find"
                                    aria-label="Find in file"
                                    value={query()}
                                    onInput={e => {
                                        setActiveIndex(0)
                                        setQuery(e.currentTarget.value)
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            step(e.shiftKey ? -1 : 1)
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault()
                                            closeFind()
                                        }
                                    }}
                                />
                                <span
                                    class={styles['preview-find-count']}
                                    classList={{
                                        [styles['is-empty']]:
                                            query() !== '' &&
                                            matches().length === 0,
                                    }}
                                >
                                    {countLabel()}
                                </span>
                                <IconButton
                                    icon="ChevronUp"
                                    label="Previous match (Shift+Enter)"
                                    iconSize={15}
                                    disabled={matches().length === 0}
                                    onClick={() => {
                                        step(-1)
                                        inputRef?.focus()
                                    }}
                                />
                                <IconButton
                                    icon="ChevronDown"
                                    label="Next match (Enter)"
                                    iconSize={15}
                                    disabled={matches().length === 0}
                                    onClick={() => {
                                        step(1)
                                        inputRef?.focus()
                                    }}
                                />
                                <Button
                                    kind="text"
                                    state={
                                        caseSensitive()
                                            ? 'selected'
                                            : 'unselected'
                                    }
                                    class={styles['preview-find-case']}
                                    title="Match case"
                                    aria-label="Match case"
                                    aria-pressed={caseSensitive()}
                                    onClick={() => {
                                        setCaseSensitive(v => !v)
                                        inputRef?.focus()
                                    }}
                                >
                                    Aa
                                </Button>
                                <IconButton
                                    icon="X"
                                    label="Close (Esc)"
                                    iconSize={15}
                                    onClick={closeFind}
                                />
                            </div>
                        </Match>
                        <Match when={kind() === 'pdf'}>
                            {/* PdfPages renders pdf.js's text layer (selectable/copyable per
                                page), but there is no find-bar UI over it yet — say so plainly
                                rather than pretending to search. */}
                            <div
                                class={`${styles['preview-find']} ${styles['preview-find-note']}`}
                                onKeyDown={e => e.stopPropagation()}
                            >
                                <Icon value="Search" size={14} />
                                <span class={styles['preview-find-note-text']}>
                                    In-app PDF search isn't available yet.
                                </span>
                                <IconButton
                                    icon="X"
                                    label="Dismiss"
                                    iconSize={15}
                                    onClick={closeFind}
                                />
                            </div>
                        </Match>
                    </Switch>
                </Show>

                <Switch>
                    <Match when={kind() === 'image'}>
                        <Show
                            when={!imgFailed()}
                            fallback={
                                <div class={styles['preview-external']}>
                                    <EmptyState title="Couldn't load image">
                                        {`"${name()}" could not be displayed.`}
                                        {isTauri()
                                            ? ' Open it in its default app to view it.'
                                            : ' Open it externally to view it.'}
                                    </EmptyState>
                                    <Show when={isTauri()}>
                                        <IconTextButton
                                            icon="ExternalLink"
                                            onClick={() =>
                                                void openExternal(false)
                                            }
                                        >
                                            OPEN IN DEFAULT APP
                                        </IconTextButton>
                                    </Show>
                                </div>
                            }
                        >
                            <img
                                ref={attachImage}
                                class={styles['preview-image']}
                                src={assetUrl()}
                                alt={name()}
                                onLoad={e => measureImage(e.currentTarget)}
                                onError={() => {
                                    setImgFailed(true)
                                    setImagePages([])
                                }}
                            />
                            <Show when={imagePages().length > 0}>
                                <PageInk
                                    sidecarPath={inkSidecarFor(props.path)}
                                    pages={imagePages}
                                    active={drawMode}
                                    onExit={exitDraw}
                                />
                            </Show>
                        </Show>
                    </Match>
                    <Match when={kind() === 'pdf'}>
                        {/* One pdf.js canvas per page, fit-width by default (zoom 1), driven by
                            the ViewBar's zoom controls + Ctrl/Cmd+wheel below. */}
                        {(() => {
                            // Built ONCE and handed over by identifier. An inline
                            // `overlay={<PageInk …/>}` compiles to a GETTER that creates a new
                            // component on every read, and PdfPages reads `props.overlay` twice
                            // (its <Show when> and the insert) — two ink layers, each loading
                            // and saving the same sidecar.
                            const ink = (
                                <PageInk
                                    sidecarPath={inkSidecarFor(props.path)}
                                    pages={pdfPages}
                                    active={drawMode}
                                    onExit={exitDraw}
                                />
                            )
                            return (
                                <PdfPages
                                    load={pdfLoad()}
                                    zoom={pdfZoom()}
                                    onLayout={onPdfLayout}
                                    overlay={ink}
                                />
                            )
                        })()}
                    </Match>
                    <Match when={kind() === 'code'}>
                        <Show when={!code.loading} fallback={<Loading />}>
                            <pre
                                class={styles['preview-code']}
                                tabindex={0}
                                ref={codeRef}
                            >
                                <Show when={segments()} fallback={code() ?? ''}>
                                    <For each={segments()!}>
                                        {seg =>
                                            seg.matchIndex >= 0 ? (
                                                <mark
                                                    class={styles['preview-find-match']}
                                                    classList={{
                                                        [styles['is-active']]:
                                                            seg.matchIndex ===
                                                            activeIndex(),
                                                    }}
                                                    data-find-match
                                                    data-active={
                                                        seg.matchIndex ===
                                                        activeIndex()
                                                            ? true
                                                            : undefined
                                                    }
                                                >
                                                    {seg.text}
                                                </mark>
                                            ) : (
                                                seg.text
                                            )
                                        }
                                    </For>
                                </Show>
                            </pre>
                        </Show>
                    </Match>
                    <Match when={kind() === 'external'}>
                        <div class={styles['preview-external']}>
                            <EmptyState title="Preview not available">
                                {`This ${extLabel(name())} file can't be previewed here.`}
                                {isTauri()
                                    ? ' Open it in its default app to view or edit it.'
                                    : ' Open it externally to view or edit it.'}
                            </EmptyState>
                            <Show when={isTauri()}>
                                <IconTextButton
                                    icon="ExternalLink"
                                    onClick={() => void openExternal(false)}
                                >
                                    OPEN IN DEFAULT APP
                                </IconTextButton>
                            </Show>
                        </div>
                    </Match>
                </Switch>
            </div>
        </div>
    )
}

/** Uppercased extension for the "This .PSD file …" copy, or "binary" when there's none. */
function extLabel(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot > 0 ? `.${name.slice(dot + 1).toUpperCase()}` : 'binary'
}
