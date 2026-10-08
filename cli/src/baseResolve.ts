// Path resolution shared by every CLI command that takes a base path (`base`, `row`,
// `calendar`, `card review --file`). A path with an explicit `.md` / `.jsonl` extension is
// used as written; an extensionless one resolves to `<path>.base.jsonl` when that file
// exists, otherwise `<path>.md` (the markdown base a vault predating JSONL holds).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BASE_EXT } from '../../core/src/bases/baseFile'

const EXPLICIT_EXT_RE = /\.(md|jsonl)$/i

export function resolveBasePath(vault: string, path: string): string {
    if (EXPLICIT_EXT_RE.test(path)) return path
    if (existsSync(join(vault, `${path}${BASE_EXT}`)))
        return `${path}${BASE_EXT}`
    return `${path}.md`
}

/** A vault-relative path in one canonical spelling: `/` separators, no leading `./`, no empty
 *  or `.` segments. `./Calendar.md` and `Calendar.md` compare equal after this. */
export function normalizeVaultPath(path: string): string {
    return path
        .replace(/\\/g, '/')
        .split('/')
        .filter(seg => seg !== '' && seg !== '.')
        .join('/')
}
