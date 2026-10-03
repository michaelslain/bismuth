// app/src/intro/introKeys.ts
import { isDismissKey } from '../ui/widgetKeys'

/** What a keydown means to the intro's pager, or null when it is none of its business.
 *  ArrowLeft/ArrowRight stay hardcoded — paging through a slideshow is spatial navigation, not a
 *  rebindable command (keybindingCoverage.test.ts records them as the pager exception). The skip
 *  key IS rebindable: it reads through the shared dismiss key. */
export function introKeyAction(e: KeyboardEvent): 'next' | 'prev' | 'skip' | null {
    if (e.key === 'ArrowRight') return 'next'
    if (e.key === 'ArrowLeft') return 'prev'
    if (isDismissKey(e)) return 'skip'
    return null
}
