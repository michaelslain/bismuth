// Visual spec for <FileView> — routes a `.md` file to the right surface by reading its body
// ONCE and branching on the parsed frontmatter: `type: base` -> BaseView, `type: daemon-page`
// -> InboxPageView, everything else -> the CodeMirror Editor (or the Milkdown BlockEditor when
// `editor.defaultMode` is "visual" — not exercised here since that's a global settings toggle
// this file would otherwise have to mutate and leave behind for later stories; BlockEditor.
// stories.tsx already covers that surface directly).
//
// This is a ROUTER, not a leaf component (same caveat as PaneContent.stories.tsx): the point of
// these stories is "does this frontmatter shape land on the right downstream view", not the
// full behaviour of Editor/BaseView/InboxPageView, each of which has its own thorough coverage.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { FileView } from './FileView'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { refreshDaemonPages } from './daemonInbox'
import { sampleDaemonPages } from './ui/_daemonFixtures'

const meta = {
    title: 'App/FileView',
    component: FileView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FileView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const noNames = () => []
const baseProps = {
    onSaved: noop,
    onOpen: noop,
    noteNames: noNames,
    memoryNames: noNames,
    tagNames: noNames,
}

const NOTE_PATH = 'projects/roadmap.md'
const NOTE_BODY = '# Roadmap\n\nOrdinary prose — no special frontmatter.\n'
const BASE_PATH = 'boards/tasks.md'
const BASE_BODY = '---\ntype: base\nviews:\n  - type: table\n---\n'
// Matches ui/_daemonFixtures.ts's `sampleDaemonPages()` first entry exactly — InboxPageView
// looks its header state up by PATH in the module-level daemonInbox.ts signal (populated by
// `refreshDaemonPages()`), not from the file's own frontmatter, so the seeded page record and
// the file at this path have to agree.
const DAEMON_PAGE_PATH = '.daemon/pages/reply-drafts.md'
const DAEMON_PAGE_BODY = [
    '---',
    'type: daemon-page',
    '---',
    '',
    '# 3 reply drafts ready',
    '',
    'Drafted replies to 3 unread emails from the last hour. Review before sending.',
].join('\n')

/** No special frontmatter: reads as an ordinary note, mounted in the CodeMirror `Editor`
 *  (`editor.defaultMode` defaults to "source" — see DEFAULTS in settingsSchema.ts). */
export const Note: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return <FileView path={NOTE_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(
                canvasElement.querySelector('.cm-editor'),
            ).not.toBeNull()
        })
    },
}

/** `type: base` frontmatter routes to `<BaseView>`, handed the already-fetched body so it
 *  doesn't re-read the file FileView just read. */
export const Base: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [BASE_PATH]: BASE_BODY } }))
        return <FileView path={BASE_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // BaseView's ViewBar crumb shows the base FILE's name — "tasks" — not the view type;
        // the view-type label only appears once a base declares more than one view (see
        // BaseView.tsx's `SegmentedToggle`, gated on `views.length > 1`), which this single-view
        // fixture deliberately doesn't.
        await waitFor(() => {
            expect(canvas.getByText('tasks')).toBeInTheDocument()
        })
    },
}

/** `type: daemon-page` frontmatter routes to `<InboxPageView>` — the same Editor/BlockEditor
 *  body wrapped in an action-bar header, checked BEFORE the plain-note branch (isDaemonPage is
 *  its own Match, ahead of the `!isBase() && !isDaemonPage()` fallback). The header's actions
 *  come from the daemonInbox.ts page record (looked up by path), so this seeds BOTH the file
 *  body and `/daemon/pages` from the same fixture entry and calls `refreshDaemonPages()`,
 *  mirroring InboxPageView.stories.tsx's own setup. */
export const DaemonPage: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: { [DAEMON_PAGE_PATH]: DAEMON_PAGE_BODY },
                daemonPages: sampleDaemonPages(),
                // fakeTransport's own DEFAULT /daemon/status stub is shaped for the daemon-SETUP
                // surfaces (enabled/running/crons/processes) and omits `owner`/`thisDeviceId` —
                // InboxPageView.tsx's `notOwner()` reads `status()!.owner.ownerDeviceId` (an
                // `undefined` owner passes its own `!== null` guard, then throws on the property
                // read), so this seeds the actual `DaemonStatus` shape (core/src/daemon.ts) the
                // real `/daemon/status` route returns, not the setup-modal shape.
                daemonStatus: {
                    running: true,
                    thisDeviceId: 'device-1',
                    owner: null,
                    name: 'Vault',
                },
            }),
        )
        void refreshDaemonPages()
        return <FileView path={DAEMON_PAGE_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // TextButton renders its label upper-cased via CSS, but the DOM text itself is already
        // "SEND" (not "Send") — match case-insensitively rather than assume the source casing.
        await waitFor(() => {
            expect(canvas.getByText(/^send$/i)).toBeInTheDocument()
        })
    },
}
