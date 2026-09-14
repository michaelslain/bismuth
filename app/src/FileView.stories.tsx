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
import { createSignal } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import { FileView } from './FileView'
import { PaneContent } from './PaneContent'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { refreshDaemonPages } from './daemonInbox'
import { sampleDaemonPages } from './ui/_daemonFixtures'
import { start as startServerVersion } from './serverVersion'

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
                // fakeTransport's own DEFAULT /daemon/status stub now carries `owner: null` +
                // `thisDeviceId` (and InboxPageView.tsx's `notOwner()` now guards with `!= null`,
                // catching both null and undefined) — the crash this comment used to describe is
                // fixed. But a `daemonStatus` seed here REPLACES that default object wholesale
                // rather than merging with it (see the transport's `seed.daemonStatus ?? {...}`),
                // so this story still has to supply its own complete `DaemonStatus` shape
                // (core/src/daemon.ts) — including `owner`/`thisDeviceId` — to name a specific
                // owning device (`device-1`) and vault name rather than falling back to nothing.
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
        // "SUBMIT" (not "Submit") — match case-insensitively rather than assume the source
        // casing. The word tracks ui/_daemonFixtures.ts's primary action label, which is page
        // DATA (each daemon page names its own actions in frontmatter), not an app constant —
        // so this assertion follows the fixture, and changing the fixture's label changes it.
        await waitFor(() => {
            expect(canvas.getByText(/^submit$/i)).toBeInTheDocument()
        })
    },
}

// A minimal stand-in for the browser EventSource (mirrors serverVersionStart.test.ts's own fake)
// — lets this story's play() advance `serverVersion()` on demand with no real backend, which is
// what drives the bump-then-switch sequence below.
class FakeEventSource {
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    close() {}
    emit(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) })
    }
}

// Task 9 regression fixture: two base notes with the SAME source spec (both own-rows — no
// explicit `source:`, so each resolves to the identical `{kind:'base'}` spec — see
// docs/bases/overview.md's "Default source resolution") and distinguishable rows, plus a plain
// note used to force BaseView to unmount/remount between visits.
const REMOUNT_NOTE_PATH = 'switcher/plain-note.md'
const REMOUNT_NOTE_BODY =
    '# Plain note\n\nA non-base stop that unmounts BaseView between base visits.\n'
const REMOUNT_BASE_A_PATH = 'Base A.md'
const REMOUNT_BASE_A_BODY = '---\ntype: base\n---\n\n- description: alpha\n'
const REMOUNT_BASE_B_PATH = 'Base B.md'
const REMOUNT_BASE_B_BODY = '---\ntype: base\n---\n\n- description: beta\n'

/** Local switcher harness: a `path` signal plus three buttons, driving `<FileView path={path()}
 *  .../>` directly rather than routing through the full App/PaneTree chain — the brief's own
 *  scenario A/B reproduce at this level already (BaseView.tsx's `pendingBody`, captured once at
 *  mount, is the thing under test). */
function RemountSwitcher() {
    const [path, setPath] = createSignal(REMOUNT_NOTE_PATH)
    return (
        <div>
            <div>
                <button
                    type="button"
                    data-testid="remount-note"
                    onClick={() => setPath(REMOUNT_NOTE_PATH)}
                >
                    Note
                </button>
                <button
                    type="button"
                    data-testid="remount-a"
                    onClick={() => setPath(REMOUNT_BASE_A_PATH)}
                >
                    Base A
                </button>
                <button
                    type="button"
                    data-testid="remount-b"
                    onClick={() => setPath(REMOUNT_BASE_B_PATH)}
                >
                    Base B
                </button>
            </div>
            <FileView path={path()} {...baseProps} />
        </div>
    )
}

/** Regression for the bug report: "clicking on the calendar tab would sometimes show the
 *  contents of the task manager tab instead". Diagnosed cause: a tab switch keeps FileView ->
 *  BaseView mounted (FileView's own `Show` only tears down when `isBase()` flips, and the App-
 *  level tab switch never remounts the leaf at all), so BaseView's `pendingBody` — captured ONCE
 *  at mount from `props.body` — can survive a docCache-fresh skip and later get parsed as a
 *  DIFFERENT base's document once a vault change invalidates the cache. Sequence that reproduces
 *  it (mirrors diag-3 repro.ts's scenario A, which measured this 10/10 against the real vault):
 *  visit A, visit B (both parse correctly + warm the caches) -> detour through a plain note
 *  (unmounts BaseView) -> back to A (REMOUNTS BaseView; docCache is still fresh for A, so the
 *  freshly-captured pendingBody is never consumed) -> an unrelated vault change bumps the server
 *  version (marks every docCache entry stale, but is irrelevant to A/B so it does not force an
 *  eager refetch while A is still showing) -> switch to B (no remount this time, since isBase()
 *  never left `true`; the stale-forced refetch reaches for the still-unconsumed pendingBody and
 *  parses A's body under B's path). */
