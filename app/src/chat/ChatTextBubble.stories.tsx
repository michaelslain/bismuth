// Visual spec for <ChatTextBubble> — one turn's prose, rendered through the same note markdown
// pipeline every note uses, so a message reads exactly like a note. Shared by ChatUserTurn's
// bubble and ChatAssistantTurn's text parts (see their own stories for the composed shapes); this
// one isolates the bubble itself, including the empty-text no-render case.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, fn, waitFor, within } from 'storybook/test'
import ChatTextBubble from './ChatTextBubble'

const meta = {
    title: 'Chat/ChatTextBubble',
    component: ChatTextBubble,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatTextBubble>

export default meta
type Story = StoryObj<typeof meta>

const proseText = [
    'A few things landed:',
    '',
    '- **Faster startup** — the daemon now boots in under a second',
    '- `bismuth daemon logs` now supports `--since`',
    '',
    '> Worth noting: the old flag still works, just deprecated.',
].join('\n')

/** Assistant prose — headings, a bulleted list and a bold run render as real markdown. Rendered in
 *  a 360px column (a narrow pane), where `--since` used to split at its hyphen. */
export const Assistant: Story = {
    render: () => (
        <div style={{ width: '360px' }}>
            <ChatTextBubble text={proseText} role="assistant" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/Faster startup/)).toBeInTheDocument()
        const code = canvas.getByText('--since')
        // Inline code must not break mid-token (design #8).
        await expect(getComputedStyle(code).overflowWrap).toBe('normal')
        // ...and a hyphenated flag never splits at its dashes (`--since` -> `-` / `-since`): a
        // span broken across two lines has two client rects, an unbroken one has exactly one.
        await expect(code.getClientRects().length).toBe(1)
    },
}

/** A long inline span (a path, a quoted command) must not push the transcript sideways: it is
 *  capped at the column and scrolls inside itself, while a short span (`--since`) still never
 *  wraps. Without the cap `nowrap` alone grew the whole transcript a horizontal scrollbar under
 *  ~760px. A fence (`pre code`) is untouched — it keeps its own scroller. */
export const LongInlineCode: Story = {
    render: () => (
        <div data-testid="column" style={{ width: '360px' }}>
            <ChatTextBubble
                text={[
                    'Run `bun run core/src/server.ts --vault /Users/m/Documents/dev/bismuth/.dev-vault/vault --memory /Users/m/Documents/dev/bismuth/.dev-vault/memory` first,',
                    'then pass `--since` to `bismuth daemon logs`.',
                ].join(' ')}
                role="assistant"
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const column = canvas.getByTestId('column')
        const long = canvas.getByText(/^bun run core\/src\/server\.ts/)
        await expect(long.textContent!.length).toBeGreaterThanOrEqual(120)
        // the span did not push anything past the 360px column
        await expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth)
        await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(canvasElement.clientWidth)
        await expect(long.getBoundingClientRect().width).toBeLessThanOrEqual(
            column.getBoundingClientRect().width,
        )
        // ...it scrolls inside itself instead
        await expect(long.scrollWidth).toBeGreaterThan(long.clientWidth)
        // and the short span the `nowrap` exists for is still one unbroken box
        await expect(canvas.getByText('--since').getClientRects().length).toBe(1)
    },
}

/** A plain sent message — the user role carries the same prose register (bubbles dissolve; both
 *  roles share `.chat-bubble`). */
export const User: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble text="Summarize the vault." role="user" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Summarize the vault.')).toBeInTheDocument()
    },
}

/** A markdown table is a TYPED grid — `+ - | =` through AsciiCellEdges — never drawn borders
 *  (DESIGN.md's Typed Grid Rule). No cell carries a border; every cell hosts one edge overlay, and
 *  the header types a heavy `=` underline. */
export const TypedTable: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble
                text={[
                    '| flag | meaning |',
                    '| --- | --- |',
                    '| `--since` | only logs after a date |',
                    '| `--follow` | stream new lines |',
                ].join('\n')}
                role="assistant"
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const cells = Array.from(canvasElement.querySelectorAll('th, td'))
        await expect(cells.length).toBe(6)
        for (const cell of cells) {
            const cs = getComputedStyle(cell)
            await expect(cs.borderTopWidth).toBe('0px')
            await expect(cs.borderLeftWidth).toBe('0px')
            await expect(cell.querySelector('[data-edges]')).not.toBeNull()
        }
        const header = canvasElement.querySelector('th [data-edges]') as HTMLElement
        await expect(header.dataset.heavy).toBe('bottom')
        // PAINTED, not just mounted: the overlay has a box, and its mask is the glyph sprite (a
        // data: PNG) rather than the transparent placeholder that holds until the UI font installs
        // the sprites — a mounted-but-blank grid has the placeholder.
        const box = header.getBoundingClientRect()
        await expect(box.width).toBeGreaterThan(0)
        await expect(box.height).toBeGreaterThan(0)
        await waitFor(() =>
            expect(getComputedStyle(header).webkitMaskBoxImageSource).toContain(
                'data:image/png',
            ),
        )
        // the first body row omits `top` — the header's `=` is that line
        const firstBody = canvasElement.querySelector('tbody tr td [data-edges]') as HTMLElement
        await expect(firstBody.dataset.edges).not.toContain('top')
    },
}

/** Blank text (e.g. an image-only turn) renders nothing at all — no empty bubble shell. The
 *  caption is the story's own marker (so the canvas isn't literally blank pixels), not part of
 *  ChatTextBubble; the assertion below is what actually proves the component renders nothing. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <p>blank text below renders no bubble:</p>
            <div data-testid="empty-host">
                <ChatTextBubble text="   " role="user" />
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const host = canvas.getByTestId('empty-host')
        await expect(host.querySelector('[data-chat-bubble-wrap]')).toBeNull()
    },
}

/** Right-click a bubble fires `onContextMenu` — the transcript owns the actual Reply/Copy menu. */
export const ContextMenu: Story = {
    render: args => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble
                text="Right-click me."
                role="assistant"
                onContextMenu={args.onContextMenu}
            />
        </div>
    ),
    args: { onContextMenu: fn() },
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        const bubble = canvas.getByText('Right-click me.')
        await fireEvent.contextMenu(bubble)
        await expect(args.onContextMenu).toHaveBeenCalled()
    },
}
