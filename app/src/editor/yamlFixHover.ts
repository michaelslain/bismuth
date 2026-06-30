// app/src/editor/yamlFixHover.ts
// Hovering a YAML-schema error (the purple "property-mark" squiggle) pops the
// quick-fix menu automatically — same actions as the right-click menu, styled
// with the shared popover base, but triggered on hover. Scoped to YAML-schema
// diagnostics ONLY (matched by `source`), so spelling/grammar marks never fire it.
import { hoverTooltip, type Tooltip, type EditorView } from "@codemirror/view";
import { forEachDiagnostic, type Action } from "@codemirror/lint";
import { createPopoverRow } from "../ui/popover/rowDom";

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
        // Same `.bismuth-popover` DOM the right-click menu renders (built via the shared
        // rowDom helper), so the hover quick-fix is pixel-identical to the menu.
        const dom = document.createElement("div");
        dom.className = "bismuth-popover";

        if (hit.actions.length) {
          for (const a of hit.actions) {
            dom.appendChild(createPopoverRow({
              label: a.name,
              icon: "Wrench",
              onSelect: () => { a.apply(view, hit.from, hit.to); view.focus(); },
            }));
          }
        } else {
          // No actionable fix (e.g. "expected a number") → show the message itself (disabled).
          dom.appendChild(createPopoverRow({ label: hit.message }));
        }

        return { dom };
      },
    };
  });
}
