// app/src/PaneTree.tsx
// Recursively renders one tab's pane tree. A leaf renders PaneContent and reports
// focus/clicks; a split renders two children with a draggable divider between them.
import { Show, createSignal, onCleanup, type Accessor } from "solid-js";
import type { PaneNode, Leaf, Dir } from "./panes";
import { PaneContent } from "./PaneContent";
import { Icon } from "./icons/Icon";
import { IconButton } from "./ui/IconButton";
import { contentLabel, contentIcon } from "./tabIds";
import type { DragState } from "./dnd/viewDrag";
import { nearestEdge, type Zone } from "./dnd/geometry";
import type { NoteCandidate } from "./editor/wikilink";
import "./PaneTree.css";

type PaneTreeProps = {
  node: PaneNode;
  focusId: string;
  showHeader: boolean; // tab is split → show a name header on each pane
  onFocus: (leafId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onMenu: (leafId: string, x: number, y: number) => void;
  onClose: (leafId: string) => void;
  onDropFile: (leafId: string, path: string, dir: Dir) => void;
  dragState: Accessor<DragState>;
  onStartPaneDrag: (e: PointerEvent, leafId: string, label: string) => void;
  onSaved: () => void;
  onOpen: (path: string) => void;
  onOpenQuickSwitcher: () => void;
  onNewTerminal: () => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
};

const DRAG_MIME = "application/x-oa-path"; // a file dragged from the tree

// A single pane: renders its content, reports focus/right-click, accepts a file
// dragged from the tree (HTML5 drag → split), and is a drop target for the
// pointer-events view-drag (tabs/panes). The highlighted zone shows where a drop
// lands — an edge splits, the center replaces.
function PaneLeaf(props: PaneTreeProps & { node: Leaf }) {
  const [fileDropDir, setFileDropDir] = createSignal<Dir | null>(null);
  let el!: HTMLDivElement;

  // Which half of the pane the cursor is over → which direction a file drop splits.
  // File drops always split (never replace), so this uses the edge-only helper.
  const getDropDir = (e: DragEvent): Dir => {
    const r = el.getBoundingClientRect();
    return nearestEdge({ x: r.left, y: r.top, w: r.width, h: r.height }, e.clientX, e.clientY);
  };

  // Drop-zone to highlight: a file drag (HTML5) reports an edge; a view drag
  // (tab/pane) reports its live zone when this pane is the current target.
  const activeZone = (): Zone | null => {
    const fd = fileDropDir();
    if (fd) return fd;
    const d = props.dragState();
    if (d.active && d.target?.kind === "pane" && d.target.leafId === props.node.id) {
      return d.target.zone;
    }
    return null;
  };

  return (
    <div
      ref={el}
      class="pane-leaf"
      classList={{ focused: props.node.id === props.focusId }}
      data-pane-leaf={props.node.id}
      onMouseDown={() => props.onFocus(props.node.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(props.node.id, e.clientX, e.clientY);
      }}
      onDragOver={(e) => {
        const types = e.dataTransfer?.types;
        if (!types || !types.includes(DRAG_MIME)) return; // only file-tree drags
        e.preventDefault(); // allow drop
        setFileDropDir(getDropDir(e));
      }}
      onDragLeave={() => setFileDropDir(null)}
      onDrop={(e) => {
        const dir = fileDropDir();
        setFileDropDir(null);
        if (!dir) return;
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
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).classList.contains("pane-header-x")) return;
            props.onStartPaneDrag(e, props.node.id, contentLabel(props.node.content));
          }}
        >
          <Show when={contentIcon(props.node.content)}>
            {(icon) => <Icon value={icon()} size={13} class="pane-header-icon" />}
          </Show>
          <span class="pane-header-label">{contentLabel(props.node.content)}</span>
          <IconButton
            icon="X"
            label="Close pane"
            class="pane-header-x"
            iconSize={12}
            onMouseDown={(e) => {
              e.stopPropagation(); // don't also trigger focus
              e.preventDefault();
              props.onClose(props.node.id);
            }}
          />
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
      <Show when={activeZone()}>
        {(z) => <div class={`pane-dropzone ${z()}`} />}
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
        // Teardown for an in-flight divider drag. Hoisted to the split-branch scope so
        // onCleanup can detach the window listeners if this node unmounts mid-drag
        // (e.g. an external oa-deleted/oa-moved/close event rewrites the tab tree before
        // pointerup fires), avoiding leaked listeners + setResizing on a disposed scope.
        let endDrag: (() => void) | null = null;
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
          // pointercancel (OS pointer takeover) must end the drag too, or the
          // listeners leak and .pane-split stays stuck in its no-transition state.
          const up = () => {
            endDrag = null;
            setResizing(false);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
          };
          endDrag = up;
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        };
        // If the split unmounts mid-drag, run the same teardown so the move/up listeners
        // are removed from window. setResizing is a no-op here (scope is disposing) but
        // the listener detachment is the point.
        onCleanup(() => endDrag?.());
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
