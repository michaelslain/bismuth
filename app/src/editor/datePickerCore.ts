// app/src/editor/datePickerCore.ts
// Pure, DOM-free + CodeMirror-free helpers for the date/datetime frontmatter picker
// (datePicker.ts). Kept separate so they're unit-testable under `bun test` without
// importing the editor's CSS or @codemirror/view. See datePicker.ts for the UI.
import type { Schema } from "../../../core/src/schema/types";
import { extractFrontmatterBoundary } from "./frontmatterUtils";

export type DateKind = "date" | "datetime";

export interface DateTarget {
  /** Property key (the text before the colon). */
  key: string;
  kind: DateKind;
  /** Doc offset where the value text begins (just past `key:` and any spaces). */
  valueFrom: number;
  /** Doc offset where the value text ends (trailing whitespace trimmed). */
  valueTo: number;
  /** The current trimmed value text, if any. */
  current: string;
  /** Stable identity for the target (line-start offset + key) — preserves tooltip
   *  identity while only the value text changes, so the native inputs don't remount. */
  sig: string;
}

// A frontmatter key line: `key:` optionally followed by spaces and a value. Keys are the
// usual YAML scalar key (letters/digits/_/-/.), anchored at column 0 (no indent — indented
// lines are list items / nested maps, never a top-level date property).
const KEY_VALUE_RE = /^([A-Za-z0-9_][\w.-]*):(\s*)(.*)$/;

/** The `date`/`datetime` kind registered for `key`, or null if it's neither (or unknown). */
export function dateKindOf(schema: Schema, key: string): DateKind | null {
  const entry = schema[key];
  if (!entry) return null;
  if (entry.type === "date") return "date";
  if (entry.type === "datetime") return "datetime";
  return null;
}

/**
 * If the caret (`head`) sits inside the VALUE region of a frontmatter property whose
 * registered type is `date`/`datetime`, describe that target; otherwise null.
 *
 * Pure over a document string + caret offset (no CodeMirror), so it's unit-testable.
 */
export function findDateTarget(doc: string, head: number, schema: Schema): DateTarget | null {
  const fm = extractFrontmatterBoundary(doc);
  if (!fm || head < fm.from || head > fm.to) return null;

  const lineStart = doc.lastIndexOf("\n", head - 1) + 1; // 0 when on the first line
  let lineEnd = doc.indexOf("\n", head);
  if (lineEnd === -1) lineEnd = doc.length;
  const lineText = doc.slice(lineStart, lineEnd);

  const m = KEY_VALUE_RE.exec(lineText);
  if (!m) return null;
  const key = m[1];
  const kind = dateKindOf(schema, key);
  if (!kind) return null;

  const colonIdx = key.length; // index of ':' within the line
  const caretCol = head - lineStart;
  if (caretCol <= colonIdx) return null; // caret is on/before the colon → editing the key

  const valueStartCol = colonIdx + 1 + m[2].length;
  const rawValue = m[3];
  const trimmedLen = rawValue.replace(/\s+$/, "").length;
  // Caret must sit within the value region — not past the (trimmed) value into trailing space.
  if (caretCol > valueStartCol + trimmedLen) return null;

  const valueFrom = lineStart + valueStartCol;
  return {
    key,
    kind,
    valueFrom,
    valueTo: valueFrom + trimmedLen,
    current: rawValue.trim(),
    sig: `${lineStart}:${key}`,
  };
}

/** Split a stored value into date (YYYY-MM-DD) + time (HH:mm) parts for prefilling the
 *  native inputs. Tolerates surrounding quotes and a `T` or space separator; returns
 *  empty strings for parts that aren't present. */
export function parseDateValue(value: string): { date: string; time: string } {
  const v = value.trim().replace(/^['"]|['"]$/g, "");
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v);
  return { date: m?.[1] ?? "", time: m?.[2] ?? "" };
}

/** Compose the text to insert: a bare date, or `YYYY-MM-DDTHH:mm` when a datetime has a
 *  time component. An empty date yields "" (nothing to insert). */
export function composeDateValue(kind: DateKind, date: string, time: string): string {
  if (!date) return "";
  return kind === "datetime" && time ? `${date}T${time}` : date;
}

/** Current local wall-clock as HH:mm (zero-padded). Uses the editor host's local timezone
 *  (matching the native `<input type="time">` and the rest of the LOCAL date math here), so
 *  two users on a shared vault each see their own local time. Date injectable for tests. */
export function nowHHMM(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
