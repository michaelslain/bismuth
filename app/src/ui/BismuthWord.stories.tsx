// Visual spec for the iridescent "bismuth" easter egg — every literal, whole-word occurrence of
// "bismuth" in rendered prose paints with the app's gradient instead of body colour.
//
// TWO CLASSES, ONE EFFECT, TWO EMITTERS. `.bismuth-word` is written by the reading-mode markdown
// renderer (bases/markdown.ts); `.cm-bismuth` is the live-preview editor decoration
// (editor/livePreview.ts). Both are RUNTIME-GENERATED STRING LITERALS, never imported identifiers,
// which is why they live in styles/content.css and not in a CSS Module — a module would hash the
// name at build time while the emitter kept writing the literal, and the effect would silently
// vanish from every note with nothing reporting it. cssLayering.test.ts is the ratchet on that.
//
// This story exists because the effect had none: it is a brand decision that can only be judged by
// looking, and until now the only way to see it was to type the word into a note.
//
// It needs `--grad` and takes the REAL one. `.storybook/preview.ts` runs
// `setCssVars(settingsToCssVars(DEFAULTS))` at module scope — the same projection App.tsx performs
// at runtime — so the token is live on :root here. Never hardcode a stand-in: a story that invents
// its own gradient is grading a fabrication, not the product.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Label } from './_storyKit'
import { settingsToCssVars } from '../settingsCssVars'
import { THEME_NAMES, THEME_LABELS } from '../themes'
import { DEFAULTS } from '../../../core/src/schema/settingsSchema'
import type { Settings } from '../settings'
import '../App.css'

const Prose = (props: { children: any }) => (
    <p
        style={{
            font: 'var(--fs-read, 15px)/1.6 var(--editor-font)',
            color: 'var(--fg)',
            'max-width': '46ch',
            margin: '0',
        }}
    >
        {props.children}
    </p>
)

const Panel = (props: { children: any }) => (
    <div
        style={{
            background: 'var(--bg)',
            padding: '16px 18px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '10px',
        }}
    >
        {props.children}
    </div>
)

const meta = {
    title: 'App Shell/Bismuth Word',
    parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The effect in a sentence of real prose, at note size — how it is actually encountered. */
export const InProse: Story = {
    render: () => (
        <Panel>
            <Prose>
                A note about <span class="bismuth-word">bismuth</span>, the
                element whose oxide layer refracts into a rainbow. The word
                paints itself; nothing else in this paragraph does.
            </Prose>
        </Panel>
    ),
}

/**
 * The two emitters side by side. `.bismuth-word` (reading mode) and `.cm-bismuth` (live-preview
 * editor) must be visually IDENTICAL — they are one effect reached two ways, and any drift between
 * them shows up as the word changing appearance when you switch surfaces.
 */
export const BothEmitters: Story = {
    render: () => (
        <Panel>
            <Label>.bismuth-word — reading mode (bases/markdown.ts)</Label>
            <Prose>
                <span class="bismuth-word">bismuth</span>
            </Prose>
            <Label>.cm-bismuth — live preview (editor/livePreview.ts)</Label>
            <Prose>
                <span class="cm-bismuth">bismuth</span>
            </Prose>
        </Panel>
    ),
}

/**
 * Against the top-strip wordmark. These are the app's only two iridescent surfaces and they now
 * share one gradient (`--grad`) rather than each carrying its own — this story is the check that
 * they still match. If they diverge, one of them has grown a bespoke ramp again.
 */
export const AgainstTheWordmark: Story = {
    render: () => (
        <Panel>
            <Label>top strip — .asc-wordmark</Label>
            <span class="asc-wordmark">{",;']--]';,"}</span>
            <Label>prose easter egg — .bismuth-word</Label>
            <Prose>
                <span class="bismuth-word">bismuth</span>
            </Prose>
        </Panel>
    ),
}

/**
 * The word at several prose sizes. The gradient is oversized (200% of the box) and pans, so a
 * short word samples only a slice of the ramp — at small sizes it can read as a flat tint rather
 * than an iridescence. This is the story that catches that.
 */
export const Sizes: Story = {
    render: () => (
        <Panel>
            {['11.5px', '13px', '15px', '19px', '24px'].map(size => (
                <div
                    style={{
                        display: 'flex',
                        'align-items': 'baseline',
                        gap: '12px',
                    }}
                >
                    <span style={{ 'min-width': '64px' }}>
                        <Label>{size}</Label>
                    </span>
                    <span
                        class="bismuth-word"
                        style={{
                            'font-size': size,
                            'font-family': 'var(--editor-font)',
                        }}
                    >
                        bismuth
                    </span>
                </div>
            ))}
        </Panel>
    ),
}

/**
 * THE COST OF SHARING ONE GRADIENT, made visible.
 *
 * The easter egg used to carry a fixed, theme-INDEPENDENT rainbow — the crystal colours read
 * identically on ink, paper, cathode and riso, because the effect was meant to look like bismuth
 * regardless of what the app looked like around it. It now paints with `--grad`, the same token the
 * top-strip wordmark uses, and `--grad` is projected per-theme by settingsCssVars.ts. So the word
 * shifts with the theme.
 *
 * That is a deliberate trade — one mark, one gradient — but it is a real change in behaviour and it
 * needed somewhere it could be SEEN rather than described in a comment. This is that somewhere. Each
 * block below projects the real per-theme vars exactly as App.tsx does at runtime, so nothing here
 * is invented.
 */
export const AcrossThemes: Story = {
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}
        >
            {THEME_NAMES.map(name => {
                const vars = settingsToCssVars({
                    ...(DEFAULTS as unknown as Settings),
                    appearance: {
                        ...(DEFAULTS as unknown as Settings).appearance,
                        theme: name,
                    },
                })
                return (
                    <div
                        style={{
                            ...vars,
                            background: 'var(--bg)',
                            color: 'var(--fg)',
                            padding: '14px 18px',
                            display: 'flex',
                            'align-items': 'center',
                            gap: '18px',
                        }}
                    >
                        <span style={{ 'min-width': '90px' }}>
                            <Label>{THEME_LABELS[name] ?? name}</Label>
                        </span>
                        <span class="asc-wordmark">{",;']--]';,"}</span>
                        <span
                            class="bismuth-word"
                            style={{
                                'font-size': 'var(--fs-read, 15px)',
                                'font-family': 'var(--editor-font)',
                            }}
                        >
                            bismuth
                        </span>
                    </div>
                )
            })}
        </div>
    ),
}
