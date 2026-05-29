// app/src/PaneTree.tsx
// Recursively renders one tab's pane tree. A leaf renders PaneContent and reports
// focus/clicks; a split renders two children with a draggable divider between them.
import { Show, createSignal } from "solid-js";
import type { PaneNode, Leaf, Dir } from "./panes";
import { PaneContent } from "./PaneContent";
import { contentLabel } from "./tabIds";
import type { NoteCandidate } from "./editor/wikilink";

type PaneTreeProps = {
  node: PaneNode;
  focusId: string;
  showHeader: boolean; // tab is split → show a name header on each pane
  onFocus: (leafId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onMenu: (leafId: string, x: number, y: number) => void;
  onClose: (leafId: string) => void;
  onDropFile: (leafId: string, path: string, dir: Dir) => void;
  onSaved: () => void;
  onOpen: (path: string) => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
};

const DRAG_MIME = "application/x-oa-path";

// A single pane: renders its content, reports focus/right-click, and accepts a file
// dragged from the tree as a drop-to-split (the highlighted half shows where it lands).
function PaneLeaf(props: PaneTreeProps & { node: Leaf }) {
  const [dropDir, setDropDir] = createSignal<Dir | null>(null);
  let el!: HTMLDivElement;

  // Which half of the pane the cursor is over → which direction the split will go.
  const dirAt = (e: DragEvent): Dir => {
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width - 0.5;
    const fy = (e.clientY - r.top) / r.height - 0.5;
    if (Math.abs(fx) >= Math.abs(fy)) return fx < 0 ? "left" : "right";
    return fy < 0 ? "up" : "down";
  };

  return (
    <div
      ref={el}
      class="pane-leaf"
      classList={{ focused: props.node.id === props.focusId }}
      onMouseDown={() => props.onFocus(props.node.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(props.node.id, e.clientX, e.clientY);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes(DRAG_MIME)) return;
        e.preventDefault(); // allow drop
        setDropDir(dirAt(e));
      }}
      onDragLeave={() => setDropDir(null)}
      onDrop={(e) => {
        const path = e.dataTransfer?.getData(DRAG_MIME);
        const dir = dropDir();
        setDropDir(null);
        if (!path || !dir) return;
        e.preventDefault();
        props.onDropFile(props.node.id, path, dir);
      }}
    >
      <Show when={props.showHeader}>
        <div class="pane-header">
          <span class="pane-header-label">{contentLabel(props.node.content)}</span>
          <span
            class="pane-header-x"
            title="Close pane"
            onMouseDown={(e) => {
              e.stopPropagation(); // don't also trigger focus
              e.preventDefault();
              props.onClose(props.node.id);
            }}
          >
            ×
          </span>
        </div>
      </Show>
      <div class="pane-body">
        <PaneContent
          path={props.node.content}
          onSaved={props.onSaved}
          onOpen={props.onOpen}
          noteNames={props.noteNames}
          tagNames={props.tagNames}
        />
      </div>
      <Show when={dropDir()}>
        {(d) => <div class={`pane-dropzone ${d()}`} />}
      </Show>
    </div>
  );
}

export function PaneTree(props: PaneTreeProps) {
  return (
    <Show
      when={props.node.kind === "split" ? (props.node as Extract<PaneNode, { kind: "split" }>) : null}
      fallback={<PaneLeaf {...props} node={props.node as Leaf} />}
    >
      {(split) => {
        let container!: HTMLDivElement;
        const startDrag = (e: PointerEvent) => {
          e.preventDefault();
          const rect = container.getBoundingClientRect();
          const move = (ev: PointerEvent) => {
            const ratio =
              split().dir === "row"
                ? (ev.clientX - rect.left) / rect.width
                : (ev.clientY - rect.top) / rect.height;
            props.onResize(split().id, Math.min(0.92, Math.max(0.08, ratio)));
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        };
        return (
          <div
            ref={container}
            class="pane-split"
            classList={{ row: split().dir === "row", col: split().dir === "col" }}
          >
            <div class="pane-child" style={{ "flex-basis": `${split().ratio * 100}%` }}>
              <PaneTree {...props} node={split().a} />
            </div>
            <div
              class="pane-divider"
              classList={{ row: split().dir === "row", col: split().dir === "col" }}
              onPointerDown={startDrag}
            />
            <div class="pane-child" style={{ "flex-basis": `${(1 - split().ratio) * 100}%` }}>
              <PaneTree {...props} node={split().b} />
            </div>
          </div>
        );
      }}
    </Show>
  );
}
