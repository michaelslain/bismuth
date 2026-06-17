import { For, Index, Show, type JSX } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { renderValue, isTaskRow } from "./renderValue";
import { Icon } from "../icons/Icon";
import { groupColor } from "../ui/StatusDot";
import { todayISO } from "../../../core/src/dates";
import { api } from "../api";
import { openTaskStatusMenu } from "../taskStatusMenu";
import styles from "./BaseView.module.css";

// Task status (todo/done/in-progress/cancelled/other) -> the native checkbox's
// data-status (matches livePreview's `.cm-task-checkbox` glyph states).
function checkStatus(s: unknown): "todo" | "done" | "doing" | "cancelled" {
  if (s === "done") return "done";
  if (s === "in-progress") return "doing";
  if (s === "cancelled") return "cancelled";
  return "todo";
}

const PRIORITY_MARK: Record<string, string> = {
  highest: "🔺", high: "⏫", medium: "🔼", low: "🔽", lowest: "⏬",
};

// Render a task description as lightweight inline markdown — wikilinks become
// clickable, #tags get the tag color, **bold**/*italic* render — so a task line
// reads like it does in the editor instead of as flat, truncated text.
const INLINE_RE = /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|(^|\s)#([A-Za-z0-9_/-]+)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
function renderTaskText(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      // [[wikilink]] -> open the note
      const [target, display] = m[1].split("|");
      const label = display ?? target.split("/").pop() ?? target;
      const path = target.endsWith(".md") ? target : `${target}.md`;
      out.push(
        <span class={styles.taskLink} onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("oa-open", { detail: path })); }}>
          {label}
        </span>,
      );
    } else if (m[2] !== undefined) {
      // [label](url) -> external links open in a new tab; note paths open in-app
      const url = m[3];
      const external = /^https?:\/\//.test(url);
      out.push(
        <span class={styles.taskLink} title={url} onClick={(e) => {
          e.stopPropagation();
          if (external) window.open(url, "_blank", "noopener");
          else window.dispatchEvent(new CustomEvent("oa-open", { detail: url.endsWith(".md") ? url : `${url}.md` }));
        }}>
          {m[2]}
        </span>,
      );
    } else if (m[5] !== undefined) {
      if (m[4]) out.push(m[4]); // preserve the whitespace captured before the tag
      out.push(<span class={styles.taskTag}>#{m[5]}</span>);
    } else if (m[6] !== undefined) {
      out.push(<strong>{m[6]}</strong>);
    } else if (m[7] !== undefined) {
      out.push(<em>{m[7]}</em>);
    }
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** One task line, rendered like the editor's native `- [ ]` items: the same checkbox
 *  glyph, a markdown description, and the parsed signifiers (priority + dates + recurrence). */
function TaskRow(props: { row: Row; onToggle: (row: Row, e: Event) => void; onSetStatus: (row: Row, e: MouseEvent) => void }) {
  const n = () => props.row.note;
  const status = () => checkStatus(n().status);
  const done = () => n().status === "done";
  const desc = () => String(n().description ?? props.row.file.name);
  const priority = () => n().priority as string | undefined;
  const due = () => n().due as string | undefined;
  const scheduled = () => n().scheduled as string | undefined;
  const start = () => n().start as string | undefined;
  const recurrence = () => n().recurrence as string | undefined;
  const overdue = () => !!due() && !done() && due()! < todayISO();

  return (
    <div class={styles.taskItem}>
      <span
        class={styles.taskCheck}
        data-status={status()}
        title="Toggle task — right-click to set status"
        onClick={(e) => props.onToggle(props.row, e)}
        onContextMenu={(e) => props.onSetStatus(props.row, e)}
      >
        <span class={`${styles.ckGlyph} ${styles.ckCheck}`}><Icon value="Check" size={11} strokeWidth={3} /></span>
        <span class={`${styles.ckGlyph} ${styles.ckSlash}`} />
        <span class={`${styles.ckGlyph} ${styles.ckDash}`} />
      </span>
      <span class={`${styles.taskBody} ${done() ? styles.done : ""}`}>
        {renderTaskText(desc())}
        <Show when={priority() && priority() !== "none"}>
          <span class={styles.taskPrio} title={`${priority()} priority`}>{PRIORITY_MARK[priority()!]}</span>
        </Show>
        <Show when={start()}><span class={styles.taskMeta}>🛫 {start()}</span></Show>
        <Show when={scheduled()}><span class={styles.taskMeta}>⏳ {scheduled()}</span></Show>
        <Show when={due()}><span class={`${styles.taskMeta} ${overdue() ? styles.overdue : ""}`}>📅 {due()}</span></Show>
        <Show when={recurrence()}><span class={styles.taskMeta}>🔁 {recurrence()}</span></Show>
      </span>
    </div>
  );
}

export function ListView(props: { result: ViewResult; config: BaseConfig; onChange?: () => void }) {
  const firstCol = (): string => props.result.columns[0] ?? "file.name";
  const authorCol = (): string | undefined => props.result.columns[1];
  const rightCol = (): string | undefined => props.result.columns[2];

  const open = (row: Row) => window.dispatchEvent(new CustomEvent("oa-open", { detail: row.file.path }));

  // A checkbox line: toggle the underlying markdown task, then refetch. The checkbox
  // click is isolated from the row's open-on-click so ticking a task doesn't navigate.
  const toggle = (row: Row, e: Event) => {
    e.stopPropagation();
    // Refresh either way so the list reflects disk truth even if the write failed.
    void api.toggleTask(row.file.path, row.note.line as number).finally(() => props.onChange?.());
  };

  // Right-click a checkbox → the shared status menu (To do / In progress / Done / Cancelled,
  // current omitted), same as the cards view + editor. Writes the chosen box char to the source
  // line so every status round-trips — unlike the left-click toggle, which only flips done⇄todo.
  const setStatus = (row: Row, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // don't also open the pane's context menu underneath
    const cur = String(row.note.statusChar ?? " ") || " ";
    openTaskStatusMenu(e.clientX, e.clientY, cur, (char) => {
      void api.toggleTask(row.file.path, row.note.line as number, char).finally(() => props.onChange?.());
    });
  };

  return (
    <div class={styles.list}>
      {/* Groups are index-keyed (Index, not For): a re-resolve mints a new group OBJECT
          whenever its row set changes (toggle/add/remove), and a reference-keyed <For> would
          dispose+remount the whole group subtree — discarding every row identity reconcileRows
          preserved (the "whole list reloads" flash). Index keeps the group's DOM mounted and
          hands a reactive `group()` accessor, so only the inner reference-keyed <For> over the
          rows diffs — and just the changed row repaints. */}
      <Index each={props.result.groups}>
        {(group) => (
          <div class={styles.lgroup}>
            <Show when={group().key !== ""}>
              <div class={styles.lghead} style={{ color: groupColor(group().key) }}>
                <span class={styles.dot} />
                {group().key}
                <span class={styles.count}>· {group().rows.length}</span>
              </div>
            </Show>
            <For each={group().rows}>
              {(row) => {
                // Task rows render as a native checkbox line (see TaskRow).
                if (isTaskRow(row)) return <TaskRow row={row} onToggle={toggle} onSetStatus={setStatus} />;

                const title = resolveProperty(firstCol(), row);
                const author = authorCol() ? resolveProperty(authorCol()!, row) : null;
                return (
                  <div class={styles.lrow} onClick={() => open(row)}>
                    <Icon value="Book" size={15} />
                    <span class={styles.ltext}>
                      {title == null ? row.file.name : String(title)}
                      <Show when={author != null && typeof author !== "object"}>
                        <span class={styles.lrowAuthor}> — {String(author)}</span>
                      </Show>
                    </span>
                    <Show when={rightCol()}>
                      <span class={styles.lrowRight}>
                        {renderValue(rightCol()!, row)}
                      </span>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        )}
      </Index>
    </div>
  );
}
