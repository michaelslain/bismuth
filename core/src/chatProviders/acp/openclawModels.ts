// core/src/chatProviders/acp/openclawModels.ts
// openclaw's ACP bridge sends no model list and takes no model switch, so the driver reads the list
// from `openclaw models list --json` (a local catalog read, which works without a gateway) and the
// effort levels from the `thought_level` config option the bridge does send.
import type { AcpModelEntry } from './protocol'

export interface AgentModelList {
    models: { key: string; name: string }[]
    /** The key tagged `default`, or the only model. */
    current: string | null
}

/** Pure: read `models list --json` output. Tolerant of text before the JSON object. */
export function parseModelList(stdout: string): AgentModelList {
    const start = stdout.indexOf('{')
    if (start < 0) return { models: [], current: null }
    let parsed: unknown
    try {
        parsed = JSON.parse(stdout.slice(start))
    } catch {
        return { models: [], current: null }
    }
    const raw = (parsed as { models?: unknown } | null)?.models
    if (!Array.isArray(raw)) return { models: [], current: null }
    const models: AgentModelList['models'] = []
    let current: string | null = null
    for (const m of raw) {
        const key = (m as { key?: unknown } | null)?.key
        if (typeof key !== 'string' || !key) continue
        const name = (m as { name?: unknown }).name
        models.push({ key, name: typeof name === 'string' && name ? name : key })
        const tags = (m as { tags?: unknown }).tags
        if (current === null && Array.isArray(tags) && tags.includes('default'))
            current = key
    }
    if (current === null && models.length === 1) current = models[0]!.key
    return { models, current }
}

/** Pure: the config id and levels of a `session/new` result's `thought_level` option. A list of only
 *  off/none is no effort choice. `adaptive` is dropped: the gateway describes it as "use the session's
 *  default level", which is no level to send. */
export function thoughtLevels(result: unknown): {
    id: string | null
    levels: string[]
} {
    const options = (result as { configOptions?: unknown } | null)?.configOptions
    if (!Array.isArray(options)) return { id: null, levels: [] }
    const opt = options.find(
        o => o && o.category === 'thought_level' && Array.isArray(o.options),
    ) as { id?: unknown; options: unknown[] } | undefined
    if (!opt || typeof opt.id !== 'string') return { id: null, levels: [] }
    const levels: string[] = []
    for (const o of opt.options) {
        // Select options are `{value, name}` or groups `{options: [...]}`.
        const group = (o as { options?: unknown })?.options
        for (const leaf of Array.isArray(group) ? group : [o]) {
            const v = (leaf as { value?: unknown } | null)?.value
            if (typeof v === 'string' && v && v !== 'adaptive') levels.push(v)
        }
    }
    const real = levels.every(l => l === 'off' || l === 'none') ? [] : levels
    return { id: opt.id, levels: real }
}

/** Pure: the models frame entries, each carrying the thought levels the session offers. */
export function modelEntries(
    list: AgentModelList,
    levels: string[],
): AcpModelEntry[] {
    return list.models.map(m => ({
        value: m.key,
        label: m.name,
        description: '',
        effortLevels: levels,
    }))
}

/** Run the agent's model-list command; an empty list on any failure or after `timeoutMs`. */
export async function listAgentModels(
    bin: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    timeoutMs = 20_000,
): Promise<AgentModelList> {
    try {
        const proc = Bun.spawn([bin, ...args], {
            cwd,
            env,
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'ignore',
        })
        const timer = setTimeout(() => {
            try {
                proc.kill(9)
            } catch {
                /* already exited */
            }
        }, timeoutMs)
        const out = await new Response(proc.stdout).text()
        clearTimeout(timer)
        return parseModelList(out)
    } catch {
        return { models: [], current: null }
    }
}
