// Cron tiers: maps a job's named effort tier (fast, balanced, deep) onto a backend's model and
// effort, with explicit job settings always winning. Provider-neutral: a backend only ever gets
// model names it owns — Codex tiers set effort and leave the model to Codex's own default.

export type CronTier = 'fast' | 'balanced' | 'deep'

type Resolved = { model?: string; effort?: string }

const TIER_MAP: Readonly<Record<string, Readonly<Record<CronTier, Resolved>>>> = {
    claude: {
        fast: { model: 'haiku' },
        balanced: { model: 'sonnet' },
        deep: { model: 'opus' },
    },
    codex: {
        fast: { effort: 'low' },
        balanced: { effort: 'medium' },
        deep: { effort: 'high' },
    },
}

const warned = new Set<string>()
function warnOnce(key: string, message: string) {
    if (warned.has(key)) return
    warned.add(key)
    console.error(`[tier] ${message}`)
}

export function resolveTier(backend: string, tier: string | undefined, explicit: Resolved): Resolved {
    if (!tier) return explicit
    const byTier = Object.hasOwn(TIER_MAP, backend) ? TIER_MAP[backend] : undefined
    if (!byTier) {
        warnOnce(`backend:${backend}`, `no tier mapping for backend "${backend}"; ignoring tier "${tier}"`)
        return explicit
    }
    if (!Object.hasOwn(byTier, tier)) {
        warnOnce(`tier:${tier}`, `unknown tier "${tier}"; ignoring it`)
        return explicit
    }
    const mapped = byTier[tier as CronTier]
    const out: Resolved = {}
    const model = explicit.model ?? mapped.model
    const effort = explicit.effort ?? mapped.effort
    if (model !== undefined) out.model = model
    if (effort !== undefined) out.effort = effort
    return out
}
