// Visual spec for <ChatTextBubble> — one turn's prose, rendered through the same note markdown
// pipeline every note uses, so a message reads exactly like a note. Shared by ChatUserTurn's
// bubble and ChatAssistantTurn's text parts (see their own stories for the composed shapes); this
// one isolates the bubble itself, including the empty-text no-render case.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'
import ChatTextBubble from './ChatTextBubble'
import { stubClipboard } from '../ui/_clipboardStub'
import { ToastHost } from '../ui/ToastHost'
import { parseButtonBlock, buttonKey } from '../../../core/src/buttons/buttonBlock'
import { setButtonRuntime } from '../buttons/buttonRuntime'
import { createSignal } from 'solid-js'
import TextButton from '../ui/TextButton'
import { foldArrows, noteProseReady } from '../ui/_noteProseReady'

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
        await noteProseReady(canvasElement)
        await expect(canvas.getByText(/Faster startup/)).toBeInTheDocument()
        // Nothing pushes the 360px column sideways.
        await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(
            canvasElement.clientWidth,
        )
    },
}

const lineRefText = [
    'The claim you want to tighten is [[Proposal#L12]], and the evidence for it sits in [[Proposal#L3-L8]].',
    '',
    'A heading link still reads as the note name: [[Proposal#Goals]].',
].join('\n')

/** A reply citing a note's lines while line numbers are on (core/src/chatLineRefNote.ts): each
 *  `[[Note#L12]]` reads as `Proposal:12`, a range as `Proposal:3–8`, and a click opens the note
 *  with those lines selected. A heading anchor keeps reading as the bare note name. */
export const LineReferences: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <ChatTextBubble text={lineRefText} role="assistant" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const labels = [
            ...canvasElement.querySelectorAll('[data-line-anchor]'),
        ].map(el => el.textContent)
        await expect(labels).toEqual([':12', ':3–8'])
        const text = canvasElement.querySelector<HTMLElement>('.cm-content')!.innerText
        await expect(text).toContain('Proposal:12')
        await expect(text).toContain('Proposal:3–8')
        await expect(text).not.toContain('#L12')
        await expect(text).not.toContain('Goals')
    },
}

const fenceText = [
    'Run the migration, then restart:',
    '',
    '```sh',
    'bun run db:migrate',
    'bun run daemon restart',
    'bun run daemon logs --since 5m',
    '```',
    '',
    'Both steps are safe to repeat.',
].join('\n')

/** A fence's lines are the paragraph's pitch: the `pre` keeps the prose size so its row height is a
 *  prose row, and the smaller mono run sits inside it. A fence on its own tighter leading read as a
 *  cramped patch pasted into the message. */
export const CodeFence: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <ChatTextBubble text={fenceText} role="assistant" />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        // The fence wears the note's code header: its ```lang label and one copy button.
        await expect(
            await canvas.findAllByRole('button', { name: 'Copy code' }),
        ).toHaveLength(1)
        await expect(canvas.getByText('bun run db:migrate')).toBeInTheDocument()
    },
}

const quoteText = [
    'From the design notes:',
    '',
    '> Every block copies itself: a code block from its header, a quote from the end of its first',
    '> line. The copy is the text without its quote markers.',
    '',
    'That is the whole rule.',
].join('\n')

/** A quote in a reply wears the same copy button a quote in a note does, at the right of its first
 *  line; the code block's "Copy code" and the message's own copy are separate controls. */
export const Quote: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <ChatTextBubble text={quoteText} role="assistant" />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        await expect(
            await canvas.findAllByRole('button', { name: 'Copy quote' }),
        ).toHaveLength(1)
    },
}

/** A reply that OPENS with a quote: the quote's copy button holds the top-right corner, so the
 *  message's own copy drops to the bottom-right instead of stacking on it. */
export const OpensWithQuote: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <ChatTextBubble
                text={'> Quoted from your note: keep the copy plain text.\n\nAgreed, and the same goes for code.'}
                role="assistant"
            />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        const quote = await canvas.findByRole('button', { name: 'Copy quote' })
        const message = canvas.getByRole('button', { name: 'Copy message' })
        // The two controls sit in different corners: the message copy is below the quote's.
        await expect(message.getBoundingClientRect().top).toBeGreaterThan(
            quote.getBoundingClientRect().bottom,
        )
    },
}

