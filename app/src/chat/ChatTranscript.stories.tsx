// Visual spec for <ChatTranscript> — the scrollable message list. Covers the shapes Acceptance
// calls out (lowercase turn labels, tool-row layout, bold-not-larger prose, no dead empty band)
// plus the transient rows (awaiting reply, turn error) and narrow layout. `play()` stories prove
// the callback wiring the interface promises: cancel-queued, a permission answer, and the bubble
// context menu's Reply.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import {
    expect,
    fireEvent,
    fn,
    userEvent,
    waitFor,
    within,
} from 'storybook/test'
import { createSignal, Show, type Component } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import ChatTranscript from './ChatTranscript'
import {
    applyChatFrame,
    buildTranscript,
    type TurnItem,
} from './chatTranscriptLogic'
import EmptyState from '../ui/EmptyState'
import { foldArrows, noteProseReady } from '../ui/_noteProseReady'
import {
    COMMAND_OUTPUT_ITEMS,
    CONVERSATION_ITEMS,
    IMAGE_TURN_ITEMS,
    INLINE_PROMPT_ITEMS,
    MULTI_TURN_ITEMS,
    QUEUED_ITEMS,
    SYSTEM_NOTE_ITEMS,
    THINKING_ITEMS,
    TOOL_CALL_ITEMS,
    longFrames,
} from './_transcriptFixtures'

const meta = {
    title: 'Chat/ChatTranscript',
    component: ChatTranscript,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatTranscript>

export default meta
type Story = StoryObj<typeof meta>

const noop = {
    onAnswerPermission: fn(),
    onAnswerQuestion: fn(),
    onCancelQueued: fn(),
    onReply: fn(),
}

// CONVERSATION_ITEMS[1] is the assistant turn's sole text part — the exact string a bubble
// right-click "Reply" must quote.
const conversationAssistantText =
    CONVERSATION_ITEMS[1].role === 'assistant' &&
    CONVERSATION_ITEMS[1].parts[0].kind === 'text'
        ? CONVERSATION_ITEMS[1].parts[0].text
        : ''

/** A prose conversation, including a bulleted list with a bold run. */
export const Conversation: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        // Right-click the assistant's prose bubble → Reply, and confirm onReply fires with its
        // exact text (not just "was called").
        const bubble = canvas.getByText(/A few things landed/)
        await fireEvent.contextMenu(bubble)
        const replyRow = await canvas.findByText('Reply')
        await userEvent.click(replyRow)
        await expect(noop.onReply).toHaveBeenCalledWith(
            conversationAssistantText,
        )
    },
}

/** Collapse a message: the chevron beside a turn's label folds the whole turn to its label row and
 *  the first line of what it said; clicking again opens it. */
export const CollapsedTurn: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        const [, assistant] = canvas.getAllByRole('button', {
            name: 'Collapse message',
        })
        await userEvent.click(assistant!)
        await waitFor(() =>
            expect(canvas.queryByText(/Fixed a bug/)).not.toBeInTheDocument(),
        )
        // The folded row keeps the first line, and the turns around it are untouched.
        await expect(
            canvas.getAllByText('A few things landed:').length,
        ).toBeGreaterThan(0)
        await expect(canvas.getByText('Nice, thanks.')).toBeVisible()
        await expect(
            canvas.getByRole('button', { name: 'Expand message' }),
        ).toHaveAttribute('aria-expanded', 'false')
    },
}

const SECTIONED_ITEMS: TurnItem[] = [
    { role: 'user', text: 'How do I run it locally?' },
    {
        role: 'assistant',
        parts: [
            {
                kind: 'text',
                text: [
                    '## Setup',
                    '',
                    '- **Install**',
                    '    - `bun install` at the repo root',
                    '        - once per clone',
                    '        - again after a lockfile change',
                    '    - `bun run hooks:install` on a fresh clone',
                    '- Run `bun run dev:browser`',
                    '',
                    '## Troubleshooting',
                    '',
                    'A second dev server dies with `EADDRINUSE`.',
                ].join('\n'),
            },
        ],
        footer: null,
    },
]

