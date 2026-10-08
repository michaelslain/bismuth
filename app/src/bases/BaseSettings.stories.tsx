// Visual spec for <BaseSettings> — the base's settings modal (one view) (`.evm-modal` chrome shared
// with the calendar's CalendarSettings): column mapping for non-tabular views, chart
// aggregation, record columns/sort/group-by, and the base-level Properties editor (#104) that
// shows for every view type. Saving calls `api.setProperty` per changed field — the global
// fakeTransport (.storybook/preview.ts) answers any unmapped POST with a generic 200 ack (see
// ui/_fakeTransport.ts), so SAVE completing here proves the write path runs without asserting
// on a specific backend response. `SaveWritesTopLevelKey` swaps in a spied transport to
// assert exactly what a save writes (one top-level key per changed field).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { BaseSettings } from './BaseSettings'
import { sampleBaseConfig, SAMPLE_ROWS } from '../ui/_baseFixtures'
import { setTransport } from '../api'
import { spiedTransport } from '../ui/_kanbanSpiedTransport'
import { fakeTransport } from '../ui/_fakeTransport'
import type { Transport } from '../api'
import type { ViewConfig } from '../../../core/src/bases/types'
import { parseBaseFile } from '../../../core/src/bases/parse'

const meta = {
    title: 'Bases/BaseSettings',
    component: BaseSettings,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BaseSettings>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** A declared-property row's disclosure head. Found by `aria-expanded` WITHOUT `aria-haspopup`:
 *  every SettingsField label now names its control, so the summaries section's select for a
 *  column reads "priority none" and a bare `/^priority/` button query matches it too. */
async function propertyHead(
    canvas: ReturnType<typeof within>,
    name: RegExp,
): Promise<HTMLElement> {
    const all = await canvas.findAllByRole('button', { name })
    const head = all.find(
        (b: HTMLElement) =>
            b.hasAttribute('aria-expanded') && !b.hasAttribute('aria-haspopup'),
    )
    if (!head) throw new Error(`no property row matching ${name}`)
    return head
}

/** Table: a RECORD type that DOES show the Columns section (only kanban suppresses it — see
 *  `showColumns` in the component, which pushes column order into Properties instead). */
export const Table: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                view: { type: 'table' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
    play: async () => {
        // Was a <div role="button"> with no tabindex — present to a screen reader, unreachable by
        // keyboard. ModalHeader makes it a real IconButton. ui/Modal portals to document.body, so
        // query there rather than canvasElement.
        const close = document.body.querySelector(
            '[aria-label="Close"]',
        ) as HTMLElement | null
        await expect(close).not.toBeNull()
        await expect(close!.tagName).toBe('BUTTON')
        // Prove the PROPERTY, not the tag: a <div role="button"> with no tabindex — which is
        // exactly what this used to be — cannot take focus, so activeElement would stay put.
        // A real <button> can. This is what makes the control keyboard-reachable at all.
        close!.focus()
        await expect(document.activeElement).toBe(close)

        // I1: <For each={cols()}> keyed each ToggleRow by the row OBJECT — toggle() replaces
        // that object (`arr[i] = { ...arr[i], visible: !arr[i].visible }`), so a regression back
        // to <For> unmounts the focused row and remounts a new DOM node at the same position,
        // dropping focus to <body>. <Index> keys by position instead, so the same node updates
        // in place and keeps focus. Assert both halves: the element stays focused AND the toggle
        // actually took effect (aria-checked flipped) — proving this isn't a no-op click.
        const columnRow = document.body.querySelector(
            '[data-testid="toggle-row"]',
        ) as HTMLElement
        await expect(columnRow).not.toBeNull()
        columnRow.focus()
        await expect(document.activeElement).toBe(columnRow)
        const checkedBefore = columnRow.getAttribute('aria-checked')
        columnRow.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
        )
        await new Promise(r => setTimeout(r, 0))
        await expect(document.activeElement).toBe(columnRow)
        await expect(columnRow.getAttribute('aria-checked')).not.toBe(
            checkedBefore,
        )
    },
}

/** Kanban: a record type WITHOUT the Columns section (Properties supersedes it), plus its own
 *  "Hide meta labels" toggle absent from every other record type. */
