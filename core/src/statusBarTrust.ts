// core/src/statusBarTrust.ts — per-machine approval of `run:` commands found in a vault's
// .settings. A cloned vault must not execute anything until the owner approves it.
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** process.env.BISMUTH_TRUST_FILE || ~/.bismuth/trusted-commands.json */
export function trustFilePath(): string {
    return process.env.BISMUTH_TRUST_FILE || join(homedir(), '.bismuth', 'trusted-commands.json')
}

const hash = (command: string) => createHash('sha256').update(command).digest('hex')

function vaultKey(vault: string): string {
    try {
        return realpathSync(vault)
    } catch {
        return resolve(vault)
    }
}

function readTable(): Record<string, string[]> {
    try {
        const parsed = JSON.parse(readFileSync(trustFilePath(), 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const out: Record<string, string[]> = {}
        for (const [k, v] of Object.entries(parsed)) {
            if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string')
        }
        return out
    } catch {
        return {}
    }
}

/** Keyed by realpath(vault) -> list of sha256(command) hex. Missing/corrupt file = nothing trusted. */
export function isCommandTrusted(vault: string, command: string): boolean {
    return readTable()[vaultKey(vault)]?.includes(hash(command)) ?? false
}

/** True for a command that can look different from what runs: a newline, a carriage return, or
 *  a bidi control character. Such a command is never approvable. */
export function hasHiddenChars(command: string): boolean {
    return /[\n\r\u202A-\u202E\u2066-\u2069]/.test(command)
}

/** Adds the hash; creates the file/dir with mode 0600/0700. Idempotent. */
export function trustCommand(vault: string, command: string): void {
    if (hasHiddenChars(command))
        throw new Error('command contains newlines or bidi control characters and cannot be approved')
    const table = readTable()
    const key = vaultKey(vault)
    const list = table[key] ?? []
    const h = hash(command)
    if (list.includes(h)) return
    table[key] = [...list, h]
    const file = trustFilePath()
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    // write beside the target then rename, so a crash never leaves a truncated trust file
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, JSON.stringify(table, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
    chmodSync(file, 0o600)
}
