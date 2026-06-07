// app/src/editor/taskComplete.ts
// Obsidian-Tasks-style inline metadata completion. While typing a checkbox task line
// (`- [ ] …`), typing a keyword (due, scheduled, start, priority, high, every, …) offers
// the matching signifier; picking it inserts the emoji (📅 ⏳ 🛫 ✅ ➕ ❌ for dates,
// 🔺⏫🔼🔽⏬ for priority, 🔁 for recurrence — see core/src/tasks.ts) and, for the dated /
// recurring ones, re-opens the popup with relative-date / recurrence choices that resolve
// to the ISO format the parser expects. Emoji is hard to type; this makes the metadata
// discoverable and correct.
//
// Pure, unit-tested helpers (taskDescStart, classifyTaskContext, relativeDateOptions) do
// the matching; the source is thin wiring, mirroring wikilink.ts/tag.ts/queryComplete.ts.
import { pickedCompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { todayISO, addDaysISO } from "../../../core/src/dates";

/** Column where a task's description begins (just past `- [ ] `), or null if the line is
 *  not a checkbox task. Mirrors the TASK_LINE shape in core/src/tasks.ts. */
export function taskDescStart(lineText: string): number | null {
  const m = lineText.match(/^(\s*[-*+] \[.\] )/);
  return m ? m[1].length : null;
}

// The date / recurrence signifiers, as an alternation so astral-plane emoji match reliably.
const DATE_EMOJI = "📅|⏳|🛫|✅|➕|❌";

export type TaskContext =
  | { kind: "date"; from: number; query: string }
  | { kind: "recurrence"; from: number; query: string }
  | { kind: "keyword"; from: number; query: string }
  | null;

/** Classify the text before the caret within a task description. A date/recurrence emoji
 *  immediately before the caret means we're filling that value; otherwise the trailing
 *  word is a keyword to expand into a signifier. */
export function classifyTaskContext(textBefore: string): TaskContext {
  let m = textBefore.match(new RegExp(`(?:${DATE_EMOJI})[ \\t]*([\\w-]*)$`, "u"));
  if (m) return { kind: "date", from: textBefore.length - m[1].length, query: m[1] };

  m = textBefore.match(/🔁[ \t]*([\w ]*)$/u);
  if (m) return { kind: "recurrence", from: textBefore.length - m[1].length, query: m[1] };

  m = textBefore.match(/([\p{L}]+)$/u);
  if (m) return { kind: "keyword", from: textBefore.length - m[1].length, query: m[1] };

  return null;
}

interface TaskField { label: string; keywords: string[]; insert: string; follow: "date" | "recurrence" | null }

// Keyword → signifier. `follow` re-opens the popup with the value list (dates / recurrence).
const TASK_FIELDS: TaskField[] = [
  { label: "📅  due date",         keywords: ["due"],                            insert: "📅 ", follow: "date" },
  { label: "⏳  scheduled date",   keywords: ["scheduled"],                      insert: "⏳ ", follow: "date" },
  { label: "🛫  start date",       keywords: ["start", "starts"],                insert: "🛫 ", follow: "date" },
  { label: "🔁  recurrence",       keywords: ["repeat", "recurring", "recur", "every"], insert: "🔁 ", follow: "recurrence" },
  { label: "🔺  highest priority", keywords: ["priority", "highest", "urgent"],  insert: "🔺 ", follow: null },
  { label: "⏫  high priority",     keywords: ["priority", "high"],               insert: "⏫ ", follow: null },
  { label: "🔼  medium priority",  keywords: ["priority", "medium"],             insert: "🔼 ", follow: null },
  { label: "🔽  low priority",     keywords: ["priority", "low"],                insert: "🔽 ", follow: null },
  { label: "⏬  lowest priority",   keywords: ["priority", "lowest"],             insert: "⏬ ", follow: null },
  { label: "✅  done date",        keywords: ["done", "completed"],              insert: "✅ ", follow: "date" },
  { label: "➕  created date",      keywords: ["created"],                        insert: "➕ ", follow: "date" },
  { label: "❌  cancelled date",   keywords: ["cancelled", "canceled"],          insert: "❌ ", follow: "date" },
];

const RECUR_RULES = ["every day", "every week", "every weekday", "every month", "every year", "every 2 weeks"];

const DATE_OFFSETS: Array<{ label: string; days: number }> = [
  { label: "today", days: 0 },
  { label: "tomorrow", days: 1 },
  { label: "in 2 days", days: 2 },
  { label: "in 3 days", days: 3 },
  { label: "in a week", days: 7 },
  { label: "in two weeks", days: 14 },
];

/** Relative-date choices resolved to ISO against `today` (pure; `today` injectable for tests). */
export function relativeDateOptions(today: string = todayISO()): Array<{ label: string; date: string }> {
  return DATE_OFFSETS.map((o) => ({ label: o.label, date: o.days === 0 ? today : addDaysISO(today, o.days) }));
}

/** TASK_FIELDS whose any keyword starts with `query` (case-insensitive). Empty query → all. */
export function matchTaskFields(query: string): TaskField[] {
  const q = query.toLowerCase();
  if (!q) return TASK_FIELDS;
  return TASK_FIELDS.filter((f) => f.keywords.some((k) => k.startsWith(q)));
}

function replaceWith(insert: string, cursorOffset: number, trigger: boolean) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + cursorOffset },
      annotations: pickedCompletion.of(completion),
    });
    if (trigger) startCompletion(view);
  };
}

export function taskSource(): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const descStart = taskDescStart(line.text);
    const col = context.pos - line.from;
    if (descStart == null || col < descStart) return null; // not in a task description

    const textBefore = line.text.slice(0, col);
    const cls = classifyTaskContext(textBefore);
    if (!cls) return null;
    const from = line.from + cls.from;

    if (cls.kind === "date") {
      const options: Completion[] = relativeDateOptions().map((d) => ({
        label: d.label, detail: d.date, type: "enum",
        apply: replaceWith(d.date, d.date.length, false),
      }));
      return { from, options, validFor: /^[\w-]*$/ };
    }
    if (cls.kind === "recurrence") {
      const options: Completion[] = RECUR_RULES.map((r) => ({
        label: r, type: "enum",
        apply: replaceWith(r, r.length, false),
      }));
      return { from, options, validFor: /^[\w ]*$/ };
    }
    // keyword: expand into a signifier. Quiet unless explicitly invoked or ≥2 chars typed.
    if (!context.explicit && cls.query.length < 2) return null;
    const fields = matchTaskFields(cls.query);
    if (fields.length === 0) return null;
    const options: Completion[] = fields.map((f) => ({
      label: f.label, type: "enum",
      apply: replaceWith(f.insert, f.insert.length, f.follow != null),
    }));
    return { from, options, filter: false, validFor: /^[\p{L}]*$/u };
  };
}
