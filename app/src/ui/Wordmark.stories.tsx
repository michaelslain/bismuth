// Visual spec for the app-shell wordmark — the ASCII mark in the top strip
// (`app/src/App.tsx`'s `.asc-wordmark` span, styled in `App.css`).
//
// This is chrome, not a `ui/` primitive, so there is no `Wordmark` component to import: the story
// renders the same span + class the shell does. Kept here anyway because the mark is a brand
// decision that needs to be LOOKED at, and the shell has no other visual surface.
//
// The mark paints via `background-clip: text` with `color: transparent`, so it needs `--grad`.
// It does NOT need one here: `.storybook/preview.ts` already runs
// `setCssVars(settingsToCssVars(DEFAULTS))` at module scope — the same projection App.tsx performs
// at runtime — so every theme token, `--grad` included, is live on :root for every story.
// An earlier draft of this file hardcoded its own rainbow. That was worse than redundant: it meant
// these stories displayed an INVENTED gradient, so anyone judging the mark's colour here was
// grading a fabrication. Never stand in for a design token; take the real one.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Label } from './_storyKit'
import '../App.css'

/** The mark itself — a hopper-crystal silhouette in punctuation. */
const MARK = ",;']--]';,"

function Strip(props: { tracking?: string; children?: string }) {
    return (
        <div
            style={{
                ...(props.tracking
                    ? { '--wordmark-tracking': props.tracking }
                    : {}),
                background: 'var(--bg, #0d0d0f)',
                padding: '10px 14px',
                'border-radius': '4px',
                display: 'flex',
                'align-items': 'center',
                'min-width': '180px',
            }}
        >
            <span class="asc-wordmark">{props.children ?? MARK}</span>
        </div>
    )
}

const meta = {
    title: 'App Shell/Wordmark',
    parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The shipped mark at its default tracking (-0.22em, App.css `.asc-wordmark`). */
export const Default: Story = {
    render: () => <Strip />,
}

/**
 * Tracking ladder. The mark is ASCII art, not lettering — the glyphs have to close into one
 * silhouette, so this reads bottom-up: looser values break it into loose punctuation, tighter
 * values fuse the `--` bar into the bracket shoulders. Pick by eye.
 */
export const Tracking: Story = {
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}
        >
            {(
                [
                    '.08em (old, for lettering)',
                    '0',
                    '-0.03em',
                    '-0.06em',
                    '-0.09em',
                    '-0.12em',
                    '-0.16em',
                    '-0.22em (current)',
                    '-0.28em',
                ] as const
            ).map(t => {
                const value = t.split(' ')[0]
                return (
                    <div
                        style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '12px',
                        }}
                    >
                        <span style={{ 'min-width': '170px' }}>
                            <Label>{t}</Label>
                        </span>
                        <Strip tracking={value} />
                    </div>
                )
            })}
        </div>
    ),
}
