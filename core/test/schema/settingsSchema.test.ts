// core/test/schema/settingsSchema.test.ts
import { test, expect } from 'bun:test'
import { SETTINGS_SCHEMA, DEFAULTS } from '../../src/schema/settingsSchema'
import { validateDocument } from '../../src/schema/validate'
import { KEYBINDING_CATALOG } from '../../src/keybindings'
import type { SchemaEntry, Schema } from '../../src/schema/types'

function objectFields(entry: SchemaEntry): Schema {
    if (typeof entry.type === 'object' && entry.type.kind === 'object')
        return entry.type.fields
    throw new Error('expected an object section')
}

test('SETTINGS_SCHEMA nests the app sections, calendar, ui, server, folderIcons and properties', () => {
    expect(Object.keys(SETTINGS_SCHEMA).sort()).toEqual(
        [
            'appearance',
            'attachments',
            'calendar',
            'chat',
            'codex',
            'daemon',
            'dailyNotes',
            'editor',
            'folderIcons',
            'folderVisibility',
            'googleCalendar',
            'graph',
            'keybindings',
            'mcp',
            'properties',
            'server',
            'srs',
            'tabBar',
            'templates',
            'terminal',
            'toolbar',
            'ui',
            'update',
            'vault',
        ].sort(),
    )
})

test('folderIcons section is an empty object schema (the per-folder icon map placeholder)', () => {
    expect(SETTINGS_SCHEMA.folderIcons.type).toEqual({
        kind: 'object',
        fields: {},
    })
})

test('folderVisibility section is an empty object schema (the per-folder visibility map placeholder)', () => {
    expect(SETTINGS_SCHEMA.folderVisibility.type).toEqual({
        kind: 'object',
        fields: {},
    })
})

test('appearance has no flat per-color keys (themes are the single source of color)', () => {
    const appearance = objectFields(SETTINGS_SCHEMA.appearance)
    expect(appearance.background).toBeUndefined()
    expect(appearance.foreground).toBeUndefined()
    expect(appearance.neutral).toBeUndefined()
    expect(appearance.accent).toBeUndefined()
    expect(appearance.accentPalette).toBeUndefined()
})

test('appearance.theme is the Bismuth theme enum defaulting to ink', () => {
    const appearance = objectFields(SETTINGS_SCHEMA.appearance)
    expect(appearance.theme.type).toEqual({
        kind: 'enum',
        values: ['ink', 'paper', 'cathode', 'riso'],
    })
    expect(appearance.theme.default).toBe('ink')
    expect(appearance.theme.doc).toBeTruthy()
})

test('appearance.icon is the 14-mark enum defaulting to hopper-crystal', () => {
    const appearance = objectFields(SETTINGS_SCHEMA.appearance)
    expect(appearance.icon.type).toEqual({
        kind: 'enum',
        values: [
            'hopper-crystal',
            'node-b',
            'square-funnel',
            'nested-diamonds',
            'pinwheel',
            'node-crystal',
            'lattice',
            'diamond-bloom',
            'node-diamond',
            'octagon-bloom',
            'spin-cross',
            'tri-bloom',
            'radial-graph',
            'node-rings',
        ],
    })
    expect(appearance.icon.default).toBe('hopper-crystal')
    expect(appearance.icon.doc).toBeTruthy()
})

test('editorFont enum carries the EDITOR_FONTS list', () => {
    const appearance = objectFields(SETTINGS_SCHEMA.appearance)
    expect(appearance.editorFont.type).toEqual({
        kind: 'enum',
        values: [
            'Monaspace Xenon',
            'Monaspace Neon',
            'Monaspace Argon',
            'Monaspace Krypton',
            'Monaspace Radon',
        ],
    })
    expect(appearance.editorFont.default).toBe('Monaspace Xenon')
})

test('uiFont enum carries the EDITOR_FONTS list', () => {
    const appearance = objectFields(SETTINGS_SCHEMA.appearance)
    expect(appearance.uiFont.type).toEqual({
        kind: 'enum',
        values: [
            'Monaspace Xenon',
            'Monaspace Neon',
            'Monaspace Argon',
            'Monaspace Krypton',
            'Monaspace Radon',
        ],
    })
    expect(appearance.uiFont.default).toBe('Monaspace Xenon')
})

test('graph.repulsion is a number with the old slider bounds and default', () => {
    const graph = objectFields(SETTINGS_SCHEMA.graph)
    expect(graph.repulsion.type).toBe('number')
    expect(graph.repulsion.default).toBe(-10)
    expect(graph.repulsion.min).toBe(-40)
    expect(graph.repulsion.max).toBe(-1)
})

