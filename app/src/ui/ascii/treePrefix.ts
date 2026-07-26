// app/src/ui/ascii/treePrefix.ts
// Pure connector-prefix builder for <AsciiTree> rows. Ported 1:1 from
// design/ascii/design-system/components/ascii/AsciiTree.jsx — plain ASCII only,
// never box-drawing characters.

/** Connector prefix for a node at `depth`, last child or not. */
export function treePrefix(depth: number, last: boolean): string {
  return depth === 0 ? (last ? "`-- " : "|-- ") : "|   ".repeat(depth) + (last ? "`-- " : "|-- ");
}
