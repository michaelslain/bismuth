// app/src/editor/settingsKeymap.test.ts
//
// Mounts a REAL happy-dom-backed EditorView and dispatches real KeyboardEvents at
// view.contentDOM — same pattern as app/src/editor/undoRedoScroll.test.ts.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { GlobalWindow } from 'happy-dom'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { setSettings, DEFAULTS } from '../settings'

// toCmKeys (app/src/keybindings.ts) is Task 1's addition, landing in a parallel
// worktree, and does not exist in THIS worktree yet — see task-3-brief.md.
// settingsKeymap.ts imports the REAL, unmodified name (`import { toCmKeys } from
// '../keybindings'`), which is what makes `bun run typecheck` fail on that one
// import until Task 1 merges (expected, reported separately — not worked around
// here or in app/src/keybindings.ts, which belongs to Task 1).
//
// For THIS file's own run to go green today, `mock.module` stands in a minimal
// local double for the slice of toCmKeys's documented contract these tests
// exercise (letter-key combos, comma-alternatives, empty → unbind). It is not a
// copy of Task 1's real parsing/validation logic — e.g. it does not replicate
// "garbage" rejection. A dynamic `await import('./settingsKeymap')` (rather than
// a static top-level import) is required so the mock is registered in the module
// registry before settingsKeymap.ts's own static `import { toCmKeys } from
// '../keybindings'` is resolved — the same pattern app/src/editor/keepaliveSave.test.ts
// already uses in this repo for a different mocked dependency.
mock.module('../keybindings', () => ({
    toCmKeys: (setting: string | undefined | null): string[] => {
        if (!setting) return []
        return setting
            .split(',')
            .map(part => part.trim())
            .filter(part => part.length > 0)
            .map(combo => {
                const tokens = combo
                    .split('+')
                    .map(t => t.trim())
                    .filter(Boolean)
                const key = tokens[tokens.length - 1]
                const mods = tokens.slice(0, -1)
                return [
                    ...mods,
                    key.length === 1 ? key.toLowerCase() : key,
                ].join('-')
            })
    },
}))

// Separately-discovered environment gap (not this task's to fix — see the report's
// "Found, not acted on"): under `bun test`, Bun's default "node" export condition
// resolves the bare `solid-js` package to its SSR build
// (node_modules/solid-js/dist/server.js), whose createEffect is a hard no-op —
// `function createEffect(fn, value) {}`, verified by reading that file directly.
// settingsKeymapCompartment's `attach` is entirely built on createEffect, so with
// the REAL solid-js this test's reconfigure would never observably happen (not
// even once) — indistinguishable, from inside `bun test`, from `attach` doing
// nothing at all. app/src/graph/EmbeddedGraph.test.ts documents the sibling case
// of this same resolution gap for `solid-js/web`'s `render()`.
//
// settingsKeymap.ts's only solid-js import is `createEffect`, so this double
// overrides just that export: it runs the effect body immediately (mirroring a
// real effect's first run) and records it so the test can manually re-invoke the
// SAME closure `attach` registered — standing in for the dependency-triggered
// re-run genuine Solid reactivity performs in a real browser build. This exercises
// attach's actual production code (the closure that reads settings + reconfigures
// the compartment), not a re-implementation of it.
const effectRuns: Array<() => void> = []
mock.module('solid-js', () => ({
    createEffect: (fn: () => void) => {
        effectRuns.push(fn)
        fn()
    },
}))

const { buildSettingsKeymap, settingsKeymapCompartment } =
    await import('./settingsKeymap')

// Same pattern as undoRedoScroll.test.ts: install happy-dom's globals ONLY for this
// file's tests (beforeAll) and remove exactly what we added (afterAll) so a leaked
// global DOM can't affect other (intentionally headless) test files loaded in the
// same `bun test app` process.
const DOM_GLOBALS = [
    'document',
    'window',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'Text',
    'DocumentFragment',
    'Event',
    'CustomEvent',
    'InputEvent',
    'KeyboardEvent',
    'MouseEvent',
    'DOMParser',
    'XMLSerializer',
    'getComputedStyle',
    'MutationObserver',
    'Range',
    'NodeFilter',
    'HTMLDivElement',
    'HTMLSpanElement',
    'DOMRect',
]
const installed: string[] = []

beforeAll(() => {
    const win = new GlobalWindow()
    for (const key of DOM_GLOBALS) {
        if (!(key in globalThis) && key in win) {
            ;(globalThis as Record<string, unknown>)[key] = (
                win as unknown as Record<string, unknown>
            )[key]
            installed.push(key)
        }
    }
    if (!('window' in globalThis)) {
        ;(globalThis as Record<string, unknown>).window = win
        installed.push('window')
    }
})

afterAll(() => {
    for (const key of installed)
        delete (globalThis as Record<string, unknown>)[key]
    installed.length = 0
})

