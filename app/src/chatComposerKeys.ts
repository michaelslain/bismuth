// app/src/chatComposerKeys.ts
//
// Pure key-routing for the visual-chat composer (Row 77). The composer is a CodeMirror instance
// (ChatComposer.tsx) whose keydown is delegated to ChatComposerBar; this decides — from the key +
// the composer's state — WHAT the key means, so the precedence (slash popover owns nav first, then
// streaming-stop interrupts, then send, else CodeMirror handles it) is unit-testable and can't
// silently drift. ChatComposerBar maps each action to its side effect (nav / pick / stop / send)
// and returns true (CodeMirror stops) for every action except `pass`, where Shift+Enter etc. fall
// through to CodeMirror's own handling (a plain newline, ordinary typing).
//
// NOTE: keys the vault autocomplete popup owns while it's OPEN ([[wikilink]]/tag/emoji navigation)
// never reach here — ChatComposer defers those to CodeMirror before calling ChatComposerBar — so
// this only ever sees the composer's own chords.
//
// `chat-send` / `chat-stop` / `chat-history-prev` / `chat-history-next` are now `.settings.keybindings`
// combos rather than hardcoded literals. This module stays PURE — no settings-store import — so the
// caller resolves the live combo strings and passes them in as `combos`. Matching goes through the
// SAME matcher (`matchesKeybinding`, ./keybindings.ts) every other rebindable shortcut in the app
// uses: "Mod" folds Cmd/Ctrl, comma-separated alternatives all match, and modifiers are EXACT — so
// rebinding chat-send to "Mod+Enter" makes a plain Enter fall through to `pass` (CodeMirror's own
// newline handling) instead of sending, because plain Enter no longer matches the combo.
//
// `chat-newline` (default Shift+Enter) is DELIBERATELY not one of the matched combos below: this
// module's action vocabulary has no distinct "newline" action, only `send` vs `pass`, and "didn't
// match chat-send" already IS "let CodeMirror insert whatever the key normally would" — exactly what
// a newline binding needs. There is nothing a `chat-newline` branch could return that `pass` doesn't
// already produce, so it stays in the catalog purely so it has a label + a row in the keybindings
// settings UI; see the task-6 report for the fuller reasoning.
//
// `open-completion` is a separate CodeMirror-level keybinding — ChatComposer.tsx wires it straight
// into `settingsKeymapCompartment` — and never reaches this module at all.

import { matchesKeybinding } from './keybindings'

export type ComposerKeyAction =
    | 'slash-nav' // Arrow/Escape while the slash-command popover is open → move/close the menu
    | 'slash-select' // Enter while the slash popover is open → pick the highlighted command
    | 'stop' // chat-stop while a turn streams → interrupt it (TUI parity)
    | 'send' // chat-send → send or stage the message
    | 'history-up' // chat-history-prev at the composer's top boundary → recall an older sent message
    | 'history-down' // chat-history-next at the composer's bottom boundary → move toward the newest / draft
    | 'pass' // let CodeMirror handle it (a newline, ordinary typing, Escape-with-nothing-open)

export interface ComposerKeyEvent {
    key: string
    shiftKey: boolean
    /** KeyboardEvent.code — only load-bearing for a combo that needs the PHYSICAL key (see
     *  ./keybindings.ts's Option-composed-character note). None of this module's default combos
     *  need it, so it defaults to '' when omitted — existing callers that only ever built
     *  `{ key, shiftKey }` keep compiling and matching correctly. */
    code?: string
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
}

export interface ComposerKeyState {
    /** The slash-command autocomplete popover is open. */
    slashOpen: boolean
    /** A turn is currently streaming (so chat-stop interrupts it). */
    streaming: boolean
    /** The caret is on the composer's first VISUAL line (no line above it to move the caret into) — a
     *  chat-history-prev candidate instead of ordinary caret movement. Computed from the live
     *  CodeMirror view (see ChatComposer.tsx); irrelevant unless the key matches chat-history-prev. */
    atTop?: boolean
    /** Same idea for chat-history-next: the caret is on the composer's last visual line. Irrelevant
     *  unless the key matches chat-history-next. */
    atBottom?: boolean
}

/** The resolved `.settings.keybindings` combos this module matches against. Every field is
 *  optional — an empty or missing combo simply never matches (the same "unbind" convention
 *  `app/src/editor/settingsKeymap.ts` uses) — and keyed by the exact catalog id
 *  (`core/src/keybindings.ts`) so a caller can eventually pass `settings.keybindings` straight
 *  through once its TS shape carries these ids, with no translation layer in between. */
export interface ComposerKeyCombos {
    'chat-send'?: string
    'chat-stop'?: string
    'chat-history-prev'?: string
    'chat-history-next'?: string
}

/** The catalog defaults (core/src/keybindings.ts). Used when a caller doesn't (yet) pass live
 *  settings — every existing call site that predates this settings wiring keeps compiling and
 *  behaving exactly as before by simply omitting the third argument. */
export const DEFAULT_COMPOSER_KEY_COMBOS: ComposerKeyCombos = {
    'chat-send': 'Enter',
    'chat-stop': 'Escape',
    'chat-history-prev': 'ArrowUp',
    'chat-history-next': 'ArrowDown',
}

// matchesKeybinding reads a real KeyboardEvent's modifier flags; ComposerKeyEvent only requires
// `key`/`shiftKey` (every pre-existing caller built one of those), so default the rest to
// false/'' rather than asking every test + call site to spell out four fields it doesn't care
// about. Mirrors the same `{ ... } as KeyboardEvent` stand-in app/src/keybindings.test.ts uses.
function toMatchable(e: ComposerKeyEvent): KeyboardEvent {
    return {
        key: e.key,
        code: e.code ?? '',
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey ?? false,
        metaKey: e.metaKey ?? false,
        altKey: e.altKey ?? false,
    } as KeyboardEvent
}

/** Decide what a composer keystroke means. Pure — no DOM, no side effects, no settings-store
 *  import; `combos` is resolved and passed in by the caller (defaults to the catalog's defaults). */
export function classifyComposerKey(
    e: ComposerKeyEvent,
    state: ComposerKeyState,
    combos: ComposerKeyCombos = DEFAULT_COMPOSER_KEY_COMBOS,
): ComposerKeyAction {
    // The slash popover owns navigation first, exactly as it did with the old textarea handler — this
    // also means Arrow keys navigate the menu instead of recalling history while it's open. Left
    // hardcoded (not settings-driven): this is the popover's own spatial navigation contract, not a
    // rebindable global shortcut.
    if (state.slashOpen) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape')
            return 'slash-nav'
        if (e.key === 'Enter' && !e.shiftKey) return 'slash-select'
    }
    const evt = toMatchable(e)
    // chat-stop interrupts an in-flight turn (only when the slash popover isn't open — handled above).
    if (matchesKeybinding(evt, combos['chat-stop']) && state.streaming)
        return 'stop'
    // chat-send sends/stages. Whatever key ISN'T chat-send (the default Shift+Enter, or anything
    // else once rebound) is left to CodeMirror as a plain newline — see the header comment for why
    // chat-newline has no branch of its own here.
    if (matchesKeybinding(evt, combos['chat-send'])) return 'send'
    // Shell-style prompt history — only at the composer's boundary, so ordinary multi-line cursor
    // movement inside a longer draft is left to CodeMirror.
    if (matchesKeybinding(evt, combos['chat-history-prev']) && state.atTop)
        return 'history-up'
    if (matchesKeybinding(evt, combos['chat-history-next']) && state.atBottom)
        return 'history-down'
    return 'pass'
}
