import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import TableCell from './TableCell'
import { sampleBaseConfig } from '../ui/_baseFixtures'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Row } from '../../../core/src/bases/types'
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
            await new Promise(r => setTimeout(r, 30))
            const input = canvasElement.querySelector('input')!
            expect(document.activeElement).toBe(input)
            return input
        }
        let input = await open()
        await userEvent.clear(input)
        await userEvent.type(input, 'F. Herbert{Enter}')
        await new Promise(r => setTimeout(r, 30))
        expect(
            canvasElement.querySelector('[data-testid="cell-value"]')!
                .textContent,
        ).toBe('F. Herbert')
        input = await open()
        await userEvent.clear(input)
        await userEvent.type(input, 'Frank Herbert{Enter}')
        await new Promise(r => setTimeout(r, 30))
        expect(
            canvasElement.querySelector('[data-testid="cell-value"]')!
                .textContent,
        ).toBe('Frank Herbert')
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
        await new Promise(r => setTimeout(r, 30))
        expect(cellText()).toBe('x')
        expect(canvasElement.querySelector('input')).toBeNull()
        expect(getComputedStyle(button()).backgroundColor).toBe(
            'rgba(0, 0, 0, 0)',
        )
        await userEvent.unhover(button())
        button().click()
        await new Promise(r => setTimeout(r, 30))
        expect(cellText()).toBe('')
        expect(canvasElement.querySelector('input')).toBeNull()
    },
}