export const NeverShowsAnotherBasesContent: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [REMOUNT_NOTE_PATH]: REMOUNT_NOTE_BODY,
                    [REMOUNT_BASE_A_PATH]: REMOUNT_BASE_A_BODY,
                    [REMOUNT_BASE_B_PATH]: REMOUNT_BASE_B_BODY,
                },
            }),
        )
        return <RemountSwitcher />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)

        // The only way to advance `serverVersion()` (BaseView.tsx's docCache/rowCache freshness
        // key) from a story is a fake EventSource fed through serverVersion.ts's own DI seam.
        // `start()` is module-level-idempotent, and two remount stories call it: in a page where it already
        // ran (the other story, or anything else), this call is a no-op and never builds `fakeEs` — hence
        // the `expect(fakeEs).toBeDefined()` before emitting, so the story cannot pass vacuously.
        let fakeEs: FakeEventSource | undefined
        startServerVersion({
            eventSourceFactory: () => {
                fakeEs = new FakeEventSource()
                return fakeEs as unknown as EventSource
            },
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {},
        })

        // Visit A, then B: both parse correctly and warm BaseView's module-level docCache plus
        // FileView's noteCache — the state a real session already has after opening two base
        // tabs once each.
        await fireEvent.click(canvas.getByTestId('remount-a'))
        await waitFor(() =>
            expect(canvas.getByText('alpha')).toBeInTheDocument(),
        )
        await fireEvent.click(canvas.getByTestId('remount-b'))
        await waitFor(() => expect(canvas.getByText('beta')).toBeInTheDocument())

        // Detour through a non-base note: isBase() goes false, unmounting BaseView.
        await fireEvent.click(canvas.getByTestId('remount-note'))
        await waitFor(() =>
            expect(canvasElement.querySelector('.cm-editor')).not.toBeNull(),
        )

        // Back to A: BaseView remounts fresh (pendingBody = A's body), but docCache is still
        // fresh for A at this version, so the doc resource skips loadDocument() and that
        // freshly-captured pendingBody is never consumed.
        await fireEvent.click(canvas.getByTestId('remount-a'))
        await waitFor(() =>
            expect(canvas.getByText('alpha')).toBeInTheDocument(),
        )

        // An unrelated vault change bumps the server version: irrelevant to either base (so it
        // does not force an eager refetch of the currently-active A), but it DOES mark every
        // docCache entry stale (BaseView.tsx's unconditional `docCache.invalidate(version)`).
        expect(fakeEs).toBeDefined()
        fakeEs?.emit({
            version: 2,
            paths: ['unrelated.md'],
            dirty: { graph: false, tree: false },
        })
        await new Promise(r => setTimeout(r, 0))

        // Switch to B without another non-base detour: BaseView is NOT remounted (isBase() never
        // left true across A -> B), so the still-unconsumed pendingBody (A's body) is what
        // loadDocument() reaches for once the now-stale docCache entry forces a real resolve —
        // B's pane parses A's body under B's path. Before the fix this shows "alpha" (wrong)
        // instead of "beta"; the fix (keying BaseView on props.path) remounts BaseView here too,
        // so a fresh pendingBody is captured on every switch and this never happens.
        await fireEvent.click(canvas.getByTestId('remount-b'))
        await waitFor(() => expect(canvas.getByText('beta')).toBeInTheDocument())
        expect(canvas.queryByText('alpha')).not.toBeInTheDocument()
    },
}

/** Local switcher harness, same three-button shape as `RemountSwitcher` above, but driving
 *  `<PaneContent>` — the real router that wraps `FileView` in `lazy()` + `<Suspense>` (see
 *  PaneContent.tsx) — instead of `<FileView>` directly. */