/** A reply that OPENS with a callout: the callout's copy button holds the top-right corner of its
 *  title row, so the message's own copy drops to the bottom-right. */
export const OpensWithCallout: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <ChatTextBubble
                text={'> [!note] Heads up\n> The copy is the body, not the title.\n\nThat matches code blocks.'}
                role="assistant"
            />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        const callout = await canvas.findByRole('button', { name: 'Copy callout' })
        const message = canvas.getByRole('button', { name: 'Copy message' })
        await expect(message.getBoundingClientRect().top).toBeGreaterThan(
            callout.getBoundingClientRect().bottom,
        )
    },
}

const twoFenceText = [
    '```ts',
    "export const greet = (name: string) => `hi ${name}`",
    '```',
    '',
    'And the shell side:',
    '',
    '```',
    'bun run greet --name ada',
    '```',
].join('\n')

/** Two fences, opening and closing the message: each wears its own ```lang header and copy button
 *  (the same CodeHeader a note shows), and clicking one copies exactly that fence's code. */
export const TwoFences: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <ChatTextBubble text={twoFenceText} role="assistant" />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        const buttons = await waitFor(() => {
            const b = canvas.getAllByRole('button', { name: 'Copy code' })
            if (b.length !== 2) throw new Error('fences not adopted yet')
            return b
        })
        await expect(canvas.getAllByTestId('code-lang').map(e => e.textContent)).toEqual([
            '```ts',
            '```',
        ])
        const clip = stubClipboard()
        await userEvent.click(buttons[1]!)
        await userEvent.click(buttons[0]!)
        await waitFor(() =>
            expect(clip.written()).toEqual([
                'bun run greet --name ada',
                'export const greet = (name: string) => `hi ${name}`',
            ]),
        )
        await waitFor(() => expect(canvas.getAllByText('Copied').length).toBeGreaterThan(0))
        clip.restore()
        // Leave the story at rest: no focused copy button still showing.
        ;(document.activeElement as HTMLElement | null)?.blur()
        // Fences at both ends leave no free corner: the message copy yields to the fences' own.
        const msg = canvasElement.querySelector('[aria-label="Copy message"]')!
        await expect(getComputedStyle(msg).display).toBe('none')
    },
}

const fenceFirstText = ['```sh', 'bun run db:migrate', '```', '', 'Safe to repeat.'].join('\n')

/** A message that opens with a fence: the fence's copy holds the top-right, so the message's own
 *  copy sits at the bottom-right, never on top of it. */
export const OpensWithFence: Story = {
    render: () => (
        <div style={{ width: '480px' }}>
            <ChatTextBubble text={fenceFirstText} role="assistant" />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        const code = await waitFor(() => canvas.getByRole('button', { name: 'Copy code' }))
        const msg = canvas.getByRole('button', { name: 'Copy message' })
        const a = code.getBoundingClientRect()
        const b = msg.getBoundingClientRect()
        const apart =
            a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
        await expect(apart).toBe(true)
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
        await noteProseReady(canvasElement)
        const column = canvas.getByTestId('column')
        // A long inline span never pushes the transcript sideways.
        await expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth)
        await expect(canvasElement.scrollWidth).toBeLessThanOrEqual(
            canvasElement.clientWidth,
        )
    },
}

/** Offset of `el`'s own text baseline from the baseline of the line it sits in, in px. A zero-size
 *  inline-block's top edge is the baseline of whatever line holds it, so one marker beside the
 *  element and one inside it compare the two baselines in any engine. */
const baselineOffset = (el: Element) => {
    const mark = () => {
        const m = document.createElement('span')
        m.style.cssText = 'display:inline-block;width:0;height:0'
        return m
    }
    const outside = mark()
    const inside = mark()
    el.parentNode!.insertBefore(outside, el)
    el.insertBefore(inside, el.firstChild)
    const d =
        inside.getBoundingClientRect().top - outside.getBoundingClientRect().top
    outside.remove()
    inside.remove()
    return d
}

/** Inline code and inline math sit on the prose baseline. Inline code is a scroll container (see
 *  LongInlineCode), and an inline-block scroll container aligns by its bottom edge, which dropped
 *  every chip ~3px below the sentence. */
