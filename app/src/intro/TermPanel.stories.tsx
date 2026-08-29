// The first-run intro's static terminal panels.
//
// THIS COMPONENT RENDERED IN NO STORY AT ALL until 2026-08-28. It lived inside intro/marks.tsx
// behind two one-line wrapper components (`DaemonStage`, `ClaudeStage`), and that file's story
// exported only two of its four components — so the panel a new user sees on their very first run
// of the app was the one piece of UI nobody could look at without reinstalling.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import TermPanel, { DAEMON_LINES, CLAUDE_LINES } from './TermPanel'

const meta = {
    title: 'Intro/TermPanel',
    component: TermPanel,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof TermPanel>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: any }) => (
    <div style={{ background: 'var(--bg)', padding: 'var(--sp-7)', width: '520px' }}>
        {props.children}
    </div>
)

/** The daemon panel, exactly as the intro ships it. */
export const Daemon: Story = {
    render: () => (
        <Frame>
            <TermPanel name="DAEMON · live" lines={DAEMON_LINES} />
        </Frame>
    ),
}

/** The Claude Code panel, exactly as the intro ships it. */
export const Claude: Story = {
    render: () => (
        <Frame>
            <TermPanel name="claude code" lines={CLAUDE_LINES} />
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
                    { d: 'a detail line with a trailer', dd: '· trailing note' },
                    { d: 'a detail line with an ok mark', ok: 'done' },
                    {
                        d: 'accented, with both',
                        accent: 'var(--accent)',
                        dd: '· note',
                        ok: 'ok',
                    },
                ]}
            />
        </Frame>
    ),
}

/** Empty — the degenerate case. The chrome (session tab, caret) must still render on its own. */
export const Empty: Story = {
    render: () => (
        <Frame>
            <TermPanel name="empty" lines={[]} />
        </Frame>
    ),
}
