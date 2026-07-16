# The ` ```graph ` block — an embedded, editable graph

> Code: `core/src/graphBlock.ts` (pure parser / serializer / mutations, unit-tested in
> `core/test/graphBlock.test.ts`), `app/src/editor/graphBlock.ts` (the CodeMirror
> extension, mirroring the ` ```query ` block), `app/src/graph/EmbeddedGraph.tsx` (the
> rendered widget — reuses `CanvasGraphRenderer` + `core/src/layout.ts`).

A ` ```graph ` fenced block in a note body renders **inline as an interactive graph**
(the same canvas renderer as the knowledge graph). It is a lossless **markdown ⇄ graph
round-trip**: editing the graph through the widget's tools writes the updated canonical
markdown back into the same fence (an ordinary, undoable editor transaction — autosaved
like typing), and re-rendering that markdown reproduces the same graph.

## Syntax

One statement per line. Blank lines and `# comment` lines are ignored.

````
```graph
a: Alice
b
a -> b: manages
b -- c
```
````

| statement | meaning |
| --- | --- |
| `id` | declare a node |
| `id: Label text` | declare a node with a display label (rest of line) |
| `a -> b` | directed edge (endpoints are declared implicitly if new) |
| `a -- b` | undirected edge |
| `a -> b: label` | edge with a label |

Tokens are bare words of `A-Za-z0-9_.-/` (must not contain `->`/`--`); anything else —
spaces, quotes, arrows — goes in a double-quoted string with `\"`/`\\` escapes:
`"My First Node" -> b`. Arrows work with or without surrounding spaces (`a->b`).

**Canonical form** (what the widget writes back): every node on its own line first (in
model order, labeled ones as `id: label`), then every edge. The parser also accepts the
terse shorthand (edges implying their endpoints); it simply re-serializes more explicitly.
Parse errors are reported per-line in the widget, which disables graph editing (so a
write-back can never drop lines it didn't understand) until the source is fixed.

**Recovering from a parse error**: the edit tools hide, but **SOURCE stays available** — it
is the way back. Press it to reveal the raw fence, fix the flagged line, then move the caret
out of the block; it collapses back to a working graph. (Covered end to end by
`app/src/editor/graphBlock.test.ts`.)

## The widget

- **SELECT** — click a node, then rename its id / set its label / delete it in the edit row.
- **CONNECT** — click two nodes to add an edge between them; clicking an already-linked
  pair removes the edge(s). The `→`/`—` toggle picks directed vs undirected for new edges.
- **ERASE** — click a node to delete it and its edges.
- **+ NODE** — append a fresh node (`node`, `node-2`, …).
- **2D / 3D** — flat vs orbit layout. Drag orbits/pans; **Mod+scroll** (or trackpad
  pinch) zooms — plain scroll passes through to the note so the block never hijacks it.
- **SOURCE** (`</>`): reveals the raw fence for hand-editing, exactly like the
  ` ```query ` block — it collapses back to the rendered graph when the caret leaves. Shown
  in every state, including a block with parse errors (see **Recovering from a parse
  error** above).

Layout is **computed, not stored**: node positions come from the same deterministic
layout as the knowledge graph (`core/src/layout.ts`), so the same markdown always draws
the same picture and positions are not part of the DSL. Node drag-repositioning is
therefore intentionally not an edit tool.

## Notes

- `computeBlockRegions` (livePreview) skips ` ```graph ` fences the same way it skips
  ` ```query ` — the fence is owned by `graphBlock.ts`, not the code-block card.
- The slash menu (`/graph`) inserts an empty fence.
- In the Milkdown block editor, a ` ```graph ` fence shows as a plain code block; the
  interactive widget is a CodeMirror (default editor) surface.