/** Headings and bullets fold inside a transcript turn exactly as in a note (the message IS the note
 *  view), and every triangle — a section's, a sub-bullet's, the message's own — is the one fold
 *  glyph, hanging on one column in the gutter. Folding the turn takes its folds with it. */
export const FoldsInTurn: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={SECTIONED_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement, 2)
        const arrows = foldArrows(canvasElement)
        const section = arrows.get('h|2|Troubleshooting|0')!
        await expect(arrows.has('l|`bun install` at the repo root|0')).toBe(true)
        const message = canvas.getAllByRole('button', {
            name: 'Collapse message',
        })[1]!
        // Not clipped by the turn's own fold box: the section triangle paints where it sits.
        const r = section.getBoundingClientRect()
        const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
        )
        await expect(section.contains(hit)).toBe(true)
        // The message's triangle and a heading's sit on one column, left of the text.
        const centre = (el: Element) => {
            const g = el.querySelector('[data-fold-glyph]')!.getBoundingClientRect()
            return g.left + g.width / 2
        }
        await expect(Math.abs(centre(message) - centre(section))).toBeLessThan(1)
        const text = canvas.getByText('Troubleshooting').getBoundingClientRect()
        await expect(message.getBoundingClientRect().right).toBeLessThanOrEqual(
            text.left,
        )
        await userEvent.click(section)
        await waitFor(() =>
            expect(canvas.queryByText(/EADDRINUSE/)).not.toBeInTheDocument(),
        )
    },
}

/** Select a phrase mid-bubble: the floating `[reply]` sits over the line of prose above it, so its
 *  own opaque surface is what keeps the label legible against the text behind. */
export const SelectionReply: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const item = within(canvasElement).getByText(
            /queued messages could double-send/,
        )
        const textNode = [...item.childNodes].find(
            n => n.nodeType === 3 && n.textContent?.includes('queued'),
        ) as Text
        const start = textNode.data.indexOf('queued messages')
        const range = document.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, start + 'queued messages'.length)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        await fireEvent.mouseUp(item)
        // Portalled to <body>: a pane is `contain: strict`, so a fixed element left inside it would
        // be placed relative to the pane, not the viewport.
        const reply = await within(document.body).findByRole('button', {
            name: 'reply',
        })
        await expect(canvasElement.contains(reply)).toBe(false)
        // The surface behind the label is opaque, not the transparent bracket register.
        const surface = reply.closest('[data-popover]')
        await expect(surface).not.toBeNull()
        // It sits centred over the selection, just above it.
        const sr = range.getBoundingClientRect()
        const pr = (surface as Element).getBoundingClientRect()
        await expect(
            Math.abs(pr.left + pr.width / 2 - (sr.left + sr.width / 2)),
        ).toBeLessThan(2)
        await expect(pr.bottom).toBeLessThanOrEqual(sr.top)
        await expect(sr.top - pr.bottom).toBeLessThan(16)
        const bg = getComputedStyle(surface as Element).backgroundColor
        await expect(bg).not.toBe('rgba(0, 0, 0, 0)')
        await expect(bg).not.toBe('transparent')
    },
}

/** Every face in the canvas, and every label reading `name`, top to bottom. */
function facesAndLabels(canvasElement: HTMLElement, name: string) {
    const faces = [
        ...canvasElement.querySelectorAll<HTMLElement>(
            '[data-testid="daemon-face"]',
        ),
    ]
    const labels = within(canvasElement)
        .getAllByText(name)
        .map(el => el.getBoundingClientRect())
        .sort((a, b) => a.top - b.top)
    return { faces, labels }
}

/** The one face sits on the row of the LAST `name` label, to its left. */
async function expectFaceOnLastLabel(canvasElement: HTMLElement, name: string) {
    const { faces, labels } = facesAndLabels(canvasElement, name)
    await expect(faces.length).toBe(1)
    const f = faces[0].getBoundingClientRect()
    const last = labels[labels.length - 1]
    await expect(
        Math.abs(f.top + f.height / 2 - (last.top + last.height / 2)),
    ).toBeLessThan(4)
    await expect(f.right).toBeLessThan(last.left)
    return { face: faces[0], labels }
}

