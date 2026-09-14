// app/src/preview/CompanionFrontmatter.tsx
// The tag-carrying companion note's frontmatter strip, mounted under PreviewView's ViewBar for
// image + pdf kinds (plan "Design": tags for a binary live in its companion note `<file>.md`
// — core/src/fileKinds.ts's companionPathFor — created lazily, only once the user actually
// writes something). Reads/writes the RAW frontmatter block via ui/MarkdownField — whose
// livePreview extension already renders `---` fences like a note's own frontmatter — inside the
// compact ui/Frontmatter accent-edge panel, built on companionDoc.ts's pure split/join so a
// body the user wrote into the companion by hand is never disturbed.
//
// PERSISTENCE: debounced (settings.editor.autoSaveDelay, same knob Editor.tsx's autosave reads)
// api.writeChecked against the last-known disk text. A conflict — someone else wrote the
// companion between our read and our write — is handled the way #46 handles it for the note
// editor in SPIRIT (never silently clobber a concurrent edit), but not its full three-way merge:
// for a couple of tags, reloading from disk and toasting is the right amount of machinery.
//
// TAG AUTOCOMPLETE: `tagNames` is accepted per the task interface, but ui/MarkdownField builds
// its CodeMirror extensions entirely internally with no prop to append a completion source, and
// widening that shared primitive (house rule: one component, one set of assumptions, reviewed
// against every OTHER caller) is out of scope here — REPORTED rather than done, see the task
// report.
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import { api } from '../api'
import { companionPathFor } from '../../../core/src/fileKinds'
import {
    EMPTY_FRONTMATTER,
    joinCompanion,
    shouldWriteCompanion,
    splitCompanion,
} from './companionDoc'
import Frontmatter from '../ui/Frontmatter'
import MarkdownField from '../ui/MarkdownField'
import { pushToast } from '../Toast'
import { settings } from '../settings'
import { registerSidecarFlush } from '../editorRegistry'
import styles from './CompanionFrontmatter.module.css'

export type CompanionFrontmatterProps = {
    /** The binary's own path (an image or PDF) — never the companion path itself. */
    binaryPath: string
    tagNames: () => string[]
    class?: string
}

function CompanionFrontmatter(props: CompanionFrontmatterProps) {
    const [frontmatterText, setFrontmatterText] =
        createSignal(EMPTY_FRONTMATTER)
    // Gates the first paint until the companion has actually been read once, so a companion that
    // already carries tags never flashes the empty template first.
    const [ready, setReady] = createSignal(false)

    let companionPath = ''
    let existingRaw = ''
    let body = ''
    let dirty = false
    let loadToken = 0
    let saveTimer: ReturnType<typeof setTimeout> | undefined

    // Returns a Promise so it can be AWAITED — both by FileTree's flush-before-move/delete
    // protocol (registered below via registerSidecarFlush) and this component's own cleanup —
    // rather than merely scheduled. A caller awaiting this is guaranteed the write has actually
    // landed (or definitively failed) before it proceeds, not just that one was kicked off.
    const flushSave = (): Promise<void> => {
        clearTimeout(saveTimer)
        saveTimer = undefined
        if (!dirty) return Promise.resolve()
        dirty = false
        const path = companionPath
        const token = loadToken
        const next = frontmatterText()
        if (!shouldWriteCompanion(existingRaw, next)) return Promise.resolve()
        const baseText = existingRaw
        const joined = joinCompanion(next, body)
        return api.writeChecked(path, joined, baseText).then(
            res => {
                if (token !== loadToken) return // a different binary loaded meanwhile
                if (res.conflict) {
                    existingRaw = res.current
                    const split = splitCompanion(res.current)
                    body = split.body
                    setFrontmatterText(split.frontmatter || EMPTY_FRONTMATTER)
                    pushToast(
                        `${path.split('/').pop()} changed elsewhere — reloaded its tags.`,
                    )
                    return
                }
                existingRaw = joined
            },
            (e: unknown) => {
                if (token !== loadToken) return
                dirty = true // the edit is still live in the field — retry on the next debounce
                pushToast(`Couldn't save tags: ${(e as Error).message}`)
            },
        )
    }
    const scheduleSave = () => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(flushSave, settings.editor.autoSaveDelay)
    }

    createEffect(
        on(
            () => props.binaryPath,
            binaryPath => {
                const token = ++loadToken
                companionPath = companionPathFor(binaryPath)
                dirty = false
                setReady(false)
                api.read(companionPath).then(
                    text => {
                        if (token !== loadToken) return
                        existingRaw = text
                        const split = splitCompanion(text)
                        body = split.body
                        setFrontmatterText(
                            split.frontmatter || EMPTY_FRONTMATTER,
                        )
                        setReady(true)
                    },
                    () => {
                        if (token !== loadToken) return
                        existingRaw = ''
                        body = ''
                        setFrontmatterText(EMPTY_FRONTMATTER)
                        setReady(true)
                    },
                )
                // Register this binary's flush with the global registry so FileTree's
                // flush-before-move/delete protocol (flushSidecarsAtOrUnder) can find and await
                // it — this writer has no EditorView, so it takes no part in the CodeMirror-only
                // flushers above otherwise (chunk-1 review).
                const unregister = registerSidecarFlush(binaryPath, flushSave)
                // Flush the OLD path's pending edit (if any) before switching to the new one, and
                // on unmount — mirrors preview/PageInk.tsx's debounce lifecycle. Unregister AFTER
                // the flush settles (not before), so a flush FileTree triggers mid-teardown can
                // still find this entry.
                onCleanup(() => {
                    void flushSave().then(unregister)
                })
            },
        ),
    )

    // Every other way a debounce window can end badly (PageInk's list, minus the pane-focus
    // specifics — this field has no separate "draw mode" to exit).
    createEffect(() => {
        window.addEventListener('blur', flushSave)
        window.addEventListener('beforeunload', flushSave)
        window.addEventListener('pagehide', flushSave)
        onCleanup(() => {
            window.removeEventListener('blur', flushSave)
            window.removeEventListener('beforeunload', flushSave)
            window.removeEventListener('pagehide', flushSave)
        })
    })

    const onInput = (value: string) => {
        setFrontmatterText(value)
        dirty = true
        scheduleSave()
    }

    return (
        <Show when={ready()}>
            <Frontmatter
                class={[styles['companion-frontmatter'], props.class]
                    .filter(Boolean)
                    .join(' ')}
            >
                <MarkdownField
                    value={frontmatterText()}
                    onInput={onInput}
                    class={styles['companion-frontmatter-field']}
                />
            </Frontmatter>
        </Show>
    )
}

export default CompanionFrontmatter
