// Visual spec for <DaemonRow> — one row of a shared column grid. Every story wraps its rows in
// a `.list`-shaped grid (the exact template DaemonCrons/DaemonProcesses use) so the subgrid has
// real tracks to inherit and the alignment claim is actually demonstrable, not just a single row
// floating with no shared columns to prove.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { For } from 'solid-js'
import DaemonRow, { type DaemonRowProps } from './DaemonRow'
import { TextButton } from '../ui/TextButton'

const meta = {
    title: 'Daemon/DaemonRow',
    component: DaemonRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonRow>

export default meta
type Story = StoryObj<typeof meta>

const listStyle = {
    display: 'grid',
    'grid-template-columns': 'auto minmax(0, 1fr) minmax(0, 11ch) auto auto',
    width: '360px',
} as const

const List = (props: { rows: DaemonRowProps[] }) => (
    <div style={listStyle}>
        <For each={props.rows}>{row => <DaemonRow {...row} />}</For>
    </div>
)

/** The 4-column services shape (no schedule track) — used only by `WithoutMeta` below. A row
 *  must never mix into the 5-column list without `meta`: it has no explicit grid-column
 *  indices, so a 4-cell row inside a 5-column subgrid would auto-place its cells one column
 *  short and misalign (see DaemonRow.tsx's header comment). */
const noMetaListStyle = {
    display: 'grid',
    'grid-template-columns': 'auto minmax(0, 1fr) auto auto',
    width: '280px',
} as const

const NoMetaList = (props: { rows: DaemonRowProps[] }) => (
    <div style={noMetaListStyle}>
        <For each={props.rows}>{row => <DaemonRow {...row} />}</For>
    </div>
)

/** Every tone, in a shared grid — the dot colour, the status word and the age all line up in the
 *  same columns down the list. */
export const Tones: Story = {
    render: () => (
        <List
            rows={[
                {
                    name: 'morning-brief',
                    tone: 'ok',
                    status: 'ok 4m ago',
                    meta: 'daily',
                    onOpen: () => {},
                },
                {
                    name: 'answer-emails',
                    tone: 'running',
                    status: 'running',
                    meta: 'every 15m',
                    onOpen: () => {},
                },
                {
                    name: 'dream',
                    tone: 'failed',
                    status: 'failed 2h ago',
                    meta: 'every 3h',
                    onOpen: () => {},
                },
                {
                    name: 'nightly-backup',
                    tone: 'off',
                    status: 'off',
                    meta: 'daily',
                    dim: true,
                    onOpen: () => {},
                },
                {
                    name: 'vault-review',
                    tone: 'idle',
                    status: 'never',
                    meta: 'on change',
                    onOpen: () => {},
                },
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('ok 4m ago')).toBeInTheDocument()
        await expect(canvas.getByText('running')).toBeInTheDocument()
        await expect(canvas.getByText('failed 2h ago')).toBeInTheDocument()
        await expect(canvas.getByText('off')).toBeInTheDocument()
        await expect(canvas.getByText('never')).toBeInTheDocument()
    },
}

/** A dimmed, disabled row — the whole row steps back, not just the dot. */
export const Dim: Story = {
    render: () => (
        <List
            rows={[
                {
                    name: 'nightly-backup',
                    tone: 'off',
                    status: 'off',
                    meta: 'daily',
                    dim: true,
                    onOpen: () => {},
                },
            ]}
        />
    ),
}

/** A name long enough that it must ellipsize in the fixed row rather than push the schedule/
 *  status/actions columns off the edge. */
export const LongName: Story = {
    render: () => (
        <List
            rows={[
                {
                    name: 'reconcile-every-vault-notes-inbound-link-graph-nightly',
                    tone: 'ok',
                    status: 'ok 4m ago',
                    meta: 'every 3h',
                    onOpen: () => {},
                },
            ]}
        />
    ),
}

/** No `meta` at all — the 4-column services shape, DaemonProcesses' own list template (never
 *  the 5-column crons list without `meta` — see DaemonRow.tsx's header comment on why). */
export const WithoutMeta: Story = {
    render: () => (
        <NoMetaList
            rows={[
                {
                    name: 'reindex',
                    tone: 'ok',
                    status: 'on',
                    onOpen: () => {},
                },
            ]}
        />
    ),
}

/** With `meta` — the schedule column carries the cron's frequency string. */
export const WithMeta: Story = {
    render: () => (
        <List
            rows={[
                {
                    name: 'answer-emails',
                    tone: 'ok',
                    status: 'ok 10m ago',
                    meta: 'every 15m',
                    onOpen: () => {},
                },
            ]}
        />
    ),
}

/** A trailing action in the row's last column — `[ run ]`, the crons list's default action. */
export const WithActions: Story = {
    render: () => (
        <List
            rows={[
                {
                    name: 'morning-brief',
                    tone: 'ok',
                    status: 'ok 4m ago',
                    meta: 'daily',
                    onOpen: () => {},
                    actions: <TextButton onClick={() => {}}>run</TextButton>,
                },
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByRole('button', { name: 'run' }),
        ).toBeInTheDocument()
    },
}
