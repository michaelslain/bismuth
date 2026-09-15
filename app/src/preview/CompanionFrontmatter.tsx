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
// scratch-note blocks (task 2's ScratchTextLayer), so a save from either never drops the other's
// content. This component just reads `store.frontmatter()`/calls `store.setFrontmatter` — same
// "use the caller's store, or make one" pattern as PageInk.tsx's `props.store ?? createAnnotation
// Store(...)`. MarkdownField's `value` is fully reactive (it syncs an out-of-band change into its
// own doc, see its own header), so no extra re-seed keying is needed here — `store.revision` only
// matters to seed-only fields, i.e. task 2's per-block editors.
//
// TAG AUTOCOMPLETE: `tagNames` is accepted per the task interface, but ui/MarkdownField builds
// its CodeMirror extensions entirely internally with no prop to append a completion source, and
// widening that shared primitive (house rule: one component, one set of assumptions, reviewed
// against every OTHER caller) is out of scope here — REPORTED rather than done, see the task
// report.
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
