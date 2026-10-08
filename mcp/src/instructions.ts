// Server-level `instructions` (mcp/src/server.ts's `new Server(_, { instructions })`) — text the
// client reads BEFORE ever calling a tool, so it's the highest-leverage spot for guidance an agent
// must act on without being asked: the one tagging mistake agents keep making (writing a brand-new
// note that just embeds an image/PDF, `![[paper.pdf]]`, to hold its tags, instead of using the
// binary's real, hidden companion note), and the GUIDES to read before a task — this is the
// trigger that replaced shipping them as Claude Code skills, and unlike a skill it reaches every
// backend that reads MCP instructions. A plain exported string (not inlined in server.ts) so it's
// unit-testable and its size stays pinned — every session on the machine loads this, so it stays
// terse on purpose.
export const SERVER_INSTRUCTIONS =
    'EVERY time you create, edit or debug a Bismuth base (a `type: base` note, or a ```query ' +
    'block), first read bases/authoring.md with bismuth_docs_read, then bases/authoring/<view ' +
    'kind>.md for the kind you are writing. Converting a vault between Obsidian and Bismuth: ' +
    'first read guides/converting-obsidian-to-bismuth.md or ' +
    'guides/converting-bismuth-to-obsidian.md. ' +
    'Making or changing a colour theme: first read guides/custom-themes.md. ' +
    "An image or PDF has no frontmatter of its own — its tags/properties live in its companion " +
    'note <file>.<ext>.md (e.g. paper.pdf.md), a hidden file the app opens as the binary itself. ' +
    "To tag or set a property on a binary, run `bismuth prop set <file.pdf> tags '[\"a\",\"b\"]'` " +
    '(creates the companion if needed) — NEVER create a separate <name>.md that just embeds the ' +
    'file (e.g. `![[paper.pdf]]`) to hold tags; that makes a duplicate note, not a companion. ' +
    'Ink/annotations live separately, in <file>.<ext>.draw. See bismuth_docs_read on ' +
    'vault/frontmatter.md for more. Asked what is hidden or off-limits to AI: run `bismuth ' +
    'settings deny-list`, never grep; an agent gets only a count by design, so give it and have ' +
    'the user run it for paths (vault/visibility.md). If Bismuth misbehaves after an update (missing CLI, stale MCP, ' +
    'daemon not running), run bismuth_doctor first.'