export const Kanban: Story = {
    render: () => (
        <BaseSettings
            type="kanban"
            config={sampleBaseConfig({
                view: {
                    type: 'kanban',
                    groupBy: { property: 'status', direction: 'ASC' },
                },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Flashcards: the field-mapping section (front/back/due column pickers) plus the
 *  bidirectional toggle unique to this view type. */
export const Flashcards: Story = {
    render: () => (
        <BaseSettings
            type="flashcards"
            config={sampleBaseConfig({
                view: { type: 'flashcards', bidirectional: true },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Bar chart: the chart-axis field mapping (X/Value) plus Aggregation (aggregate + date
 *  bucket) — no Columns/sort/group, no Properties column-order coupling. */
export const BarChart: Story = {
    render: () => (
        <BaseSettings
            type="bar"
            config={sampleBaseConfig({
                view: { type: 'bar', x: 'due', y: 'priority' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Heatmap: a chart type whose Aggregation section omits the date-bucket picker (`bin` isn't
 *  offered for heatmap — see `props.type !== 'heatmap'` in the component). */
export const Heatmap: Story = {
    render: () => (
        <BaseSettings
            type="heatmap"
            config={sampleBaseConfig({
                view: { type: 'heatmap', x: 'due' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** No `basePath` — the sub-title (note label under "table settings") is hidden and there is NO
 *  file to write to. SAVE used to stay live here and report success (`onSaved`) while discarding
 *  every edit, so the user closed the panel believing their change had landed. It is now OFF, and
 *  the footer says why. This is a real reachable state: settings opened for a view with no host note
 *  yet resolved.
 *
 *  The play makes a REAL edit (a row limit) and then asserts the three things a screenshot cannot
 *  show: SAVE is disabled, the footer states the reason, and clicking it writes nothing and never
 *  fires `onSaved`. Without the fix the button is enabled and `onSaved` fires. */
export const NoBasePath: Story = {
    render: () => {
        const spy = spiedTransport()
        setTransport(spy.transport)
        const g = globalThis as {
            __noPathCalls?: unknown
            __noPathSaved?: number
        }
        g.__noPathCalls = spy.calls
        g.__noPathSaved = 0
        return (
            <BaseSettings
                type="table"
                config={sampleBaseConfig({
                    view: { type: 'table' },
                })}
                rows={SAMPLE_ROWS}
                onClose={noop}
                onSaved={() => {
                    g.__noPathSaved = (g.__noPathSaved ?? 0) + 1
                }}
            />
        )
    },
    play: async () => {
        const body = within(document.body)
        const limit = (await body.findByPlaceholderText(
            'no limit',
        )) as HTMLInputElement
        await userEvent.type(limit, '5')
        const save = body.getByText('save').closest('button') as HTMLButtonElement
        await expect(save.disabled).toBe(true)
        await expect(body.getByTestId('settings-save-note')).toHaveTextContent(
            /no base file to save to/,
        )
        await userEvent.click(save)
        await new Promise(r => setTimeout(r, 50))
        const g = globalThis as {
            __noPathCalls?: { path: string; body: unknown }[]
            __noPathSaved?: number
        }
        // nothing was written, and nothing claimed it had been
        await expect(
            g.__noPathCalls!.filter(c => c.path === '/set-property'),
        ).toHaveLength(0)
        await expect(g.__noPathSaved).toBe(0)
    },
}

/** No rows: `allCols()` falls back to the config's own declared properties, so the column
 *  toggles and sort/group dropdowns still populate from `declaredProperties` alone rather than
 *  going empty — a base with rows not yet resolved (or genuinely empty) isn't a blank panel. */
export const EmptyRows: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                view: { type: 'table' },
            })}
            basePath="projects/roadmap.md"
            rows={[]}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Interactive: expand the Properties section's progressive disclosure — clicking a collapsed
 *  property row opens its full editor (name/type/type-specific extras/reorder/delete),
 *  proving the "at most one row open at a time" behaviour actually reaches the DOM.
 *  <BaseSettings> renders through <Modal>, which mounts via a solid-js/web <Portal> to
 *  document.body (ui/Modal.tsx) — canvasElement is the empty storybook-root the portal left
 *  behind, so this queries document.body instead. The plain text "status" is ambiguous inside
 *  the modal (the Columns section's own checkbox for the same property carries the identical
 *  label), so the property row is targeted by its `role="button"` (`propset-head` in the
 *  component) rather than by text alone — and `role: "button"` alone is STILL ambiguous: the
 *  row's own eye-icon child (`aria-label="Hide status from cards/table"`) is itself a `role:
 *  "button"` whose accessible name also contains "status". The row's accessible name is built
 *  name-first ("status" then "select" then the nested eye button's aria-label — see
 *  `propset-head`'s child order), so anchoring the match to the START of the name picks the
 *  row, not the nested toggle. */
/** I2 regression: the Properties list keyed `<For each={propRows()}>` by the row OBJECT, and
 *  `updateRow` replaces that object on every keystroke — so `<For>` unmounted and remounted the
 *  row's DOM on the FIRST character, dropping focus before a second character could land. Only
 *  `<Index>` (keyed by position, like the Columns list above) keeps the same input node across
 *  the update. Types into an expanded row's name field one character at a time and asserts the
 *  input stays `document.activeElement` throughout AND ends up holding the full string — either
 *  half failing independently would mean the fix is incomplete (focus kept but value truncated,
 *  or vice versa). */
export const TypeIntoPropertyName: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                view: { type: 'table' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
    play: async () => {
        const canvas = within(document.body)
        const doneRow = await propertyHead(canvas, /^done/i)
        await userEvent.click(doneRow)
        const nameInput = (await canvas.findByPlaceholderText(
            'property name',
        )) as HTMLInputElement
        nameInput.focus()
        await userEvent.clear(nameInput)
        await userEvent.type(nameInput, 'abc')
        await expect(document.activeElement).toBe(nameInput)
        await expect(nameInput.value).toBe('abc')
    },
}

/** Same regression as `TypeIntoPropertyName`, for the options textarea — where it bit hardest:
 *  a multiselect/select row's options field only ever kept the FIRST typed character, so
 *  entering a comma-separated option list was impossible through the UI. Expands the
 *  multiselect "tags" row and types a full comma-separated list into its options textarea. */
export const TypeOptions: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                view: { type: 'table' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
    play: async () => {
        const canvas = within(document.body)
        const tagsRow = await propertyHead(canvas, /^tags/i)
        await userEvent.click(tagsRow)
        const optionsField = (await canvas.findByPlaceholderText(
            /options —/,
        )) as HTMLTextAreaElement
        optionsField.focus()
        await userEvent.clear(optionsField)
        await userEvent.type(optionsField, 'feature, bug, change')
        await expect(document.activeElement).toBe(optionsField)
        await expect(optionsField.value).toBe('feature, bug, change')
    },
}

/** `buildPropertiesYaml` keeps only the FIRST of two rows sharing a (trimmed, case-sensitive)
 *  name and silently drops the rest — so renaming a row to collide with an existing name would
 *  quietly shrink the saved property set with no feedback. `duplicatePropertyNames` surfaces the
 *  collision as a warning under the later row's name field, and SAVE disables while any
 *  duplicate exists. Renames the "priority" row to the already-used name "status". */
export const DuplicatePropertyName: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                view: { type: 'table' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
    play: async () => {
        const canvas = within(document.body)
        const priorityRow = await propertyHead(canvas, /^priority/i)
        await userEvent.click(priorityRow)
        const nameInput = (await canvas.findByPlaceholderText(
            'property name',
        )) as HTMLInputElement
        nameInput.focus()
        await userEvent.clear(nameInput)
        await userEvent.type(nameInput, 'status')
        await expect(canvas.getByText(/duplicate name/i)).toBeInTheDocument()
        const saveBtn = canvas.getByText('save').closest('button')
        await expect(saveBtn).not.toBeNull()
        await expect(saveBtn!.disabled).toBe(true)
    },
}

/** Rect assertion instead of `toBeInTheDocument()`: the Remove property button is meant to be a genuinely visible
 *  part of the expanded row, not merely present in the DOM (which a clipped, zero-height or
 *  scrolled-out-of-view element would also satisfy). Proves DELETE's own bounding rect lies
 *  fully inside the modal body's scroll container's rect — top edge at or below the
 *  container's, bottom edge at or above it — after scrolling it into view for containers that
 *  scroll. */
export const ExpandPropertyRow: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={sampleBaseConfig({
                view: { type: 'table' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
    play: async () => {
        const canvas = within(document.body)
        const statusRow = await propertyHead(canvas, /^status/i)
        await userEvent.click(statusRow)
        const deleteButton = canvas.getByLabelText('Remove property')
        deleteButton.scrollIntoView()
        const modalBody = document.body.querySelector(
            '[data-testid="modal-body"]',
        ) as HTMLElement
        await expect(modalBody).not.toBeNull()
        // The Disclosure body opens with a height animation; rows below it overlap the button until
        // it settles, so the geometry + paint checks retry until then (a real clip never settles).
        await waitFor(async () => {
            deleteButton.scrollIntoView()
            const bodyRect = modalBody.getBoundingClientRect()
            const buttonRect = deleteButton.getBoundingClientRect()
            await expect(buttonRect.top).toBeGreaterThanOrEqual(bodyRect.top)
            await expect(buttonRect.bottom).toBeLessThanOrEqual(bodyRect.bottom)
            // The rect check alone can't catch an inner `overflow: hidden` clipping the button —
            // its bounding rect stays intact even while it's visually cut off. Confirm the button
            // is actually the element painted at its own center point.
            const cx = (buttonRect.left + buttonRect.right) / 2
            const cy = (buttonRect.top + buttonRect.bottom) / 2
            await expect(
                deleteButton.contains(document.elementFromPoint(cx, cy)),
            ).toBe(true)
        })
    },
}

const FULL_BASE = `---
type: base
view: table
source:
  kind: notes
  where: file.inFolder("projects")
formulas:
  late: 'date(due) < today() && !done'
filters:
  and:
    - '!file.hasTag("archive")'
    - or:
        - 'priority > 1'
        - done
summaries:
  priority: Average
---
`
const FULL_PATH = 'projects/full.md'
const fullConfig = () =>
    parseBaseFile(FULL_BASE, { name: 'full', path: FULL_PATH }).config

/** A base with source, a filter tree deeper than one list (its nested `or:` shows as an
 *  expression row), a formula, and the table-only summaries section. */
export const TableWithEverything: Story = {
    render: () => (
        <BaseSettings
            type="table"
            config={fullConfig()}
            basePath={FULL_PATH}
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Map: latitude/longitude column bindings + the opening frame (zoom + center). */
export const MapPlaces: Story = {
    render: () => (
        <BaseSettings
            type="map"
            config={sampleBaseConfig({
                view: {
                    type: 'map',
                    lat: 'latitude',
                    zoom: 6,
                    center: { lat: 40.7, lng: -74 },
                },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** Cards: the image column binding, what a card shows, and the cover fit + shape. */
export const Cards: Story = {
    render: () => (
        <BaseSettings
            type="cards"
            config={sampleBaseConfig({
                view: {
                    type: 'cards',
                    image: 'status',
                    imageFit: 'contain',
                    imageAspectRatio: 1,
                },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

const kindStory = (
    type: 'list' | 'bullets' | 'line' | 'stat' | 'calendar',
    extra: Record<string, unknown> = {},
): Story => ({
    render: () => (
        <BaseSettings
            type={type}
            config={sampleBaseConfig({
                view: { type, ...extra } as ViewConfig,
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
})

/** List: a record kind with Columns, sort and group, and the tasks/normal mode toggle. */
export const List: Story = kindStory('list')

/** Bullets: a record kind, same sections as List. */
export const Bullets: Story = kindStory('bullets')

/** Line chart: chart-axis mapping plus the aggregation with a date bucket. */
export const Line: Story = kindStory('line', { x: 'due', y: 'priority' })

/** Stat: a chart kind bound to one value. */
export const Stat: Story = kindStory('stat', { x: 'due', y: 'priority' })

/** Calendar: no column mapping or record sections — identity (with the mode toggle), source,
 *  filters, formulas and properties only. */
export const Calendar: Story = kindStory('calendar')

/** A base whose source is `tasks` — every row is a checkbox line from the vault's notes. */
export const TasksSource: Story = {
    render: () => (
        <BaseSettings
            type="list"
            config={sampleBaseConfig({
                source: { kind: 'tasks' },
                view: { type: 'list', mode: 'tasks' },
            })}
            basePath="projects/roadmap.md"
            rows={SAMPLE_ROWS}
            onClose={noop}
            onSaved={noop}
        />
    ),
}

/** SAVE end to end through a spied fake transport: changing the row limit writes exactly one
 *  top-level set-property, then `onSaved` fires. */
export const SaveWritesTopLevelKey: Story = {
    render: () => {
        const spy = spiedTransport({ files: { [FULL_PATH]: FULL_BASE } })
        setTransport(spy.transport)
        const g = globalThis as {
            __baseSettingsCalls?: unknown
            __baseSettingsSaved?: number
        }
        g.__baseSettingsCalls = spy.calls
        g.__baseSettingsSaved = 0
        return (
            <BaseSettings
                type="table"
                config={fullConfig()}
                basePath={FULL_PATH}
                rows={SAMPLE_ROWS}
                onClose={noop}
                onSaved={() => {
                    g.__baseSettingsSaved = (g.__baseSettingsSaved ?? 0) + 1
                }}
            />
        )
    },
    play: async () => {
        const canvas = within(document.body)
        const limit = (await canvas.findByPlaceholderText(
            'no limit',
        )) as HTMLInputElement
        await userEvent.type(limit, '5')
        await userEvent.click(canvas.getByText('save'))
        await new Promise(r => setTimeout(r, 100))
        const g = globalThis as {
            __baseSettingsCalls?: { path: string; body: unknown }[]
            __baseSettingsSaved?: number
        }
        await expect(g.__baseSettingsCalls).toContainEqual({
            path: '/set-property',
            body: { path: FULL_PATH, key: 'limit', value: 5 },
        })
        // nothing else was rewritten — an untouched section writes nothing
        await expect(
            g.__baseSettingsCalls!.filter(c => c.path === '/set-property'),
        ).toHaveLength(1)
        await expect(g.__baseSettingsSaved).toBe(1)
    },
}

/** A transport whose writes never settle (`hang`) or always fail (`fail`), over the fake server. */
function stuckTransport(mode: 'hang' | 'fail'): Transport {
    const base = fakeTransport({ files: { [FULL_PATH]: FULL_BASE } })
    const write: Transport['post'] = () =>
        mode === 'hang'
            ? new Promise<Response>(() => {})
            : Promise.reject(new Error('disk is full'))
    return { ...base, post: write, put: write }
}

/** SAVE fails on a LONG base. The failure used to be the last child of the scrolling body while
 *  SAVE sat in the pinned footer, so on a base like this one the user clicked save, nothing visibly
 *  happened, and the reason was scrolled out of sight. It is now in the footer beside SAVE.
 *
 *  Asserted by structure AND geometry: the alert is a `role="alert"` in the very row that holds
 *  the SAVE button, and it is on screen without scrolling anything. Without the fix the alert is a
 *  descendant of the body, not of the footer. */
export const SaveFailure: Story = {
    render: () => {
        setTransport(stuckTransport('fail'))
        return (
            <BaseSettings
                type="table"
                config={fullConfig()}
                basePath={FULL_PATH}
                rows={SAMPLE_ROWS}
                onClose={noop}
                onSaved={noop}
            />
        )
    },
    play: async () => {
        const body = within(document.body)
        const limit = (await body.findByPlaceholderText(
            'no limit',
        )) as HTMLInputElement
        await userEvent.type(limit, '5')
        const save = body.getByText('save').closest('button') as HTMLButtonElement
        await userEvent.click(save)
        const alert = await body.findByRole('alert')
        await expect(alert).toHaveTextContent(/couldn't save \/\/ disk is full/)
        await expect(save.parentElement!.contains(alert)).toBe(true)
        const r = alert.getBoundingClientRect()
        await expect(r.top).toBeGreaterThanOrEqual(0)
        await expect(r.bottom).toBeLessThanOrEqual(window.innerHeight)
        // the failure leaves SAVE usable again, so the user can retry
        await expect(save.disabled).toBe(false)
    },
}

/** SAVE in flight: the write has not settled yet. SAVE is off (a second click would double-write)
 *  and the footer says "saving…" rather than leaving the user to wonder whether the click landed. */
export const Saving: Story = {
    render: () => {
        setTransport(stuckTransport('hang'))
        return (
            <BaseSettings
                type="table"
                config={fullConfig()}
                basePath={FULL_PATH}
                rows={SAMPLE_ROWS}
                onClose={noop}
                onSaved={noop}
            />
        )
    },
    play: async () => {
        const body = within(document.body)
        const limit = (await body.findByPlaceholderText(
            'no limit',
        )) as HTMLInputElement
        await userEvent.type(limit, '5')
        const save = body.getByText('save').closest('button') as HTMLButtonElement
        await expect(save.disabled).toBe(false)
        await userEvent.click(save)
        await expect(await body.findByText('saving…')).toBeInTheDocument()
        await expect(save.disabled).toBe(true)
    },
}