export const InlineBaseline: Story = {
    render: () => (
        <div style={{ width: '560px' }}>
            <ChatTextBubble
                text={
                    'All 7 questions are now `###` headings under your `## Questions` section, and $x^2 + y^2 = r^2$ sits on the line too.'
                }
                role="assistant"
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        for (const text of ['###', '## Questions']) {
            await expect(
                Math.abs(baselineOffset(canvas.getByText(text))),
            ).toBeLessThanOrEqual(0.5)
        }
        const math = await waitFor(() => {
            const el = canvasElement.querySelector('.katex')
            if (!el) throw new Error('math not rendered yet')
            return el
        })
        await expect(Math.abs(baselineOffset(math))).toBeLessThanOrEqual(0.5)
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
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Summarize the vault.'),
        ).toBeInTheDocument()
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
        await noteProseReady(canvasElement)
        // The note's rendered table: every cell is there, and none draws a border — a note's
        // table is a typed grid (DESIGN.md's Typed Grid Rule).
        const cells = await waitFor(() => {
            const c = Array.from(canvasElement.querySelectorAll('th, td'))
            if (c.length !== 6) throw new Error(`table cells: ${c.length}`)
            return c
        })
        for (const cell of cells)
            await expect(getComputedStyle(cell).borderLeftWidth).toBe('0px')
    },
}

/** A table as an agent writes one, in the 360px transcript: MarkdownTable sizes the columns — a path
 *  wraps at its `/` and `.` joints, the prose column takes the wrapping, `done` stays one word. */
export const NarrowTable: Story = {
    render: () => (
        <div style={{ width: '360px' }}>
            <ChatTextBubble
                text={[
                    'Here is what changed:',
                    '',
                    '| file | what changed | status |',
                    '| --- | --- | --- |',
                    '| `app/src/chat/ChatTextBubble.module.css` | cells keep whole words, so a short column never splits mid-letter | done |',
                    '| `core/src/vault.ts` | rename moves the companion note with the file | done |',
                ].join('\n')}
                role="assistant"
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const bubble = canvasElement.querySelector(
            '[data-chat-bubble]',
        ) as HTMLElement
        // A note's table keeps itself inside the message: wider than the column, it scrolls
        // sideways in its own box instead of pushing the transcript.
        const scroll = await waitFor(() => {
            const el = canvasElement.querySelector('.cm-table-scroll')
            if (!el || canvasElement.querySelectorAll('td').length !== 6)
                throw new Error('table not rendered yet')
            return el
        })
        await waitFor(() =>
            expect(scroll.getBoundingClientRect().right).toBeLessThanOrEqual(
                bubble.getBoundingClientRect().right + 1,
            ),
        )
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
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        const bubble = canvas.getByText('Right-click me.')
        await fireEvent.contextMenu(bubble)
        await expect(args.onContextMenu).toHaveBeenCalled()
    },
}

const buttonText = [
    'I can take this further. Pick one:',
    '',
    '```button',
    '- label: Summarize this week',
    '  kind: primary',
    '  prompt: Summarize what changed in the vault this week.',
    '- label: Open daemon',
    '  command: open-daemon',
    '- label: Show open tasks',
    '  send: What tasks are still open?',
    '```',
    '',
    'Or tell me what you need.',
].join('\n')

/** An assistant message's ```button fence is a live row inside the bubble, in the prose column; a
 *  `send` chip hands its text to `onSend` (the session's next user message). */
export const ButtonsAssistant: Story = {
    beforeEach: () => {
        setButtonRuntime({
            parse: parseButtonBlock,
            key: buttonKey,
            press: async () => ({
                ok: false,
                reason: 'invalid',
                message: 'story runtime',
            }),
            states: async () => ({}),
            runCommand: async () => {},
            commandLabel: id => (id === 'open-daemon' ? 'Open daemon' : undefined),
            daemonEnabled: () => true,
            notOwner: () => false,
            isTrusted: () => true,
            trust: () => {},
        })
    },
    args: { onSend: fn() },
    render: args => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble
                text={buttonText}
                role="assistant"
                chatId="story-chat"
                onSend={args.onSend}
            />
        </div>
    ),
    play: async ({ canvasElement, args }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        const send = await canvas.findByRole('button', { name: /show open tasks/ })
        await expect(canvas.getByRole('button', { name: /summarize this week/ })).toBeInTheDocument()
        await fireEvent.click(send)
        await waitFor(() =>
            expect(args.onSend).toHaveBeenCalledWith('What tasks are still open?'),
        )
    },
}