test('graph color settings are gone (derived from appearance); viewMode is not a setting', () => {
    const graph = objectFields(SETTINGS_SCHEMA.graph)
    expect(graph.palette).toBeUndefined()
    expect(graph.edgeColor).toBeUndefined()
    expect(graph.backgroundColor).toBeUndefined()
    // The 2D/3D dimension is a transient per-window UI toggle (localStorage in
    // GraphView.tsx), deliberately NOT persisted in settings.yaml.
    expect(graph.viewMode).toBeUndefined()
})

test('calendar section mirrors the calendar defaults', () => {
    const cal = objectFields(SETTINGS_SCHEMA.calendar)
    expect(cal.defaultView.type).toEqual({
        kind: 'enum',
        values: ['month', 'week', '3day', 'day'],
    })
    expect(cal.defaultView.default).toBe('week')
    expect(cal.weekStartsOnMonday.default).toBe(true)
    expect(cal.militaryTime.default).toBe(false)
})

test('daemon section is exactly { backend, enabled, inboxRetentionDays, inheritUserMcp }', () => {
    const daemon = objectFields(SETTINGS_SCHEMA.daemon)
    expect(Object.keys(daemon).sort()).toEqual([
        'backend',
        'enabled',
        'inboxRetentionDays',
        'inheritUserMcp',
    ])
    expect(daemon.inheritUserMcp.type).toBe('boolean')
    expect(daemon.inheritUserMcp.default).toBe(false)
    expect(daemon.enabled.type).toBe('boolean')
    expect(daemon.enabled.default).toBe(false)
    expect(daemon.inboxRetentionDays.type).toBe('number')
    expect(daemon.inboxRetentionDays.default).toBe(7)
    // The backend enum is derived from the catalog's daemon capability — "claude" today, plus
    // "codex" once its daemon backend lands (this is a REQUEST; resolveDaemonBackend is the gate).
    expect(daemon.backend.default).toBe('claude')
    expect(daemon.backend.type).toEqual({
        kind: 'enum',
        values: expect.arrayContaining(['claude', 'codex']),
    })
    // The obsolete keys are gone: name now lives in .daemon/identity.md frontmatter; daemon is
    // bundled (home is fixed); no git-pull self-update.
    expect(daemon.name).toBeUndefined()
    expect(daemon.home).toBeUndefined()
    expect(daemon.autoUpdate).toBeUndefined()
})

test('keybindings section has one string key per catalog action, defaulting to its combo', () => {
    const kb = objectFields(SETTINGS_SCHEMA.keybindings)
    // Exactly the catalog ids, no more, no less.
    expect(Object.keys(kb).sort()).toEqual(
        KEYBINDING_CATALOG.map(k => k.id).sort(),
    )
    for (const spec of KEYBINDING_CATALOG) {
        expect(kb[spec.id].type).toBe('keybind')
        expect(kb[spec.id].default).toBe(spec.default)
        expect(kb[spec.id].doc).toBeTruthy()
    }
    // Representative defaults equal the previously hardcoded combos.
    expect(kb['command-palette'].default).toBe('Mod+P')
    expect(kb['split-down'].default).toBe('Mod+Shift+D')
    expect(kb['terminal'].default).toBe('Mod+`, Mod+J')
})

test('KEYBINDING_CATALOG includes the whole-app zoom actions (Cmd+=/Cmd+-/Cmd+0)', () => {
    const ids = KEYBINDING_CATALOG.map(k => k.id)
    expect(ids).toContain('zoom-in')
    expect(ids).toContain('zoom-out')
    expect(ids).toContain('zoom-reset')
    const kb = objectFields(SETTINGS_SCHEMA.keybindings)
    expect(kb['zoom-in'].default).toBe('Mod+=, Mod+Shift+=')
    expect(kb['zoom-out'].default).toBe('Mod+-')
    expect(kb['zoom-reset'].default).toBe('Mod+0')
})

test('keybindings is the LAST schema section (so it sits at the end of a fresh settings.yaml)', () => {
    const keys = Object.keys(SETTINGS_SCHEMA)
    expect(keys[keys.length - 1]).toBe('keybindings')
})

test('DEFAULTS.keybindings materializes every catalog combo', () => {
    const d = DEFAULTS as Record<string, Record<string, unknown>>
    for (const spec of KEYBINDING_CATALOG) {
        expect(d.keybindings[spec.id]).toBe(spec.default)
    }
})

// --- Task 2: the 26 new rebindable-keys ids, on top of the original 24. ---

