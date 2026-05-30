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
  onMovePane: (targetId: string, draggedId: string, dir: Dir) => void;
  onSaved: () => void;
  onOpen: (path: string) => void;
  onOpenQuickSwitcher: () => void;
  onNewTerminal: () => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
};

const DRAG_MIME = "application/x-oa-path"; // a file dragged from the tree
const PANE_MIME = "application/x-oa-pane"; // a pane dragged by its header (carries leaf id)

// A single pane: renders its content, reports focus/right-click, and accepts a file
// dragged from the tree as a drop-to-split (the highlighted half shows where it lands).
function PaneLeaf(props: PaneTreeProps & { node: Leaf }) {
  const [dropDir, setDropDir] = createSignal<Dir | null>(null);
  let el!: HTMLDivElement;

  // Which half of the pane the cursor is over → which direction the split will go.
  const getDropDir = (e: DragEvent): Dir => {
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width - 0.5;
    const fy = (e.clientY - r.top) / r.height - 0.5;
    if (Math.abs(fx) >= Math.abs(fy)) {
      return fx < 0 ? "left" : "right";
    }
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
        const types = e.dataTransfer?.types;
        if (!types || (!types.includes(DRAG_MIME) && !types.includes(PANE_MIME))) return;
        e.preventDefault(); // allow drop
        setDropDir(getDropDir(e));
      }}
      onDragLeave={() => setDropDir(null)}
      onDrop={(e) => {
        const dir = dropDir();
        setDropDir(null);
        if (!dir) return;
        const paneId = e.dataTransfer?.getData(PANE_MIME);
        if (paneId) {
          e.preventDefault();
          props.onMovePane(props.node.id, paneId, dir);
          return;
        }
        const path = e.dataTransfer?.getData(DRAG_MIME);
        if (path) {
          e.preventDefault();
          props.onDropFile(props.node.id, path, dir);
        }
      }}
    >
      <Show when={props.showHeader}>
        <div
          class="pane-header"
          draggable={true}
          onDragStart={(e) => {
            e.dataTransfer?.setData(PANE_MIME, props.node.id);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          }}
        >
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
          onOpenQuickSwitcher={props.onOpenQuickSwitcher}
          onNewTerminal={props.onNewTerminal}
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
        // While dragging the divider, sizes must track the cursor exactly — suppress the
        // flex-basis transition (see .pane-split.resizing in App.css) for the duration.
        const [resizing, setResizing] = createSignal(false);
        const startDrag = (e: PointerEvent) => {
          e.preventDefault();
          setResizing(true);
          const rect = container.getBoundingClientRect();
          const move = (ev: PointerEvent) => {
            const ratio =
              split().dir === "row"
                ? (ev.clientX - rect.left) / rect.width
                : (ev.clientY - rect.top) / rect.height;
            props.onResize(split().id, Math.min(0.92, Math.max(0.08, ratio)));
          };
          const up = () => {
            setResizing(false);
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
            classList={{ row: split().dir === "row", col: split().dir === "col", resizing: resizing() }}
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
