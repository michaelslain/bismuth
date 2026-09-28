// app/src/ui/stopGestures.ts
// A child that owns its pointer gestures says so, instead of its parent asking the DOM who the
// event came from. `stopPropagation` on click alone does NOT stop pointerdown / mousedown /
// dblclick, so a row that starts a drag on pointerdown still fires — this stops all four.

/** Stop an event reaching the ancestors' handlers. */
export function stopGestures(e: Event): void {
    e.stopPropagation()
}

/** Spread onto the root of a region that is not part of its row's gestures:
 *  `<div {...gestureStops}>`. */
export const gestureStops = {
    onClick: (e: MouseEvent) => stopGestures(e),
    onMouseDown: (e: MouseEvent) => stopGestures(e),
    onPointerDown: (e: PointerEvent) => stopGestures(e),
    onDblClick: (e: MouseEvent) => stopGestures(e),
}
