// app/src/preview/CompanionFrontmatter.tsx
// The tag-carrying companion note's frontmatter strip, mounted under PreviewView's ViewBar for
// image + pdf kinds (plan "Design": tags for a binary live in its companion note `<file>.md`
// — core/src/fileKinds.ts's companionPathFor — created lazily, only once the user actually
// writes something). Reads/writes the RAW frontmatter block via ui/MarkdownField — whose
// livePreview extension already renders `---` fences like a note's own frontmatter.
//
// NOTE-IDENTICAL BY RULING (Task 1): note frontmatter is FLAT — no left accent bar, no radius
// (livePreview.ts's own `.cm-block-top`/`.cm-block-mid`/`.cm-block-bottom` chrome, ~1780-1850, is
// the source of truth). `ui/Frontmatter` (the accent-edge panel primitive used by Card/Callout)
// was the wrong shape for this and has been dropped — this component now renders its own flat
// root and matches the note editor directly via CompanionFrontmatter.module.css, never restyling
// livePreview's own rules.
//
// PERSISTENCE lives in createCompanionStore.ts (annotationTypes.ts's CompanionStore) — the ONE
// owner of the companion's read/debounced-write/conflict-reload for both this strip and the
// scratch-note blocks (ScratchTextLayer), so a save from either never drops the other's content.
// This component just reads `store.frontmatter()`/calls `store.setFrontmatter` — same "use the
// caller's store, or make one" pattern as PageInk.tsx's `props.store ?? createAnnotationStore(...)`.
// MarkdownField's `value` is fully reactive (it syncs an out-of-band change into its own doc, see
// its own header), so no extra re-seed keying is needed here — `store.revision` only matters to
// seed-only fields, i.e. ScratchTextLayer's per-block editors.
//
// TAG AUTOCOMPLETE: `tagNames` is accepted but deliberately NOT forwarded to MarkdownField (which
// does now take a `tagNames` prop). This field edits a RAW frontmatter block, and MarkdownField
// hardcodes `inFrontmatter: () => false`, so the shared stack's frontmatter-aware sources
// (property keys, enum values, the `tags:` list) never fire here — only the BODY `#tag` source
// would, popping a tag menu on YAML's comment character. Forwarding it needs an `inFrontmatter`
// seam on MarkdownField first.
//
// FOLD: unremembered/local unless `props.foldKey` is passed, in which case fold state is kept in
// frontmatterFold.ts's module-level Map for the session (a tab switch keeps it, a full reload
// does not — same ruling pdfViewMemory.ts documents). The Map holds no signal of its own, so
// `foldVersion` is bumped on every toggle to force `folded()` to re-read it; `folded()` also
// re-reads automatically when `props.foldKey` itself changes, since it is read inside the memo.
import { createSignal, Show } from 'solid-js'
import createCompanionStore from './createCompanionStore'
import type { CompanionStore } from './annotationTypes'
import { isFrontmatterFolded, setFrontmatterFolded } from './frontmatterFold'
import FoldedFence from './FoldedFence'
import IconButton from '../ui/IconButton'
import MarkdownField from '../ui/MarkdownField'
import styles from './CompanionFrontmatter.module.css'

export type CompanionFrontmatterProps = {
    /** An already-owned companion store (e.g. PreviewView also drives scratch-note blocks off
     *  it) — see PageInk.tsx's identical `store?` pattern. */
    store?: CompanionStore
    /** The binary's own path (an image or PDF) — never the companion path itself. Used only
     *  when `store` is absent: the component then calls createCompanionStore itself. */
    binaryPath?: string
    tagNames: () => string[]
    /** Remember the strip's fold state under this key for the session; absent = local,
     *  unremembered, starts open. */
    foldKey?: string
    class?: string
}

function CompanionFrontmatter(props: CompanionFrontmatterProps) {
    const store: CompanionStore =
        props.store ?? createCompanionStore(() => props.binaryPath ?? '')

    const [localFolded, setLocalFolded] = createSignal(false)
    const [foldVersion, bump] = createSignal(0)
    const folded = () =>
        props.foldKey
            ? foldVersion() >= 0 && isFrontmatterFolded(props.foldKey)
            : localFolded()
    const toggle = () => {
        const next = !folded()
        if (props.foldKey) {
            setFrontmatterFolded(props.foldKey, next)
            bump(v => v + 1)
        } else {
            setLocalFolded(next)
        }
    }

    const onInput = (value: string) => {
        store.setFrontmatter(value)
    }

    return (
        // A failed read (403, network error) never renders an editable field — writing through
        // it would risk clobbering a file this session never actually saw (createCompanionStore
        // .ts's flushSave refuses those writes outright; hiding the field keeps the UI from lying
        // about being able to persist an edit).
        <Show when={store.loadState() === 'ready'}>
            <div
                class={[styles['companion-frontmatter'], props.class]
                    .filter(Boolean)
                    .join(' ')}
                data-folded={folded() ? '' : undefined}
            >
                <IconButton
                    class={styles.chevron}
                    icon={folded() ? 'ChevronRight' : 'ChevronDown'}
                    label={folded() ? 'unfold frontmatter' : 'fold frontmatter'}
                    aria-expanded={!folded()}
                    onClick={toggle}
                />
                <Show when={folded()}>
                    <FoldedFence />
                </Show>
                <div class={styles.field}>
                    <MarkdownField value={store.frontmatter()} onInput={onInput} />
                </div>
            </div>
        </Show>
    )
}

export default CompanionFrontmatter
