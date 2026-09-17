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
