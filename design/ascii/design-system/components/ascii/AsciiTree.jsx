import React from "react";

/** Connector prefix for a node at `depth`, last child or not. */
export function treePrefix(depth, last) {
  return depth === 0 ? (last ? "`-- " : "|-- ") : "|   ".repeat(depth) + (last ? "`-- " : "|-- ");
}

/**
 * The vault tree. Connectors are typed characters; each row carries the surface
 * glyph for its kind (▸ folder, ✎ note, ▤ base, ◈ agent, ✳ daemon).
 */
export function AsciiTree({ rows = [], activeId, onSelect, className }) {
  return (
    <div className={["asc-tree", className].filter(Boolean).join(" ")}>
      {rows.map((r) => (
        <div key={r.id}
             className={["asc-tree-row", r.id === activeId ? "active" : ""].filter(Boolean).join(" ")}
             onClick={() => onSelect?.(r.id)}>
          {treePrefix(r.depth ?? 0, !!r.last)}{r.glyph ? r.glyph + " " : ""}{r.label}
          {r.meta ? "".padEnd(Math.max(1, 22 - String(r.label).length)) + r.meta : ""}
        </div>
      ))}
    </div>
  );
}
