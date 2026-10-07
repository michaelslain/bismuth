// Visual spec for <TaskCheckbox> — the task-list marker live-preview mounts as a CodeMirror
// widget for `- [ ]`/`- [x]`/`- [/]`/`- [-]` lines: literal bracket text, the same register as
// bases/TaskCheck.tsx. Its real styling lives in livePreview.ts's EditorView.baseTheme() (the
// `.cm-task-checkbox` block), which CodeMirror only injects for a live EditorView, so the <style>
// below reproduces those rules verbatim (same selectors, same var() tokens).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import {
    contentOriginLeft,
    lineWith,
    markerRect,
    textRowLefts,
} from './_listGeometry'
import { TaskCheckbox, charToStatus, type TaskStatus } from './TaskCheckbox'
import { Row } from '../ui/_storyKit'
import MarkdownField from '../ui/MarkdownField'

const meta = {
    title: 'Editor/TaskCheckbox',
    component: TaskCheckbox,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskCheckbox>

export default meta
type Story = StoryObj<typeof meta>

// Verbatim from livePreview.ts's EditorView.baseTheme() (the widget's real, only styling).
// It drives ui/BracketToggle's three custom properties — the glyph, its inks and its box all come
// from that primitive now — so there is no `color` here and no `[data-status='done']` /
// `[data-status='doing']` rule at all: `[x]` and `[/]` take BracketToggle's own default
// `--bracket-on` (the accent). The `font-size: 24px` this block used to carry was never in the
// real theme; it made the story's mark twice the size of the one that ships.
const TASK_CHECKBOX_CSS = `
  .cm-task-checkbox {
    display: inline-block;
    font-family: var(--ui-font-stack);
    text-indent: 0;
    white-space: nowrap;
    cursor: pointer;
    --bracket-height: auto;
    --bracket-off: var(--text-muted);
  }
  /* Cancelled BEFORE hover: both selectors are (0,2,0), so the later one wins and hover has to be
     last or a cancelled box (still clickable — a click toggles it to done) loses its hover cue. */
  .cm-task-checkbox[data-status='cancelled'] { --bracket-off: var(--faint); }
  .cm-task-checkbox:hover { --bracket-off: var(--accent); }
`

/** A single todo checkbox (`[ ]`). */
export const Default: Story = {
    render: () => (
        <>
            <style>{TASK_CHECKBOX_CSS}</style>
            <TaskCheckbox status={() => 'todo'} />
        </>
    ),
}

/** All four states side by side: `[ ]` / `[x]` / `[/]` / `[-]` —
 *  each driven by the same `[ ]`/`[x]`/`[/]`/`[-]` char the real markdown line stores,
 *  routed through the same `charToStatus` the widget itself uses. */
export const AllStatuses: Story = {
    render: () => {
        const chars = ['todo', 'x', '/', '-'] as const
        const labelFor = (s: TaskStatus) => s[0].toUpperCase() + s.slice(1)
        return (
            <>
                <style>{TASK_CHECKBOX_CSS}</style>
                <Row gap="28px">
                    {chars.map(ch => {
                        const status = ch === 'todo' ? 'todo' : charToStatus(ch)
                        return (
                            <div
                                style={{
                                    display: 'flex',
                                    'flex-direction': 'column',
                                    'align-items': 'center',
                                    gap: '6px',
                                }}
                            >
                                <TaskCheckbox status={() => status} />
                                <span
                                    style={{
                                        'font-family': 'var(--ui-font-stack)',
                                        'font-size': 'var(--fs-ui)',
                                        color: 'var(--text-muted)',
                                    }}
                                >
                                    {labelFor(status)}
                                </span>
                            </div>
                        )
                    })}
                </Row>
            </>
        )
    },
}

/** Interactive: clicking cycles todo -> done -> todo, matching the widget's real click
 *  behavior — which toggles done ⇄ not-done from ANY status, so clicking a `[/]` or `[-]` box
 *  writes `x` too. `doing`/`cancelled` are reached by the right-click status menu or by typing. */
export const Interactive: Story = {
    render: () => {
        const [status, setStatus] = createSignal<TaskStatus>('todo')
        return (
            <>
                <style>{TASK_CHECKBOX_CSS}</style>
                <span
                    onClick={() =>
                        setStatus(s => (s === 'done' ? 'todo' : 'done'))
                    }
                >
                    <TaskCheckbox status={status} />
                </span>
            </>
        )
    },
}

/** In a live CodeMirror editor (MarkdownField mounts the same livePreview extension as the note
 *  editor, so this is the REAL theme, not the copy above): every status, a nested task, a wrapped
 *  long task that must hang under its text, and a bullet sibling for the gutter. */
export const InEditor: Story = {
    play: async ({ canvasElement }) => {
        const root = canvasElement.querySelector('.cm-editor')
        if (!root)
            throw new Error('MarkdownField mounted no CodeMirror editor to measure')
        await new Promise(r => requestAnimationFrame(() => r(null)))

        // THE DEPTH-0 LIST LINES, one per marker kind and status. Named by a substring of their
        // own rendered text so a reordering of the buffer above cannot silently point these at
        // the wrong line.
        const AXIS = [
            'todo',
            'done',
            'doing',
            'cancelled',
            'a long task line',
            'plain bullet',
        ]
        const WRAPPED = 'a long task line that wraps'

        // (1) THE HANGING INDENT. A wrapped item's continuation row must start on the same x as
        // its own first row — that is what "hanging" means. The line's inline `text-indent` has
        // to cancel exactly ONE LIST_STEP for this to hold; indenting by the full marker column
        // (LIST_GUTTER) instead leaves row 1 the overhang (0.6em) LEFT of row 2, which no
        // element rect and no screenshot-diff of a short line can see.
        const rows = textRowLefts(lineWith(root, WRAPPED))
        expect(
            rows.length,
            'the long task line did not wrap — this assertion would grade nothing',
        ).toBeGreaterThan(1)
        expect(
            Math.abs(rows[1] - rows[0]),
            `wrapped row starts at x=${rows[1]} but its own first row starts at x=${rows[0]}`,
        ).toBeLessThanOrEqual(0.5)

        // (2) NOTHING HANGS LEFT OF THE CLIP EDGE. The marker column is pulled left of the line
        // box on purpose; it may not be pulled left of `.cm-content`, which a zero-padding host
        // (the chat composer) clips at.
        const origin = contentOriginLeft(root)
        for (const needle of [...AXIS, 'nested child task']) {
            const left = markerRect(lineWith(root, needle)).left
            expect(
                left - origin,
                `the marker column of "${needle}" starts ${(origin - left).toFixed(1)}px outside the content box — a zero-padding host clips it`,
            ).toBeGreaterThanOrEqual(-0.5)
        }

        // (3) ONE COLUMN. Bullets, done/doing/cancelled tasks and a wrapping task all put their
        // text on the SAME axis — the headline of the marker-column work, previously measured by
        // hand over CDP and asserted nowhere.
        const axis = AXIS.map(n => [n, textRowLefts(lineWith(root, n))[0]] as const)
        for (const [n, x] of axis)
            expect(
                Math.abs(x - axis[0][1]),
                `"${n}" text starts at x=${x} but "${axis[0][0]}" starts at x=${axis[0][1]} — the list kinds do not share one column`,
            ).toBeLessThanOrEqual(0.5)

        // (4) THE WIDGET IS A CHECKBOX TO ASSISTIVE TECH, and `doing` is the indeterminate one.
        const boxes = [
            ...root.querySelectorAll<HTMLElement>('[role="checkbox"]'),
        ]
        expect(boxes.length).toBe(7)
        const expected: Record<string, string> = {
            todo: 'false',
            done: 'true',
            doing: 'mixed',
            cancelled: 'false',
        }
        for (const b of boxes) {
            const status = b.dataset.status ?? ''
            expect(expected[status], `unexpected data-status ${status}`).toBeDefined()
            expect(b.getAttribute('aria-checked')).toBe(expected[status])
        }
    },
    render: () => {
        const [v, setV] = createSignal(
            [
                '- [ ] todo',
                '- [x] done',
                '- [/] doing',
                '- [-] cancelled',
                '    - [ ] nested child task',
                '        - [x] grandchild task',
                '- [ ] a long task line that wraps onto a second row so the hanging indent under its own text can be checked',
                '- plain bullet',
            ].join('\n'),
        )
        return (
            <div
                data-testid="task-editor"
                style={{
                    width: '360px',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                }}
            >
                <MarkdownField value={v()} onInput={setV} />
            </div>
        )
    },
}
