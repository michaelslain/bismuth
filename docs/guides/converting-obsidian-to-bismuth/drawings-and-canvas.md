# Converting Obsidian canvas and Excalidraw files

Bismuth reads neither Obsidian canvases nor Excalidraw drawings. `bismuth import obsidian` keeps both files on disk, converts neither, and lists each one under Needs a decision so a person can decide whether to preserve the content as an image. Bismuth's own drawing formats (`.draw` files and ` ```draw ` fences) have no Obsidian source, so nothing converts into them. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/drawing/overview.md` (`.draw` files), `docs/editor/ink.md` (` ```draw ` fences), `docs/vault/attachments.md` (what can be embedded), `docs/vault/structure.md` (which file types the tree shows).
- Obsidian: https://obsidian.md/help/plugins/canvas, https://obsidian.md/help/file-formats, https://jsoncanvas.org/spec/1.0/
- Excalidraw plugin (only if `obsidian-excalidraw-plugin` is in `community-plugins.json`): https://github.com/zsviczian/obsidian-excalidraw-plugin

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and tell the user about the difference.

| Obsidian | In Bismuth |
|---|---|
| `.canvas` (JSON Canvas: `nodes` and `edges`) | not read, not listed in the tree, not embeddable; the file stays on disk |
| `![[Board.canvas]]` | a "note not found" widget |
| `.excalidraw.md` notes (Excalidraw plugin) | an ordinary note showing the plugin's raw text; no Excalidraw code path |
| Excalidraw auto-export PNG/SVG copy (a plugin setting) | an image; embeds like any image |
| stroke ink | none in Obsidian; nothing to import |

## What the command reports

| Section | Item |
|---|---|
| Needs a decision | `canvas is not shown in Bismuth; …` per `.canvas` file, `canvas embed: …` per `![[X.canvas]]`, `Excalidraw drawing shows as raw text; …` per `.excalidraw.md` note |

## Resolve a Needs a decision item

- **A canvas file**: leave the `.canvas` where it is. If the user wants its content visible, ask them to export an image from Obsidian and embed it as `![[Board.png]]`. Do not hand-translate nodes.
- **An Excalidraw note**: ask the user to enable the plugin's auto-export (a PNG or SVG copy on save) or to export an image. Put the image next to the note and add `![[<name>.png]]` to the top of the note body. Leave the original note.
- **A canvas embed**: remove a stale `![[X.canvas]]` embed only if the user agrees; otherwise leave it.

## Lossy

- Everything in a canvas (cards, connections, layout) is invisible in Bismuth.
- Excalidraw drawings are viewable only as exported images.

## Validate

- `bismuth tree --vault "$OUT" --pretty | grep -ci canvas` prints `0`, because canvas files are not in the tree, and every canvas path is in the report.
- Any image you added sits in the vault, so its `![[<name>.png]]` embed resolves by file name.
