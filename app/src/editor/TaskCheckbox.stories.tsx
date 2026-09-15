// Visual spec for <TaskCheckbox> — the task-list marker live-preview mounts as a CodeMirror
// widget for `- [ ]`/`- [x]`/`- [/]`/`- [-]` lines: literal bracket text, the same register as
// bases/TaskCheck.tsx. Its real styling lives in livePreview.ts's EditorView.baseTheme() (the
// `.cm-task-checkbox` block), which CodeMirror only injects for a live EditorView, so the <style>
// below reproduces those rules verbatim (same selectors, same var() tokens).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
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
const TASK_CHECKBOX_CSS = `
  .cm-task-checkbox {
    display: inline-block;
    font-family: var(--editor-font);
    text-indent: 0;
    white-space: nowrap;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 24px;
  }
  .cm-task-checkbox:hover { color: var(--accent); }
  .cm-task-checkbox[data-status='done'] { color: var(--accent); }
  .cm-task-checkbox[data-status='doing'] { color: var(--accent-purple); }
  .cm-task-checkbox[data-status='cancelled'] { opacity: 0.65; }
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
 *  behavior (doing/cancelled are display-only, set by typing `[/]`/`[-]`, not by clicking). */
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