function mountView(doc: string, extensions: Extension[]): EditorView {
    return new EditorView({
        state: EditorState.create({ doc, extensions }),
    })
}

// Dispatches a real KeyboardEvent for `Mod+<key>` (metaKey, matching the "Mod-x"
// combos undoRedoScroll.test.ts already proves resolve correctly in this exact
// happy-dom harness) and returns whether it was handled.
function pressMod(view: EditorView, key: string): boolean {
    const e = new KeyboardEvent('keydown', {
        key,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        bubbles: true,
        cancelable: true,
    })
    view.contentDOM.dispatchEvent(e)
    return e.defaultPrevented
}

describe('buildSettingsKeymap', () => {
    afterAll(() => {
        // Leave the shared settings store as we found it — bun test app runs every
        // workspace test file in one process, so a leftover mutation here would be
        // visible to any later file that also reads these ids.
        setSettings('keybindings', 'find', DEFAULTS.keybindings.find)
        setSettings('keybindings', 'terminal', DEFAULTS.keybindings.terminal)
        setSettings('keybindings', 'new-tab', DEFAULTS.keybindings['new-tab'])
    })

    test('runs the bound command for the combo the setting holds, and not for one it does not', () => {
        setSettings('keybindings', 'find', 'Mod+K')
        const calls: string[] = []
        const view = mountView('hello', [
            buildSettingsKeymap([
                {
                    id: 'find',
                    run: () => {
                        calls.push('find')
                        return true
                    },
                },
            ]),
        ])

        expect(pressMod(view, 'k')).toBe(true)
        expect(calls).toEqual(['find'])

        // A combo the setting does NOT hold must not run the command.
        expect(pressMod(view, 'l')).toBe(false)
        expect(calls).toEqual(['find'])
    })

    test('a comma-alternatives setting produces one working binding per alternative', () => {
        setSettings('keybindings', 'terminal', 'Mod+J, Mod+P')
        const calls: string[] = []
        const view = mountView('hello', [
            buildSettingsKeymap([
                {
                    id: 'terminal',
                    run: () => {
                        calls.push('terminal')
                        return true
                    },
                },
            ]),
        ])

        expect(pressMod(view, 'j')).toBe(true)
        expect(pressMod(view, 'p')).toBe(true)
        expect(calls).toEqual(['terminal', 'terminal'])
    })

    test('an empty setting is a deliberate unbind — it contributes no CM binding at all', () => {
        setSettings('keybindings', 'new-tab', '')
        const calls: string[] = []
        const view = mountView('hello', [
            buildSettingsKeymap([
                {
                    id: 'new-tab',
                    run: () => {
                        calls.push('new-tab')
                        return true
                    },
                },
            ]),
        ])

        expect(pressMod(view, 't')).toBe(false)
        expect(calls).toEqual([])
    })
})

describe('settingsKeymapCompartment', () => {
    afterAll(() => {
        setSettings('keybindings', 'zoom-in', DEFAULTS.keybindings['zoom-in'])
    })

    test('reconfiguring after a setting change swaps which combo fires, without rebuilding the EditorView', () => {
        setSettings('keybindings', 'zoom-in', 'Mod+I')
        const calls: string[] = []
        const { extension, attach } = settingsKeymapCompartment([
            {
                id: 'zoom-in',
                run: () => {
                    calls.push('zoom-in')
                    return true
                },
            },
        ])

        const view = mountView('hello world', [extension])
        const viewBefore = view
        const docBefore = view.state.doc.toString()

        // Real usage calls attach(view) once inside a Solid component's owner; our
        // mocked createEffect (see the module-level comment above) ignores owner
        // and just runs + records the effect body, so no createRoot wrap is needed
        // here to exercise it.
        attach(view)

        expect(pressMod(view, 'i')).toBe(true)
        expect(calls).toEqual(['zoom-in'])

        setSettings('keybindings', 'zoom-in', 'Mod+O')
        // Stand in for the automatic re-run a real Solid effect performs when one
        // of its tracked settings.keybindings reads changes (blocked here — see
        // above): manually re-invoke the SAME closure attach registered.
        effectRuns.forEach(fn => fn())

        // The OLD combo must stop firing — proving this, not merely that the new
        // combo works, is the point: a helper that rebuilds the view on every
        // reconfigure could still make the NEW combo work while accidentally
        // leaving the old binding registered too (e.g. by recreating the view with
        // BOTH the old and new extension state momentarily present).
        expect(pressMod(view, 'i')).toBe(false)
        expect(calls).toEqual(['zoom-in'])

        expect(pressMod(view, 'o')).toBe(true)
        expect(calls).toEqual(['zoom-in', 'zoom-in'])

        // No rebuild: same EditorView instance, same doc content throughout.
        expect(view).toBe(viewBefore)
        expect(view.state.doc.toString()).toBe(docBefore)
    })
})
