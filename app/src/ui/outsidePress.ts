// Decides whether a click is a genuine outside click for a surface that closes when clicked
// outside (a modal's backdrop, a context menu). A `click` is dispatched to the nearest common
// ancestor of the press and release targets, so a text selection dragged from an input inside the
// surface and released outside it fires `click` on the backdrop (or the document) — which reads as
// an outside click and closes the surface mid-selection. The press point is what says whose
// gesture it was: only a click whose press ALSO began outside counts.

export type OutsidePress = {
    /** Call on every pointerdown (capture phase, or on the surface's own backdrop). */
    down: (target: EventTarget | null) => void
    /** True when this click both began and ended outside the surface. Consumes the press. */
    isOutsideClick: (target: EventTarget | null) => boolean
}

export function createOutsidePress(
    isInside: (target: EventTarget | null) => boolean,
): OutsidePress {
    let pressedInside = false
    return {
        down: target => {
            pressedInside = isInside(target)
        },
        isOutsideClick: target => {
            const began = pressedInside
            pressedInside = false
            return !began && !isInside(target)
        },
    }
}

export default createOutsidePress
