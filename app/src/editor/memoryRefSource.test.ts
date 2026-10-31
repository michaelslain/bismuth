// app/src/editor/memoryRefSource.test.ts
//
// Pins the `~slug` MEMORY REFERENCE contract — the 3rd-brain twin of the `[[wikilink]]` picker:
//   • typing `~` + a letter opens a memory autocomplete (the way `[[` opens the note picker)
//   • picking one inserts `~slug`, which PERSISTS in the saved markdown
//   • daemon disabled → no memory notes → no picker (and no crash)
//   • a bare `~` opens nothing, so Enter after it is still a newline
//
// These run the REAL CompletionSource against a real EditorState + CompletionContext (not a
// re-implementation), so a regression in matchMemoryRefPrefix, the option assembly, or the apply
// handler fails here. The note editor and the chat composer both consume this exact source through
// `vaultCompletion()` → `markdownEditingExtensions`, so one test covers BOTH surfaces.
//
// The Enter behaviour is proved on a MOUNTED EditorView (happy-dom), because it is about keymap
// precedence against CodeMirror's own Enter→acceptCompletion binding — something only a real
// dispatched keydown can demonstrate.
import { GlobalWindow } from 'happy-dom'
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { EditorState } from '@codemirror/state'
import {
    CompletionContext,
    type CompletionResult,
    startCompletion,
    completionStatus,
} from '@codemirror/autocomplete'
import { memoryRefSource, vaultCompletion } from './autocomplete'
import type { MemoryCandidate } from '../../../core/src/memoryRef'

const MEMORIES: MemoryCandidate[] = [
    { label: 'cron-run-preference', slug: 'cron-run-preference' },
    { label: 'push-after-commit', slug: 'push-after-commit' },
    { label: 'note', slug: 'sub/dir/note' },
]

/** Run the memory source with the caret at the end of `doc`. The source is synchronous. */
function run(
    doc: string,
    memories: MemoryCandidate[] = MEMORIES,
): CompletionResult | null {
    const state = EditorState.create({ doc })
    const ctx = new CompletionContext(state, doc.length, false)
    return memoryRefSource(() => memories)(ctx) as CompletionResult | null
}

const labels = (r: CompletionResult | null): string[] =>
    r ? r.options.map(o => String(o.label)) : []

describe('memoryRefSource — `~` + a letter opens the memory picker', () => {
    test('`~c` lists the memory notes matching what was typed', () => {
        expect(labels(run('~c'))).toContain('cron-run-preference')
    })

    test('a bare `~` opens nothing — it is common punctuation', () => {
        expect(run('~')).toBeNull()
        expect(run('about ~')).toBeNull()
    })

    test('the popup is anchored just past the `~`, so the `~` itself survives the pick', () => {
        // doc "see ~cr" → `~` at 4, so the replaced range starts at 5. This is what makes the
        // saved text `~slug` rather than `slug`.
        expect(run('see ~cr')?.from).toBe(5)
    })

    test('fires mid-prose after whitespace', () => {
        expect(labels(run('as noted in ~cron'))).toContain(
            'cron-run-preference',
        )
    })

    test('stays shut for `~5`, `~/path`, `~~strike` and a glued `a~b`', () => {
        expect(run('~5')).toBeNull()
        expect(run('cd ~/Doc')).toBeNull()
        expect(run('~~str')).toBeNull()
        expect(run('a~b')).toBeNull()
    })

    test('does not fire inside a code span (a `~` in code is literal)', () => {
        expect(run('`a ~b')).toBeNull()
    })

    test('a subfoldered memory note shows its rel path as detail; a flat one shows none', () => {
        const opts = run('~n')!.options
        expect(opts.find(o => o.label === 'note')?.detail).toBe('sub/dir/note')
        const all = run('~c')!.options
        expect(
            all.find(o => o.label === 'cron-run-preference')?.detail,
        ).toBeUndefined()
    })
})

