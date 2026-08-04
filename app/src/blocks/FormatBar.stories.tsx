// Visual spec for <FormatBar> — the selection-anchored formatting strip a Milkdown block
// shows over a non-empty text selection: Bold/Italic/Code/Link (routed through the bridge's
// exec()) then H1/H2/H3/Bullet (routed to the block-type callback). It's pure presentation —
// the host (BlockEditor) owns selection tracking/positioning and hands it a FormatBarState —
// so these stories supply a stub BlockEditorHandle (the bridge's exec/getMarkdown/etc.) and
// record what was invoked instead of driving a real Milkdown surface.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { FormatBar, type FormatBlockKind } from "./FormatBar";
import type { BlockEditorHandle } from "./milkdownEditor";
import { Label } from "../ui/_storyKit";
import "../BlockEditor.css";

const meta = {
  title: "Editor/FormatBar",
  component: FormatBar,
  parameters: { layout: "padded" },
} satisfies Meta<typeof FormatBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A stub bridge handle — only `exec` is wired to the story's log; the rest are no-ops
 *  FormatBar itself never calls. */
function stubHandle(onExec: (cmd: string) => void): BlockEditorHandle {
  return {
    setMarkdown: () => {},
    getMarkdown: () => "",
    focus: () => {},
    exec: onExec,
    applyAutocomplete: () => {},
    destroy: () => {},
  };
}

/** Floats near the selection's top-center — `state.x`/`y` are fixed-position screen coords,
 *  so the story pins them a short distance into the preview frame rather than at (0,0). */
export const Default: Story = {
  render: () => (
    <div style={{ position: "relative", height: "80px" }}>
      <FormatBar
        state={{
          x: 24, y: 24,
          handle: stubHandle(() => {}),
          onBlockKind: () => {},
        }}
      />
    </div>
  ),
};

/** Interactive: click a mark or block-type button and see which command it dispatched —
 *  distinguishing the two routing paths (inline marks -> handle.exec, block type ->
 *  onBlockKind) the bar's own docstring calls out. */
export const Interactive: Story = {
  render: () => {
    const [last, setLast] = createSignal("(none yet)");
    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
          <Label>Last action</Label>
          <span style={{ "font-family": "var(--ui-font-stack)", "font-size": "13px", color: "var(--fg)" }}>
            {last()}
          </span>
        </div>
        <div style={{ position: "relative", height: "60px" }}>
          <FormatBar
            state={{
              x: 24, y: 12,
              handle: stubHandle((cmd) => setLast(`mark: ${cmd}`)),
              onBlockKind: (kind: FormatBlockKind) => setLast(`block: ${kind}`),
            }}
          />
        </div>
      </div>
    );
  },
};
