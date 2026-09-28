// Story-only helper (the `*.stories.*` glob skips underscore files): the add-pin flow as a REAL
// mouse drives it, shared by `Bases/MapView → AddPin` and `Bases/Gallery → MapPinsLand`.
//
// Why not `el.click()` or one synthetic `click`: the map's own handlers split the gesture —
// `onMouseDown` decides pan-vs-place, `onMouseMove` pans, `onClick` places — and a lone `click`
// skips the first two entirely. A story that dispatched only `click` passed while a real mouse
// (pointerdown → mousedown → pointerup → mouseup → click, all bubbling, all at one point) did
// something else. `pressAt` fires the full sequence at the element actually under the point,
// the way the browser would.
import { expect, userEvent, waitFor, within } from 'storybook/test'

/** Fire the whole mouse sequence a real left click produces, at viewport point (x, y), on
 *  whatever element is on top there — never on an element the caller merely assumes is.
 *  `jitter` moves the pointer that many px between press and release, the way a real hand does:
 *  a gesture that treats any movement as a drag (a pan threshold of zero) loses such a click. */
export function pressAt(doc: Document, x: number, y: number, jitter = 0): Element {
    const target = doc.elementFromPoint(x, y)
    if (!target) throw new Error(`nothing under (${x}, ${y})`)
    const at = (cx: number, cy: number) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: cx,
        clientY: cy,
        button: 0,
        view: doc.defaultView,
    })
    const rx = x + jitter
    const ry = y - Math.min(jitter, 1)
    const PE = doc.defaultView!.PointerEvent
    const pe = { pointerId: 1, isPrimary: true }
    target.dispatchEvent(new PE('pointerdown', { ...at(x, y), ...pe, buttons: 1 }))
    target.dispatchEvent(new MouseEvent('mousedown', { ...at(x, y), buttons: 1 }))
    if (jitter) {
        target.dispatchEvent(new PE('pointermove', { ...at(rx, ry), ...pe, buttons: 1 }))
        target.dispatchEvent(new MouseEvent('mousemove', { ...at(rx, ry), buttons: 1 }))
    }
    target.dispatchEvent(new PE('pointerup', { ...at(rx, ry), ...pe, buttons: 0 }))
    target.dispatchEvent(new MouseEvent('mouseup', { ...at(rx, ry), buttons: 0 }))
    target.dispatchEvent(new MouseEvent('click', { ...at(rx, ry), buttons: 0, detail: 1 }))
    return target
}

/** Press the centre of an element with the full real-mouse sequence. */
export function pressEl(el: Element, jitter = 0): Element {
    const r = el.getBoundingClientRect()
    return pressAt(el.ownerDocument, r.left + r.width / 2, r.top + r.height / 2, jitter)
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

/** The map surface once it is mounted AND measured. MapView lays out at a default 800×600 until
 *  its ResizeObserver reports the real size, and that first report re-centres every path — a
 *  framing captured before it compares unequal to everything after for no fault of the map. */
export async function sizedMap(root: HTMLElement): Promise<HTMLElement> {
    let mapEl: HTMLElement | undefined
    await waitFor(
        () => {
            mapEl = mapSurface(root)
            const svg = mapEl.querySelector('svg')
            const w = Math.round(mapEl.getBoundingClientRect().width)
            if (!svg || Math.round(Number(svg.getAttribute('width'))) !== w)
                throw new Error('map not measured yet')
        },
        { timeout: 5000 },
    )
    return mapEl!
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

/** The `place <title>` rows `Add pin`'s menu offers — one per row with no location. Empty when
 *  the menu is not open. */
function placeItems(doc: Document): string[] {
    return [...doc.querySelectorAll('.bismuth-popover-label')]
        .map(el => (el.textContent ?? '').trim())
        .filter(t => t.startsWith('place '))
}

/** Placing an EXISTING row that has no coordinates, with a real-mouse event sequence at every
 *  step: zoom in (so the framing is the USER's, not the initial fit) → press `Add pin` → its menu
 *  offers `new place` then one `place <title>` per unplaced row → pick `place <pick>` → press an
 *  empty spot on the map (with jitter). Asserts the pin lands (count +1, the row leaves the menu)
 *  AND that neither arming nor placing — nor the refetch after the write — moved the map. */
export async function placeUnplacedByMouse(
    root: HTMLElement,
    pick: string,
    unplacedBefore: number,
    /** Zoom in first so the framing is the user's own. Off when an earlier step already did —
     *  a second notch pushes the basemap's `<g>` far past the viewport, which the invariant sweep
     *  (it measures the unclipped SVG group) reports as horizontal overflow. */
    zoomFirst = true,
): Promise<void> {
    const doc = root.ownerDocument
    const scope = within(root)
    const body = within(doc.body)
    const mapEl = await sizedMap(root)
    const add = await scope.findByTestId('map-add-pin')
    expect(scope.queryByTestId('map-unplaced-button')).toBeNull()
    const before = pinCount(root)

    if (zoomFirst) {
        const initial = framing(mapEl)
        pressEl(scope.getByLabelText('Zoom in'))
        await waitFor(() => {
            if (framing(mapEl) === initial)
                throw new Error('zoom in did not change the framing')
        })
    }
    const userFraming = framing(mapEl)

    // A person presses what they can see: bring the map's top-left into view first (an earlier
    // step's editor dialog can leave the page scrolled), since `pressEl` hits whatever is on top.
    add.scrollIntoView({ block: 'center' })
    pressEl(add, 1)
    await body.findByText('new place')
    await waitFor(() => expect(placeItems(doc)).toHaveLength(unplacedBefore))
    expect(framing(mapEl)).toBe(userFraming)
    pressEl(await body.findByText(`place ${pick}`), 1)
    await scope.findByText(new RegExp(`placing ${pick}`))
    expect(mapEl.className).toContain('mapArmed')
    expect(framing(mapEl)).toBe(userFraming)

    const spot = clearSpot(mapEl)
    pressAt(doc, spot.x, spot.y, 2)

    await waitFor(() => {
        if (mapEl.className.includes('mapArmed'))
            throw new Error('still armed after pressing the map')
    })
    await waitFor(() => {
        expect(pinCount(root)).toBe(before + 1)
        expect(scope.getByText(pick)).toBeInTheDocument()
    })
    expect(framing(mapEl)).toBe(userFraming)

    // The placed row has left Add pin's menu.
    if (unplacedBefore > 1) {
        add.scrollIntoView({ block: 'center' })
        pressEl(add, 1)
        await body.findByText('new place')
        await waitFor(() =>
            expect(placeItems(doc)).toHaveLength(unplacedBefore - 1),
        )
        expect(placeItems(doc)).not.toContain(`place ${pick}`)
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(body.queryByText('new place')).toBeNull())
    }
}

/** The open row editor (CardEditModal inside a Modal), anywhere in the document. */
async function editorDialog(doc: Document): Promise<HTMLElement> {
    return within(doc.body).findByRole('dialog')
}

/** Rename the row in the open editor: type into its (auto-focused) title field, commit with
 *  Enter, close with Escape — the keys a person uses. Waits for the dialog to go. */
async function renameInEditor(doc: Document, title: string): Promise<void> {
    const dialog = await editorDialog(doc)
    const input = within(dialog).getByPlaceholderText('Untitled') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, `${title}{Enter}`)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
        if (doc.body.querySelector('[role="dialog"]'))
            throw new Error('row editor still open')
    })
}

