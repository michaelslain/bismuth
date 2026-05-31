import type { Row, FileMeta } from "./types";

const EMPTY_FILE: Omit<FileMeta, "name" | "path" | "basename"> = {
  folder: "",
  ext: "md",
  size: 0,
  ctime: 0,
  mtime: 0,
  tags: [],
  links: [],
};

/** Coerce a raw table cell string to a value. Empty → undefined (column absent for that row). */
function coerce(raw: string): unknown {
  const s = raw.trim();
  if (s === "") return undefined;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** Split a table row on its (unescaped) pipes, trimming the optional leading/trailing pipe. */
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

// A GFM table separator row: | --- | :--: | etc.
const SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Parse the first GFM table found in `body` into rows. file.name/path come from `meta`. */
export function parseMarkdownTable(body: string, meta: { name: string; path: string }): Row[] {
  const lines = body.split("\n");
  let i = 0;
  // find the header line: first line containing a pipe whose next line is a separator
  while (i < lines.length) {
    if (lines[i].includes("|") && i + 1 < lines.length && SEP_RE.test(lines[i + 1])) break;
    i++;
  }
  if (i + 1 >= lines.length || !SEP_RE.test(lines[i + 1] ?? "")) return [];
  const headers = splitRow(lines[i]);
  const rows: Row[] = [];
  for (let j = i + 2; j < lines.length; j++) {
    const line = lines[j];
    if (!line.includes("|")) break; // table ends at the first non-table line
    const cells = splitRow(line);
    const note: Record<string, unknown> = {};
    headers.forEach((h, k) => {
      const v = coerce(cells[k] ?? "");
      if (v !== undefined) note[h] = v;
    });
    rows.push({
      file: { ...EMPTY_FILE, name: meta.name, basename: meta.name, path: meta.path },
      note,
      formula: {},
    });
  }
  return rows;
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/** Serialize rows back to a GFM table given an explicit column order. */
export function rowsToMarkdownTable(columns: string[], rows: Row[]): string {
  const header = `| ${columns.join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${columns.map((c) => fmt(r.note[c])).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}
