// app/src/preview/CompanionFrontmatter.tsx
// The tag-carrying companion note's frontmatter strip, mounted under PreviewView's ViewBar for
// image + pdf kinds (plan "Design": tags for a binary live in its companion note `<file>.md`
// — core/src/fileKinds.ts's companionPathFor — created lazily, only once the user actually
// writes something). Reads/writes the RAW frontmatter block via ui/MarkdownField — whose
// livePreview extension already renders `---` fences like a note's own frontmatter — inside the
// compact ui/Frontmatter accent-edge panel.
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
import { Show } from 'solid-js'
import createCompanionStore from './createCompanionStore'
import type { CompanionStore } from './annotationTypes'
import Frontmatter from '../ui/Frontmatter'
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

    const onInput = (value: string) => {
        store.setFrontmatter(value)
    }

    return (
        // A failed read (403, network error) never renders an editable field — writing through
        // it would risk clobbering a file this session never actually saw (createCompanionStore
        // .ts's flushSave refuses those writes outright; hiding the field keeps the UI from lying
        // about being able to persist an edit).
        <Show when={store.loadState() === 'ready'}>
            <Frontmatter
                class={[styles['companion-frontmatter'], props.class]
                    .filter(Boolean)
                    .join(' ')}
            >
                <MarkdownField
                    value={store.frontmatter()}
                    onInput={onInput}
                    class={styles['companion-frontmatter-field']}
                />
            </Frontmatter>
        </Show>
    )
}

export default CompanionFrontmatter
