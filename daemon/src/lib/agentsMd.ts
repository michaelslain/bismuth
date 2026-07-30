import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

// A literal duplicate of core/src/agentBackends/agentsMd.ts's managed-block writer — kept here too
// since the daemon is a separate workspace + separately-bundled binary that must not import across
// into @bismuth/core (same rationale as claudeWhich.ts/bismuthPaths.ts). The marker strings are kept
// BYTE-IDENTICAL to core's so a vault ever touched by both (a chat session driving Codex, and the
// daemon's own Codex brain) upserts the SAME block rather than each maintaining its own — whichever
// side writes second correctly replaces the other's content, because the merge only looks for the
// marker text, not which module produced it.
//
// Writing into the user's vault is opt-in (settings.codex.writeAgentsMd, read by
// readDaemonSettings in ./registry.ts) — see core's copy for the full design rationale.

export const AGENTS_MD_FILENAME = "AGENTS.md"

const START_MARKER = "<!-- bismuth:managed:start -- do not edit below, this block is regenerated automatically -->"
const END_MARKER = "<!-- bismuth:managed:end -->"

/** PURE. See core/src/agentBackends/agentsMd.ts's upsertAgentsMdBlock for the full contract
 *  (creates a fresh block, replaces an existing one in place preserving surrounding prose,
 *  idempotent, and appends fresh rather than risking a bad splice on malformed/out-of-order
 *  markers). */
export function upsertAgentsMdBlock(existingText: string | null, content: string): string {
  const body = content.trim()
  const block = `${START_MARKER}\n${body}\n${END_MARKER}`
  const base = existingText ?? ""
  const startIdx = base.indexOf(START_MARKER)
  const endIdx = base.indexOf(END_MARKER)

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    const trimmedBase = base.replace(/\s+$/, "")
    return trimmedBase ? `${trimmedBase}\n\n${block}\n` : `${block}\n`
  }

  const before = base.slice(0, startIdx).replace(/\s+$/, "")
  const after = base.slice(endIdx + END_MARKER.length).replace(/^\s+/, "")
  const beforePart = before ? `${before}\n\n` : ""
  const afterPart = after ? `\n\n${after}` : ""
  return `${beforePart}${block}${afterPart}\n`
}

/** Best-effort: read `<vaultRoot>/AGENTS.md` (if present), upsert Bismuth's managed block with
 *  `content`, and write it back. Never throws — a failure here must not fail the daemon's send. */
export function writeAgentsMdBlock(vaultRoot: string, content: string): boolean {
  try {
    const path = join(vaultRoot, AGENTS_MD_FILENAME)
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null
    const next = upsertAgentsMdBlock(existing, content)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, next)
    return true
  } catch {
    return false
  }
}
