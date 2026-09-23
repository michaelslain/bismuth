// Visual spec for <SettingsField> — one labelled control in a settings form: a text-only label +
// plain required/optional badge, the control itself, then an optional SettingsHint under it (was
// `.evm-modal .set-field` / `.set-lab` / `.req` / `.opt`; modal redesign Task 4, 2026-09-23 —
// label column keyed to `--label-col`, badges are plain text with no box, no icon).
//
// Rendered inside a plain 460px-wide div rather than a FormModal — these rules do not depend on
// the modal chrome, only on the shared `--label-col` token.
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

/** A required field, an optional field, and a spanning field with a hint — the three shapes a
 *  settings form actually uses. */
export const Grid: Story = {
    render: () => {
        const [title, setTitle] = createSignal('team sync')
        const [category, setCategory] = createSignal('work')
        const [notes, setNotes] = createSignal('')
        return (
            <div style={{ width: '460px' }}>
                <SettingsGrid>
                    <SettingsField label="title" badge="required">
                        <TextInput value={title()} onInput={setTitle} />
                    </SettingsField>
                    <SettingsField label="category" badge="optional">
                        <TextInput value={category()} onInput={setCategory} />
                    </SettingsField>
                    <SettingsField
                        label="notes"
                        badge="optional"
                        span
                        hint="visible only to you, never synced to google calendar."
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
        // Catches: the label column drifting between rows — every non-span field's label
        // should start at the same x (they all read the same --label-col token).
        const label0 = fields[0]
            .querySelector('[class*="label"]')!
            .getBoundingClientRect()
        const label1 = fields[1]
            .querySelector('[class*="label"]')!
            .getBoundingClientRect()
        expect(Math.round(label0.left)).toBe(Math.round(label1.left))
        expect(Math.round(label0.width)).toBe(Math.round(label1.width))
        // Catches: `span` failing to drop the field to a single full-width column — the
        // spanning field's control should start further left than the non-span fields' controls.
        const control0 = fields[0]
            .querySelector('[class*="control"]')!
            .getBoundingClientRect()
        const control2 = fields[2]
            .querySelector('[class*="control"]')!
            .getBoundingClientRect()
        expect(control2.left).toBeLessThan(control0.left)
        // Catches: the badge regaining a box or its uppercase transform (Acceptance 12 — plain
        // text now, already-lowercase, no CSS transform).
        const badge = canvasElement.querySelector<HTMLElement>(
            '[data-testid="settings-field"] span[class*="req"]',
        )!
        expect(getComputedStyle(badge).textTransform).toBe('none')
        expect(getComputedStyle(badge).backgroundColor).toBe(
            'rgba(0, 0, 0, 0)',
        )
    },
}

/** Every SettingsField prop shape: required, optional, spanning + hint, and the deprecated
 *  `icon` prop passed but ignored (no icon renders). */
export const AllShapes: Story = {
    render: () => {
        const [a, setA] = createSignal('team sync')
        const [b, setB] = createSignal('')
        const [c, setC] = createSignal('9:00am')
        return (
            <div style={{ width: '460px' }}>
                <SettingsGrid>
                    <SettingsField label="title" icon="Tag" badge="required">
                        <TextInput value={a()} onInput={setA} />
                    </SettingsField>
                    <SettingsField label="start" badge="optional">
                        <TextInput value={c()} onInput={setC} />
                    </SettingsField>
                    <SettingsField
                        label="description"
                        span
                        hint="markdown is supported."
                    >
                        <TextInput value={b()} onInput={setB} multiline />
                    </SettingsField>
                </SettingsGrid>
            </div>
        )
    },
}
