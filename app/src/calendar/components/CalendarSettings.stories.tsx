// Visual spec for <CalendarSettings> — the calendar's own settings modal: column mapping
// (which frontmatter keys carry date/start/end/recurrence/category) plus the embedded
// <GcalSyncPanel> (see that file's own stories for its states in isolation). Open/closed comes
// from the module-level `showCalendarSettings` box in calendar/state.ts (same pattern as
// EventModal/RecurrenceDialog/CategoryPanel), and its field values come from `GET /base?file=…`
// (`api.base`) — neither route the Storybook-wide fakeTransport answers by default, so this
// file wraps it the same way GcalSyncPanel.stories.tsx does: read that file's header for why.
//
// <Modal> mounts via a Solid <Portal> straight onto document.body — outside
// canvasElement/#storybook-root entirely (see Modal.tsx). So every play below queries
// `document`, not `canvasElement`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Show } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { CalendarSettings } from './CalendarSettings'
import { showCalendarSettings } from '../state'
import { setTransport, type Transport } from '../../api'
import { fakeTransport } from '../../ui/_fakeTransport'
import type { ParsedBase, Row } from '../../../../core/src/bases/types'

const meta = {
    title: 'Calendar/CalendarSettings',
    component: CalendarSettings,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CalendarSettings>

export default meta
type Story = StoryObj<typeof meta>

const BASE_PATH = 'Calendar.md'

function row(note: Record<string, unknown>): Row {
    return {
        file: {
            name: 'Standup',
            basename: 'Standup',
            path: 'Standup.md',
            folder: '',
            ext: 'md',
            size: 0,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note,
        formula: {},
    } as unknown as Row
}

/** Wrap the shared fakeTransport, answering this calendar's `/base` fetch (used for both the
 *  column-mapping seed and, via the embedded GcalSyncPanel, its own base read) and
 *  `/gcal/status` (disconnected — GcalSyncPanel's own stories cover the connected states),
 *  delegating everything else to the normal fixture. */
function seedBase(view: Record<string, unknown>, rows: Row[]) {
    const inner = fakeTransport()
    const parsed: ParsedBase = {
        config: { views: [{ type: 'calendar', name: 'Calendar', ...view }] },
        rows,
    } as unknown as ParsedBase
    const custom: Transport = {
        ...inner,
        getJson: async <T,>(path: string): Promise<T> => {
            const pathname = path.split('?')[0]
            if (pathname === '/base') return parsed as unknown as T
            if (pathname === '/gcal/status')
                return {
                    connected: false,
                    needsCredentials: true,
                } as unknown as T
            return inner.getJson<T>(path)
        },
    }
    setTransport(custom)
}

/** Open, seeded with the base's real values already bound to the conventional columns —
 *  the fullest "everything already wired up" resting state. */
export const Default: Story = {
    render: () => {
        seedBase(
            {
                dateField: 'date',
                startTimeField: 'startTime',
                endTimeField: 'endTime',
                recurrenceField: 'recurrence',
                categoryField: 'category',
            },
            [row({ date: '2026-08-17', startTime: '09:00', category: 'Work' })],
        )
        showCalendarSettings.value = true
        return <CalendarSettings basePath={BASE_PATH} />
    },
}

/** No view config written yet (a freshly created calendar base) — every field falls back to
 *  its conventional default column name, and the optional fields default to "Not set". */
export const UnconfiguredBase: Story = {
    render: () => {
        seedBase({}, [])
        showCalendarSettings.value = true
        return <CalendarSettings basePath={BASE_PATH} />
    },
}

/** The vault's notes carry a non-conventional column (`whenDue` instead of `date`) — proves
 *  the Select's option list is unioned from the ROWS' actual frontmatter keys, not just the
 *  fixed STD_COLS list, so a real vault's odd column names are still pickable. */
export const CustomColumnVocabulary: Story = {
    render: () => {
        seedBase({ dateField: 'whenDue' }, [
            row({ whenDue: '2026-08-20', owner: 'Alex', priority: 2 }),
        ])
        showCalendarSettings.value = true
        return <CalendarSettings basePath={BASE_PATH} />
    },
}

/** Closed by default (`showCalendarSettings.value` starts false) — a trigger opens it, proving
 *  the box-driven open/close round-trips both ways rather than only ever rendering open. */
export const Interactive: Story = {
    render: () => {
        seedBase({}, [])
        showCalendarSettings.value = false
        return (
            <Show
                when={showCalendarSettings.value}
                fallback={
                    <button
                        type="button"
                        onClick={() => (showCalendarSettings.value = true)}
                    >
                        Open calendar settings
                    </button>
                }
            >
                <CalendarSettings basePath={BASE_PATH} />
            </Show>
        )
    },
    play: async () => {
        const canvas = within(document.body)
        const trigger = canvas.getByText('Open calendar settings')
        await userEvent.click(trigger)
        await waitFor(() =>
            expect(document.querySelector('.calendar-settings')).not.toBeNull(),
        )
        const closeBtn = canvas.getByLabelText('Close')
        await userEvent.click(closeBtn)
        await waitFor(() =>
            expect(document.querySelector('.calendar-settings')).toBeNull(),
        )
    },
}