/** The same fence in a USER message stays inert muted text: `[label]` per button, primary last. */
export const ButtonsUser: Story = {
    render: args => (
        <div style={{ width: '600px' }}>
            <ChatTextBubble
                text={buttonText}
                role="user"
                chatId="story-chat"
                onSend={args.onSend}
            />
        </div>
    ),
    args: { onSend: fn() },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        // A fence you wrote never runs: its row is the inert labels, nothing to press.
        await expect(canvas.queryAllByRole('button', { name: /open daemon/ })).toHaveLength(0)
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-button-block]')?.textContent,
            ).toBe('[open daemon] [show open tasks] [summarize this week]'),
        )
    },
}

const foldText = [
    '## Setup',
    '',
    'Install once, then run the dev server.',
    '',
    '- **Install**',
    '    - `bun install` at the repo root',
    '        - once per clone',
    '        - again after a lockfile change',
    '    - `bun run hooks:install` on a fresh clone',
    '- Run `bun run dev:browser`',
    '',
    '### Ports',
    '',
    'Core listens on 4321, Vite on 1420.',
    '',
    '## Troubleshooting',
    '',
    'A second dev server dies with `EADDRINUSE`.',
].join('\n')

const SETUP = 'h|2|Setup|0'
const PORTS = 'h|3|Ports|0'
const TROUBLE = 'h|2|Troubleshooting|0'
const INSTALL = 'l|**Install**|0'
const BUN_INSTALL = 'l|`bun install` at the repo root|0'

/** A message folds exactly as a note does, because it IS the note view: hover a heading, or a
 *  bullet at any depth that has sub-items, and the note's fold triangle shows in the left gutter;
 *  click it to fold that section or sub-list. The 40px left padding is the transcript's gutter. */
export const Folds: Story = {
    render: () => (
        <div style={{ width: '420px', 'padding-left': '40px' }}>
            <ChatTextBubble text={foldText} role="assistant" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        // One triangle per heading with something under it, and per bullet with sub-items — the
        // sub-bullet with its own children included, the leaves not.
        const arrows = foldArrows(canvasElement)
        await expect([...arrows.keys()].sort()).toEqual(
            [SETUP, PORTS, TROUBLE, INSTALL, BUN_INSTALL].sort(),
        )
        // Every heading triangle hangs in the gutter, wholly left of the text column.
        const left = canvasElement
            .querySelector('[data-chat-bubble]')!
            .getBoundingClientRect().left
        for (const id of [SETUP, PORTS, TROUBLE])
            await expect(
                arrows.get(id)!.getBoundingClientRect().right,
            ).toBeLessThanOrEqual(left)
        // Folding "Setup" folds its section, the nested "Ports" with it, but not the next h2.
        await userEvent.click(arrows.get(SETUP)!)
        await waitFor(() =>
            expect(canvas.queryByText(/Install once/)).not.toBeInTheDocument(),
        )
        await expect(canvas.queryByText(/Core listens/)).not.toBeInTheDocument()
        await expect(canvas.getByText(/EADDRINUSE/)).toBeInTheDocument()
        // ...and it opens again.
        await userEvent.click(foldArrows(canvasElement).get(SETUP)!)
        await expect(await canvas.findByText(/Install once/)).toBeInTheDocument()
        // A sub-bullet with children folds its own sub-list; its text and its siblings stay.
        await userEvent.click(foldArrows(canvasElement).get(BUN_INSTALL)!)
        await waitFor(() =>
            expect(canvas.queryByText(/once per clone/)).not.toBeInTheDocument(),
        )
        await expect(canvas.getByText(/at the repo root/)).toBeInTheDocument()
        await expect(canvas.getByText(/on a fresh clone/)).toBeInTheDocument()
    },
}

/** The same message with the "Install" list and "Troubleshooting" folded: folded triangles point
 *  right and stay shown without a hover. */
