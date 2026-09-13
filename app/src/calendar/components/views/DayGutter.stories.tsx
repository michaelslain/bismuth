// Visual spec for <DayGutter> — the left gutter column that aligns a day view's header/all-day
// rows with TimeGrid's hour labels (was `.time-gutter`). Its width comes from the
// `--time-gutter-width` setting (`calendar.timeGutterWidth`, settingsCssVars.ts) — Storybook's
// `preview.ts` projects the real settings defaults onto `:root`, so a running story sees that
// setting's DEFAULT, not the CSS rule's own `54px` fallback (which only applies if the token is
// missing entirely, e.g. `--time-gutter-width` is unset in the live app too).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import DayGutter from './DayGutter'

const meta = {
    title: 'Calendar/Views/DayGutter',
    component: DayGutter,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DayGutter>

export default meta
type Story = StoryObj<typeof meta>

/** Mounted in a flex row, same as every real caller — proves the gutter's width holds under
 *  flex layout rather than only in isolation, and tracks the live `--time-gutter-width` token
 *  rather than a number hardcoded into the story. */
export const Default: Story = {
    render: () => (
        <div style={{ display: 'flex' }} data-testid="row">
            <DayGutter />
            <div style={{ flex: 1 }}>content</div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>('[data-testid="row"]')!
        const gutter = row.firstElementChild as HTMLElement
        const token = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
                '--time-gutter-width',
            ),
        )
        // Fails if `--time-gutter-width` is missing or unparseable (preview.ts stops
        // projecting settings, or the setting is renamed) — without this, a vanished token
        // would make `token` NaN and the width assertion below pass vacuously (NaN !== NaN
        // comparisons never throw the way a wrong-number comparison would).
        expect(Number.isFinite(token) && token > 0).toBe(true)
        // Fails if the gutter's width rule is dropped, hardcoded to some other number, or
        // overridden by the flex row it sits in — compared against the LIVE setting token
        // rather than a literal, so it also fails if the gutter's CSS drifts from
        // `--time-gutter-width` (e.g. reverts to its own bare `54px` fallback).
        expect(Math.round(gutter.getBoundingClientRect().width)).toBe(token)
    },
}
