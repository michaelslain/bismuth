// core/src/tmpFiles.ts
// Scratch staging for bytes that need a real filesystem path but must NOT enter the vault.
//
// Why this exists: a file dragged from Finder into a chat arrives as a real absolute path (the
// Tauri native drag-drop handler), and chat just references that path in place — nothing is
// copied. But a PASTED file (and a drop in the browser dev build) arrives as bytes with no
// path at all, and a path is exactly what the agent needs in order to read it. Those bytes get
// staged here.
//
// Deliberately NOT the vault's attachment folder: notes own that folder, and every file a user
// drags into a chat should not become a permanent tracked vault file. Entries here are pruned
// by age on server boot.

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** How long a staged file survives. Long enough to outlive the conversation that referenced it,
 *  short enough that the directory doesn't grow without bound. */
export const TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** `~/.bismuth/tmp` — sibling of the run registry's `~/.bismuth/run`. Overridable via
 *  `BISMUTH_TMP_DIR` (tests point it at a scratch dir). */
export function tmpFilesDir(): string {
    return process.env.BISMUTH_TMP_DIR || join(homedir(), '.bismuth', 'tmp')
}

/**
 * Reduce an arbitrary client-supplied name to a safe single path segment.
 *
 * The name comes straight off a `File.name` / clipboard item, so it is untrusted: strip every
 * path separator (a `../../.ssh/authorized_keys` must not escape the scratch dir), drop leading
 * dots (no writing dotfiles), and cap the length. Returns "file" when nothing usable is left,
 * so a hostile name degrades to a boring one rather than throwing.
 */
export function safeTmpName(name: string): string {
    const base = (name.split(/[\\/]/).pop() ?? '')
        .replace(/[\x00-\x1f]/g, '')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 120)
    return base || 'file'
}

/** A name that doesn't collide with an existing entry: `photo.jpg` → `photo-1.jpg` → … The
 *  suffix goes before the extension so the file keeps its type. */
async function uniqueName(dir: string, name: string): Promise<string> {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let candidate = name
    for (let i = 1; i < 1000; i++) {
        const exists = await stat(join(dir, candidate)).then(
            () => true,
            () => false,
        )
        if (!exists) return candidate
        candidate = `${stem}-${i}${ext}`
    }
    return `${stem}-${Date.now()}${ext}`
}

/** Write `bytes` into the scratch dir under a safe, de-collided form of `name`. Returns the
 *  ABSOLUTE path — the whole point of staging is producing something an agent can read. */
export async function stageTmpFile(
    name: string,
    bytes: Uint8Array | ArrayBuffer,
): Promise<string> {
    const dir = tmpFilesDir()
    await mkdir(dir, { recursive: true })
    const final = await uniqueName(dir, safeTmpName(name))
    const path = join(dir, final)
    await writeFile(
        path,
        bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
    )
    return path
}

/**
 * Delete staged files older than `maxAgeMs`. Called once on server boot — staging is a
 * side effect of a user gesture, so there is no steady stream to justify a background timer,
 * and "clean up what last session left" is the behaviour that matters.
 *
 * Returns the number of entries removed (tests assert on it). Never throws: a scratch dir that
 * can't be pruned must not take the server down.
 */
export async function pruneTmpFiles(
    maxAgeMs: number = TMP_MAX_AGE_MS,
    now = Date.now(),
): Promise<number> {
    const dir = tmpFilesDir()
    let removed = 0
    let entries: string[]
    try {
        entries = await readdir(dir)
    } catch {
        return 0 // no scratch dir yet — nothing to prune
    }
    for (const entry of entries) {
        const path = join(dir, entry)
        try {
            const s = await stat(path)
            if (now - s.mtimeMs < maxAgeMs) continue
            await rm(path, { recursive: true, force: true })
            removed++
        } catch {
            /* raced with another prune / permission — skip */
        }
    }
    return removed
}
