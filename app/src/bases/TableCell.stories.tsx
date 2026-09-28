import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import TableCell from './TableCell'
import { sampleBaseConfig } from '../ui/_baseFixtures'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import Text from '../ui/Text'

const meta = {
    title: 'Bases/TableCell',
    component: TableCell,
} satisfies Meta<typeof TableCell>

export default meta
type Story = StoryObj<typeof meta>

/** One text cell with REAL state: click it, type, press Enter, and the new value renders —
 *  the same loop a table row runs, with the vault write replaced by a signal. A second click
 *  proves the next edit opens focused too (a browser honours `autofocus` only once per page,
 *  which is exactly how the second edit in a table used to type into nothing). */
export const EditInPlace: Story = {
    render: () => {
        const [author, setAuthor] = createSignal('Frank Herbert')
        const row = (): Row => ({
            file: syntheticBaseFile('Reading List.md'),
            note: { title: 'Dune', author: author() },
            formula: {},
            index: 0,
        })
        return (
            <div style={{ width: '280px', padding: '12px' }}>
                <TableCell
                    row={row()}
                    col="author"
                    config={sampleBaseConfig()}
                    siblingValues={() => []}
                    onCommit={v => setAuthor(String(v ?? ''))}
                >
                    <Text as="span" data-testid="cell-value">
                        {author()}
                    </Text>
                </TableCell>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const open = async () => {
            canvasElement.querySelector<HTMLElement>('button')!.click()
            // The cell focuses its editor in a microtask after mounting it — wait for that, not
            // for a guessed delay.
            await waitFor(() =>
                expect(document.activeElement).toBe(
                    canvasElement.querySelector('input'),
                ),
            )
            return canvasElement.querySelector('input')!
        }
        let input = await open()
        await userEvent.clear(input)
        await userEvent.type(input, 'F. Herbert{Enter}')
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="cell-value"]')!
                    .textContent,
            ).toBe('F. Herbert'),
        )
        input = await open()
        await userEvent.clear(input)
        await userEvent.type(input, 'Frank Herbert{Enter}')
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="cell-value"]')!
                    .textContent,
            ).toBe('Frank Herbert'),
        )
    },
}

/** A boolean cell never becomes an `editing` state — a click commits the flip immediately,
 *  with no `PropertyValueEditor`/input ever mounted. Read-only look is the same `x`/blank
 *  `renderValue.tsx` uses; state is a real signal, so two clicks round-trip true → false → true. */
