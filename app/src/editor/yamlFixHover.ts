// app/src/editor/yamlFixHover.ts
// Hovering a YAML-schema error (the purple "property-mark" squiggle) pops the
// quick-fix menu automatically — same actions as the right-click menu, styled
// with the shared popover base, but triggered on hover. Scoped to YAML-schema
// diagnostics ONLY (matched by `source`), so spelling/grammar marks never fire it.
import { hoverTooltip, type Tooltip, type EditorView } from "@codemirror/view";
import { forEachDiagnostic, type Action } from "@codemirror/lint";

/** Tag put on yaml-schema diagnostics so this hover (and nothing else) recognises them. */
export const YAML_DIAGNOSTIC_SOURCE = "yaml-schema";

export function yamlFixHover() {
  return hoverTooltip((view: EditorView, pos: number): Tooltip | null => {
    // Collect yaml-schema diagnostics under the cursor (ignore spelling/grammar).
    const hits: { from: number; to: number; message: string; actions: readonly Action[] }[] = [];
    forEachDiagnostic(view.state, (d, from, to) => {
      if (d.source === YAML_DIAGNOSTIC_SOURCE && pos >= from && pos <= to) {
        hits.push({ from, to, message: d.message, actions: d.actions ?? [] });
      }
    });
    if (!hits.length) return null;
    const hit = hits[hits.length - 1];

    return {
      pos: hit.from,
      end: hit.to,
      above: false,
      create() {
        const dom = document.createElement("div");
        dom.className = "oa-popover";

        const addRow = (label: string, withIcon: boolean, onClick?: () => void) => {
          const row = document.createElement("div");
          row.className = "oa-popover-row" + (onClick ? "" : " oa-popover-row--disabled");
          if (withIcon) {
            const span = document.createElement("span");
            span.className = "oa-popover-icon";
            row.appendChild(span);
            // Lazy import keeps lucide-solid (a client-only dependency) out of this
            // module's static eval path, so test environments importing the editor
            // extensions stay clean. Icon fills in once the chunk resolves.
            import("../icons/iconMarkup")
              .then(({ lucideIconMarkup }) => {
                const markup = lucideIconMarkup("Wrench", 14);
                if (markup) span.innerHTML = markup;
              })
              .catch(() => {});
          }
          const lbl = document.createElement("span");
          lbl.className = "oa-popover-label";
          lbl.textContent = label;
          row.appendChild(lbl);
          if (onClick) {
            // mousedown + preventDefault so applying the fix doesn't lose editor focus.
            row.addEventListener("mousedown", (e) => { e.preventDefault(); onClick(); });
            row.addEventListener("mouseenter", () => row.classList.add("oa-popover-row--selected"));
            row.addEventListener("mouseleave", () => row.classList.remove("oa-popover-row--selected"));
          }
          dom.appendChild(row);
        };

        if (hit.actions.length) {
          for (const a of hit.actions) {
            addRow(a.name, true, () => { a.apply(view, hit.from, hit.to); view.focus(); });
          }
        } else {
          // No actionable fix (e.g. "expected a number") → show the message itself.
          addRow(hit.message, false);
        }

        return { dom };
      },
    };
  });
}
