// Visual spec for <SettingsField> — one labelled control in a settings form: a text-only label +
// plain required/optional badge, the control itself, then an optional SettingsHint under it (was
// `.evm-modal .set-field` / `.set-lab` / `.req` / `.opt`; modal redesign Task 4, 2026-09-23 —
// label column keyed to `--label-col`, badges are plain text with no box, no icon).
//
// Rendered inside a plain 460px-wide div rather than a FormModal — these rules do not depend on
// the modal chrome, only on the shared `--label-col` token.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { createSignal, Show } from 'solid-js'
import SettingsField from './SettingsField'
import SettingsGrid from './SettingsGrid'
import { TextInput } from './TextInput'
import Select from './Select'
import { SegmentedToggle } from './SegmentedToggle'

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
        const label0 = fields[0].querySelector('label')!.getBoundingClientRect()
        const label1 = fields[1].querySelector('label')!.getBoundingClientRect()
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

/** Every SettingsField prop shape: required, optional, spanning + hint. */
export const AllShapes: Story = {
    render: () => {
        const [a, setA] = createSignal('team sync')
        const [b, setB] = createSignal('')
        const [c, setC] = createSignal('9:00am')
        return (
            <div style={{ width: '460px' }}>
                <SettingsGrid>
                    <SettingsField label="title" badge="required">
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

/** The text a screen reader would announce for `el` from its label wiring: `<label for>` text
 *  (via `.labels`) plus any `aria-labelledby` targets, in order. */
const nameOf = (el: HTMLElement): string => {
    const native = [...((el as HTMLInputElement).labels ?? [])].map(
        l => l.textContent,
    )
    const ids = (el.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
    // A referenced element's name excludes its aria-hidden descendants (the Select's caret glyph).
    const text = (e: Element | null) => {
        const c = e?.cloneNode(true) as HTMLElement | undefined
        c?.querySelectorAll('[aria-hidden="true"]').forEach(h => h.remove())
        return c?.textContent ?? ''
    }
    const ref = ids.map(id => text(document.getElementById(id)))
    return [...native, ...ref].join(' ').trim()
}

let revealControl: (() => void) | undefined

/** THE accessibility fix, asserted rather than eyeballed: the label is a real `<label>` bound to its
 *  control, so a screen reader announces it (WCAG 1.3.1 / 4.1.2). Before, the label was a bare `<div>`
 *  next to a sibling `<div>` and nothing associated them — invisible in any screenshot. Covers a text
 *  input (`<label for>` → `input.labels`), a Select trigger (`aria-labelledby` = label + its value),
 *  a toggle (its members keep their own names), a required badge staying OUT of the name, and a
 *  control that mounts later. */
export const LabelIsBoundToControl: Story = {
    render: () => {
        const [title, setTitle] = createSignal('team sync')
        const [cat, setCat] = createSignal('work')
        const [mode, setMode] = createSignal('day')
        const [shown, setShown] = createSignal(false)
        revealControl = () => setShown(true)
        return (
            <div style={{ width: '460px' }}>
                <SettingsGrid>
                    <SettingsField label="title" badge="required">
                        <TextInput value={title()} onInput={setTitle} />
                    </SettingsField>
                    <SettingsField label="category">
                        <Select
                            value={cat()}
                            onChange={setCat}
                            options={[
                                { value: 'work', label: 'work' },
                                { value: 'home', label: 'home' },
                            ]}
                        />
                    </SettingsField>
                    <SettingsField label="repeats">
                        <SegmentedToggle
                            value={mode()}
                            onChange={setMode}
                            options={[
                                { id: 'day', label: 'day' },
                                { id: 'week', label: 'week' },
                            ]}
                        />
                    </SettingsField>
                    <SettingsField label="late arrival">
                        <Show when={shown()}>
                            <TextInput value="" onInput={() => {}} />
                        </Show>
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
        // A text input: a REAL <label> resolves through the DOM's own `labels`, badge excluded.
        const input = fields[0].querySelector('input')!
        await expect(input.labels).toHaveLength(1)
        await expect(input.labels![0].tagName).toBe('LABEL')
        await expect(input.labels![0].textContent).toBe('title')
        await expect(nameOf(input)).toBe('title')
        await expect(input.getAttribute('aria-required')).toBe('true')
        // Clicking the label reaches the control — the other half of a real <label>.
        input.blur()
        input.labels![0].click()
        await expect(document.activeElement).toBe(input)
        // A Select trigger: named "<label> <value>" — the value is not replaced by the name.
        const trigger = fields[1].querySelector<HTMLElement>(
            '[data-select-trigger]',
        )!
        await expect(nameOf(trigger)).toBe('category work')
        // A toggle's members are NOT renamed by the field label — they keep their own text.
        for (const b of fields[2].querySelectorAll('button')) {
            await expect(b.hasAttribute('aria-labelledby')).toBe(false)
        }
        // A control that mounts after the field does is bound too.
        await expect(fields[3].querySelector('input')).toBeNull()
        revealControl?.()
        await waitFor(() =>
            expect(nameOf(fields[3].querySelector('input')!)).toBe(
                'late arrival',
            ),
        )
    },
}

/** One row height, one baseline, one badge track — three defects, each a measured grader finding.
 *  A long label no-wraps (ellipsis) instead of pushing the req/opt badge onto a second line, so a
 *  short-labelled row and a long-labelled one are the same height; the badge sits in its own track
 *  at the same x in every row; and the label's text shares the control value's baseline (both
 *  centred in the same `--h-control` box — the label used to sit 2-4px above). */
export const RowsShareBaselineAndHeight: Story = {
    render: () => (
        <div style={{ width: '460px' }}>
            <SettingsGrid>
                <SettingsField label="title" badge="required">
                    <TextInput value="team sync" onInput={() => {}} />
                </SettingsField>
                <SettingsField
                    label="scheduled start of the recurring event"
                    badge="required"
                >
                    <TextInput value="9:00am" onInput={() => {}} />
                </SettingsField>
                <SettingsField label="notes" badge="optional">
                    <TextInput value="" onInput={() => {}} />
                </SettingsField>
            </SettingsGrid>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const fields = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="settings-field"]',
            ),
        ]
        const heights = fields.map(f =>
            Math.round(f.getBoundingClientRect().height),
        )
        // Catches: a badge wrapping under a long label (three different row heights).
        await expect(new Set(heights).size).toBe(1)
        // Catches: a wrapped label (it is one line, ellipsised).
        const longLabel = fields[1].querySelector('label')!
        await expect(getComputedStyle(longLabel).whiteSpace).toBe('nowrap')
        await expect(longLabel.scrollWidth).toBeGreaterThan(
            longLabel.clientWidth,
        )
        // Catches: the badge drifting with its label's length.
        const reqLeft = fields
            .slice(0, 2)
            .map(f =>
                Math.round(
                    f
                        .querySelector('span[class*="req"]')!
                        .getBoundingClientRect().left,
                ),
            )
        await expect(reqLeft[0]).toBe(reqLeft[1])
        // Catches: label above the value's baseline — their text lines are vertically centred
        // on each other (the two share a first baseline when centres and fonts match).
        for (const f of fields) {
            const label = f.querySelector('label')!
            const input = f.querySelector('input')!
            const range = document.createRange()
            range.selectNodeContents(label)
            const text = range.getBoundingClientRect()
            const box = input.getBoundingClientRect()
            const delta = Math.abs(
                text.top + text.height / 2 - (box.top + box.height / 2),
            )
            await expect(delta).toBeLessThanOrEqual(1)
        }
    },
}