/** Several exchanges: the bot's face is the avatar of the LOWEST assistant turn only, with the name
 *  to its right; every earlier assistant turn shows just the name. */
export const LowestTurnAvatar: Story = {
    render: () => (
        <div style={{ width: '760px', height: '620px', display: 'flex' }}>
            <ChatTranscript
                items={MULTI_TURN_ITEMS}
                persona="Sage"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const { face, labels } = await expectFaceOnLastLabel(
            canvasElement,
            'sage',
        )
        await expect(labels.length).toBe(3)
        await expect(face.getAttribute('aria-label')).toBe('sage — watching')
    },
}

/** Tool calls in every state: settled ok, settled error, still pending. */
export const ToolCalls: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={TOOL_CALL_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Grep')).toBeInTheDocument()
        await expect(canvas.getByText('Bash')).toBeInTheDocument()
        await expect(canvas.getByText('Read')).toBeInTheDocument()
    },
}

/** An unanswered permission, an already-answered one, and an AskUserQuestion card. */
export const InlinePrompts: Story = {
    render: args => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={INLINE_PROMPT_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                onAnswerPermission={args.onAnswerPermission}
                onAnswerQuestion={noop.onAnswerQuestion}
                onCancelQueued={noop.onCancelQueued}
                onReply={noop.onReply}
            />
        </div>
    ),
    args: { onAnswerPermission: fn() },
    play: async ({ canvasElement, args }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await userEvent.click(
            canvas.getAllByRole('button', { name: 'allow' })[0],
        )
        await expect(args.onAnswerPermission).toHaveBeenCalledWith(
            'perm-1',
            'allow',
            false,
        )
    },
}

/** A slash-command result renders as ordinary chat prose — no command-output box. */
export const SlashCommandReply: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={COMMAND_OUTPUT_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(canvas.getByText('/context')).toBeInTheDocument()
        // the note's table widget draws its cells after the view mounts
        await expect(await canvas.findByText('tokens')).toBeInTheDocument()
    },
}

/** No items — the caller's `empty` JSX centred, no dead band below it. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={[]}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                empty={<EmptyState>Ask bismuth anything.</EmptyState>}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Ask bismuth anything.'),
        ).toBeInTheDocument()
    },
}

/** Pre-first-delta — the "working" indicator under the persona's label, which carries the face
 *  while it waits. */
export const AwaitingReply: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={[
                    ...CONVERSATION_ITEMS,
                    { role: 'user', text: 'Summarize the vault.' },
                ]}
                persona="bismuth"
                awaitingReply
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/working/)).toBeInTheDocument()
        // The working row is the lowest assistant row, so it takes the face (thinking) and the
        // finished turn above it goes back to just the name.
        const { face } = await expectFaceOnLastLabel(canvasElement, 'bismuth')
        await expect(face.dataset.mood).toBe('thinking')
    },
}

/** A recoverable per-turn error, shown after the last turn. */
export const TurnError: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError="Lost connection to the daemon — retrying…"
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Lost connection to the daemon — retrying…'),
        ).toBeInTheDocument()
    },
}

/** A queued (staged) user turn, dimmed, with a cancel button. */
export const Queued: Story = {
    render: args => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={QUEUED_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                onAnswerPermission={noop.onAnswerPermission}
                onAnswerQuestion={noop.onAnswerQuestion}
                onCancelQueued={args.onCancelQueued}
                onReply={noop.onReply}
            />
        </div>
    ),
    args: { onCancelQueued: fn() },
    play: async ({ canvasElement, args }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await userEvent.click(
            canvas.getByRole('button', { name: 'Cancel queued message' }),
        )
        await expect(args.onCancelQueued).toHaveBeenCalledWith('q-abc')
    },
}

