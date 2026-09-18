// app/src/keybindingCoverage.test.ts
// Guards the invariant this whole plan exists to establish: every app-level keyboard shortcut
// is a KEYBINDING_CATALOG id read from settings.keybindings, not a literal typed into a handler.
// Greps app/src (excluding *.test.*, *.stories.*) for the two shapes a hardcoded shortcut takes:
//   1. `key: '<literal>'` inside a CodeMirror `keymap.of([...])` array
//   2. `e.key === '<literal>'` / `e.code === '<literal>'` (also `ev.`, the only two identifier
//      names a KeyboardEvent parameter is given anywhere in this codebase — see the file survey
//      this test's allow-list is built from) in a plain DOM keydown handler
// A file with either shape must be in ALLOWED_FILES below, with a one-line reason. A new file
// that hardcodes a key fails this test with a message naming the file and pointing at
// KEYBINDING_CATALOG (core/src/keybindings.ts) instead of at this test.
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const APP_SRC = join(import.meta.dir)

type AllowEntry = {
    /** Path relative to app/src. */
    file: string
    /** Why every literal in this file is a deliberate decision, not an oversight. */
    reason: string
}

// Every file that legitimately hardcodes a key, and why. Do NOT add a file here just to make
// the test pass — if a literal looks like a genuine app command nobody wired to the catalog,
// report it (see docs/settings/keybindings.md + the task-12 report) instead of allow-listing it.
const ALLOWED_FILES: AllowEntry[] = [
    {
        file: 'ui/widgetKeys.ts',
        reason: 'the shared ui-dismiss/ui-confirm matcher itself — literals here ARE the implementation, quoted only in a comment describing what it replaces',
    },
    {
        file: 'keybindings.ts',
        reason: 'the combo grammar + matcher module itself (KEY_ALIASES, CODE_KEYS, CM_KEY_NAMES) — these tables are the implementation, not app shortcuts',
    },
    {
        file: 'App.tsx',
        reason: 'the secret reset combo (Mod+Ctrl+Alt+Shift+R, matched via e.code === "KeyR") is deliberately undiscoverable — putting it in .settings defeats its only purpose; plus a backup Escape guard for the Cmd+O switcher gated on switcherOpen(), mirroring SwitcherBar’s own dismiss so it still works if focus left the input',
    },
    {
        file: 'ChatComposer.tsx',
        reason: 'ArrowUp/ArrowDown here only probe CodeMirror caret position (atTop/atBottom via moveVertically) to feed chatComposerKeys.ts — the actual chat-history-prev/next dispatch is matchesKeybinding-driven there, not here (see the doc comment on onKeyDown in this file)',
    },
    {
        file: 'chatComposerKeys.ts',
        reason: "the chat composer's slash-popover branch — its own navigation keymap, which must keep owning those keys first, same as the CM completion popup",
    },
    {
        file: 'ContextMenu.tsx',
        reason: "submenu ArrowLeft/ArrowRight — arrow-key navigation inside a menu is the surface's spatial contract, not a named command",
    },
    {
        file: 'ui/Select.tsx',
        reason: 'ArrowDown/Enter/Space open the closed trigger (mirrors native <select>); once open, nav is delegated to ui/popover/createMenuNav.ts — the same list-navigation spatial contract as every other menu',
    },
    {
        file: 'ui/gallery/SymbolGallery.tsx',
        reason: 'grid arrow-key navigation + Enter-to-pick inside the symbol gallery — the spatial contract of a gallery grid',
    },
    {
        file: 'intro/VaultIntro.tsx',
        reason: "ArrowLeft/ArrowRight paging through the intro slides — a pager's spatial contract",
    },
    {
        file: 'palette/SwitcherBar.tsx',
        reason: 'Enter routing (planSwitcherEnter) commits the highlighted row or runs ask-ai — part of the switcher list\'s own createMenuNav-style contract, not an independently rebindable command',
    },
    {
        file: 'calendar/taskChipKeys.ts',
        reason: "a task chip's own interaction grammar (ContextMenu/Shift+F10 opens the OS-standard context-menu gesture, Enter opens, Space toggles, Alt+Arrow reschedules by day) — a per-row micro-widget contract, the same shape as the cell grid's",
    },
    {
        file: 'editor/tableModel.ts',
        reason: "the markdown table's own Tab/Enter/Escape (next cell / newline-or-next-row / leave) — the table grid's spatial contract, mirroring editor/cellEditor.ts's CM keymap",
    },
    {
        file: 'editor/cellEditor.ts',
        reason: "the Bases cell grid's own Tab/Enter/Escape (move to next cell, commit the cell, cancel the cell) — the table's spatial contract, named explicitly in this task's brief",
    },
    {
        file: 'editor/completionDisplay.ts',
        reason: "the CodeMirror completion popup's own navigation keymap (Escape/Arrow/PageUp/PageDown/Enter) — named explicitly in this task's brief as staying hardcoded",
    },
    {
        file: 'editor/autocomplete.ts',
        reason: 'the SRS "??" separator Enter guard runs at Prec.highest ahead of the completion popup keymap to stop it swallowing a real newline — part of the same completion-popup contract as completionDisplay.ts, not an independent shortcut',
    },
    {
        file: 'editor/datePicker.ts',
        reason: "the date-picker CM tooltip's own Escape/ArrowUp/ArrowDown/Enter — structurally identical popup-navigation contract to the completion popup (dismiss/move/pick), just for a different widget",
    },
    {
        file: 'editor/enterKeymap.ts',
        reason: "the note editor's own Enter-continues-list/blockquote-markup handling, replacing CodeMirror's default insertNewlineAndIndent — an editing primitive of the markdown surface, not a Bismuth app shortcut",
    },
    {
        file: 'editor/findPanel.ts',
        reason: 'the in-note find bar\'s own Enter-steps-to-next-match / Escape-closes convention — universal "find bar" behavior (browser/IDE Ctrl+F idiom), not something users rebind independently of the `find` catalog id that opens the bar',
    },
    {
        file: 'PreviewView.tsx',
        reason: 'the PDF find panel\'s own Enter-steps/Escape-closes convention, mirroring editor/findPanel.ts — universal "find bar" behavior, not an independently rebindable command (ink-undo/ink-redo in this file are matchesKeybinding-driven, same as InkOverlay.tsx/PageInk.tsx)',
    },
    {
        file: 'editor/drawBlock.ts',
        reason: 'PENDING SWEEP, not a design decision — see task-12 report. A temporary window keydown listener cancels a block-reorder drag on Escape; conceptually a ui-dismiss case (cancel a transient interaction) that was never wired to isDismissKey',
    },
    {
        file: 'calendar/components/GcalSyncPanel.tsx',
        reason: 'PENDING SWEEP — a local field\'s own Enter-to-commit, never brought under the ui-confirm migration this plan ran over chat/bases/intro/note-title surfaces (see task-12 report)',
    },
    {
        file: 'calendar/components/EventModal.tsx',
        reason: 'PENDING SWEEP — the same local Enter-to-commit / Backspace-to-delete pattern, not yet migrated (see task-12 report)',
    },
    {
        file: 'calendar/components/CategoryPanel.tsx',
        reason: 'PENDING SWEEP — local Enter-to-commit / Escape-to-cancel on inline category fields, not yet migrated (see task-12 report)',
    },
    {
        file: 'chat/ChatQuestionCard.tsx',
        reason: 'PENDING SWEEP — a local Enter-to-submit on an inline answer field, not yet migrated (see task-12 report)',
    },
    {
        file: 'graph/EmbeddedGraph.tsx',
        reason: 'PENDING SWEEP — Enter commits an inline node-label edit, not yet migrated (see task-12 report)',
    },
    {
        file: 'bases/BaseSettings.tsx',
        reason: 'PENDING SWEEP — Enter/Space on an inline settings control, not yet migrated (see task-12 report)',
    },
    {
        file: 'bases/EditCardsModal.tsx',
        reason: 'PENDING SWEEP — Enter-to-commit (with Shift+Enter for a newline) on card-editor text fields, not yet migrated (see task-12 report)',
    },
    {
        file: 'bases/CardsView.tsx',
        reason: 'PENDING SWEEP — a local Enter-to-open on a card, not yet migrated (see task-12 report)',
    },
    {
        file: 'preview/BookmarkRow.tsx',
        reason: 'PENDING SWEEP — Enter-to-jump and F2-to-rename on a bookmark row, not yet migrated (see task-12 report)',
    },
    {
        file: 'editor/settingsComplete.ts',
        reason: 'PENDING SWEEP — Escape closes the .settings autocomplete popup; not yet migrated to ui-dismiss (see task-12 report)',
    },
    {
        file: 'ExportView.tsx',
        reason: 'PENDING SWEEP — a local path field\'s own Enter-to-commit, not yet migrated (see task-12 report)',
    },
    {
        file: 'ui/ToggleRow.tsx',
        reason: 'Enter now reads isConfirmKey (ui-confirm); Space stays a hardcoded literal — it is this control\'s own activation gesture under the WAI-ARIA switch pattern (role="switch"), not an independently rebindable command',
    },
]

