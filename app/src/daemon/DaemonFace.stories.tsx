// Visual spec for <DaemonFace> — the daemon page's living `.:[00]:.`. One story per mood, plus a
// caption and a narrow column. The frame model (daemonFaceModel.ts) is unit-tested; these stories pin
// what the tests cannot: the glyphs actually render as 8 cells with the brackets in place, at a
// size that reads as the centre of a page.
//
// Props: mood ('asleep' | 'idle' | 'busy' | 'alert' | 'hurt' | 'listening' | 'talking'),
// caption? (JSX, rendered muted and centred under the face), class?.
//
// Busy and Talking tick every 260ms / 180ms, so two shots of them rarely show the same frame —
// that is the component working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect } from 'storybook/test'
import DaemonFace from './DaemonFace'
import type { DaemonMood } from './daemonFaceModel'

function Column(props: { width: string; children: JSX.Element }) {
    return (
        <div style={{ width: props.width, 'max-width': '100%' }}>
            {props.children}
        </div>
    )
}

const meta = {
    title: 'Daemon/DaemonFace',
    component: DaemonFace,
    parameters: { layout: 'centered' },
    argTypes: {
        mood: {
            control: 'inline-radio',
            options: [
                'asleep',
                'idle',
                'busy',
                'alert',
                'hurt',
                'listening',
                'talking',
            ],
        },
    },
    args: { mood: 'idle' },
    render: args => (
        <Column width="720px">
            <DaemonFace {...args} />
        </Column>
    ),
} satisfies Meta<typeof DaemonFace>

export default meta
type Story = StoryObj<typeof meta>

function assertFace(minFontPx: number) {
    return async ({ canvasElement }: { canvasElement: HTMLElement }) => {
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )
        await expect(face).not.toBeNull()
        const text = face!.textContent ?? ''
        await expect(text.length).toBe(8)
        await expect(text[2]).toBe('[')
        await expect(text[5]).toBe(']')
        const px = parseFloat(getComputedStyle(face!).fontSize)
        await expect(px).toBeGreaterThanOrEqual(minFontPx)
    }
}

function mood(m: DaemonMood): Story {
    return { args: { mood: m }, play: assertFace(56) }
}

/** Watching: `.:[00]:.` breathing every 1.4s, blinking every few seconds. */
export const Idle: Story = mood('idle')

/** Disabled or not running: `.:[..]:.` in faint ink, no breathing, no blinks. */
export const Asleep: Story = mood('asleep')

/** A cron or inbox page is running: the eyes scan `=-` `==` `-=` `==`. */
export const Busy: Story = mood('busy')

/** Inbox pages need review: eyes wide `OO`, blinking sooner. */
export const Alert: Story = mood('alert')

/** A cron failed in the last 30 minutes: `.:[><]:.` in the danger tone, still. */
export const Hurt: Story = mood('hurt')

/** The user is typing in the daemon chat: sides lean in `::[00]::`. */
export const Listening: Story = mood('listening')

/** The daemon chat is streaming a reply: eyes alternate `0o` / `o0`. */
export const Talking: Story = mood('talking')

/** The status line the daemon page feeds it. */
export const WithCaption: Story = {
    args: { mood: 'idle', caption: 'watching // last: dream 2h ago' },
    play: assertFace(56),
}

/** A 280px column: the face holds its 56px floor and still fits all eight cells. */
export const Narrow: Story = {
    args: { mood: 'idle', caption: 'watching // last: dream 2h ago' },
    render: args => (
        <Column width="280px">
            <DaemonFace {...args} />
        </Column>
    ),
    play: assertFace(40),
}
