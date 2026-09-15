// Server-level `instructions` (mcp/src/server.ts's `new Server(_, { instructions })`) — text the
// client reads BEFORE ever calling a tool, so it's the highest-leverage spot to head off the one
// tagging mistake agents keep making: writing a brand-new note that just embeds an image/PDF
// (`![[paper.pdf]]`) to hold its tags, instead of using the binary's real, hidden companion note.
// A plain exported string (not inlined in server.ts) so it's unit-testable and its size stays
// pinned — every session on the machine loads this, so it stays terse on purpose.
export const SERVER_INSTRUCTIONS =
    "An image or PDF has no frontmatter of its own — its tags/properties live in its companion " +
    'note <file>.<ext>.md (e.g. paper.pdf.md), a hidden file the app opens as the binary itself. ' +
    "To tag or set a property on a binary, run `bismuth prop set <file.pdf> tags '[\"a\",\"b\"]'` " +
    '(creates the companion if needed) — NEVER create a separate <name>.md that just embeds the ' +
    'file (e.g. `![[paper.pdf]]`) to hold tags; that makes a duplicate note, not a companion. ' +
    'Ink/annotations live separately, in <file>.<ext>.draw. See bismuth_docs_read on ' +
    'vault/frontmatter.md for more.'
