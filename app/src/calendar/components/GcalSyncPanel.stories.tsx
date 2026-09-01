// Visual spec for <GcalSyncPanel> — the "Google Calendar sync" section of a calendar's
// settings modal. Two independent fetches drive its states: `GET /gcal/status` (account-level
// connection) and `GET /base?file=<basePath>` (this calendar's own googleCalendarSync /
// googleCalendarId frontmatter, via `api.base`).
//
// The Storybook-wide fakeTransport (.storybook/preview.ts) only answers /tree, /version,
// /file, /rows plus a few daemon/update routes — neither `/gcal/status` nor `/base` is among
// them, so BOTH throw by default. GcalConnectModal.stories.tsx leans on that throw to land on
// the disconnected form; here we want the CONNECTED account state and a populated per-calendar
// sync config too, which needs real data behind those routes. Rather than adding gcal/base
// cases to the SHARED fake (which would change every OTHER story's transport), each story below
// layers a small local Transport that answers just these two routes and delegates everything
// else to the shared `fakeTransport` — the same "layer a custom seed on top" pattern the
// preview's own doc comment describes, just for routes the shared seed has no slot for.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { GcalSyncPanel } from './GcalSyncPanel'
import { setTransport, type Transport } from '../../api'
import { fakeTransport } from '../../ui/_fakeTransport'
import type { GcalStatus } from '../../../../core/src/gcal'
import type { ParsedBase } from '../../../../core/src/bases/types'
import styles from '../Calendar.module.css'

const meta = {
    title: 'Calendar/GcalSyncPanel',
    component: GcalSyncPanel,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GcalSyncPanel>

export default meta
type Story = StoryObj<typeof meta>

const BASE_PATH = 'Calendar.md'

function baseFixture(view: Record<string, unknown>): ParsedBase {
    return {
        config: {
            views: [{ type: 'calendar', name: 'Calendar', ...view }],
        },
        rows: [],
    } as unknown as ParsedBase
}

/** Wrap the shared fakeTransport, answering /gcal/status + this one base's /base fetch, and
 *  delegating everything else (`/tree`, `/file`, `/rows`, ...) to the normal fixture. */
function seedGcal(status: GcalStatus | null, view: Record<string, unknown>) {
    const inner = fakeTransport()
    const custom: Transport = {
        ...inner,
        getJson: async <T,>(path: string): Promise<T> => {
            const pathname = path.split('?')[0]
            if (pathname === '/gcal/status') {
                if (!status)
                    throw new Error('fakeTransport: /gcal/status not stubbed')
                return status as unknown as T
            }
            if (pathname === '/base') return baseFixture(view) as unknown as T
            return inner.getJson<T>(path)
        },
    }
    setTransport(custom)
}

/** Not connected — the "CONNECT GOOGLE CALENDAR" prompt. No account-level Google connection at
 *  all, so this calendar's own sync toggle is unreachable regardless of its frontmatter. */
export const Disconnected: Story = {
    render: () => {
        seedGcal({ connected: false, needsCredentials: true }, {})
        return <GcalSyncPanel basePath={BASE_PATH} />
    },
}

/** Connected, but sync is OFF for this specific calendar — the toggle row + calendar-id field
 *  + conflict-policy select are all visible (account-level UI), just unchecked. */
export const ConnectedSyncOff: Story = {
    render: () => {
        seedGcal(
            {
                connected: true,
                needsCredentials: false,
                account: 'reader@example.com',
                timeZone: 'America/Los_Angeles',
                connectedAt: '2026-07-01T12:00:00.000Z',
            },
            { googleCalendarSync: false },
        )
        return <GcalSyncPanel basePath={BASE_PATH} />
    },
}

/** Connected AND synced — the fullest resting state: account row, ON toggle, a non-default
 *  calendar id, and the conflict-policy select all populated from the base's own frontmatter. */
export const ConnectedSyncOn: Story = {
    render: () => {
        seedGcal(
            {
                connected: true,
                needsCredentials: false,
                account: 'reader@example.com',
                timeZone: 'America/Los_Angeles',
                connectedAt: '2026-07-01T12:00:00.000Z',
            },
            {
                googleCalendarSync: true,
                googleCalendarId: 'team-offsites@group.calendar.google.com',
            },
        )
        return <GcalSyncPanel basePath={BASE_PATH} />
    },
}

/** Clicking the sync toggle when it's off actually flips it — proves the row drives
 *  `api.setProperty` + a refetch, not just that it's clickable. The shared fakeTransport's
 *  generic `post()` fallback acks any unmapped path with 200, which is what `/set-property`
 *  hits here; the refetched `/base` then needs to reflect the flip, so this story keeps its
 *  own tiny bit of mutable state instead of a fixed fixture. */
export const Interactive: Story = {
    render: () => {
        let synced = false
        const inner = fakeTransport()
        const custom: Transport = {
            ...inner,
            getJson: async <T,>(path: string): Promise<T> => {
                const pathname = path.split('?')[0]
                if (pathname === '/gcal/status') {
                    return {
                        connected: true,
                        needsCredentials: false,
                        account: 'reader@example.com',
                    } as unknown as T
                }
                if (pathname === '/base')
                    return baseFixture({
                        googleCalendarSync: synced,
                    }) as unknown as T
                return inner.getJson<T>(path)
            },
            post: async (path: string, body: unknown): Promise<Response> => {
                if (path === '/set-property') {
                    const { key, value } = body as {
                        key: string
                        value: unknown
                    }
                    if (key === 'googleCalendarSync') synced = Boolean(value)
                    return new Response('ok')
                }
                return inner.post(path, body)
            },
        }
        setTransport(custom)
        return <GcalSyncPanel basePath={BASE_PATH} />
    },
    play: async () => {
        const canvas = within(document.body)
        const row = await canvas.findByText('Sync this calendar with Google')
        await userEvent.click(row)
        await waitFor(() =>
            expect(
                document.querySelector(
                    `.${styles['set-col']}:not(.${styles['off']})`,
                ),
            ).not.toBeNull(),
        )
    },
}
