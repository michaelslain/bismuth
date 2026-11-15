// core/src/chatProviders/codex/models.ts
//
// Codex's model list and each model's reasoning-effort levels, read from `codex debug models`
// (a JSON catalog on stdout). Pure parsing here; the one spawn is `readCodexModels`.

export type CodexModelOption = {
    value: string
    label: string
    description: string
    effortLevels: string[]
}

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json =>
    typeof v === 'object' && v !== null && !Array.isArray(v)

/** The picker entries (`visibility: "list"`) of a `codex debug models` payload. Anything that is
 *  not that payload yields an empty list. */
export function parseCodexModels(stdout: string): CodexModelOption[] {
    let root: unknown
    try {
        root = JSON.parse(stdout)
    } catch {
        return []
    }
    if (!isRecord(root) || !Array.isArray(root.models)) return []
    const out: CodexModelOption[] = []
    for (const m of root.models) {
        if (!isRecord(m) || m.visibility !== 'list') continue
        if (typeof m.slug !== 'string' || !m.slug) continue
        const levels = Array.isArray(m.supported_reasoning_levels)
            ? m.supported_reasoning_levels.flatMap(l =>
                  isRecord(l) && typeof l.effort === 'string' ? [l.effort] : [],
              )
            : []
        out.push({
            value: m.slug,
            label:
                typeof m.display_name === 'string' && m.display_name
                    ? m.display_name
                    : m.slug,
            description: typeof m.description === 'string' ? m.description : '',
            effortLevels: levels,
        })
    }
    return out
}

/** Put `extra` (the configured or local model) first when the catalog lacks it. Its effort levels
 *  are the ones every catalog model lists: codex sends effort to a custom provider as well, but
 *  rejects a level only some models have (ultra). */
export function withExtraModel(
    models: CodexModelOption[],
    extra: string | undefined,
): CodexModelOption[] {
    if (!extra || models.some(m => m.value === extra)) return models
    return [
        {
            value: extra,
            label: extra,
            description: 'configured model',
            effortLevels: (models[0]?.effortLevels ?? []).filter(l =>
                models.every(m => m.effortLevels.includes(l)),
            ),
        },
        ...models,
    ]
}

/** Run `codex debug models` once. Empty on any failure: the picker just stays hidden. */
export async function readCodexModels(
    bin: string,
    env: Record<string, string>,
    cwd: string,
): Promise<CodexModelOption[]> {
    try {
        const proc = Bun.spawn([bin, 'debug', 'models'], {
            cwd,
            env,
            stdout: 'pipe',
            stderr: 'ignore',
            stdin: 'ignore',
        })
        const timer = setTimeout(() => proc.kill(), 15_000)
        const text = await new Response(proc.stdout).text()
        clearTimeout(timer)
        return parseCodexModels(text)
    } catch {
        return []
    }
}
