// app/src/ui/widgetKeys.ts
// Two rebindable ids stand in for the ~sixty per-widget `e.key === 'Escape'` /
// `e.key === 'Enter'` handlers scattered across modals, menus, inline inputs and
// galleries — one line in .settings reaches every transient widget that reads
// through these instead of a hardcoded literal. The combo grammar + exact
// modifier matching live in ./keybindings; this module only picks the setting.
import { settings } from '../settings'
import { matchesKeybinding } from '../keybindings'

/** Does this event mean "close/cancel this transient surface"? Reads
 *  settings.keybindings['ui-dismiss']; an EMPTY setting falls back to Escape so a
 *  user can never trap themselves in a modal with no way out — that fallback is
 *  for an empty setting only, a real rebinding (e.g. "Mod+.") replaces Escape
 *  entirely rather than adding to it. */
export function isDismissKey(e: KeyboardEvent): boolean {
    return matchesKeybinding(e, settings.keybindings['ui-dismiss'] || 'Escape')
}

/** Does this event mean "accept/commit this transient surface"? Reads
 *  settings.keybindings['ui-confirm']. matchesKeybinding matches modifiers
 *  exactly, so Shift+Enter (a newline in every multi-line surface) never reads
 *  as a confirm. Empty setting → matchesKeybinding's own empty check → no
 *  confirm key at all. */
export function isConfirmKey(e: KeyboardEvent): boolean {
    return matchesKeybinding(e, settings.keybindings['ui-confirm'])
}

/** Does this event mean "open the context menu from the keyboard"? The platform's own
 *  convention — the dedicated ContextMenu key or Shift+F10 — not a rebindable command, the
 *  same pair calendar/taskChipKeys.ts reads for a task chip. */
export function isMenuKey(e: KeyboardEvent): boolean {
    return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)
}

/** Does this event mean "activate the focused thing" — the native button pair, Enter or Space
 *  with no modifiers? For a non-button element made keyboard-reachable (tabindex + role); not
 *  rebindable, because it mirrors what a real `<button>` does. */
export function isActivateKey(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
    return e.key === 'Enter' || e.key === ' '
}

/** Is this the Tab key? The platform's focus key, not a rebindable command — for a widget that
 *  accepts a suggestion as focus leaves it (SuggestInput). */
export function isTabKey(e: KeyboardEvent): boolean {
    return e.key === 'Tab'
}
