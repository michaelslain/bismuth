import { describe, expect, it } from 'bun:test'
import {
    COMMAND_CATALOG,
    COMMAND_IDS,
    commandLabel,
    UI_CONTROL_BLOCKLIST,
    isUiControlAllowed,
} from '../src/commands'
import { KEYBINDING_CATALOG } from '../src/keybindings'

describe('command catalog', () => {
    it('derives COMMAND_IDS from the catalog, in order', () => {
        expect(COMMAND_IDS).toEqual(COMMAND_CATALOG.map(c => c.id))
    })

    it('has unique ids', () => {
        expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length)
    })

    it('every command has a non-empty label and icon', () => {
        for (const c of COMMAND_CATALOG) {
            expect(c.label.length).toBeGreaterThan(0)
            expect(c.icon.length).toBeGreaterThan(0)
        }
    })

    it('includes the seeded-default and graph commands', () => {
        expect(COMMAND_IDS).toContain('new-note')
        expect(COMMAND_IDS).toContain('new-folder')
        expect(COMMAND_IDS).toContain('terminal')
        expect(COMMAND_IDS).toContain('graph-both')
    })

    it('includes the file-menu commands', () => {
        for (const id of ['open-folder', 'new-window', 'export']) {
            expect(COMMAND_IDS).toContain(id)
        }
    })

    it('includes the whole-app zoom commands', () => {
        for (const id of ['zoom-in', 'zoom-out', 'zoom-reset']) {
            expect(COMMAND_IDS).toContain(id)
        }
    })

    it('looks up a label by id', () => {
        expect(commandLabel('terminal')).toBe('Open Terminal')
        expect(commandLabel('does-not-exist')).toBeUndefined()
    })

    // The seven split/focus/close pane verbs previously existed only as keybindings
    // (core/src/keybindings.ts) — an agent could open and close tabs but never arrange a
    // layout. They're catalog commands now so app control can reach them.
    it('includes the pane split/focus/close commands, allowed via app control', () => {
        const paneCommandIds = [
            'split-right',
            'split-down',
            'close-pane',
            'focus-pane-left',
            'focus-pane-right',
            'focus-pane-up',
            'focus-pane-down',
        ]
        for (const id of paneCommandIds) {
            expect(COMMAND_IDS).toContain(id)
            expect(isUiControlAllowed(id)).toBe(true)
        }
    })

    // "local" is a real, user-toggleable GraphMode (app/src/GraphView.tsx) that previously had
    // no catalog id — the one graph mode an agent couldn't switch to via app control.
    it('includes graph-local, allowed via app control', () => {
        expect(COMMAND_IDS).toContain('graph-local')
        expect(isUiControlAllowed('graph-local')).toBe(true)
    })

    // This exact gap — a keybinding-only pane verb with no catalog counterpart — is how
    // split-right/split-down/close-pane/focus-pane-* went unreachable from app control in the
    // first place. Assert the two catalogs can't drift apart on pane actions again: every
    // keybinding id that names a pane action must have a matching command id.
    it('keeps every pane-action keybinding wired into the command catalog (drift guard)', () => {
        const paneKeybindingIds = KEYBINDING_CATALOG.map(k => k.id).filter(
            id => id.includes('pane') || id.startsWith('split-'),
        )
        // Sanity: the filter itself must actually find the pane keybindings, or this guard
        // would vacuously pass forever.
        expect(paneKeybindingIds.length).toBeGreaterThanOrEqual(8)
        for (const id of paneKeybindingIds) {
            expect(COMMAND_IDS).toContain(id)
        }
    })
})

describe('ui control gate', () => {
    // A blocklist entry that matches no catalog id is worse than no entry: it reads as
    // protection in review and in the docs while blocking nothing.
    it('every blocklist entry is a real catalog id', () => {
        for (const id of UI_CONTROL_BLOCKLIST) {
            expect(COMMAND_IDS).toContain(id)
        }
    })

    it('refuses the daemon service-reinstall verb', () => {
        expect(isUiControlAllowed('daemon-update')).toBe(false)
    })

    it('refuses an id that is not in the catalog at all', () => {
        expect(isUiControlAllowed('not-a-command')).toBe(false)
    })

    it('allows an ordinary catalog id', () => {
        expect(isUiControlAllowed('new-note')).toBe(true)
    })
})

describe('interactive commands', () => {
    // These seven commands only OPEN A MODAL and then wait on a person to finish it — the action
    // never completes the underlying task by itself (create/connect/setup/install dialogs, or a
    // picker like the emoji library / create menu). They stay runnable via app control BY DESIGN
    // (an agent opening the dialog to show a user how is the point); what changes is the
    // `run-command` reply (App.tsx's runCommand handler), which reports `interactive:true` + a note
    // instead of implying the underlying task itself completed.
    const interactiveIds = [
        'create-menu',
        'emoji-library',
        'edit-dictionary',
        'daemon-owner',
        'daemon-setup',
        'bismuth-install',
        'gcal-connect',
    ]

    it('marks exactly the seven modal-opening commands interactive', () => {
        for (const id of interactiveIds) {
            const spec = COMMAND_CATALOG.find(c => c.id === id)
            expect(spec).toBeDefined()
            expect(spec?.interactive).toBe(true)
        }
    })

    it('leaves ordinary commands non-interactive', () => {
        for (const id of [
            'new-note',
            'terminal',
            'graph-both',
            'zoom-in',
            'split-right',
            'settings',
        ]) {
            const spec = COMMAND_CATALOG.find(c => c.id === id)
            expect(spec?.interactive).toBeFalsy()
        }
    })

    // A drift guard, same shape as the blocklist/pane-keybinding guards above: catches both an
    // accidentally-unset flag on one of the seven AND an accidentally-set flag on an eighth id.
    it('has no interactive ids beyond this exact set', () => {
        const actual = COMMAND_CATALOG.filter(c => c.interactive)
            .map(c => c.id)
            .sort()
        expect(actual).toEqual([...interactiveIds].sort())
    })

    it('still allows every interactive command via app control (opening it to show a person how is the point)', () => {
        for (const id of interactiveIds) {
            expect(isUiControlAllowed(id)).toBe(true)
        }
    })
})
