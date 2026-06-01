/**
 * Template expansion for {{...}} tokens used in note templates.
 *
 * Supports {{date}}, {{time}}, {{title}}, {{cursor}} and optional
 * date/time offsets and moment-style format strings.
 */

/** Context provided when expanding a template. */
export type TemplateContext = { now: Date; title: string };

/** Result of expanding a template. */
export type ExpandResult = {
  /** The expanded text with all recognised tokens replaced. */
  text: string;
  /**
   * Zero-based character index of the first {{cursor}} token in the output,
   * or `text.length` if no {{cursor}} was present.
   */
  cursorOffset: number;
};

// ---------------------------------------------------------------------------
// formatDate — moment-style subset, left-to-right longest-match scan
// ---------------------------------------------------------------------------

const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAY_NAMES_FULL = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const WEEKDAY_NAMES_SHORT = [
  "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
];

/**
 * Format a Date using a moment-style pattern string.
 *
 * Supported tokens (longest match wins):
 *   YYYY  YY  MMMM  MMM  MM  M  DD  D
 *   dddd  ddd  HH  H  hh  h  mm  m  ss  s  A  a
 *
 * Uses a fixed en-US locale for month/weekday names.
 * Scans LEFT-TO-RIGHT matching the longest known token at each position.
 */
function formatDate(d: Date, pattern: string): string {
  // Ordered by descending length so longest-match is found first.
  const tokens: [string, () => string][] = [
    ["YYYY", () => String(d.getFullYear()).padStart(4, "0")],
    ["YY",   () => String(d.getFullYear()).slice(-2)],
    ["MMMM", () => MONTH_NAMES_FULL[d.getMonth()]],
    ["MMM",  () => MONTH_NAMES_SHORT[d.getMonth()]],
    ["MM",   () => String(d.getMonth() + 1).padStart(2, "0")],
    ["M",    () => String(d.getMonth() + 1)],
    ["DD",   () => String(d.getDate()).padStart(2, "0")],
    ["D",    () => String(d.getDate())],
    ["dddd", () => WEEKDAY_NAMES_FULL[d.getDay()]],
    ["ddd",  () => WEEKDAY_NAMES_SHORT[d.getDay()]],
    ["HH",   () => String(d.getHours()).padStart(2, "0")],
    ["H",    () => String(d.getHours())],
    ["hh",   () => {
      const h = d.getHours() % 12 || 12;
      return String(h).padStart(2, "0");
    }],
    ["h",    () => {
      const h = d.getHours() % 12 || 12;
      return String(h);
    }],
    ["mm",   () => String(d.getMinutes()).padStart(2, "0")],
    ["m",    () => String(d.getMinutes())],
    ["ss",   () => String(d.getSeconds()).padStart(2, "0")],
    ["s",    () => String(d.getSeconds())],
    ["A",    () => d.getHours() < 12 ? "AM" : "PM"],
    ["a",    () => d.getHours() < 12 ? "am" : "pm"],
  ];

  let result = "";
  let i = 0;
  while (i < pattern.length) {
    let matched = false;
    for (const [tok, fn] of tokens) {
      if (pattern.startsWith(tok, i)) {
        result += fn();
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += pattern[i];
      i += 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Token grammar helpers
// ---------------------------------------------------------------------------

// Regex for a single {{...}} token.
// Captures the inner content (everything between {{ and }}).
const TOKEN_RE = /\{\{([^}]*(?:\}(?!\})[^}]*)*)\}\}/g;

/**
 * Parse the inner content of a {{...}} token.
 * Returns null if the token is not a recognised name or has a bad structure.
 *
 * Grammar: <name>[<+|-><N><unit>][:<format>]
 * where <name> is one of: date, time, title, cursor
 * date units: d w m y    time units: h m
 */
