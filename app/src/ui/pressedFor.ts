import type { ButtonState } from './buttonClass'

/** `aria-pressed` for a toggle member: `selected` is pressed, `unselected` is not, and a
 *  `normal` (standalone action) button is not a toggle so it carries none. */
export function pressedFor(state: ButtonState | undefined): boolean | undefined {
    if (state === 'selected') return true
    if (state === 'unselected') return false
    return undefined
}
