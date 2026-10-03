// The first-run intro's static terminal panels.
//
// THIS COMPONENT RENDERED IN NO STORY AT ALL until 2026-08-28. It lived inside intro/marks.tsx
// behind two one-line wrapper components (`DaemonStage`, `ClaudeStage`), and that file's story
// exported only two of its four components — so the panel a new user sees on their very first run
// of the app was the one piece of UI nobody could look at without reinstalling.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TermPanel, { DAEMON_LINES, AGENT_LINES } from './TermPanel'

const meta = {
    title: 'Intro/TermPanel',
    component: TermPanel,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof TermPanel>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: any; width?: string }) => (
    <div
        style={{
            background: 'var(--bg)',
            padding: 'var(--sp-7)',
            width: props.width ?? '520px',
        }}
    >
        {props.children}
    </div>
)

/** The daemon panel, exactly as the intro ships it. */
export const Daemon: Story = {
    render: () => (
        <Frame>
            <TermPanel name="daemon // live" lines={DAEMON_LINES} />
        </Frame>
    ),
    // The leader is drawn by CSS and every ok value shares one minimum width, so the values form
    // one column: `running` and `+12 edges` end at the same x (and, being left-aligned in equal
    // boxes, start at the same x too).
    play: async ({ canvasElement }) => {
        const oks = [...canvasElement.querySelectorAll('[data-term-ok]')]
        expect(oks.length).toBe(2)
        const rights = oks.map(el => el.getBoundingClientRect().right)
        const lefts = oks.map(el => el.getBoundingClientRect().left)
        expect(Math.abs(rights[0] - rights[1])).toBeLessThanOrEqual(1)
        expect(Math.abs(lefts[0] - lefts[1])).toBeLessThanOrEqual(1)
    },
}

/** The chat panel, exactly as the intro ships it. The transcript is a Claude Code session
 *  because `claude` is DEFAULT_BACKEND; the slide's copy names the other agents. */
export const Agent: Story = {
    render: () => (
        <Frame>
            <TermPanel name="chat" lines={AGENT_LINES} />
        </Frame>
    ),
}

/**
 * Every line KIND the panel can render, in one panel. This is the story the old structure made
 * impossible: with the content baked into two wrapper components, the only renderable cases were
 * the two shipped scripts, so a line variant nothing happened to use was untested by construction.
 */
export const AllLineKinds: Story = {
    render: () => (
        <Frame>
            <TermPanel
                name="every line kind"
                lines={[
                    { p: '~/vault', c: '❯ a prompt line with a command' },
                    { user: 'a user line' },
                    { status: 'a status line' },
                    { d: 'a detail line' },
                    { d: 'a detail line with a trailer', dd: '// trailing note' },
                    { d: 'a detail line with an ok mark', ok: 'done' },
                    {
                        d: 'accented, with both',
                        accent: '3 forgotten notes',
                        dd: '// note',
                        ok: 'ok',
                    },
                ]}
            />
        </Frame>
    ),
}

/** A command line far longer than the panel (90 chars). Policy: the panel stays 510px. The body
 *  clips (`overflow: hidden`) and the line ends in an ellipsis, rather than wrapping or growing
 *  the panel. */
export const Overflow: Story = {
    render: () => (
        <Frame width="570px">
            <TermPanel
                name="overflow"
                lines={[
                    {
                        p: '~/vault',
                        c: '❯ bismuth base create "unread books" --source notes --filter "tag = book and x = 1 and y"',
                    },
                ]}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const tab = [...canvasElement.querySelectorAll('span')].find(el =>
            el.textContent?.includes('[ overflow ]'),
        )
        const panel = tab?.parentElement?.parentElement
        expect(panel).toBeTruthy()
        expect(Math.round(panel!.getBoundingClientRect().width)).toBe(510)
    },
}

/** Empty — the degenerate case. The chrome (session tab, caret) must still render on its own. */
export const Empty: Story = {
    render: () => (
        <Frame>
            <TermPanel name="empty" lines={[]} />
        </Frame>
    ),
}