test('KEYBINDING_CATALOG has exactly 50 entries (24 original + 26 rebindable-keys)', () => {
    expect(KEYBINDING_CATALOG.length).toBe(50)
})

test('every KEYBINDING_CATALOG id is unique', () => {
    const ids = KEYBINDING_CATALOG.map(k => k.id)
    expect(new Set(ids).size).toBe(ids.length)
})

test('every KEYBINDING_CATALOG doc is non-empty', () => {
    for (const spec of KEYBINDING_CATALOG) {
        expect(spec.doc.trim().length).toBeGreaterThan(0)
    }
})

test('every KEYBINDING_CATALOG default is syntactically parseable', () => {
    // core has no frontend imports (see core/src/keybindings.ts's header), so this
    // test cannot import Task 1's app/src/keybindings.ts parseCombo and must not —
    // this is a structural re-check of the same "+"-delimited grammar documented at
    // the top of core/src/keybindings.ts: split on ',' for alternatives, then on '+'
    // for modifiers-then-key; a combo parses when that second split yields at least
    // one non-empty token (parseCombo treats the final token as the key even when it
    // is not a recognized modifier word, e.g. a bare "Tab" or "1").
    function altParses(alt: string): boolean {
        return (
            alt
                .split('+')
                .map(p => p.trim())
                .filter(Boolean).length > 0
        )
    }
    // No known exceptions: every alternative of every default must parse. (A
    // controller ruling on 2026-09-17 corrected graph-zoom-in's `'=, +'` and
    // graph-zoom-out's `'-, _'` — a bare `+` is unparseable under this "+"-delimited
    // grammar, and Shift is matched EXACTLY so a bare `_`/`+` never fires for an event
    // carrying shiftKey — to `'=, Shift+=, Plus'` / `'-, Shift+-'`, the same pattern
    // the existing `zoom-in` entry already uses. This assertion is what should have
    // caught that, so it carries no carve-out.)
    for (const spec of KEYBINDING_CATALOG) {
        const alts = spec.default
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        expect(alts.length).toBeGreaterThan(0)
        for (const alt of alts) {
            expect(altParses(alt)).toBe(true)
        }
    }
})

test('the 26 new ids are present with their exact specified defaults', () => {
    const kb = objectFields(SETTINGS_SCHEMA.keybindings)
    const expected: Record<string, string> = {
        'open-completion': 'Ctrl+Space, Mod+Shift+Space',
        'accept-completion': 'Tab',
        indent: 'Tab',
        outdent: 'Shift+Tab',
        'toggle-bold': 'Mod+B',
        'toggle-italic': 'Mod+I',
        'chat-send': 'Enter',
        'chat-newline': 'Shift+Enter',
        'chat-stop': 'Escape',
        'chat-history-prev': 'ArrowUp',
        'chat-history-next': 'ArrowDown',
        'undo-delete': 'Mod+Z',
        'delete-selection': 'Delete, Backspace',
        'flashcard-flip': 'Space',
        'flashcard-hard': '1',
        'flashcard-good': '2',
        'flashcard-easy': '3',
        'graph-reset-view': 'Escape',
        'graph-focus-node': 'Z, Shift+Z',
        'graph-zoom-in': '=, Shift+=, Plus',
        'graph-zoom-out': '-, Shift+-',
        'ink-undo': 'Mod+Z',
        'ink-redo': 'Mod+Shift+Z',
        'exit-draw-mode': 'Escape',
        'ui-dismiss': 'Escape',
        'ui-confirm': 'Enter',
    }
    expect(Object.keys(expected).length).toBe(26)
    for (const [id, combo] of Object.entries(expected)) {
        expect(kb[id]).toBeDefined()
        expect(kb[id].default).toBe(combo)
        expect(kb[id].doc).toBeTruthy()
    }
})

