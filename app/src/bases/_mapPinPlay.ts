// Story-only helper (the `*.stories.*` glob skips underscore files): the add-pin flow as a REAL
// mouse drives it, shared by `Bases/MapView → AddPin` and `Bases/Gallery → MapPinsLand`.
//
// Why not `el.click()` or one synthetic `click`: the map's own handlers split the gesture —
// `onMouseDown` decides pan-vs-place, `onMouseMove` pans, `onClick` places — and a lone `click`
// skips the first two entirely. A story that dispatched only `click` passed while a real mouse
// (pointerdown → mousedown → pointerup → mouseup → click, all bubbling, all at one point) did
// something else. `pressAt` fires the full sequence at the element actually under the point,
// the way the browser would.
import { expect, waitFor, within } from 'storybook/test'

/** Fire the whole mouse sequence a real left click produces, at viewport point (x, y), on
 *  whatever element is on top there — never on an element the caller merely assumes is. */
export function pressAt(doc: Document, x: number, y: number): Element {
    const target = doc.elementFromPoint(x, y)
    if (!target) throw new Error(`nothing under (${x}, ${y})`)
    const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        button: 0,
        view: doc.defaultView,
    }
    const down = { ...init, buttons: 1 }
    const up = { ...init, buttons: 0 }
    const PE = doc.defaultView!.PointerEvent
    target.dispatchEvent(
        new PE('pointerdown', { ...down, pointerId: 1, isPrimary: true }),
    )
    target.dispatchEvent(new MouseEvent('mousedown', down))
    target.dispatchEvent(
        new PE('pointerup', { ...up, pointerId: 1, isPrimary: true }),
    )
    target.dispatchEvent(new MouseEvent('mouseup', up))
    target.dispatchEvent(new MouseEvent('click', { ...up, detail: 1 }))
    return target
}

/** Press the centre of an element with the full real-mouse sequence. */
export function pressEl(el: Element): Element {
    const r = el.getBoundingClientRect()
    return pressAt(el.ownerDocument, r.left + r.width / 2, r.top + r.height / 2)
}

/** The map's current framing, read from what it paints: the first landmass path's geometry
 *  moves with BOTH centre and zoom, and the scale label changes with zoom. Equal framings
 *  before/after a step mean that step did not re-frame the map. */
export function framing(mapEl: HTMLElement): string {
    const d = mapEl.querySelector('svg path')?.getAttribute('d') ?? ''
    const scale = [...mapEl.querySelectorAll('span')].find(s =>
        /^\d+(\.\d+)? (k?m)$/.test(s.textContent ?? ''),
    )?.textContent
    return `${scale} | ${d.slice(0, 48)}`
}

/** The map element itself (the pannable surface), inside a `mapWrap` container. */
export function mapSurface(root: HTMLElement): HTMLElement {
    const wrap = root.querySelector('[class*="mapWrap"]') as HTMLElement | null
    if (!wrap) throw new Error('no map rendered')
    return wrap.firstElementChild as HTMLElement
}

/** Each pin is a `<button>` wrapping a chip + glyph that ALSO carry a `mapPin*` class — the tag
 *  filter keeps this a pin count instead of triple-counting. */
export function pinCount(root: HTMLElement): number {
    return root.querySelectorAll('button[class*="mapPin"]').length
}

/** A point on the map's own background: probe a few spots and return the first whose topmost
 *  element is the map surface or its basemap SVG (not a pin, not a floating control). */
export function clearSpot(mapEl: HTMLElement): { x: number; y: number } {
    const doc = mapEl.ownerDocument
    const r = mapEl.getBoundingClientRect()
    for (const [fx, fy] of [
        [0.4, 0.6],
        [0.3, 0.7],
        [0.6, 0.4],
        [0.2, 0.5],
        [0.7, 0.7],
        [0.5, 0.5],
    ]) {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        const hit = doc.elementFromPoint(x, y)
        if (
            hit &&
            (hit === mapEl || (mapEl.contains(hit) && hit.closest('svg')))
        )
            return { x, y }
    }
    throw new Error('no clear spot on the map to click')
}

/** The whole add-pin flow, with a real-mouse event sequence at every step:
 *  zoom in (so the framing is the USER's, not the initial fit) → press `Add pin` → pick `pick`
 *  from the picker → press an empty spot on the map. Asserts the pin lands (count +1, unplaced
 *  readout drops by one) AND that neither arming nor placing — nor the refetch after the write —
 *  moved the map. */
export async function addPinByMouse(
    root: HTMLElement,
    pick: string,
    unplacedBefore: number,
): Promise<void> {
    const doc = root.ownerDocument
    const scope = within(root)
    const body = within(doc.body)
    const unplacedButton = await scope.findByTestId('map-unplaced-button')
    await waitFor(() =>
        expect(unplacedButton).toHaveTextContent(
            `unplaced (${unplacedBefore})`,
        ),
    )
    const mapEl = mapSurface(root)
    const before = pinCount(root)

    const initial = framing(mapEl)
    pressEl(scope.getByLabelText('Zoom in'))
    await waitFor(() => {
        if (framing(mapEl) === initial)
            throw new Error('zoom in did not change the framing')
    })
    const userFraming = framing(mapEl)

    pressEl(await scope.findByTestId('map-add-pin'))
    // One unplaced row arms straight away; several open the picker first.
    if (!mapEl.className.includes('mapArmed'))
        pressEl(await body.findByText(pick))
    await scope.findByText(new RegExp(`placing ${pick}`))
    expect(mapEl.className).toContain('mapArmed')
    expect(framing(mapEl)).toBe(userFraming)

    const spot = clearSpot(mapEl)
    pressAt(doc, spot.x, spot.y)

    await waitFor(() => {
        if (mapEl.className.includes('mapArmed'))
            throw new Error('still armed after pressing the map')
    })
    await waitFor(() => {
        expect(pinCount(root)).toBe(before + 1)
        expect(scope.getByText(pick)).toBeInTheDocument()
    })
    if (unplacedBefore > 1)
        expect(unplacedButton).toHaveTextContent(
            `unplaced (${unplacedBefore - 1})`,
        )
    expect(framing(mapEl)).toBe(userFraming)
}
