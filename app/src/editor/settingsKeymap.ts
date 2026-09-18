// app/src/editor/settingsKeymap.ts
// Turns `settings.keybindings.<id>` combo strings into live CodeMirror bindings.
//
// Bindings sit at Prec.high so a rebind beats CodeMirror's upstream keymaps
// (defaultKeymap, historyKeymap, closeBracketsKeymap, markdownKeymap) — those stay
// untouched by this module.
//
// A binding whose setting is EMPTY contributes no CM binding at all. Empty is a
// deliberate "unbind", not a fallback to a hardcoded default (the ui-dismiss
// fallback in a later task is the one stated exception, and lives in that task's
// own file, not here).
//
// Two build paths for two kinds of caller:
//   - `buildSettingsKeymap` — a plain Extension, read once at call time. For a
//     surface built OUTSIDE a Solid owner (a widget-constructed cell editor):
//     it is simply recreated with the rest of its extensions on every activation.
//   - `settingsKeymapCompartment` — a Compartment plus a createEffect that
//     reconfigures it in place whenever any of the given ids' settings change.
//     Call `attach(view)` once, inside a Solid owner, after the view exists. The
//     view is NEVER rebuilt for a rebind — the buffer, scroll position and any
//     active draw-mode session all survive it.

import { Compartment, Prec, type Extension } from '@codemirror/state'
import {
    EditorView,
    keymap,
    type Command,
    type KeyBinding,
} from '@codemirror/view'
import { createEffect } from 'solid-js'
import { settings } from '../settings'
import { toCmKeys } from '../keybindings'
import type { KeybindingId } from '../../../core/src/keybindings'

/** One settings-driven CodeMirror binding: a catalog id plus what it runs. */
export type SettingsBinding = {
    id: KeybindingId
    run: Command
    shift?: Command
    preventDefault?: boolean
}

// The combo string currently held at settings.keybindings.<id>. `id` is typed as
// KeybindingId (derived from KEYBINDING_CATALOG), so an unknown or typo'd id is a
// compile error at every call site instead of silently returning undefined.
function comboFor(id: KeybindingId): string | undefined {
    return settings.keybindings[id]
}

// Build the CodeMirror KeyBinding entries for one SettingsBinding: zero entries
// when the setting is empty/missing (the "unbind" case), one per comma-alternative
// otherwise.
function keyBindingsFor(binding: SettingsBinding): KeyBinding[] {
    const keys: string[] = toCmKeys(comboFor(binding.id))
    return keys.map((key: string) => ({
        key,
        run: binding.run,
        shift: binding.shift,
        preventDefault: binding.preventDefault,
    }))
}

function buildKeymapExtension(bindings: SettingsBinding[]): Extension {
    return Prec.high(keymap.of(bindings.flatMap(keyBindingsFor)))
}

/** Build the live keymap extension for a set of bindings, at Prec.high so it sits in
 *  front of CodeMirror's upstream keymaps. Reads settings.keybindings at call time. */
export function buildSettingsKeymap(bindings: SettingsBinding[]): Extension {
    return buildKeymapExtension(bindings)
}

/** A compartment plus the effect that reconfigures it whenever any of the given ids
 *  changes in settings. Call `attach(view)` once after the view is constructed; it
 *  registers a createEffect in the CURRENT owner and returns nothing. The view is NOT
 *  rebuilt — the buffer, scroll position and draw mode all survive a rebind. */
export function settingsKeymapCompartment(bindings: SettingsBinding[]): {
    extension: Extension
    attach: (view: EditorView) => void
} {
    const compartment = new Compartment()
    return {
        extension: compartment.of(buildKeymapExtension(bindings)),
        attach: view => {
            createEffect(() => {
                // Read each id's combo INSIDE this effect (not captured at attach-time)
                // so the store tracks every one of them individually and re-runs on any
                // single rebind — reading through comboFor keeps this the same lookup
                // buildKeymapExtension uses below.
                const combos = bindings.map(b => comboFor(b.id))
                void combos
                view.dispatch({
                    effects: compartment.reconfigure(
                        buildKeymapExtension(bindings),
                    ),
                })
            })
        },
    }
}
