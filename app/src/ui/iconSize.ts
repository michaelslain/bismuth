import { settings } from '../settings'
import { customThemeOverrides } from '../customThemes'
import { overridePx, tokenOverride } from '../effectiveTokens'

/** The ONE icon size, in px, for every icon in the app — toolbars, rows, menus, buttons, chips.
 *  The only reader of `appearance.iconSize`: `icons/Icon.tsx`, `ui/IconButton.tsx`, `ui/IconBar.tsx`
 *  and the other icon-bearing primitives default to it, so no call site passes a size. The `icon`
 *  design token (a plain `<n>px` in `.settings` tokens or the active theme) wins over the legacy
 *  field; any other form (calc, em) leaves the legacy value in charge here while CSS still honours it.
 *  A literal size on an icon is refused by `ui/iconSizeLint.test.ts` unless it carries an
 *  `icon-size-exempt:` comment (an oversized illustration mark, never chrome). */
export default function iconSize(): number {
    return (
        overridePx(tokenOverride(settings, customThemeOverrides(), 'icon')) ??
        settings.appearance.iconSize
    )
}
