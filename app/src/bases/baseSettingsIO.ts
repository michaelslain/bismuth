// SAVE's I/O for BaseSettings: read the base file's frontmatter, run one planned write.
// The plan itself is pure and lives in baseSettingsPlan.ts.

import { parse as parseYaml } from 'yaml'
import { api } from '../api'
import { FRONTMATTER_RE } from '../../../core/src/bases/parse'
import type { WriteOp } from './baseSettingsPlan'

/** Run one planned write against the base file. */
export async function runOp(path: string, o: WriteOp): Promise<void> {
    if (o.op === 'set') await api.setProperty(path, o.key, o.value)
    else if (o.op === 'delete') await api.deleteProperty(path, o.key)
    else if (o.op === 'setView')
        await api.setViewProperty(path, o.index, o.key, o.value)
    else await api.deleteViewProperty(path, o.index, o.key)
}

/** The base file's frontmatter as it is on disk right now. */
export async function readFrontmatter(
    path: string,
): Promise<Record<string, unknown>> {
    const text = await api.read(path)
    const m = text.match(FRONTMATTER_RE)
    if (!m) return {}
    const data = parseYaml(m[2])
    return data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {}
}
