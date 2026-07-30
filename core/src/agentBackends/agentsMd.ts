// core/src/agentBackends/agentsMd.ts
//
// A managed-block writer for the AGENTS.md context-file convention — Codex, Cursor, Amp, and Droid
// all read a project-root AGENTS.md as their designed "give me persistent context" channel (Gemini's
// variant is GEMINI.md). This module is deliberately NOT under chatProviders/codex/: it is the first
// backend to use it, not the only one that will.
//
// AGENTS.md is a file the USER may also hand-author (headings, their own notes to themselves, a repo
// README-style doc). Bismuth's contribution — a short persona/memory digest refreshed per session —
// must live in a clearly delimited block so it can be rewritten on every session open without
// touching a single character the user wrote above or below it. This is a structure-preserving
// merge in the same spirit as core/src/frontmatter.ts's mutateFrontmatter and
// agentBackends/mcpRegistrars.ts's JSON/YAML upserts, just for a plain markdown file with no
// existing "one key we own" shape — so the unit here is a pair of HTML-comment markers instead.
//
// Writing into the user's vault is opt-in (see core/src/settings.ts readCodexOptIns /
// settings.codex.writeAgentsMd) — the same precedent as mcp.registerWith: naming a CLI/turning on a
// flag IS the consent, default off.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The file Bismuth writes into, at the vault root. */
export const AGENTS_MD_FILENAME = "AGENTS.md";

const START_MARKER = "<!-- bismuth:managed:start -- do not edit below, this block is regenerated automatically -->";
const END_MARKER = "<!-- bismuth:managed:end -->";

/**
 * Insert or replace Bismuth's managed block within `existingText` (null = file doesn't exist yet).
 *
 * PURE — no I/O. Behavior:
 *  - No existing markers (or a malformed/out-of-order pair): the block is APPENDED at the end,
 *    after a blank-line separator when the file already has content. Never risks a bad splice.
 *  - A valid `start...end` pair: only the text BETWEEN the markers is replaced; everything before
 *    the start marker and everything after the end marker is preserved byte-for-byte (modulo
 *    whitespace normalization immediately around the block, so re-running this doesn't accumulate
 *    blank lines).
 *  - Idempotent: calling this twice with the same `content` on its own prior output yields the same
 *    bytes the second time.
 */
export function upsertAgentsMdBlock(existingText: string | null, content: string): string {
  const body = content.trim();
  const block = `${START_MARKER}\n${body}\n${END_MARKER}`;
  const base = existingText ?? "";
  const startIdx = base.indexOf(START_MARKER);
  const endIdx = base.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    // No valid existing block (absent, or the two markers are missing/out of order) — append fresh
    // rather than guess at a splice that could corrupt the user's prose.
    const trimmedBase = base.replace(/\s+$/, "");
    return trimmedBase ? `${trimmedBase}\n\n${block}\n` : `${block}\n`;
  }

  const before = base.slice(0, startIdx).replace(/\s+$/, "");
  const after = base.slice(endIdx + END_MARKER.length).replace(/^\s+/, "");
  const beforePart = before ? `${before}\n\n` : "";
  const afterPart = after ? `\n\n${after}` : "";
  return `${beforePart}${block}${afterPart}\n`;
}

/**
 * Best-effort: read `<vaultRoot>/AGENTS.md` (if present), upsert Bismuth's managed block with
 * `content`, and write it back. Never throws — a filesystem hiccup here must never fail the chat
 * turn or daemon send that triggered it; it just skips this refresh. Returns whether the write
 * actually happened.
 */
export function writeAgentsMdBlock(vaultRoot: string, content: string): boolean {
  try {
    const path = join(vaultRoot, AGENTS_MD_FILENAME);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    const next = upsertAgentsMdBlock(existing, content);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    return true;
  } catch {
    return false;
  }
}