const ALLOWED_SET = new Set(ALLOWED_FILES.map(e => e.file))

function walk(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue
        const p = join(dir, name)
        const s = statSync(p)
        if (s.isDirectory()) out.push(...walk(p))
        else if (/\.(ts|tsx)$/.test(name)) out.push(p)
    }
    return out
}

// `e.key === '...'` / `ev.key === '...'` / `e.code === '...'` / `ev.code === '...'` — restricted
// to the `e`/`ev` identifiers, the only two names a KeyboardEvent parameter is given anywhere in
// this codebase (confirmed by surveying every `(x: KeyboardEvent)` signature and `onKeyDown={x =>`
// arrow param in app/src while building this test). This deliberately does NOT match e.g.
// `frame.code === 'no-claude'` (a chat protocol field) or `g.key`/`mv.key` (Bases grouping keys) —
// those aren't keyboard events and don't share this identifier.
const EVENT_LITERAL = /\b(?:e|ev)\.(key|code)\s*===\s*(['"])(?:(?!\2).)*\2/g

// `key: '...'` — a CodeMirror KeyBinding literal. Only checked in files that actually build a
// keymap (`keymap.of(` appears somewhere in the file), so an unrelated object literal with a
// `key` field elsewhere is never a false positive.
const KEYMAP_LITERAL = /\bkey:\s*(['"])(?:(?!\1).)*\1/g

describe('keybindingCoverage', () => {
    test('every hardcoded key literal in app/src is either catalog-driven or allow-listed', () => {
        const files = walk(APP_SRC).filter(
            p => !/\.test\.|\.stories\./.test(p),
        )
        const violations: string[] = []
        for (const abs of files) {
            const rel = relative(APP_SRC, abs)
            if (ALLOWED_SET.has(rel)) continue
            const text = readFileSync(abs, 'utf8')
            const hits: string[] = []
            for (const m of text.matchAll(EVENT_LITERAL)) hits.push(m[0])
            if (/\bkeymap\.of\(/.test(text)) {
                for (const m of text.matchAll(KEYMAP_LITERAL)) hits.push(m[0])
            }
            if (hits.length > 0) {
                violations.push(
                    `${rel}: ${hits.join(', ')} — hardcoded key literal outside KEYBINDING_CATALOG. ` +
                        `Add an id to core/src/keybindings.ts and read it via matchesKeybinding/isDismissKey/isConfirmKey, ` +
                        `or add ${rel} to ALLOWED_FILES in app/src/keybindingCoverage.test.ts with a reason.`,
                )
            }
        }
        expect(violations).toEqual([])
    })

    test('every ALLOWED_FILES entry carries a non-empty reason and points at a real file', () => {
        for (const entry of ALLOWED_FILES) {
            expect(entry.reason.length).toBeGreaterThan(10)
            expect(() =>
                readFileSync(join(APP_SRC, entry.file), 'utf8'),
            ).not.toThrow()
        }
    })
})
