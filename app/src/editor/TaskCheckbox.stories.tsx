// Visual spec for <TaskCheckbox> — the task-list checkbox live-preview mounts as a
// CodeMirror widget for `- [ ]`/`- [x]`/`- [/]`/`- [-]` lines. All three glyph layers
// (check/slash/dash) are always in the DOM; the theme cross-fades in the one matching
// `data-status` — real styling that lives as CodeMirror `EditorView.baseTheme()` rules
// (livePreview.ts, the `.cm-task-checkbox`/`.cm-ck-glyph`/... block), which CodeMirror only
// injects for a live EditorView, not a stylesheet this story can import. The <style> below
// reproduces those rules verbatim (same selectors, same var() tokens) so `data-status`
// actually drives the cross-fade here too, instead of always showing a bare, un-faded
// checkmark.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { TaskCheckbox, charToStatus, type TaskStatus } from "./TaskCheckbox";
import { Row } from "../ui/_storyKit";

const meta = {
  title: "Editor/TaskCheckbox",
  component: TaskCheckbox,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TaskCheckbox>;

export default meta;
type Story = StoryObj<typeof meta>;

// Verbatim from livePreview.ts's EditorView.baseTheme() (the widget's real, only styling).
const TASK_CHECKBOX_CSS = `
  .cm-task-checkbox {
    display: inline-block;
    position: relative;
    width: 1.08em;
    height: 1.08em;
    box-sizing: border-box;
    border: 1.5px solid color-mix(in srgb, var(--fg) 34%, transparent);
    border-radius: 0.32em;
    vertical-align: -0.18em;
    background: transparent;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease;
    font-size: 24px;
  }
  .cm-task-checkbox:hover { border-color: color-mix(in srgb, var(--accent) 70%, transparent); }
  .cm-task-checkbox[data-status='done'] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .cm-task-checkbox[data-status='doing'] { border-color: var(--accent-purple); }
  .cm-task-checkbox[data-status='cancelled'] { border-color: color-mix(in srgb, var(--fg) 28%, transparent); opacity: 0.65; }
  .cm-ck-glyph {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: scale(0.55);
    transition: opacity 150ms ease, transform 150ms ease;
    pointer-events: none;
  }
  .cm-task-checkbox[data-status='done'] .cm-ck-check { opacity: 1; transform: scale(1); }
  .cm-task-checkbox[data-status='doing'] .cm-ck-slash { opacity: 1; transform: scale(1); }
  .cm-task-checkbox[data-status='cancelled'] .cm-ck-dash { opacity: 1; transform: scale(1); }
  .cm-ck-slash::before {
    content: '';
    width: 0.13em;
    height: 0.66em;
    border-radius: 0.07em;
    background: var(--accent-purple);
    transform: rotate(45deg);
  }
  .cm-ck-dash::before {
    content: '';
    width: 0.5em;
    height: 0.13em;
    border-radius: 0.07em;
    background: color-mix(in srgb, var(--fg) 60%, transparent);
  }
`;

/** A single todo checkbox (unchecked — the box outline, no glyph faded in). */
export const Default: Story = {
  render: () => (
    <>
      <style>{TASK_CHECKBOX_CSS}</style>
      <TaskCheckbox status={() => "todo"} />
    </>
  ),
};

/** All four states side by side: todo / done (check) / doing (slash) / cancelled (dash) —
 *  each driven by the same `[ ]`/`[x]`/`[/]`/`[-]` char the real markdown line stores,
 *  routed through the same `charToStatus` the widget itself uses. */
export const AllStatuses: Story = {
  render: () => {
    const chars = ["todo", "x", "/", "-"] as const;
    const labelFor = (s: TaskStatus) => s[0].toUpperCase() + s.slice(1);
    return (
      <>
        <style>{TASK_CHECKBOX_CSS}</style>
        <Row gap="28px">
          {chars.map((ch) => {
            const status = ch === "todo" ? "todo" : charToStatus(ch);
            return (
              <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "6px" }}>
                <TaskCheckbox status={() => status} />
                <span style={{ "font-family": "var(--ui-font-stack)", "font-size": "11px", color: "var(--text-muted)" }}>
                  {labelFor(status)}
                </span>
              </div>
            );
          })}
        </Row>
      </>
    );
  },
};

/** Interactive: clicking cycles todo -> done -> todo, matching the widget's real click
 *  behavior (doing/cancelled are display-only, set by typing `[/]`/`[-]`, not by clicking). */
export const Interactive: Story = {
  render: () => {
    const [status, setStatus] = createSignal<TaskStatus>("todo");
    return (
      <>
        <style>{TASK_CHECKBOX_CSS}</style>
        <span onClick={() => setStatus((s) => (s === "done" ? "todo" : "done"))}>
          <TaskCheckbox status={status} />
        </span>
      </>
    );
  },
};