/** A narrow (360px) viewport — proves the reading column still reads at phone width. */
export const Narrow360: Story = {
    render: () => (
        <div style={{ width: '360px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText(/A few things landed/),
        ).toBeInTheDocument()
    },
}

/** A turn that reasoned before answering (ChatThinkingBlock, collapsed by default) followed by a
 *  non-error system notice (ChatSystemNote, BUG #87) — neither part kind had a story before. */
export const ThinkingAndSystemNote: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={[...THINKING_ITEMS, ...SYSTEM_NOTE_ITEMS]}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Thinking')).toBeInTheDocument()
        await expect(
            canvas.getByText('Browser control enabled for this turn.'),
        ).toBeInTheDocument()
    },
}

/** `inset="flush"` (the daemon page's usage): zero inline padding on the scroll list, so the turn
 *  column's left edge lands flush with the host's own left edge — no gap most other callers get
 *  from the default `inset="pane"`. */
export const Flush: Story = {
    render: () => (
        <div style={{ width: '520px', height: '400px', display: 'flex' }}>
            <ChatTranscript
                items={CONVERSATION_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                inset="flush"
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        const wrap = canvasElement.querySelector(
            '[class*="chat-list-wrap"]',
        ) as HTMLElement
        const line = canvas.getAllByText(/A few things landed/)[0]!
        // The text's first glyph sits at the wrap's own left edge — no inline padding. (A note
        // line's box starts at CodeMirror's 6px line inset, left of its text, so the text is what
        // is measured.)
        const range = document.createRange()
        range.selectNodeContents(line)
        await expect(Math.round(range.getClientRects()[0]!.left)).toBe(
            Math.round(wrap.getBoundingClientRect().left),
        )
    },
}

/** A user turn that arrives with sent images attached, no text. */
export const Images: Story = {
    render: () => (
        <div style={{ width: '760px', height: '520px', display: 'flex' }}>
            <ChatTranscript
                items={IMAGE_TURN_ITEMS}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                {...noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const canvas = within(canvasElement)
        await expect(canvas.getByAltText('attachment')).toBeInTheDocument()
        await expect(
            canvas.getByText('Got the screenshot — looking now.'),
        ).toBeInTheDocument()
    },
}

/** A long conversation (`turns` exchanges, each with prose, a list, code and a tool call) held in
 *  a Solid store and grown through `applyChatFrame` exactly as chatSession.ts does, so streaming
 *  into it costs what it costs in the app. `window.__chatStream(text)` appends one assistant delta
 *  and pings the append seam; bench/chatStreamPerf.ts drives it to time a token at length. */

const LongStream: Component<{ turns: number }> = props => {
    const [items, setItems] = createStore<TurnItem[]>(
        buildTranscript(longFrames(props.turns)),
    )
    const listeners = new Set<(force: boolean) => void>()
    ;(
        window as unknown as { __chatStream?: (text: string) => void }
    ).__chatStream = text => {
        let touched = false
        // The same write chatSession.ts's applyFrameToTranscript makes, so the bench times it.
        setItems(raw => {
            produce<TurnItem[]>(
                m =>
                    void (touched = applyChatFrame(m, {
                        type: 'assistant-text',
                        text,
                    })),
            )(raw)
            return items as TurnItem[]
        })
        if (touched) for (const l of listeners) l(false)
    }
    return (
        <div style={{ width: '760px', height: '720px', display: 'flex' }}>
            <ChatTranscript
                items={items}
                persona="bismuth"
                awaitingReply={false}
                turnError={null}
                subscribeAppend={l => {
                    listeners.add(l)
                    return () => listeners.delete(l)
                }}
                {...noop}
            />
        </div>
    )
}

/** 400 exchanges — the long chat a streamed token has to stay cheap in. */
export const LongConversation: Story = {
    render: () => <LongStream turns={400} />,
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement, 1)
        // Streaming into the tail keeps a following list pinned to the bottom, and the new prose
        // renders: the block-flow list and the store write chatStreamPerf.ts times still behave.
        const list = canvasElement
            .querySelector<HTMLElement>('[data-chat-bubble]')!
            .closest<HTMLElement>('[data-chat-list]')!
        list.scrollTop = list.scrollHeight
        const stream = (
            window as unknown as { __chatStream: (t: string) => void }
        ).__chatStream
        for (let i = 0; i < 20; i++) {
            stream(`streamed token ${i} `)
            await new Promise(r => requestAnimationFrame(r))
        }
        await expect(
            list.scrollHeight - list.scrollTop - list.clientHeight,
        ).toBeLessThan(40)
        await expect(
            within(canvasElement).getByText(/streamed token 19/),
        ).toBeTruthy()
    },
}

