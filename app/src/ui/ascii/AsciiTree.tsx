// app/src/ui/ascii/AsciiTree.tsx
// The vault file tree, drawn with typed connectors. Ported from
// design/ascii/design-system/components/ascii/AsciiTree.jsx (React reference) to Solid.
// Connectors are plain ASCII (never box-drawing); each row carries the surface glyph for
// its kind (folder/note/base/agent/daemon). Classes (`asc-tree`, `asc-tree-row`, `active`)
// come from patterns.css — no inline styling here.
import { For } from "solid-js";
import { treePrefix } from "./treePrefix";
import "../ui.css";

export interface AsciiTreeRow {
  id: string;
  label: string;
  depth?: number;
  last?: boolean;
  /** Surface glyph, e.g. folder/note/base/agent/daemon marker. */
  glyph?: string;
  /** Right-hand count, e.g. "(3)". */
  meta?: string;
}

export interface AsciiTreeProps {
  rows: AsciiTreeRow[];
  activeId?: string;
  onSelect?: (id: string) => void;
  class?: string;
}

/**
 * The vault tree. Connectors are typed characters; each row carries the surface
 * glyph for its kind. Never substitute box-drawing characters for `|--` / `` `-- ``.
 */
export function AsciiTree(props: AsciiTreeProps) {
  return (
    <div class={`asc-tree ${props.class ?? ""}`}>
      <For each={props.rows}>
        {(r) => (
          <div
            classList={{ "asc-tree-row": true, active: r.id === props.activeId }}
            onClick={() => props.onSelect?.(r.id)}
          >
            {treePrefix(r.depth ?? 0, !!r.last)}
            {r.glyph ? r.glyph + " " : ""}
            {r.label}
            {r.meta ? "".padEnd(Math.max(1, 22 - String(r.label).length)) + r.meta : ""}
          </div>
        )}
      </For>
    </div>
  );
}
