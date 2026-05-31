// CodeMirror extension that renders ```view blocks via the unified BaseView host.
// A StateField scans for ```view fences and block-replaces each (when the cursor is
// outside it) with a widget that resolves the block's source (base/notes/tasks) and
// renders the chosen view type. Block-replacing decorations must come from a StateField,
// not a ViewPlugin. Mirrors the tasksQuery extension's replace+reveal pattern.
import { type Extension } from "@codemirror/state";
import { mountSolid, SolidWidget } from "./solidWidget";
import { fenceBlockField } from "./fenceBlock";
import { BaseView } from "../bases/BaseView";
import { parseViewBlock } from "../../../core/src/bases/viewBlock";

class ViewBlockWidget extends SolidWidget {
  constructor(private readonly source: string, private readonly hostPath: string) {
    super("oa-view-block");
  }

  eq(other: ViewBlockWidget): boolean {
    return other.source === this.source && other.hostPath === this.hostPath;
  }

  protected renderSolid(container: HTMLElement): void {
    const spec = parseViewBlock(this.source);
    mountSolid(container, () => BaseView({ view: spec, hostPath: this.hostPath }));
  }
}

/** Renders ```view blocks inline (block-replace; revealed for editing when the cursor enters). */
export function viewBlock(getHostPath: () => string | null): Extension {
  return fenceBlockField(
    "view",
    (body, hostPath) => new ViewBlockWidget(body, hostPath),
    () => [getHostPath() ?? ""] as [string],
  );
}
