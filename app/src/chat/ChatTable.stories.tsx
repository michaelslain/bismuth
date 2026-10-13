// Visual spec for <ChatTable> — the frame a chat message puts around a markdown table. The table
// itself is the one a note renders (ui/table/typeTable.ts; Editor.stories.tsx's TableMatchesChat
// shows the two side by side); what this story covers is chat's own part: a transcript-width column,
// and the sideways scroll when a table cannot fit it. Each story renders its markdown through the
// renderNoteBody pipeline a message uses and hands ChatTable the resulting `<table>`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { renderNoteBody } from '../bases/markdown'
import ChatTable from './ChatTable'

const meta = {
    title: 'Chat/ChatTable',
    component: ChatTable,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatTable>

export default meta
type Story = StoryObj<typeof meta>

const tableOf = (md: string) => {
    const host = document.createElement('div')
    host.innerHTML = renderNoteBody(md)
    return host.querySelector('table') as HTMLTableElement
}

const summaryTable = [
    '| file | what changed | status |',
    '| --- | --- | --- |',
    '| `app/src/chat/ChatTextBubble.module.css` | cells keep whole words, so a short column never splits mid-letter | done |',
    '| `core/src/vault.ts` | rename moves the companion note with the file | done |',
    '| `docs/chat/overview.md` | tables section | todo |',
].join('\n')

const wideTable = [
    '| step | command | result | took | notes |',
    '| --- | --- | --- | --- | --- |',
    '| typecheck | `bun run typecheck` | pass | 41s | all seven workspaces |',
    '| tests | `bun test core/test/vault.test.ts` | pass | 3s | one file |',
    '| visual | `bun run visual --base http://localhost:6201` | 2 flags | 1m12s | both are the known calendar flake |',
].join('\n')

const Column = (props: { width: number; md: string; id: string }) => {
    // built once: a `table={tableOf(…)}` prop is a getter, and every read would build a new table
    const table = tableOf(props.md)
    return (
        <div style={{ width: `${props.width}px` }} data-testid={props.id}>
            <ChatTable {...{ table }} />
        </div>
    )
}

/** A table as an agent writes one — a code-path column, a prose column, a one-word column — in the
 *  360px transcript and at 600px, plus a five-column table that cannot fit 360px at all. Columns
 *  size to their content: a one-word column takes its word's width and never wraps, no word splits
 *  mid-letter, a path wraps at its `/` and `.` joints, the prose column absorbs the wrapping, and a
 *  table whose narrowest layout is still too wide scrolls inside its own frame. */
export const AutoSizedColumns: Story = {
    args: { table: document.createElement('table') },
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '24px' }}
        >
            <Column width={360} md={summaryTable} id="narrow" />
            <Column width={600} md={summaryTable} id="wide" />
            <Column width={360} md={wideTable} id="overflow" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        for (const id of ['narrow', 'wide', 'overflow']) {
            const host = canvasElement.querySelector(
                `[data-testid="${id}"]`,
            ) as HTMLElement
            const frame = host.querySelector('[data-chat-table]') as HTMLElement
            // the frame never widens its column: overflow scrolls inside it
            await expect(
                frame.getBoundingClientRect().width,
            ).toBeLessThanOrEqual(host.clientWidth + 0.5)
            // every cell types its own edges
            for (const cell of Array.from(host.querySelectorAll('th, td')))
                await expect(cell.querySelector('[data-edges]')).not.toBeNull()
            // a one-word cell stays on one line: no mid-word split
            for (const td of Array.from(host.querySelectorAll('td'))) {
                if (
                    td.querySelector('code') ||
                    !/^\S+$/.test(td.textContent!.trim())
                )
                    continue
                const range = document.createRange()
                range.selectNodeContents(td.firstChild!)
                const lines = new Set(
                    Array.from(range.getClientRects()).map(r =>
                        Math.round(r.top),
                    ),
                )
                await expect(lines.size).toBe(1)
            }
        }
        const overflow = canvasElement.querySelector(
            '[data-testid="overflow"] [data-chat-table]',
        ) as HTMLElement
        await expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth)
        // a path wraps at its joints, never mid-segment: every code token's pieces are intact
        const code = canvasElement.querySelector(
            '[data-testid="narrow"] td code',
        )!
        await expect(code.querySelectorAll('wbr').length).toBeGreaterThan(0)
        await expect(code.textContent).toBe(
            'app/src/chat/ChatTextBubble.module.css',
        )
    },
}