function parseToken(inner: string): {
  name: string;
  sign: 1 | -1;
  amount: number;
  unit: string;
  format: string | null;
} | null {
  // Must start with a known name
  const nameMatch = /^(date|time|title|cursor)/.exec(inner);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  let rest = inner.slice(name.length);

  // Optional offset: [+|-][N][unit]
  let sign: 1 | -1 = 1;
  let amount = 0;
  let unit = "";

  const offsetMatch = /^([+-])(\d+)([a-z])/.exec(rest);
  if (offsetMatch) {
    sign = offsetMatch[1] === "+" ? 1 : -1;
    amount = parseInt(offsetMatch[2], 10);
    unit = offsetMatch[3];
    rest = rest.slice(offsetMatch[0].length);
  }

  // Optional format: :<FORMAT> — format string must be non-empty
  let format: string | null = null;
  if (rest.startsWith(":")) {
    const fmt = rest.slice(1);
    if (fmt.length === 0) {
      // Malformed: colon present but no format → leave verbatim
      return null;
    }
    format = fmt;
    rest = "";
  }

  // Must have consumed the entire inner string
  if (rest.length !== 0) return null;

  return { name, sign, amount, unit, format };
}

/**
 * Apply a date/time offset to a clone of the given Date.
 * Returns the mutated clone. Returns null if the unit is invalid for the name.
 */
function applyOffset(
  d: Date,
  name: "date" | "time",
  sign: 1 | -1,
  amount: number,
  unit: string,
): Date | null {
  const clone = new Date(d.getTime());
  const n = sign * amount;

  if (name === "date") {
    switch (unit) {
      case "d": clone.setDate(clone.getDate() + n); break;
      case "w": clone.setDate(clone.getDate() + 7 * n); break;
      case "m": clone.setMonth(clone.getMonth() + n); break;
      case "y": clone.setFullYear(clone.getFullYear() + n); break;
      default: return null; // unknown unit → invalid
    }
  } else {
    // name === "time"
    switch (unit) {
      case "h": clone.setHours(clone.getHours() + n); break;
      case "m": clone.setMinutes(clone.getMinutes() + n); break;
      default: return null;
    }
  }
  return clone;
}

// ---------------------------------------------------------------------------
// expandTemplate
// ---------------------------------------------------------------------------

/**
 * Expand `{{...}}` tokens in `raw` using `ctx`.
 *
 * Recognised tokens:
 *   {{date}}             → current date (YYYY-MM-DD)
 *   {{time}}             → current time (HH:mm)
 *   {{title}}            → ctx.title verbatim
 *   {{cursor}}           → empty string; records cursor position
 *   {{date[±N<unit>][:<format>]}} and {{time[±N<unit>][:<format>]}}
 *
 * Unknown or malformed tokens are left verbatim.
 * The first {{cursor}} sets cursorOffset; subsequent ones are silently removed.
 */
export function expandTemplate(raw: string, ctx: TemplateContext): ExpandResult {
  if (raw.length === 0) return { text: "", cursorOffset: 0 };

  let cursorOffset: number | null = null;
  let result = "";
  let lastIndex = 0;

  TOKEN_RE.lastIndex = 0; // reset stateful regex

  for (const match of raw.matchAll(TOKEN_RE)) {
    const matchStart = match.index!;
    const matchEnd = matchStart + match[0].length;
    const inner = match[1];

    // Append literal text before this token
    result += raw.slice(lastIndex, matchStart);

    const parsed = parseToken(inner);

    if (parsed === null) {
      // Unknown or malformed: emit verbatim
      result += match[0];
    } else {
      const { name, sign, amount, unit, format } = parsed;

      if (name === "cursor") {
        if (cursorOffset === null) {
          cursorOffset = result.length;
        }
        // Additional cursors: emit nothing (strip)
      } else if (name === "title") {
        result += ctx.title;
      } else if (name === "date" || name === "time") {
        // Apply offset if present
        let d = new Date(ctx.now.getTime());
        if (amount !== 0) {
          const offsetted = applyOffset(d, name, sign, amount, unit);
          if (offsetted === null) {
            // Invalid unit → leave verbatim
            result += match[0];
            lastIndex = matchEnd;
            continue;
          }
          d = offsetted;
        }

        // Determine format
        const defaultFormat = name === "date" ? "YYYY-MM-DD" : "HH:mm";
        const fmt = format ?? defaultFormat;
        result += formatDate(d, fmt);
      }
    }

    lastIndex = matchEnd;
  }

  // Append any remaining literal text
  result += raw.slice(lastIndex);

  return {
    text: result,
    cursorOffset: cursorOffset ?? result.length,
  };
}