describe('memoryRefSource — daemon disabled', () => {
    test('no memory notes → NO picker at all (no crash, no empty popup)', () => {
        // Daemon off → the server builds no `.daemon/memory` graph nodes → App passes zero candidates.
        // `prefixSource` returns a result with an empty option list, which CM renders as no popup.
        expect(labels(run('~c', []))).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// Mounted-view proof of what Enter does around the `~` picker.
// ---------------------------------------------------------------------------------------------

// Same install/restore discipline as tableWidget.test.ts / graphBlock.test.ts: install ONLY the
// globals that are missing, remember exactly which, and DELETE exactly those afterwards. Two rules
// matter, because every `bun test app` file shares one process:
//   • install-if-absent — never clobber a global another file installed;
//   • delete (not "restore to undefined") — assigning undefined leaves the key PRESENT, which makes
//     the other DOM test files' own `!(key in globalThis)` guard skip their install and then blow up
//     on `document.createElement`. That is a real regression this file caused before it followed the
//     house pattern.
// The window is built inside beforeAll (never at module scope) so importing this file has no side
// effect on the intentionally-headless test files.
const DOM_GLOBALS = [
    'document',
    'window',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'Text',
    'DocumentFragment',
    'MutationObserver',
    'Range',
    'NodeFilter',
    'DOMParser',
    'HTMLDivElement',
    'HTMLSpanElement',
    'DOMRect',
    'ResizeObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'getSelection',
    'Selection',
]
// happy-dom's dispatchEvent instanceof-checks against ITS OWN Event class, so the Enter keydown we
// construct must be happy-dom's, not bun's built-in. Force the family for this file, saving +
// restoring the originals so we don't pollute other files.
const EVENT_CLASSES = ['Event', 'CustomEvent', 'KeyboardEvent']
const installed: string[] = []
const savedEventClasses: Record<string, unknown> = {}
let win: GlobalWindow

beforeAll(() => {
    win = new GlobalWindow()
    for (const key of DOM_GLOBALS) {
        if (!(key in globalThis) && key in win) {
            ;(globalThis as Record<string, unknown>)[key] = (
                win as unknown as Record<string, unknown>
            )[key]
            installed.push(key)
        }
    }
    for (const k of EVENT_CLASSES) {
        if (k in win) {
            savedEventClasses[k] = (globalThis as Record<string, unknown>)[k]
            ;(globalThis as Record<string, unknown>)[k] = (
                win as unknown as Record<string, unknown>
            )[k]
        }
    }
})

afterAll(() => {
    for (const k of installed) delete (globalThis as Record<string, unknown>)[k]
    for (const k of Object.keys(savedEventClasses)) {
        if (savedEventClasses[k] === undefined)
            delete (globalThis as Record<string, unknown>)[k]
        else (globalThis as Record<string, unknown>)[k] = savedEventClasses[k]
    }
})

describe('Enter with the `~` picker', () => {
    // Lazily imported AFTER the DOM globals are installed — EditorView touches `document` at import.
    async function mount(doc: string) {
        const { EditorView, keymap } = await import('@codemirror/view')
        const { insertNewlineAndIndent } = await import('@codemirror/commands')
        const parent = document.createElement('div')
        document.body.appendChild(parent)
        const view = new EditorView({
            parent,
            state: EditorState.create({
                doc,
                selection: { anchor: doc.length },
                extensions: [
                    vaultCompletion({
                        getNotes: () => [],
                        getMemories: () => MEMORIES,
                        getTags: () => [],
                        getSchema: () => ({}),
                        getIconNames: () => [],
                        inFrontmatter: () => false,
                        readNote: async () => '',
                    }),
                    // Stands in for the note editor's `enterKeymap` (the normal-precedence Enter handler
                    // that runs when no picker takes the key).
                    keymap.of([{ key: 'Enter', run: insertNewlineAndIndent }]),
                ],
            }),
        })
        return view
    }

    /** Dispatch a real Enter keydown at the contentDOM, the way CodeMirror's keymap receives it. */
    const pressEnter = (view: { contentDOM: HTMLElement }) =>
        view.contentDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                bubbles: true,
                cancelable: true,
            }),
        )

    /** Open the picker and BLOCK until it is really `active` AND accepting input. Two real CodeMirror
     *  timings make a naive test lie:
     *    1. the completion pass is debounced (~50ms) — press Enter while it's still `pending` and the
     *       newline falls through, so an "Enter accepts" assertion fails for the WRONG reason.
     *       Asserting `active` makes that failure mode impossible.
     *    2. `acceptCompletion` IGNORES Enter within `interactionDelay` (75ms) of the popup opening —
     *       an anti-misfire guard. Settle past it so "Enter accepts" is testable at all.
     *  Both are harness concerns only; a human is never this fast. */
    async function openPickerAndWait(
        view: Parameters<typeof startCompletion>[0],
    ) {
        startCompletion(view)
        for (
            let i = 0;
            i < 100 && completionStatus(view.state) !== 'active';
            i++
        ) {
            await new Promise(r => setTimeout(r, 10))
        }
        expect(completionStatus(view.state)).toBe('active')
        await new Promise(r => setTimeout(r, 90)) // clear CM's 75ms interactionDelay
    }

    test('Enter after a bare `~` inserts a NEWLINE — no picker opens to take it', async () => {
        const view = await mount('about ~')
        startCompletion(view)
        await new Promise(r => setTimeout(r, 150))
        expect(completionStatus(view.state)).not.toBe('active')
        pressEnter(view)
        expect(view.state.doc.toString()).toBe('about ~\n')
        view.destroy()
    })

    test('Enter on a `~query` line accepts the completion, inserting `~slug`', async () => {
        const view = await mount('front\n~cron')
        await openPickerAndWait(view)
        pressEnter(view)
        // The `~` is preserved (the popup replaces only the slug), so the persisted text is `~slug`.
        expect(view.state.doc.toString()).toBe('front\n~cron-run-preference')
        view.destroy()
    })
})
