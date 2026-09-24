import { settings } from '../settings'

/** The ONE icon size, in px, for every icon in the app — toolbars, rows, menus, buttons, chips.
 *  The only reader of `appearance.iconSize`: `icons/Icon.tsx`, `ui/IconButton.tsx`, `ui/IconBar.tsx`
 *  and the other icon-bearing primitives default to it, so no call site passes a size. A literal
 *  size on an icon is refused by `ui/iconSizeLint.test.ts` unless it carries an `icon-size-exempt:`
 *  comment (an oversized illustration mark, never chrome). */
export default function iconSize(): number {
    return settings.appearance.iconSize
}