export const BooleanToggle: Story = {
    render: () => {
        const [done, setDone] = createSignal(false)
        const row = (): Row => ({
            file: syntheticBaseFile('Reading List.md'),
            note: { title: 'Dune', done: done() },
            formula: {},
            index: 0,
        })
        return (
            <div style={{ width: '120px', padding: '12px' }}>
                <TableCell
                    row={row()}
                    col="done"
                    config={sampleBaseConfig()}
                    siblingValues={() => []}
                    onCommit={v => setDone(v === true)}
                >
                    <Text as="span" data-testid="cell-value">
                        {done() ? 'x' : ''}
                    </Text>
                </TableCell>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const cellText = () =>
            (
                canvasElement.querySelector('[data-testid="cell-value"]')!
                    .textContent ?? ''
            ).trim()
        const button = () =>
            canvasElement.querySelector<HTMLElement>('button')!
        // A real hover (not just `.click()`, which never fires mouseenter) must not paint the
        // text-cell "click to edit" background on a boolean cell — it commits on click
        // immediately, so that affordance would be misleading here.
        await userEvent.hover(button())
        expect(getComputedStyle(button()).backgroundColor).toBe(
            'rgba(0, 0, 0, 0)',
        )
        // A boolean cell still commits on click like every other cell, so it carries the same
        // `pointer` cursor — `cursor: text` here (measured 2026-09-27) told the whole table it
        // was a caret, not a control.
        expect(getComputedStyle(button()).cursor).toBe('pointer')
        expect(cellText()).toBe('')
        button().click()
        await waitFor(() => expect(cellText()).toBe('x'))
        expect(canvasElement.querySelector('input')).toBeNull()
        expect(getComputedStyle(button()).backgroundColor).toBe(
            'rgba(0, 0, 0, 0)',
        )
        await userEvent.unhover(button())
        button().click()
        await waitFor(() => expect(cellText()).toBe(''))
        expect(canvasElement.querySelector('input')).toBeNull()
    },
}

// One harness for the stories below: a cell over a real signal-backed row, plus a visible log
// of every commit so a play can assert what was (and was not) written.
const CommitCell = (props: {
    col: string
    value: unknown
    config: BaseConfig
    width?: string
}) => {
    const [value, setValue] = createSignal<unknown>(props.value)
    const [commits, setCommits] = createSignal<unknown[]>([])
    const row = (): Row => ({
        file: syntheticBaseFile('Reading List.md'),
        note: { title: 'Dune', [props.col]: value() },
        formula: {},
        index: 0,
    })
    return (
        <div style={{ width: props.width ?? '220px', padding: '12px' }}>
            <TableCell
                row={row()}
                col={props.col}
                config={props.config}
                siblingValues={() => []}
                onCommit={v => {
                    setCommits(c => [...c, v])
                    setValue(v)
                }}
            >
                <Text as="span" data-testid="cell-value">
                    {JSON.stringify(value())}
                </Text>
            </TableCell>
            <Text as="p" data-testid="commit-log">
                {JSON.stringify(commits())}
            </Text>
        </div>
    )
}
const commitLog = (el: HTMLElement) =>
    el.querySelector('[data-testid="commit-log"]')!.textContent
const cellButton = (el: HTMLElement) =>
    el.querySelector<HTMLElement>('button')!

const TYPED: BaseConfig = {
    declaredProperties: ['rating', 'status', 'due'],
    properties: {
        rating: { type: { kind: 'number' } },
        status: {
            type: { kind: 'select', options: ['Todo', 'Doing', 'Done'] },
        },
        due: { type: { kind: 'date' } },
    },
    views: [{ type: 'table', name: 'Table' }],
}

/** A value no in-cell editor can round-trip (a list of numbers) is shown, never opened: the
 *  cell carries the not-editable hint, a click mounts nothing and nothing is written. */
export const Readonly: Story = {
    render: () => (
        <CommitCell col="scores" value={[1, 2, 3]} config={sampleBaseConfig()} />
    ),
    play: async ({ canvasElement }) => {
        const btn = cellButton(canvasElement)
        expect(btn.title).toContain('Not editable here')
        expect(getComputedStyle(btn).cursor).toBe('default')
        await userEvent.click(btn)
        expect(canvasElement.querySelector('input, textarea')).toBeNull()
        expect(commitLog(canvasElement)).toBe('[]')
    },
}

/** A declared `number` opens a focused input, coerces the typed text to a number and commits it
 *  once on Enter. */
export const NumberEditor: Story = {
    render: () => <CommitCell col="rating" value={3} config={TYPED} />,
    play: async ({ canvasElement }) => {
        await userEvent.click(cellButton(canvasElement))
        await waitFor(() =>
            expect(document.activeElement).toBe(
                canvasElement.querySelector('input'),
            ),
        )
        const input = canvasElement.querySelector('input')!
        await userEvent.clear(input)
        await userEvent.type(input, '42{Enter}')
        await waitFor(() => expect(commitLog(canvasElement)).toBe('[42]'))
        expect(canvasElement.querySelector('input')).toBeNull()
    },
}

/** A declared `select` opens its picker in the cell (focus lands on the picker's control). */
export const SelectEditor: Story = {
    render: () => <CommitCell col="status" value="Todo" config={TYPED} />,
    play: async ({ canvasElement }) => {
        await userEvent.click(cellButton(canvasElement))
        await waitFor(() =>
            expect(document.activeElement).toBe(
                canvasElement.querySelector('button'),
            ),
        )
        expect(canvasElement.querySelector('[title="Click to edit"]')).toBeNull()
        expect(commitLog(canvasElement)).toBe('[]')
    },
}

/** A declared `date` opens its date field in the cell. */
export const DateEditor: Story = {
    render: () => <CommitCell col="due" value="2026-09-01" config={TYPED} />,
    play: async ({ canvasElement }) => {
        await userEvent.click(cellButton(canvasElement))
        await waitFor(() =>
            expect(
                canvasElement.querySelector('input, textarea, button'),
            ).toBeTruthy(),
        )
        expect(canvasElement.querySelector('[title="Click to edit"]')).toBeNull()
        expect(commitLog(canvasElement)).toBe('[]')
    },
}

/** Escape abandons the draft: the cell closes back to its old value and the typed text is never written. */
export const EscapeCancels: Story = {
    render: () => (
        <CommitCell col="author" value="Frank Herbert" config={sampleBaseConfig()} />
    ),
    play: async ({ canvasElement }) => {
        await userEvent.click(cellButton(canvasElement))
        await waitFor(() =>
            expect(document.activeElement).toBe(
                canvasElement.querySelector('input'),
            ),
        )
        await userEvent.type(canvasElement.querySelector('input')!, ' Jr{Escape}')
        await waitFor(() =>
            expect(canvasElement.querySelector('input')).toBeNull(),
        )
        // Cancel may re-commit the ORIGINAL value (the editor reverts its draft, then blur
        // commits) — what it must never do is write the typed text.
        expect(commitLog(canvasElement)).not.toContain('Jr')
        expect(
            canvasElement.querySelector('[data-testid="cell-value"]')!
                .textContent,
        ).toBe('"Frank Herbert"')
    },
}
