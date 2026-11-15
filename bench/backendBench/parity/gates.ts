// bench/backendBench/parity/gates.ts
// `applies` helpers the parity scenarios share. A backend whose catalog entry lacks a
// capability the scenario needs gets `gap`, which is scored as a miss (claude itself lacks `agents`).
import type { BackendCapabilities } from '../../../core/src/agentBackends/catalog'
import type { BenchTarget, ModelRequest, Scenario } from '../types'

type Applies = ReturnType<Scenario['applies']>

/** `skip` when the backend is not installed. */
export function installed(target: BenchTarget): Applies {
    return target.binary
        ? null
        : { verdict: 'skip', reason: `${target.backend} is not installed` }
}

/** `gap` when the catalog says the backend lacks `cap`. */
export function needsCap(
    target: BenchTarget,
    cap: keyof BackendCapabilities,
): Applies {
    const v = target.caps[cap]
    return v === false || v === 'none'
        ? { verdict: 'gap', reason: `${target.backend} has no ${cap}` }
        : null
}

/** `gap` when the backend cannot run on a local model, so no window can be set for it. */
export function needsLocalModel(target: BenchTarget): Applies {
    return target.caps.localModel
        ? null
        : {
              verdict: 'gap',
              reason: 'this backend cannot run on a local model',
          }
}

/** `skip` unless the target's model server is one the bench can watch (mock or local). */
export function watchedModel(target: BenchTarget): Applies {
    return target.source.kind === 'cloud'
        ? { verdict: 'skip', reason: 'cloud model requests are not visible' }
        : null
}

/** The models a switch can safely pick: opencode on a mock also lists the machine's own models,
 *  and one of those would reach a real provider; every other backend sends any name to the mock. */
export const switchableModels = (t: BenchTarget, all: { value: string }[]) =>
    t.backend === 'opencode' && t.source.kind === 'mock'
        ? all.filter(m => m.value.startsWith('mock/'))
        : all

/** The first non-null verdict, or null when every check passes. */
export function firstOf(...checks: Applies[]): Applies {
    return checks.find(c => c !== null) ?? null
}

const bodyString = (req: ModelRequest): string =>
    typeof req.body === 'string' ? req.body : JSON.stringify(req.body)

/** The request that carries `marker` (the turn's user text) and the agent's tools: the one the
 *  instructions ride. A backend's title or warm-up request carries neither, so skip it. */
export function mainRequest(
    reqs: ModelRequest[],
    marker: string,
): ModelRequest | null {
    const withMarker = reqs.filter(r => bodyString(r).includes(marker))
    const withTools = withMarker.find(r => {
        const tools = (r.body as { tools?: unknown } | null)?.tools
        return Array.isArray(tools) && tools.length > 0
    })
    return withTools ?? withMarker[0] ?? null
}