test('new keybinding defaults collide only where the plan says they deliberately should (same-surface repeats)', () => {
    // Surface is NOT a field on KeybindingSpec (id/label/default/doc only) — this
    // grouping mirrors the id/default/surface table in the plan
    // (.claude/plans/2026-09-17-rebindable-keys.md, Task 2's own interface block)
    // purely for this test. Parenthetical activation conditions in that table
    // ("(while streaming)", "(hovered node, else reset)", "(at first/last visual
    // line)") are stripped: they describe WHEN a surface's own binding fires, not a
    // second surface, so they are not part of the grouping key.
    const SURFACES: Record<string, string[]> = {
        'open-completion': [
            'note editor',
            '.settings',
            'card editor',
            'table-cell editor',
            'chat composer',
        ],
        'accept-completion': ['note editor', 'card editor'],
        indent: ['note editor', 'card editor', 'markdown field'],
        outdent: ['note editor', 'card editor', 'markdown field'],
        'toggle-bold': ['card editor', 'cell editor', 'note editor'],
        'toggle-italic': ['card editor', 'cell editor', 'note editor'],
        'chat-send': ['chat composer'],
        'chat-newline': ['chat composer'],
        'chat-stop': ['chat composer'],
        'chat-history-prev': ['chat composer'],
        'chat-history-next': ['chat composer'],
        'undo-delete': ['file tree'],
        'delete-selection': ['file tree'],
        'flashcard-flip': ['flashcards view'],
        'flashcard-hard': ['flashcards view'],
        'flashcard-good': ['flashcards view'],
        'flashcard-easy': ['flashcards view'],
        'graph-reset-view': ['graph renderer'],
        'graph-focus-node': ['graph renderer'],
        'graph-zoom-in': ['graph renderer'],
        'graph-zoom-out': ['graph renderer'],
        'ink-undo': ['ink overlay', 'page ink', 'preview annotations'],
        'ink-redo': ['ink overlay', 'page ink', 'preview annotations'],
        'exit-draw-mode': ['ink overlay', 'page ink'],
        'ui-dismiss': ['every transient widget'],
        'ui-confirm': ['every transient widget'],
    }
    // The one deliberate same-surface repeat the plan calls out: Tab is bound to both
    // accept-completion and indent, on the note editor and card editor surfaces (they
    // are mutually exclusive at runtime — Tab accepts an open completion popup, else
    // indents — not a real ambiguity).
    const ALLOWED = new Set(['note editor:Tab', 'card editor:Tab'])
    const bySurface = new Map<string, Map<string, string[]>>()
    for (const [id, surfaces] of Object.entries(SURFACES)) {
        const spec = KEYBINDING_CATALOG.find(k => k.id === id)
        if (!spec) throw new Error(`SURFACES references unknown id "${id}"`)
        for (const surface of surfaces) {
            if (!bySurface.has(surface)) bySurface.set(surface, new Map())
            const byDefault = bySurface.get(surface)!
            if (!byDefault.has(spec.default)) byDefault.set(spec.default, [])
            byDefault.get(spec.default)!.push(id)
        }
    }
    for (const [surface, byDefault] of bySurface) {
        for (const [combo, ids] of byDefault) {
            if (ids.length > 1) {
                expect(ALLOWED.has(`${surface}:${combo}`)).toBe(true)
            }
        }
    }
})

test('properties section is an empty object schema (the registry placeholder)', () => {
    expect(SETTINGS_SCHEMA.properties.type).toEqual({
        kind: 'object',
        fields: {},
    })
})

test('DEFAULTS is the plain nested object derived from the schema', () => {
    // Structural (robust to added settings): section set + representative leaves.
    expect(Object.keys(DEFAULTS).sort()).toEqual(
        [
            'appearance',
            'attachments',
            'calendar',
            'chat',
            'codex',
            'daemon',
            'dailyNotes',
            'editor',
            'folderIcons',
            'folderVisibility',
            'googleCalendar',
            'graph',
            'keybindings',
            'mcp',
            'properties',
            'server',
            'srs',
            'tabBar',
            'templates',
            'terminal',
            'toolbar',
            'ui',
            'update',
            'vault',
        ].sort(),
    )
    const d = DEFAULTS as Record<string, Record<string, unknown>>
    expect(d.appearance.theme).toBe('ink')
    expect(d.appearance.icon).toBe('hopper-crystal')
    expect(d.appearance.accent).toBeUndefined() // flat color keys removed; theme owns color
    expect(d.graph.repulsion).toBe(-10)
    expect(d.graph.viewMode).toBeUndefined() // 2D/3D is transient UI state, not a setting
    expect(d.editor.autoSaveDelay).toBe(800)
    expect(d.vault.backupOnSave).toBe(true)
    expect(d.calendar.defaultView).toBe('week')
    expect(d.server.fileWatchDebounceMs).toBe(250)
    expect(d.properties).toEqual({})
    expect(d.folderIcons).toEqual({})
    expect(d.folderVisibility).toEqual({})
})

test('DEFAULTS round-trips clean through validateDocument in settings mode', () => {
    const diags = validateDocument(DEFAULTS, SETTINGS_SCHEMA, {
        mode: 'settings',
    })
    const blocking = diags.filter(d => d.severity === 'error')
    expect(blocking).toEqual([])
})