/** The same shape at 10 exchanges, the short baseline bench/chatStreamPerf.ts compares against. */
export const ShortConversation: Story = {
    render: () => <LongStream turns={10} />,
    play: LongConversation.play,
}

/** A long chat shown and hidden by a toggle, as a tab switch unmounts the transcript and mounts a
 *  fresh one on return. `chatId` is what keys the remembered spot. */
const LeaveAndReturn: Component<{ chatId: string }> = props => {
    const items = buildTranscript(longFrames(120))
    const [shown, setShown] = createSignal(true)
    ;(window as unknown as { __chatShown?: (v: boolean) => void }).__chatShown =
        setShown
    return (
        <div style={{ width: '760px', height: '720px', display: 'flex' }}>
            <Show when={shown()}>
                <ChatTranscript
                    chatId={props.chatId}
                    items={items}
                    persona="bismuth"
                    awaitingReply={false}
                    turnError={null}
                    {...noop}
                />
            </Show>
        </div>
    )
}

const frames = (n: number) =>
    new Promise<void>(async r => {
        for (let i = 0; i < n; i++)
            await new Promise(f => requestAnimationFrame(f))
        r()
    })

const listIn = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-chat-list]')!

/** Leave a chat scrolled up in it and come back: the same message is at the top of the list,
 *  at the same offset, after every message near it has swapped in its note view. */
export const ScrollKeptOnReturn: Story = {
    render: () => <LeaveAndReturn chatId="story-scroll-kept" />,
    play: async ({ canvasElement }) => {
        const show = (window as unknown as { __chatShown: (v: boolean) => void })
            .__chatShown
        await noteProseReady(canvasElement, 1)
        await frames(60) // the mount-time restore lets go
        let list = listIn(canvasElement)
        const target = list.children[200] as HTMLElement
        list.scrollTop = target.offsetTop - list.offsetTop + 20
        list.dispatchEvent(new Event('scroll'))
        await frames(60) // the rows around it mount their note views
        // read the spot as it stands after the views mounted, the way a person left it
        const before = target.offsetTop - list.offsetTop - list.scrollTop
        list.dispatchEvent(new Event('scroll'))
        show(false)
        await frames(2)
        show(true)
        await waitFor(
            () => {
                list = listIn(canvasElement)
                const row = list.children[200] as HTMLElement
                const after = row.offsetTop - list.offsetTop - list.scrollTop
                expect(Math.abs(after - before)).toBeLessThanOrEqual(2)
            },
            { timeout: 4000 },
        )
        await frames(60) // still there once every view near it has settled
        const row = list.children[200] as HTMLElement
        await expect(
            Math.abs(row.offsetTop - list.offsetTop - list.scrollTop - before),
        ).toBeLessThanOrEqual(2)
    },
}

/** Leave a long chat on its last message and come back: it is on its last message, not short of
 *  it, once the messages at the end have swapped in their note views. */
export const BottomKeptOnReturn: Story = {
    render: () => <LeaveAndReturn chatId="story-bottom-kept" />,
    play: async ({ canvasElement }) => {
        const show = (window as unknown as { __chatShown: (v: boolean) => void })
            .__chatShown
        await noteProseReady(canvasElement, 1)
        show(false)
        await frames(2)
        show(true)
        await frames(90)
        const list = listIn(canvasElement)
        await expect(
            list.scrollHeight - list.scrollTop - list.clientHeight,
        ).toBeLessThan(2)
    },
}
