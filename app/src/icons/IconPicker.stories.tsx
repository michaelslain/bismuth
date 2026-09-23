// Visual spec for <IconPicker> — the file-tree "Set icon" picker. This is a thin preset over
// the shared <SymbolGallery> (see IconPicker.tsx's header): it fixes `source={iconSource}` and
// `clearLabel="reset to default icon"`, nothing else. `ui/gallery/SymbolGallery.stories.tsx`
// already covers the gallery's generic behaviour in depth (search, keyboard nav, the WebKit
// focus-guard regression, current-highlight, clear) — this file's job is narrower: prove the
// PRESET itself wires those shared pieces correctly with IconPicker's own props/labels, matching
// exactly how FileTree.tsx calls it (title `Set icon — ${name}`, current=node.icon,
// onClear clearing the icon override).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, within } from 'storybook/test'
import { IconPicker } from './IconPicker'
import { TextButton } from '../ui/TextButton'

const meta = {
    title: 'App/IconPicker',
    component: IconPicker,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof IconPicker>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** A file with no icon override yet — no `current` highlight, no reset action (matches
 *  FileTree.tsx omitting `onClear` would never happen for a real call, but a picker CAN be
 *  opened with nothing selected before the first pick). */
export const Default: Story = {
    render: () => (
        <IconPicker
            title="Set icon — Untitled.md"
            onPick={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // Modal portals to document.body, so search here rather than canvasElement.
        const body = within(document.body)
        await expect(
            body.getByPlaceholderText('Set icon — Untitled.md'),
        ).toBeInTheDocument()
        await expect(
            body.queryByText('reset to default icon'),
        ).not.toBeInTheDocument()
    },
}

/** The real FileTree.tsx shape: a note that already carries an icon override, so the picker
 *  opens with that icon highlighted AND a "reset to default icon" action to clear it. */
export const WithCurrentIconAndReset: Story = {
    render: () => (
        <IconPicker
            title="Set icon — Project Roadmap.md"
            current="BookOpen"
            onPick={noop}
            onClear={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        const body = within(document.body)
        await expect(
            body.getByText('reset to default icon'),
        ).toBeInTheDocument()
    },
}

/** Interactive: opening, picking an icon, resetting, and closing all flow through the real
 *  callbacks — the same round trip FileTree.tsx's context-menu "Set icon" action drives. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        const [icon, setIcon] = createSignal<string | undefined>(undefined)
        return (
            <div
                style={{
                    padding: '40px',
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '12px',
                    'align-items': 'flex-start',
                }}
            >
                <TextButton
                    variant="selected"
                    onClick={() => setOpen(true)}
                >
                    set icon…
                </TextButton>
                <span
                    style={{
                        'font-family': 'var(--ui-font-stack)',
                        'font-size': 'var(--fs-body)',
                        color: 'var(--text-muted)',
                    }}
                >
                    Icon: {icon() ?? '(default)'}
                </span>
                {open() && (
                    <IconPicker
                        title="Set icon — Housing.md"
                        current={icon()}
                        onPick={name => {
                            setIcon(name)
                            setOpen(false)
                        }}
                        onClear={() => {
                            setIcon(undefined)
                            setOpen(false)
                        }}
                        onClose={() => setOpen(false)}
                    />
                )}
            </div>
        )
    },
}
