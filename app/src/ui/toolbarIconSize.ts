import { settings } from '../settings'

/** Glyph px for every toolbar icon (ui/IconBar). The one reader of the toolbar icon-size setting,
 *  so the setting can be renamed without touching any bar. */
export default function toolbarIconSize(): number {
    return settings.appearance.sidebarIconFontSize
}