function PaneContentSwitcher() {
    const [path, setPath] = createSignal(REMOUNT_NOTE_PATH)
    return (
        <div>
            <div>
                <button
                    type="button"
                    data-testid="pc-note"
                    onClick={() => setPath(REMOUNT_NOTE_PATH)}
                >
                    Note
                </button>
                <button
                    type="button"
                    data-testid="pc-a"
                    onClick={() => setPath(REMOUNT_BASE_A_PATH)}
                >
                    Base A
                </button>
                <button
                    type="button"
                    data-testid="pc-b"
                    onClick={() => setPath(REMOUNT_BASE_B_PATH)}
                >
                    Base B
                </button>
            </div>
            <PaneContent
                path={path()}
                onSaved={noop}
                onOpen={noop}
                onNewTerminal={noop}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </div>
    )
}

/** Wave-2 review finding (F3) — regression coverage, NOT a `body()` vs `peekNoteCache` discriminator
 *  (see below for why). Exercises the same "never shows another base's content" invariant as
 *  `NeverShowsAnotherBasesContent` above, but through `<PaneContent>` — the real routing layer a
 *  tab switch actually goes through (wraps `FileView` in `lazy()` + `<Suspense>`, see
 *  PaneContent.tsx) — instead of `<FileView>` directly. Same sequence: visit A, visit B, detour
 *  through a plain note (unmounts BaseView), back to A, an unrelated version bump invalidates
 *  BaseView's docCache, then switch to B.
 *
 *  Investigated whether this (or the direct-FileView story above) could be made to fail with
 *  `body={body()}` alone and pass only with `body={peekNoteCache(path) ?? body()}`, per the F3
 *  ruling. In THESE stories it could not: temporarily instrumenting the mount site (this route and
 *  the direct-FileView route both) showed the value FileView hands BaseView at the instant of
 *  remount was always the new path's, with or without `peekNoteCache`, and reading solid-js@1.9.13
 *  suggests why for this isolated shape (a synchronous cache hit resolves the resource inline, in
 *  the same update pass as the `props.path` change). That is a finding about the isolated story, not
 *  proof the race cannot happen: in the running app, Task 9's real-vault repro showed the wrong base
 *  in 10 of 10 runs with `body={body()}` and in 0 of 10 with `peekNoteCache(path) ?? body()`, so the
 *  app hits a condition these stories do not reproduce. `peekNoteCache(path) ?? body()` stays, and
 *  this story is regression coverage for the invariant, not a guard of that one line. Full
 *  transcript in the fix-2 report's F3 section. */
export const NeverShowsAnotherBasesContentThroughPaneContent: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [REMOUNT_NOTE_PATH]: REMOUNT_NOTE_BODY,
                    [REMOUNT_BASE_A_PATH]: REMOUNT_BASE_A_BODY,
                    [REMOUNT_BASE_B_PATH]: REMOUNT_BASE_B_BODY,
                },
            }),
        )
        return <PaneContentSwitcher />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)

        let fakeEs: FakeEventSource | undefined
        startServerVersion({
            eventSourceFactory: () => {
                fakeEs = new FakeEventSource()
                return fakeEs as unknown as EventSource
            },
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {},
        })

        await fireEvent.click(canvas.getByTestId('pc-a'))
        await waitFor(() =>
            expect(canvas.getByText('alpha')).toBeInTheDocument(),
        )
        await fireEvent.click(canvas.getByTestId('pc-b'))
        await waitFor(() => expect(canvas.getByText('beta')).toBeInTheDocument())

        await fireEvent.click(canvas.getByTestId('pc-note'))
        await waitFor(() =>
            expect(canvasElement.querySelector('.cm-editor')).not.toBeNull(),
        )

        await fireEvent.click(canvas.getByTestId('pc-a'))
        await waitFor(() =>
            expect(canvas.getByText('alpha')).toBeInTheDocument(),
        )

        expect(fakeEs).toBeDefined()
        fakeEs?.emit({
            version: 2,
            paths: ['unrelated.md'],
            dirty: { graph: false, tree: false },
        })
        await new Promise(r => setTimeout(r, 0))

        await fireEvent.click(canvas.getByTestId('pc-b'))
        await waitFor(() => expect(canvas.getByText('beta')).toBeInTheDocument())
        expect(canvas.queryByText('alpha')).not.toBeInTheDocument()
    },
}
