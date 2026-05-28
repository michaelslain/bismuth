// app/src/PaneTree.tsx
// Recursively renders one tab's pane tree. A leaf renders PaneContent and reports
// focus/clicks; a split renders two children with a draggable divider between them.
import { Show } from "solid-js";
import type { PaneNode } from "./panes";
import { PaneContent } from "./PaneContent";
import type { NoteCandidate } from "./editor/wikilink";

type PaneTreeProps = {
  node: PaneNode;
  focusId: string;
  onFocus: (leafId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onSaved: () => void;
  onOpen: (path: string) => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
};

export function PaneTree(props: PaneTreeProps) {
  return (
    <Show
      when={props.node.kind === "split" ? (props.node as Extract<PaneNode, { kind: "split" }>) : null}
      fallback={
        <div
          class="pane-leaf"
          classList={{ focused: props.node.id === props.focusId }}
          onMouseDown={() => props.onFocus(props.node.id)}
        >
          <PaneContent
            path={(props.node as Extract<PaneNode, { kind: "leaf" }>).content}
            onSaved={props.onSaved}
            onOpen={props.onOpen}
            noteNames={props.noteNames}
            tagNames={props.tagNames}
          />
        </div>
      }
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
