// Story helper: drive a real pointer drag from one element to another, the way a mouse does —
// pointerdown on the source, pointermoves on the window to the target's centre, pointerup there.
// The calendar's task chips (calendar/taskPointerDrag.ts) and the kanban listen to exactly these.

function centre(el: Element): { x: number; y: number } {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function pointer(type: string, x: number, y: number): PointerEvent {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        isPrimary: true,
        clientX: x,
        clientY: y,
    })
}

/** Press on `from`, move to `to` in a few steps, and stop there with the button still down.
 *  Returns the drop point, for `releaseAt`. */
export function dragTo(from: Element, to: Element): { x: number; y: number } {
    const a = centre(from)
    const b = centre(to)
    from.dispatchEvent(pointer('pointerdown', a.x, a.y))
    for (let i = 1; i <= 4; i++)
        window.dispatchEvent(
            pointer('pointermove', a.x + ((b.x - a.x) * i) / 4, a.y + ((b.y - a.y) * i) / 4),
        )
    return b
}

/** Release the pointer at `p`, with the click a real mouse fires on the element under it. */
export function releaseAt(p: { x: number; y: number }): void {
    const under = document.elementFromPoint(p.x, p.y) ?? document.body
    under.dispatchEvent(pointer('pointerup', p.x, p.y))
    under.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }))
}

/** A whole drag: press on `from`, move to `to`, release there. */
export function pointerDrag(from: Element, to: Element): void {
    releaseAt(dragTo(from, to))
}
