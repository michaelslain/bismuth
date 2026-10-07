// Visual + behaviour spec for <MonthCell> — one day of the month grid: the day number and whatever
// the register puts in it. A tasks-register cell is a drop target for a dragged task chip; an
// events cell is not. Both hold real state, read back in play(). A lone cell is given every
// position flag, so it types all four edges and reads as one closed cell — inside a grid each
// boundary is typed by exactly one cell (see MonthCell.tsx).
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, within } from 'storybook/test'
import MonthCell from './MonthCell'
import Text from '../../../ui/Text'
import { fitTiles, whenAsciiGlyphTilesInstalled } from '../../../ui/ascii/asciiGlyphTiles'
import { encodeTaskDrag, TASK_DRAG_MIME } from '../../taskDrag'

const meta = {
    title: 'Calendar/Views/MonthCell',
    component: MonthCell,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MonthCell>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: any }) => (
    <div style={{ display: 'grid', 'grid-template-columns': '160px', width: '160px' }}>{props.children}</div>
)

export const InMonth: Story = {
    render: () => {
        const [clicks, setClicks] = createSignal(0)
        return (
            <Frame>
                <MonthCell date="2026-01-14" day={14} inMonth today={false} isLastCol isLastRow onOpen={() => setClicks(n => n + 1)}>
                    <Text as="span" size="micro">A chip</Text>
                </MonthCell>
                <output data-testid="clicks">{clicks()}</output>
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await fireEvent.click(c.getByTestId('month-cell'))
        expect(c.getByTestId('clicks').textContent).toBe('1')
        expect(c.getByText('A chip')).toBeInTheDocument()
        // a lone cell with every position flag types all four edges, in the contract's fixed order
        expect(
            canvasElement.querySelector('[data-edges]')!.getAttribute('data-edges'),
        ).toBe('top right bottom left')
    },
}

export const SpillDayIsDimmed: Story = {
    render: () => (
        <Frame>
            <MonthCell date="2026-01-31" day={31} inMonth={false} today={false} isLastCol onOpen={() => {}} />
            <MonthCell date="2026-02-01" day={1} inMonth today={false} isLastCol isLastRow onOpen={() => {}} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const dim = getComputedStyle(c.getByText('31'))
        const live = getComputedStyle(c.getByText('1'))
        // a quieter INK, not a see-through one: DESIGN.md shows no state by opacity
        expect(dim.opacity).toBe('1')
        expect(live.opacity).toBe('1')
        expect(dim.color).not.toBe(live.color)
    },
}

/** Today's number is dimmed by nothing, even when today is a spill day: the (0,2,0) `.dim` colour
 *  would otherwise tie with the disc's own `.today` colour and paint faint ink on the accent. Read
 *  against an in-month today beside it, so the expected ink is the live one, not a hardcoded token. */
export const TodaySpillDayKeepsItsDisc: Story = {
    render: () => (
        <Frame>
            <MonthCell date="2026-01-30" day={30} inMonth today isLastCol onOpen={() => {}} />
            <MonthCell date="2026-01-31" day={31} inMonth={false} today isLastCol isLastRow onOpen={() => {}} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const live = c.getByText('30')
        const spill = c.getByText('31')
        expect(getComputedStyle(spill).color).toBe(getComputedStyle(live).color)
        expect(getComputedStyle(spill).backgroundColor).toBe(getComputedStyle(live).backgroundColor)
        expect(getComputedStyle(spill).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        // one --row-h row, square
        const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
        const r = spill.getBoundingClientRect()
        expect(r.width).toBeCloseTo(rowH, 0)
        expect(r.height).toBeCloseTo(rowH, 0)
    },
}

/** The cell at rest sits on its floor (`calendar.monthCellMinHeight`, 80px by default), snapped UP
 *  to corner tile + a whole number of dash pitches. At a bare 80px the vertical run held 4.57 pitches
 *  and `round` stretched it to ~12.8px under the 14px dashes across (13.2 vs 13.6 as two graders
 *  measured it). Reads the painted pitch off the real box, per axis, the way the primitive's own
 *  story does — on a host whose WIDTH is snapped too, so any gap is the height's alone. */
export const FloorPaintsOnePitchDownAndAcross: Story = {
    render: () => (
        <div data-testid="snapped" style={{ width: 'calc(var(--ascii-corner-w, 1ch) + 10 * var(--ascii-pitch, 2ch))' }}>
            <MonthCell date="2026-01-14" day={14} inMonth today={false} isLastCol isLastRow onOpen={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await whenAsciiGlyphTilesInstalled()
        const cs = getComputedStyle(document.documentElement)
        const cornerW = parseFloat(cs.getPropertyValue('--ascii-corner-w'))
        const tileH = parseFloat(cs.getPropertyValue('--ascii-tile-h'))
        const pitch = parseFloat(cs.getPropertyValue('--ascii-pitch'))
        expect(pitch, 'the dash pitch is installed').toBeGreaterThan(0)
        const cell = within(canvasElement).getByTestId('month-cell')
        const host = cell.getBoundingClientRect()
        // the floor is the setting, snapped up: never below it, and a whole number of pitches past a tile
        const floor = parseFloat(cs.getPropertyValue('--month-cell-min-h'))
        expect(host.height).toBeGreaterThanOrEqual(floor)
        expect((host.height - tileH) / pitch, 'whole pitches of room down').toBeCloseTo(Math.round((host.height - tileH) / pitch), 2)
        const edges = canvasElement.querySelector<HTMLElement>('[data-edges]')!
        const r = edges.getBoundingClientRect()
        const across = fitTiles(r.width - 2 * cornerW, pitch).pitch
        const down = fitTiles(r.height - 2 * tileH, pitch).pitch
        expect(across, 'painted pitch across').toBeCloseTo(pitch, 1)
        expect(down, 'painted pitch down').toBeCloseTo(pitch, 1)
    },
}

export const TasksCellAcceptsADrop: Story = {
    render: () => {
        const [dropped, setDropped] = createSignal('nothing')
        return (
            <Frame>
                <MonthCell
                    date="2026-01-20"
                    day={20}
                    inMonth
                    today={false}
                    isLastCol
                    isLastRow
                    onOpen={() => {}}
                    onDropTask={(ref, date) => setDropped(`${ref.path}:${ref.line}->${date}`)}
                />
                <output data-testid="dropped">{dropped()}</output>
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const dataTransfer = new DataTransfer()
        dataTransfer.setData(TASK_DRAG_MIME, encodeTaskDrag({ path: 'todo.md', line: 3, field: 'due' }))
        c.getByTestId('month-cell').dispatchEvent(
            new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
        )
        expect(c.getByTestId('dropped').textContent).toBe('todo.md:3->2026-01-20')
    },
}

export const EventsCellIgnoresADrop: Story = {
    render: () => (
        <Frame>
            <MonthCell date="2026-01-20" day={20} inMonth today={false} isLastCol isLastRow onOpen={() => {}} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const cell = within(canvasElement).getByTestId('month-cell')
        const ev = new Event('dragover', { bubbles: true, cancelable: true })
        cell.dispatchEvent(ev)
        expect(ev.defaultPrevented).toBe(false)
    },
}