/** `Add pin` end to end, every press a real-mouse sequence WITH jitter: zoom in (the user's own
 *  framing) → press `Add pin` (→ `new place` when its menu opens; crosshair, armed) → press an empty spot → a NEW row is created
 *  there (pin count +1) and its row editor opens → type `title`, Enter, Escape → the new pin
 *  reads `title` after the refetch. The map's framing never moves at any step. */
export async function addPinByMouse(root: HTMLElement, title: string): Promise<void> {
    const doc = root.ownerDocument
    const scope = within(root)
    const mapEl = await sizedMap(root)
    await waitFor(() => expect(pinCount(root)).toBeGreaterThan(0))
    const before = pinCount(root)

    const initial = framing(mapEl)
    pressEl(scope.getByLabelText('Zoom in'), 1)
    await waitFor(() => {
        if (framing(mapEl) === initial)
            throw new Error('zoom in did not change the framing')
    })
    const userFraming = framing(mapEl)

    const add = await scope.findByTestId('map-add-pin')
    expect(add).not.toBeDisabled()
    pressEl(add, 1)
    // With rows lacking a location Add pin opens its menu first; `new place` arms a new row.
    const menuNew = await waitFor(
        () =>
            within(doc.body).queryByText('new place') ??
            scope.getByText(/click to add a pin/),
    )
    if ((menuNew.textContent ?? '').trim() === 'new place') pressEl(menuNew, 1)
    await scope.findByText(/click to add a pin/)
    expect(mapEl.className).toContain('mapArmed')
    expect(getComputedStyle(mapEl).cursor).toBe('crosshair')
    expect(framing(mapEl)).toBe(userFraming)

    const spot = clearSpot(mapEl)
    pressAt(doc, spot.x, spot.y, 3)
    await editorDialog(doc)
    expect(mapEl.className).not.toContain('mapArmed')
    await waitFor(() => expect(pinCount(root)).toBe(before + 1))
    expect(framing(mapEl)).toBe(userFraming)

    await renameInEditor(doc, title)
    await waitFor(() => expect(scope.getByText(title)).toBeInTheDocument())
    expect(pinCount(root)).toBe(before + 1)
    expect(framing(mapEl)).toBe(userFraming)
}

/** Left-click a pin (real sequence, 2px jitter) → its row editor opens on THAT row; rename it
 *  there → the pin's label changes after the refetch; the map never re-frames. */
export async function editPinByMouse(
    root: HTMLElement,
    label: string,
    renameTo: string,
): Promise<void> {
    const doc = root.ownerDocument
    const scope = within(root)
    const mapEl = await sizedMap(root)
    const chip = await scope.findByText(label)
    const before = framing(mapEl)
    pressEl(chip, 2)
    const dialog = await editorDialog(doc)
    const input = within(dialog).getByPlaceholderText('Untitled') as HTMLInputElement
    expect(input.value).toBe(label)
    await renameInEditor(doc, renameTo)
    await waitFor(() => expect(scope.getByText(renameTo)).toBeInTheDocument())
    expect(scope.queryByText(label)).toBeNull()
    expect(framing(mapEl)).toBe(before)
}
