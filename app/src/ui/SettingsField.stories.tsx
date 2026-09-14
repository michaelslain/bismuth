// Visual spec for <SettingsField> — one labelled control in a settings form: an
// optional accent icon + label + right-aligned required/optional badge, the
// control itself, then an optional SettingsHint (was `.evm-modal .set-field` /
// `.set-lab` / `.req` / `.opt`).
//
// Rendered inside a plain 548px-wide div rather than a FormModal — these rules do
// not depend on the modal chrome, only on the SettingsGrid column width.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import SettingsField from './SettingsField'
import SettingsGrid from './SettingsGrid'
import { TextInput } from './TextInput'

const meta = {
    title: 'UI/SettingsField',
    component: SettingsField,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsField>

export default meta
type Story = StoryObj<typeof meta>

/** A required field with an icon, an optional field, and a spanning field with a hint —
 *  the three shapes a settings form actually uses. */
export const Grid: Story = {
    render: () => {
        const [title, setTitle] = createSignal('Team sync')
        const [category, setCategory] = createSignal('Work')
        const [notes, setNotes] = createSignal('')
        return (
            <div style={{ width: '548px' }}>
                <SettingsGrid>
                    <SettingsField label="Title" icon="Tag" badge="required">
                        <TextInput value={title()} onInput={setTitle} />
                    </SettingsField>
                    <SettingsField label="Category" badge="optional">
                        <TextInput value={category()} onInput={setCategory} />
                    </SettingsField>
                    <SettingsField
                        label="Notes"
                        badge="optional"
                        span
                        hint="Visible only to you, never synced to Google Calendar."
                    >
                        <TextInput value={notes()} onInput={setNotes} multiline />
                    </SettingsField>
                </SettingsGrid>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const fields = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="settings-field"]',
            ),
        ]
        // Catches: a field failing to render at all, or SettingsGrid rendering the wrong
        // number of children.
        expect(fields).toHaveLength(3)
        const grid = fields[0].parentElement!.getBoundingClientRect()
        // Catches: `span` not applying `grid-column: 1 / -1`, which would leave the third
        // field the same half-width as the other two instead of the grid's full width.
        expect(Math.round(fields[2].getBoundingClientRect().width)).toBe(
            Math.round(grid.width),
        )
        // Catches: the non-span fields accidentally spanning too (e.g. a stray `.span`
        // class, or the grid collapsing to a single column).
        expect(fields[0].getBoundingClientRect().width).toBeLessThan(
            grid.width * 0.6,
        )
        // Catches: the badge losing its `text-transform: uppercase` (e.g. the CSS rule
        // dropped, or the DOM text itself changed to already-uppercase, which would hide
        // a regression here — this asserts the computed style, not the text).
        expect(
            getComputedStyle(
                canvasElement.querySelector(
                    '[data-testid="settings-field"] span:last-child',
                )!,
            ).textTransform,
        ).toBe('uppercase')
    },
}
