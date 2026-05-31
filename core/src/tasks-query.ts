// A small evaluator for the Obsidian Tasks plugin query language (a bounded subset).
// Pure + synchronous: given all tasks, a query string, and today's date, return the
// filtered/sorted tasks plus any human-readable errors for unrecognized filter lines.
import type { Task, Priority } from "./tasks";
import { addDaysISO } from "./dates";

export interface QueryOutcome {
  tasks: Task[];
  errors: string[];
}

type Predicate = (t: Task) => boolean;

const PRIORITY_RANK: Record<Priority, number> = {
  highest: 1, high: 2, medium: 3, none: 4, low: 5, lowest: 6,
};

const DATE_FIELDS = ["due", "scheduled", "start", "done", "created", "cancelled"] as const;
type DateField = (typeof DATE_FIELDS)[number];
const DATE_ALT = DATE_FIELDS.join("|");

function resolveDateExpr(expr: string, today: string): string | null {
  const e = expr.trim().toLowerCase();
  if (e === "today") return today;
  if (e === "tomorrow") return addDaysISO(today, 1);
  if (e === "yesterday") return addDaysISO(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return e;
  const inM = e.match(/^in (\d+) days?$/);
  if (inM) return addDaysISO(today, Number(inM[1]));
  const agoM = e.match(/^(\d+) days? ago$/);
  if (agoM) return addDaysISO(today, -Number(agoM[1]));
  return null;
}

function parseLeaf(raw: string, today: string): Predicate | null {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;

  if (s === "done") return (t) => t.status === "done" || t.status === "cancelled";
  if (s === "not done") return (t) => t.status !== "done" && t.status !== "cancelled";
  if (s === "is cancelled") return (t) => t.status === "cancelled";
  if (s === "is not cancelled") return (t) => t.status !== "cancelled";

  let m = s.match(/^is( not)? recurring$/);
  if (m) return (t) => !!t.recurrence === !m[1];

  m = s.match(/^priority is( not)? (highest|high|medium|low|lowest|none)$/);
  if (m) {
    const target = m[2] as Priority;
    return m[1]
      ? (t) => t.priority !== target
      : (t) => t.priority === target;
  }

  m = s.match(new RegExp(`^(${DATE_ALT})(?: (before|after))? (.+)$`));
  if (m) {
    const field = m[1] as DateField;
    const cmp = m[2] as "before" | "after" | undefined;
    const resolved = resolveDateExpr(m[3], today);
    if (!resolved) return null;
    return (t) => {
      const v = t[field];
      if (!v) return false;
      if (cmp === "before") return v < resolved;
      if (cmp === "after") return v > resolved;
      return v === resolved;
    };
  }

  return null;
}

// ── boolean expression: parentheses + AND/OR over leaf filters ──────────────
type Tok = { t: "(" } | { t: ")" } | { t: "and" } | { t: "or" } | { t: "leaf"; v: string };

function tokenize(line: string): Tok[] {
  const toks: Tok[] = [];
  let buf = "";
  const flush = () => {
    const v = buf.trim();
    if (v) toks.push({ t: "leaf", v });
    buf = "";
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "(") {
      flush();
      toks.push({ t: "(" });
    } else if (c === ")") {
      flush();
      toks.push({ t: ")" });
    } else {
      const op = line.slice(i).match(/^(AND|OR)\b/i);
      if (op && (buf === "" || /\s$/.test(buf))) {
        flush();
        toks.push({ t: op[1].toLowerCase() as "and" | "or" });
        i += op[1].length - 1; // -1 because for loop increments
      } else {
        buf += c;
      }
    }
  }
  flush();
  return toks;
}

function parseBool(toks: Tok[], today: string, errors: string[]): Predicate {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExpr(): Predicate {
    let left = parseTerm();
    while (peek() && peek().t === "or") {
      next();
      const right = parseTerm();
      const l = left, r = right;
      left = (t) => l(t) || r(t);
    }
    return left;
  }
  function parseTerm(): Predicate {
    let left = parseFactor();
    while (peek() && peek().t === "and") {
      next();
      const right = parseFactor();
      const l = left, r = right;
      left = (t) => l(t) && r(t);
    }
    return left;
  }
  function parseFactor(): Predicate {
    const tk = peek();
    if (!tk) { errors.push("unexpected end of filter"); return () => true; }
    if (tk.t === "(") {
      next();
      const e = parseExpr();
      if (peek() && peek().t === ")") next();
      else errors.push("missing closing parenthesis");
      return e;
    }
    if (tk.t === "leaf") {
      next();
      const p = parseLeaf(tk.v, today);
      if (!p) { errors.push(`unrecognized filter: ${tk.v}`); return () => true; }
      return p;
    }
    next();
    errors.push("unexpected token in filter");
    return () => true;
  }

  const result = parseExpr();
  if (pos < toks.length) errors.push("trailing tokens in filter");
  return result;
}

function makeSorter(key: string, reverse: boolean): (a: Task, b: Task) => number {
  const dir = reverse ? -1 : 1;
  if (key === "priority") {
    return (a, b) => dir * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }
  if (key === "description") {
    return (a, b) => dir * a.description.localeCompare(b.description);
  }
  const field = key as DateField;
  return (a, b) => {
    const av = a[field];
    const bv = b[field];
    if (!av && !bv) return 0;
    if (!av) return 1; // undated sorts last
    if (!bv) return -1;
    return dir * (av < bv ? -1 : av > bv ? 1 : 0);
  };
}

const IGNORED_INSTRUCTION = /^(group by|limit|hide|show|short mode|full mode|explain)\b/i;

export function runTaskQuery(allTasks: Task[], query: string, today: string): QueryOutcome {
  const errors: string[] = [];
  const filters: Predicate[] = [];
  const sorters: Array<(a: Task, b: Task) => number> = [];

  for (const line of query.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sortM = trimmed.match(new RegExp(`^sort by (priority|${DATE_ALT}|description)(?: (reverse))?$`, "i"));
    if (sortM) {
      sorters.push(makeSorter(sortM[1].toLowerCase(), !!sortM[2]));
      continue;
    }
    if (IGNORED_INSTRUCTION.test(trimmed)) continue;

    filters.push(parseBool(tokenize(trimmed), today, errors));
  }

  let tasks = allTasks.filter((t) => filters.every((f) => f(t)));
  if (sorters.length) {
    tasks = [...tasks].sort((a, b) => {
      for (const sorter of sorters) {
        const c = sorter(a, b);
        if (c !== 0) return c;
      }
      return 0;
    });
  }
  return { tasks, errors };
}
