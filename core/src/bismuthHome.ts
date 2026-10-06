import { homedir } from 'node:os'
import { join } from 'node:path'

/** `~/.bismuth[/...parts]` — the machine-wide Bismuth home. homedir() is called on every call, but Bun resolves HOME once at process start, so a runtime HOME change is not seen. */
export function bismuthHome(...parts: string[]): string {
    return join(homedir(), '.bismuth', ...parts)
}