export const Folded: Story = {
    render: () => (
        <div style={{ width: '420px', 'padding-left': '40px' }}>
            <ChatTextBubble text={foldText} role="assistant" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        await userEvent.click(foldArrows(canvasElement).get(INSTALL)!)
        await userEvent.click(foldArrows(canvasElement).get(TROUBLE)!)
        await waitFor(() =>
            expect(canvas.queryByText(/EADDRINUSE/)).not.toBeInTheDocument(),
        )
        for (const id of [INSTALL, TROUBLE]) {
            const arrow = foldArrows(canvasElement).get(id)!
            await waitFor(() => expect(getComputedStyle(arrow).opacity).toBe('1'))
            await expect(
                arrow.querySelector('[data-fold-glyph]'),
            ).toHaveAttribute('data-collapsed')
        }
    },
}

/** A streaming reply grows the same document: a folded section stays folded as text is appended
 *  below it. */
export const FoldSurvivesStreaming: Story = {
    render: () => {
        const [text, setText] = createSignal(foldText)
        return (
            <div style={{ width: '420px', 'padding-left': '40px' }}>
                <ChatTextBubble text={text()} role="assistant" />
                <TextButton
                    onClick={() => setText(text() + '\n\nOne more line.')}
                >
                    stream
                </TextButton>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        await userEvent.click(foldArrows(canvasElement).get(SETUP)!)
        await waitFor(() =>
            expect(canvas.queryByText(/Install once/)).not.toBeInTheDocument(),
        )
        await userEvent.click(canvas.getByRole('button', { name: /stream/ }))
        await expect(await canvas.findByText('One more line.')).toBeInTheDocument()
        await expect(canvas.queryByText(/Install once/)).not.toBeInTheDocument()
    },
}

const commentedFenceText = [
    '## Setup',
    '',
    'Run these once:',
    '',
    '```sh',
    '# install the workspaces',
    'bun install',
    '# then the hooks',
    'bun run hooks:install',
    '```',
    '',
    'And the config, if you keep one:',
    '',
    '```yaml',
    '# where the vault lives',
    'vault: ~/notes',
    '```',
    '',
    '## Next',
    '',
    'Start the dev server.',
].join('\n')

const SETUP_FENCED = 'h|2|Setup|0'
const NEXT_FENCED = 'h|2|Next|0'

/** Code with `#` comments — a shell or yaml fence, the usual reply. A `#` line inside a fence is
 *  code, so it carries no fold triangle and a click on the block's line numbers leaves every line
 *  in place; folding the heading above takes both fences whole and stops at the next heading. */
export const CommentedFences: Story = {
    render: () => (
        <div style={{ width: '420px', 'padding-left': '40px' }}>
            <ChatTextBubble text={commentedFenceText} role="assistant" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        const codeLines = () =>
            [...canvasElement.querySelectorAll('.cm-codeblock')].map(
                l => l.textContent,
            )
        const all = [
            '# install the workspaces',
            'bun install',
            '# then the hooks',
            'bun run hooks:install',
            '# where the vault lives',
            'vault: ~/notes',
        ]
        await expect(codeLines()).toEqual(all)
        // Only the two real headings fold.
        await expect([...foldArrows(canvasElement).keys()].sort()).toEqual(
            [NEXT_FENCED, SETUP_FENCED].sort(),
        )
        // Press on the first comment line's number, where a triangle would hang: nothing folds.
        const comment = [
            ...canvasElement.querySelectorAll<HTMLElement>('.cm-codeblock'),
        ][0]!
        const r = comment.getBoundingClientRect()
        const spot = document.elementFromPoint(r.left - 14, r.top + r.height / 2)
        if (spot) await userEvent.click(spot)
        await new Promise(res => setTimeout(res, 400))
        await expect(codeLines()).toEqual(all)
        await expect(canvas.getByText(/And the config/)).toBeInTheDocument()
        // Folding "Setup" hides both fences whole and leaves "Next" open; unfolding brings them back.
        await userEvent.click(foldArrows(canvasElement).get(SETUP_FENCED)!)
        await waitFor(() => expect(codeLines()).toEqual([]))
        await expect(canvas.getByText(/Start the dev server/)).toBeInTheDocument()
        await userEvent.click(foldArrows(canvasElement).get(SETUP_FENCED)!)
        await waitFor(() => expect(codeLines()).toEqual(all))
    },
}
