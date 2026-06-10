// app/src/editor/yamlSchema.ts
// CM6 glue for schema-driven YAML validation + autocomplete of note frontmatter
// (and settings.yaml, via mode). The pure mapping logic (diagnosticsForFrontmatter)
// is exported separately so it runs under `bun test` without a browser.
import { linter, type Diagnostic as CmDiagnostic, type Action } from "@codemirror/lint";
import { yamlFixHover, YAML_DIAGNOSTIC_SOURCE } from "./yamlFixHover";
import { relintNeedsRefresh } from "./relint";
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
 * Pure: validate a YAML body, then map each Diagnostic.path (a key path) to the
 * document char range of its line. In `frontmatter` mode the body is the `---`-fenced
 * slice; in `settings` mode the WHOLE document is the body (settings.yaml has no fence),
 * so the entire file is validated against SETTINGS_SCHEMA. Returns [] when there's no
 * body or the YAML is malformed (tolerant, like parseFrontmatter).
 */
export function diagnosticsForFrontmatter(
  doc: string,
  schema: Schema,
  resolveLink: (target: string) => boolean,
  mode: ValidateMode = "frontmatter",
): RangedDiagnostic[] {
  // Settings.yaml is a fenceless document — validate the whole body from offset 0.
  // Notes validate only their frontmatter slice.
  let bodyText: string;
  let bodyFrom: number;
  if (mode === "settings") {
    bodyText = doc;
    bodyFrom = 0;
  } else {
    const fm = extractFrontmatterBoundary(doc);
    if (!fm) return [];
    bodyText = fm.text;
    bodyFrom = fm.from;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(bodyText) ?? {};
  } catch {
    return []; // malformed YAML → no schema diagnostics (yaml lang lint can flag syntax)
  }

  const diags = validateDocument(parsed, schema, { mode, ctx: { resolveLink } });
  // Build a quick lookup from the body's lines to their absolute char offsets so we can
  // map a diagnostic's top-level key to the line where it appears.
  const bodyLines = bodyText.split("\n");
  const lineOffsets: number[] = [];
  let acc = bodyFrom;
  for (const l of bodyLines) {
    lineOffsets.push(acc);
    acc += l.length + 1; // +1 for the newline
  }

  const out: RangedDiagnostic[] = [];
  for (const d of diags) {
    // Walk the FULL key path to the deepest key's line, searching each segment
    // after its parent's line. This lands the mark + fix on the actual offending
    // key (e.g. `theme:`), not its section header (`appearance:`) — and resolves
    // same-named keys in different sections, since the search is parent-scoped.
    let searchFrom = 0;
    let idx = -1;
    for (const seg of d.path) {
      const rel = bodyLines.slice(searchFrom).findIndex((l) => new RegExp(`^\\s*${escapeRe(String(seg))}\\s*:`).test(l));
      if (rel === -1) continue; // e.g. a list index — no own `key:` line; keep the parent line
      idx = searchFrom + rel;
      searchFrom = idx + 1;
    }
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
    return diagnosticsForFrontmatter(doc, opts.getSchema(), opts.resolveLink, opts.mode).map((d) => {
      const diag: CmDiagnostic = {
        from: d.from,
        to: d.to,
        severity: d.severity,
        message: d.message,
        // Tag so the hover quick-fix (yamlFixHover) recognises these and ONLY these.
        source: YAML_DIAGNOSTIC_SOURCE,
        // Category color: property/settings validation marks are purple (3rd-brain),
        // distinct from red spelling / blue grammar. Styled in livePreview's theme.
        markClass: "property-mark",
      };
      // Enum nearest-match suggestions → "replace the value" quick-fixes, so the
      // shared right-click menu offers the same kind of fix as spelling/grammar.
      if (d.suggestions?.length) {
        const lineText = view.state.doc.sliceString(d.from, d.to);
        const colon = lineText.indexOf(":");
        if (colon >= 0) {
          const valFrom = d.from + colon + 1 + (lineText.slice(colon + 1).match(/^\s*/)?.[0].length ?? 0);
          diag.actions = d.suggestions.map((s): Action => ({
            name: `→ ${s}`,
            apply: (v: EditorView) => v.dispatch({ changes: { from: valFrom, to: d.to, insert: s } }),
          }));
        }
      }
      return diag;
    });
    // No hover boxes — fixes live in the shared right-click menu (editorContextMenu).
    // needsRefresh: lets requestRelint() re-run validation when the property registry
    // changes (Editor.tsx) even though the document itself hasn't been edited.
  }, { delay: 350, needsRefresh: relintNeedsRefresh, tooltipFilter: () => [] });
}

/** The CM6 extension: just the linter. Autocomplete sources are merged into the single
 *  vaultCompletion override in autocomplete.ts (Editor.tsx wires them together). */
export function yamlSchema(opts: YamlSchemaOpts): Extension {
  // Hover a schema error → auto-open the quick-fix menu (scoped to these diagnostics).
  return [schemaLinter(opts), yamlFixHover()];
}
