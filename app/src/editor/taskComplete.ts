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
import { type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { todayISO, addDaysISO, weekdayName } from "../../../core/src/dates";
import { makeApply } from "./applyCompletion";

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

/** The seven upcoming weekdays by name (`monday`…`sunday`), each resolved to its next
 *  occurrence 1–7 days out — so typing `friday` picks the coming Friday. Today's own
 *  weekday lands at +7 (today itself is the separate "today" choice). */
export function weekdayOptions(today: string = todayISO()): Array<{ label: string; date: string }> {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysISO(today, i + 1);
    return { label: weekdayName(date), date };
  });
}

/** Relative-date choices resolved to ISO against `today` (pure; `today` injectable for tests).
 *  Includes the named weekdays so a due date can be set by day-of-week ("friday"). */
export function relativeDateOptions(today: string = todayISO()): Array<{ label: string; date: string }> {
  return [
    ...DATE_OFFSETS.map((o) => ({ label: o.label, date: o.days === 0 ? today : addDaysISO(today, o.days) })),
    ...weekdayOptions(today),
  ];
}

/** TASK_FIELDS whose any keyword starts with `query` (case-insensitive). Empty query → all. */
export function matchTaskFields(query: string): TaskField[] {
  const q = query.toLowerCase();
  if (!q) return TASK_FIELDS;
  return TASK_FIELDS.filter((f) => f.keywords.some((k) => k.startsWith(q)));
}

export function taskSource(): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const descStart = taskDescStart(line.text);
    const col = context.pos - line.from;
    if (descStart == null || col < descStart) return null; // not in a task description

    const textBefore = line.text.slice(0, col);
    // classifyTaskContext only matches a signifier word/emoji directly under the caret, so
    // on an empty or just-spaced task description it returns null. For an explicit invoke
    // (Ctrl-Space) treat that as an empty keyword query at the caret → the full signifier
    // menu, inserted at the caret (nothing to clobber). Auto-typing stays quiet.
    const cls = classifyTaskContext(textBefore) ?? (context.explicit ? { kind: "keyword" as const, from: col, query: "" } : null);
    if (!cls) return null;
    const from = line.from + cls.from;

    if (cls.kind === "date") {
      const options: Completion[] = relativeDateOptions().map((d) => ({
        label: d.label, detail: d.date, type: "enum",
        apply: makeApply(d.date, d.date.length, false),
      }));
      return { from, options, validFor: /^[\w-]*$/ };
    }
    if (cls.kind === "recurrence") {
      const options: Completion[] = RECUR_RULES.map((r) => ({
        label: r, type: "enum",
        apply: makeApply(r, r.length, false),
      }));
      return { from, options, validFor: /^[\w ]*$/ };
    }
    // keyword: expand the trailing word into a signifier. Quiet unless explicitly invoked
    // or ≥2 chars typed.
    if (!context.explicit && cls.query.length < 2) return null;
    const matched = matchTaskFields(cls.query);
    if (matched.length > 0) {
      const options: Completion[] = matched.map((f) => ({
        label: f.label, type: "enum",
        apply: makeApply(f.insert, f.insert.length, f.follow != null),
      }));
      return { from, options, filter: false, validFor: /^[\p{L}]*$/u };
    }
    // No signifier starts with the trailing word (e.g. "book"). On an explicit invoke,
    // offer the whole menu inserted at the caret rather than replacing the word — with a
    // leading space when the caret isn't already preceded by whitespace.
    if (!context.explicit) return null;
    const lead = col > descStart && !/\s/.test(textBefore[col - 1]) ? " " : "";
    const options: Completion[] = TASK_FIELDS.map((f) => ({
      label: f.label, type: "enum",
      apply: makeApply(lead + f.insert, (lead + f.insert).length, f.follow != null),
    }));
    return { from: context.pos, options, filter: false, validFor: /^[\p{L}]*$/u };
  };
}
