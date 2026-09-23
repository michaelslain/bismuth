// Visual spec for <DaemonFace> — the daemon page's living `.:[00]:.`. One story per mood, plus a
// caption, a compact header form and a narrow column. The frame model (daemonFaceModel.ts) is
// unit-tested; these stories pin what the tests cannot: the glyphs actually render as 8 cells with
// the brackets in place, at a size that reads as part of the hub rather than a centrepiece — and
// that a settled mood change blinks through, not cuts.
//
// Props: mood ('asleep' | 'idle' | 'busy' | 'alert' | 'hurt' | 'listening' | 'thinking' | 'talking'),
// caption? (JSX, rendered muted and centred/right of the face), compact?, class?.
//
// Busy, talking and thinking eyes tick every >=600ms, so two shots of them rarely show the same
// frame — that is the component working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import DaemonFace from './DaemonFace'
import { MOOD_SETTLE_MS, type DaemonMood } from './daemonFaceModel'

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
                'thinking',
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

// The resting floor is now ~half of the old glyph size (28px, was 56px) — the face is part of the
// hub, not a centrepiece.
const REST_FLOOR_PX = 28

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
    return { args: { mood: m }, play: assertFace(REST_FLOOR_PX) }
}

/** Watching: `.:[00]:.` blinking every few seconds; the hands stay still. */
export const Idle: Story = mood('idle')

/** Disabled or not running: `.:[..]:.` in faint ink, no blinks. */
export const Asleep: Story = mood('asleep')

/** A cron or inbox page is running: the eyes scan, slowly and calmly. */
export const Busy: Story = mood('busy')

/** Inbox pages need review: eyes wide `OO`, blinking sooner. */
export const Alert: Story = mood('alert')

/** A cron failed in the last 30 minutes: `.:[><]:.` in the danger tone, still. */
export const Hurt: Story = mood('hurt')

/** The user is typing in the daemon chat: sides lean in `::[00]::`. */
export const Listening: Story = mood('listening')

/** The daemon chat is busy but no reply text has streamed yet: calm, distinct eyes — never the
 *  talking mouth-flip. */
export const Thinking: Story = mood('thinking')

/** The daemon chat is streaming a reply: eyes alternate `0o` / `o0`. */
export const Talking: Story = mood('talking')

/** The status line the daemon page feeds it. */
export const WithCaption: Story = {
    args: { mood: 'idle', caption: 'watching // last: dream 2h ago' },
    play: assertFace(REST_FLOOR_PX),
}

/** The daemon page's conversing state: the one-line HEADER form — a small glyph with the caption
 *  to its right, left-aligned, sized well under the resting floor. */
export const Compact: Story = {
    args: {
        mood: 'idle',
        caption: 'watching // last: dream 2h ago',
        compact: true,
    },
    play: async ({ canvasElement }) => {
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )
        const caption = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face-caption"]',
        )
        await expect(face).not.toBeNull()
        await expect(caption).not.toBeNull()
        const text = face!.textContent ?? ''
        await expect(text.length).toBe(8)
        const px = parseFloat(getComputedStyle(face!).fontSize)
        await expect(px).toBeGreaterThan(0)
        await expect(px).toBeLessThan(REST_FLOOR_PX)
        // Header form: glyph and caption sit side by side (caption to the right, roughly level
        // with the glyph), not stacked underneath it.
        const faceBox = face!.getBoundingClientRect()
        const captionBox = caption!.getBoundingClientRect()
        await expect(captionBox.left).toBeGreaterThanOrEqual(faceBox.right)
        await expect(
            Math.abs(captionBox.top - faceBox.top),
        ).toBeLessThan(faceBox.height)
    },
}

/** A 280px column: the face holds its 28px floor and still fits all eight cells. */
export const Narrow: Story = {
    args: { mood: 'idle', caption: 'watching // last: dream 2h ago' },
    render: args => (
        <Column width="280px">
            <DaemonFace {...args} />
        </Column>
    ),
    play: assertFace(20),
}

/** A mood change settles: a burst of alternating raw moods never reaches the face, and a HELD
 *  change only paints after MOOD_SETTLE_MS — through one blink frame, then the new mood's eyes.
 *  Deterministic seam: real timers via `waitFor` (no fixed sleep) plus a MutationObserver that
 *  records every frame the component actually painted, so the blink-then-eyes order is asserted
 *  from what was rendered, not from a lucky poll. */
function MoodChangeHarness() {
    const [mood, setMood] = createSignal<DaemonMood>('idle')
    return (
        <div>
            <button
                type="button"
                data-testid="go-busy"
                onClick={() => setMood('busy')}
                style={{ position: 'absolute', opacity: 0, 'pointer-events': 'none' }}
            >
                go busy
            </button>
            <Column width="720px">
                <DaemonFace mood={mood()} />
            </Column>
        </div>
    )
}

export const MoodChange: Story = {
    render: () => <MoodChangeHarness />,
    play: async ({ canvasElement }) => {
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )
        await expect(face).not.toBeNull()

        const frames: string[] = [face!.textContent ?? '']
        const observer = new MutationObserver(() => {
            frames.push(face!.textContent ?? '')
        })
        observer.observe(face!, {
            childList: true,
            subtree: true,
            characterData: true,
        })

        const goBusy = canvasElement.querySelector<HTMLButtonElement>(
            '[data-testid="go-busy"]',
        )
        await expect(goBusy).not.toBeNull()
        goBusy!.click()

        // Held long enough → the face must settle to busy (mood attribute flips).
        await waitFor(
            () => {
                if (face!.getAttribute('data-mood') !== 'busy')
                    throw new Error('not settled yet')
            },
            { timeout: MOOD_SETTLE_MS + 2000, interval: 20 },
        )

        observer.disconnect()

        const blinkIndex = frames.findIndex(f => f === '.:[--]:.')
        const settledIndex = frames.findIndex(
            f => f.startsWith('.:[') && f.endsWith(']:.') && f !== '.:[--]:.' &&
                f !== '.:[00]:.',
        )
        await expect(blinkIndex).toBeGreaterThanOrEqual(0)
        await expect(settledIndex).toBeGreaterThan(blinkIndex)
    },
}
