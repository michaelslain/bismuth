// Visual spec for <SettingsGrid> — a vertical stack of SettingsField rows, each its own
// label-column grid keyed to `--label-col` (was `.evm-modal .set-grid`; modal redesign Task 4,
// 2026-09-23 — no longer two fields side by side, one row per field). SettingsGrid owns no
// column layout itself; it defers entirely to whatever fields are passed in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import SettingsGrid from './SettingsGrid'
import SettingsField from './SettingsField'
import { TextInput } from './TextInput'

const meta = {
    title: 'UI/SettingsGrid',
    component: SettingsGrid,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsGrid>

export default meta
type Story = StoryObj<typeof meta>

/** Four fields: two ordinary rows, a hint under one of them, and a spanning field — the shapes
 *  a settings form composes together. */
export const FourFields: Story = {
    render: () => {
        const [title, setTitle] = createSignal('team sync')
        const [category, setCategory] = createSignal('work')
        const [interval, setInterval_] = createSignal('60')
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
                        label="sync interval"
                        hint="how often the daemon polls for external changes."
                    >
                        <TextInput value={interval()} onInput={setInterval_} />
                    </SettingsField>
                    <SettingsField
                        label="notes"
                        span
                        hint="visible only to you, never synced."
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
        expect(fields).toHaveLength(4)
        // Catches: rows not stacking (e.g. a stray `flex-direction: row`) — each field's top
        // should be below the previous one's top.
        const tops = fields.map(f => f.getBoundingClientRect().top)
        for (let i = 1; i < tops.length; i++) {
            expect(tops[i]).toBeGreaterThan(tops[i - 1])
        }
    },
}
