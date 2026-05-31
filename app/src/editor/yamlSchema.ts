// app/src/editor/yamlSchema.ts
// CM6 glue for schema-driven YAML validation + autocomplete of note frontmatter
// (and settings.yaml, via mode). The pure mapping logic (diagnosticsForFrontmatter)
// is exported separately so it runs under `bun test` without a browser.
import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { CompletionContext } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parse as parseYaml } from "yaml";
import { validateDocument } from "../../../core/src/schema/validate";
import type { Schema, ValidateMode } from "../../../core/src/schema/types";
import { extractFrontmatterBoundary } from "./frontmatterUtils";

export interface YamlSchemaOpts {
  getSchema: () => Schema;
  mode: ValidateMode;
  resolveLink: (target: string) => boolean;
}

// A flat diagnostic carrying document char offsets — produced purely, then handed to CM6.
interface RangedDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
  suggestions?: string[];
}

/**
 * Pure: slice the frontmatter body, parse it, validate against the schema, and map each
 * Diagnostic.path (a key path) to the document char range of its line. Returns [] when
 * there's no frontmatter or the YAML is malformed (tolerant, like parseFrontmatter).
 */
export function diagnosticsForFrontmatter(
  doc: string,
  schema: Schema,
  resolveLink: (target: string) => boolean,
  mode: ValidateMode = "frontmatter",
): RangedDiagnostic[] {
  const fm = extractFrontmatterBoundary(doc);
  if (!fm) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(fm.text) ?? {};
  } catch {
    return []; // malformed YAML → no schema diagnostics (yaml lang lint can flag syntax)
  }

  const diags = validateDocument(parsed, schema, { mode, ctx: { resolveLink } });
  // Build a quick lookup from the body's lines to their absolute char offsets so we can
  // map a diagnostic's top-level key to the line where it appears.
  const bodyLines = fm.text.split("\n");
  const lineOffsets: number[] = [];
  let acc = fm.from;
  for (const l of bodyLines) {
    lineOffsets.push(acc);
    acc += l.length + 1; // +1 for the newline
  }

  const out: RangedDiagnostic[] = [];
  for (const d of diags) {
    const key = d.path[0];
    // Find the body line whose key matches the diagnostic's top-level path segment.
    let idx = key
      ? bodyLines.findIndex((l) => new RegExp(`^${escapeRe(key)}\\s*:`).test(l))
      : -1;
    if (idx === -1) idx = 0; // fall back to the first body line
    const from = lineOffsets[idx];
    const to = from + bodyLines[idx].length;
    out.push({ from, to, severity: d.severity, message: d.message, suggestions: d.suggestions });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the cursor sits inside the frontmatter body — gates the completion sources. */
export function isInFrontmatter(ctx: CompletionContext): boolean {
  const fm = extractFrontmatterBoundary(ctx.state.doc.toString());
  return fm !== null && ctx.pos >= fm.from && ctx.pos <= fm.to;
}

/** CM6 linter source: re-derives diagnostics for the current document on each run. */
function schemaLinter(opts: YamlSchemaOpts) {
  return linter((view: EditorView): CmDiagnostic[] => {
    const doc = view.state.doc.toString();
    return diagnosticsForFrontmatter(doc, opts.getSchema(), opts.resolveLink, opts.mode).map((d) => ({
      from: d.from,
      to: d.to,
      severity: d.severity,
      message: d.message,
    }));
  }, { delay: 350 });
}

/** The CM6 extension: just the linter. Autocomplete sources are merged into the single
 *  vaultCompletion override in autocomplete.ts (Editor.tsx wires them together). */
export function yamlSchema(opts: YamlSchemaOpts): Extension {
  return [schemaLinter(opts)];
}
