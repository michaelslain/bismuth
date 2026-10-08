# The graph block

A fenced block tagged `graph` renders inside a note as an interactive node-and-edge diagram, drawn by the same canvas renderer as the knowledge graph. You write the diagram as a few lines of text or build it with the widget's tools; both edit the same text.

````markdown
```graph
a: Alice
b
a -> b: manages
b -- c
```
````

Insert an empty block by typing `/graph` at the start of a line and choosing **Graph block**; see [Autocomplete](autocomplete.md#insert-blocks-with-the-slash-menu).

## What can I write in a graph block?

One statement per line. Blank lines and lines starting with `#` are ignored.

| Statement | Meaning |
|---|---|
| `id` | Declare a node |
| `id: Label text` | Declare a node with a display label (the rest of the line) |
| `a -> b` | Directed edge; endpoints you have not declared are created |
| `a -- b` | Undirected edge |
| `a -> b: label` | Edge with a label (the rest of the line) |

Node ids are bare words made of letters, digits and `_ . - /`. Anything else, including spaces, goes in double quotes with `\"` and `\\` as escapes: `"My First Node" -> b`. An id that contains `->` or `--` must be quoted. Spaces around arrows are optional, so `a->b` works.

A node declared twice is an error. An edge's endpoints are created in the order you first mention them.

## How do I edit the graph with the mouse?

The toolbar above the canvas holds three tools, a node button, a layout switch and a source button. Each edit rewrites the fence text as an ordinary, undoable editor change, and the note autosaves like typing.

| Control | What it does |
|---|---|
| **select** | Click a node, then change its id or label in the row below and press **apply**, or press **delete** |
| **connect** | Click two nodes to add an edge; clicking an already-linked pair removes the edge |
| **erase** | Click a node to delete it and every edge touching it |
| directed or undirected toggle | Shown with **connect**; sets whether new edges are `->` or `--` |
| **node** | Append a node named `node`, `node-2`, `node-3` and so on |
| flat or orbit toggle | Switch between a flat layout and a 3D orbit layout |
| source (`</>`) | Reveal the raw fence for hand-editing |

Drag the canvas to orbit. Zoom with `Mod`+scroll or a trackpad pinch; plain scrolling passes through to the note so the block never captures it. A footer shows the node and edge counts.

Renaming a node to an id another node already uses, or to an empty id, changes nothing.

## What does a parse error do?

A line that does not parse is listed under the toolbar as `line N: message`, and the lines that did parse still draw. While any error exists the edit tools are hidden, so a write-back can never drop a line Bismuth did not understand. The flat or orbit toggle and the source button stay available.

To fix it, press the source button, correct the flagged line, and move the caret out of the block. The block collapses back to the rendered graph.

## Where do the nodes go?

Node positions are computed from the structure, not stored, so the same text always draws the same picture and you cannot drag a node into place. The layout is the knowledge graph's, without community detection. For small graphs with distinct clusters, the clusters can overlap instead of separating cleanly.

## How it works

`core/src/graphBlock.ts` holds the pure parser, serializer and mutation helpers (`parseGraphBlock`, `serializeGraphBlock`, `addNode`, `removeNode`, `renameNode`, `setNodeLabel`). Parsing is tolerant: a failing statement becomes an entry in `errors` with its 1-based line and is skipped. The serializer writes the canonical form, every node on its own line first (with `: label` when labelled), then every edge, and `parseGraphBlock` of that output reproduces the same spec. Hand-written shorthand that implies nodes through edges parses fine and is rewritten in canonical form on the next widget edit.

`app/src/editor/graphBlock.ts` is the CodeMirror extension and mirrors the query block: a `StateField` replaces each fence with the widget and tracks which blocks are revealed as source, collapsing a revealed block when the caret leaves. `app/src/editor/blockRegions.ts` skips `graph` fences so they are not also drawn as code blocks. `app/src/graph/EmbeddedGraph.tsx` is the Solid widget; it mounts `AsciiGraphRenderer` through the `GraphRenderer` seam in `app/src/graph/graphRenderer.ts`, and `layoutGraphData` in `app/src/graph/embeddedGraphRender.ts` lays the nodes out with `core/src/layout.ts`.

Source: `core/src/graphBlock.ts`, `app/src/editor/graphBlock.ts`, `app/src/editor/blockRegions.ts`, `app/src/graph/EmbeddedGraph.tsx`, `app/src/graph/embeddedGraphRender.ts`, `core/test/graphBlock.test.ts`, `app/src/editor/graphBlock.test.ts`
