// core/src/chatProviders/opencode/opencodeV2Translate.ts
// PURE translation from opencode 2's server surfaces (opencodeV2Client.ts) into ChatFrames and the
// driver's own shapes. No IO; every function is tested against events captured from a live
// opencode 2.0.32 server (core/test/chatProviders/opencodeV2Translate.test.ts).
//
// opencode 2's event bus names each step of a turn explicitly, every event `{id, type, data}` with
// the session in `data.sessionID`:
//   session.text.started/delta/ended       {assistantMessageID, ordinal, delta | text}
//   session.reasoning.started/delta/ended  the same shape, for thinking
//   session.tool.input.started             {id, name}             the call's tool name
//   session.tool.called                    {id, input}            the call's resolved input
//   session.tool.success                   {id, content:[{type:'text', text}]}
//   session.tool.failed                    {id, error:{type, message}, content?}
//   session.step.ended                     {cost, tokens}         one per model step
//   session.retry.scheduled                {attempt, error}       the provider call failed, retrying
//   permission.asked                       {id, action, resources, save, source}
//   session.execution.succeeded | failed {error} | interrupted {reason}   the turn's end
// A `*.ended` event carries the part's whole text, so a part that never streamed (or whose deltas
// were partly missed) still renders exactly once through the suffix rule below.
import type { ChatFrame } from '../../chat'
import type { OpencodeV2ModelRef } from './opencodeV2Client'
import type {
    OpencodeAuthMethod,
    OpencodeProviderList,
} from './opencodeProviders'
import type {
    OpencodeCommandEntry,
    OpencodeModelEntry,
} from './opencodeTranslate'
import { LOCAL_PROVIDER_ID } from '../../agentBackends/localModel'

/** How a v2 turn ended. */
export type OpencodeV2Outcome =
    | { kind: 'succeeded' }
    | { kind: 'failed'; message: string }
    | { kind: 'interrupted'; reason: string }

/** Per-turn accounting for translateOpencodeV2Event. */
export interface OpencodeV2TurnState {
    /** `t:<message>:<ordinal>` / `r:<message>:<ordinal>` → text length already emitted. */
    emitted: Map<string, number>
    /** tool call id → tool name, learned off `session.tool.input.started`. */
    toolNames: Map<string, string>
    toolsStarted: Set<string>
    toolsFinished: Set<string>
    /** Summed `session.step.ended` cost (USD); null until a step reports a positive one. */
    costUsd: number | null
    /** Set once a `session.execution.*` end event arrives. */
    outcome: OpencodeV2Outcome | null
    /** A tool call the user declined. opencode 2 ends the turn after a declined call (it reports
     *  `session.execution.interrupted`, reason `shutdown`), which is the user's choice, not a failure. */
    declined: boolean
}

export function newOpencodeV2TurnState(): OpencodeV2TurnState {
    return {
        emitted: new Map(),
        toolNames: new Map(),
        toolsStarted: new Set(),
        toolsFinished: new Set(),
        costUsd: null,
        outcome: null,
        declined: false,
    }
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The session id an event belongs to (`data.sessionID`), or null. Pure. */
export function opencodeV2EventSessionId(raw: unknown): string | null {
    const id = obj(obj(raw).data).sessionID
    return typeof id === 'string' && id ? id : null
}

/** The message out of a v2 error object (`{type, message}`), else a generic line. Pure. */
export function opencodeV2ErrorMessage(err: unknown): string {
    const e = obj(err)
    if (str(e.message)) return str(e.message)
    if (str(e.type)) return `opencode reported an error (${str(e.type)})`
    return 'opencode reported an error'
}

/** A tool result's display text: the `text` entries of its content joined. Pure. */
function contentText(content: unknown): string {
    if (!Array.isArray(content)) return ''
    return content
        .map(c => str(obj(c).text))
        .filter(Boolean)
        .join('\n')
}

function suffix(state: OpencodeV2TurnState, key: string, text: string): string {
    const seen = state.emitted.get(key) ?? 0
    if (text.length <= seen) return ''
    state.emitted.set(key, text.length)
    return text.slice(seen)
}

function startTool(
    state: OpencodeV2TurnState,
    id: string,
    input: unknown,
): ChatFrame[] {
    if (state.toolsStarted.has(id)) return []
    state.toolsStarted.add(id)
    return [
        {
            type: 'tool-use',
            id,
            name: state.toolNames.get(id) ?? 'tool',
            input: input ?? {},
        },
    ]
}

/**
 * Translate ONE event of the turn's session into the ChatFrames it produces, updating `state`.
 * Permission asks are parsed separately (parseOpencodeV2PermissionAsk) because the driver must
 * remember their ids. Unknown kinds yield []; never throws.
 */
export function translateOpencodeV2Event(
    raw: unknown,
    state: OpencodeV2TurnState,
): ChatFrame[] {
    const ev = obj(raw)
    const d = obj(ev.data)
    const type = str(ev.type)
    const partKey = `${str(d.assistantMessageID)}:${String(d.ordinal ?? 0)}`

    switch (type) {
        case 'session.text.delta':
        case 'session.reasoning.delta': {
            const delta = str(d.delta)
            if (!delta) return []
            const key = (type === 'session.text.delta' ? 't:' : 'r:') + partKey
            state.emitted.set(key, (state.emitted.get(key) ?? 0) + delta.length)
            return [
                type === 'session.text.delta'
                    ? { type: 'assistant-text', text: delta }
                    : { type: 'thinking', text: delta },
            ]
        }
        case 'session.text.ended':
        case 'session.reasoning.ended': {
            const text = str(d.text)
            const isText = type === 'session.text.ended'
            const rest = suffix(state, (isText ? 't:' : 'r:') + partKey, text)
            if (!rest) return []
            return [
                isText
                    ? { type: 'assistant-text', text: rest }
                    : { type: 'thinking', text: rest },
            ]
        }
        case 'session.tool.input.started': {
            const id = str(d.id)
            if (id && str(d.name)) state.toolNames.set(id, str(d.name))
            return []
        }
        case 'session.tool.called': {
            const id = str(d.id)
            return id ? startTool(state, id, d.input) : []
        }
        case 'session.tool.success':
        case 'session.tool.failed': {
            const id = str(d.id)
            if (!id || state.toolsFinished.has(id)) return []
            const frames = startTool(state, id, undefined)
            state.toolsFinished.add(id)
            const failed = type === 'session.tool.failed'
            if (failed && obj(d.error).type === 'aborted') state.declined = true
            const text = contentText(d.content)
            frames.push({
                type: 'tool-result',
                id,
                content: failed
                    ? text || opencodeV2ErrorMessage(d.error)
                    : text,
                isError: failed,
            })
            return frames
        }
        case 'session.step.ended': {
            if (typeof d.cost === 'number' && d.cost > 0)
                state.costUsd = (state.costUsd ?? 0) + d.cost
            return []
        }
        case 'session.execution.succeeded':
            state.outcome = { kind: 'succeeded' }
            return []
        case 'session.execution.failed':
            state.outcome = {
                kind: 'failed',
                message: opencodeV2ErrorMessage(d.error),
            }
            return []
        case 'session.execution.interrupted':
            state.outcome = { kind: 'interrupted', reason: str(d.reason) }
            return []
        default:
            return []
    }
}

/** How many failed provider attempts a turn tolerates before Bismuth stops it. opencode 2 retries
 *  an unreachable provider with growing backoff and no end (measured: attempt 9 at ~60 s), which
 *  reads as a chat that hangs forever; attempt 4 lands about 13 s in. */
export const OPENCODE_V2_MAX_ATTEMPTS = 4

/** The message to stop a turn with when `raw` is a `session.retry.scheduled` at or past the
 *  attempt cap, else null. Pure. */
export function opencodeV2RetryGiveUp(raw: unknown): string | null {
    const ev = obj(raw)
    if (ev.type !== 'session.retry.scheduled') return null
    const d = obj(ev.data)
    const attempt = typeof d.attempt === 'number' ? d.attempt : 0
    if (attempt < OPENCODE_V2_MAX_ATTEMPTS) return null
    return `opencode could not reach the model after ${attempt - 1} attempts: ${opencodeV2ErrorMessage(d.error)}`
}

/** A pending approval off `permission.asked`, shaped for the chat's `permission` frame. */
export interface OpencodeV2PermissionAsk {
    id: string
    toolName: string
    input: unknown
}

/** Parse a `permission.asked` event, or null. A shell ask's resources are the command line, so it
 *  becomes `{command}` (what the permission card summarises); any other action shows its
 *  resources as `{pattern}`. Pure. */
export function parseOpencodeV2PermissionAsk(
    raw: unknown,
): OpencodeV2PermissionAsk | null {
    const ev = obj(raw)
    if (ev.type !== 'permission.asked') return null
    const d = obj(ev.data)
    const id = str(d.id)
    if (!id) return null
    const action = str(d.action) || 'tool'
    const resources = Array.isArray(d.resources)
        ? d.resources.filter((r): r is string => typeof r === 'string')
        : []
    const metadata = obj(d.metadata)
    const input = Object.keys(metadata).length
        ? metadata
        : action === 'shell' || action === 'bash'
          ? { command: resources.join('\n') }
          : { pattern: resources }
    return { id, toolName: action, input }
}

/** Split `provider/model` into opencode 2's `Model.Ref` — the FIRST `/` splits, so a model id may
 *  itself hold `/` (`lmstudio/qwen/qwen3-coder-30b`). Null for anything not of that shape. Pure. */
export function opencodeV2ModelRef(model: string): OpencodeV2ModelRef | null {
    const i = model.indexOf('/')
    if (i <= 0 || i === model.length - 1) return null
    return { providerID: model.slice(0, i), id: model.slice(i + 1) }
}

/** A model's reasoning-effort levels: the ids of its variants that set `reasoningEffort`
 *  (`low`, `high`, `max`, …), in opencode's order. A variant id is what `Model.Ref.variant` takes,
 *  and the server accepts any string there without an error, so only these are ever sent. Pure. */
export function effortLevelsFromV2Variants(variants: unknown): string[] {
    if (!Array.isArray(variants)) return []
    return variants
        .map(obj)
        .filter(
            v =>
                str(v.id) &&
                typeof obj(v.settings).reasoningEffort === 'string',
        )
        .map(v => str(v.id))
}

/** `GET /api/model` → the `models` frame's entries. `free` is the first cost tier's $0 in/out
 *  (Zen's free models, and any local provider), a disabled model is dropped, a name several
 *  providers share gets its provider appended, and `effortLevels` are its reasoning variants.
 *  Pure. */
export function modelEntriesFromV2Models(raw: unknown[]): OpencodeModelEntry[] {
    const seen = new Set<string>()
    const entries: {
        id: string
        name: string | null
        free?: boolean
        effortLevels: string[]
    }[] = []
    for (const r of raw) {
        const m = obj(r)
        if (m.enabled === false) continue
        const provider = str(m.providerID)
        const model = str(m.id)
        if (!provider || !model) continue
        const id = `${provider}/${model}`
        if (seen.has(id)) continue
        seen.add(id)
        const tier = Array.isArray(m.cost) ? obj(m.cost[0]) : {}
        const free =
            typeof tier.input === 'number' && typeof tier.output === 'number'
                ? tier.input === 0 && tier.output === 0
                : undefined
        entries.push({
            id,
            name: str(m.name).trim() || null,
            free,
            effortLevels: effortLevelsFromV2Variants(m.variants),
        })
    }
    const count = new Map<string, number>()
    for (const e of entries)
        if (e.name) count.set(e.name, (count.get(e.name) ?? 0) + 1)
    return entries.map(e => ({
        value: e.id,
        label: e.name
            ? (count.get(e.name) ?? 0) > 1
                ? `${e.name} (${e.id.split('/')[0]})`
                : e.name
            : e.id,
        description: e.id,
        effortLevels: e.effortLevels,
        ...(e.free === undefined ? {} : { free: e.free }),
    }))
}

/** The `Model.Ref` a turn runs: the pick, with the chosen effort as its variant only when that
 *  model lists the level (`levels`); otherwise no variant, which the server reads as the model's
 *  default. Null for a pick that is not `provider/model`. Pure. */
export function opencodeV2TurnModel(
    model: string,
    effort: string | undefined,
    levels: readonly string[],
): OpencodeV2ModelRef | null {
    const ref = opencodeV2ModelRef(model)
    if (!ref) return null
    return effort && levels.includes(effort) ? { ...ref, variant: effort } : ref
}

/** `GET /api/command` → the `/` popover's entries (one typable token per name). Pure. */
export function commandEntriesFromV2(raw: unknown[]): OpencodeCommandEntry[] {
    const out: OpencodeCommandEntry[] = []
    for (const r of raw) {
        const c = obj(r)
        const name = str(c.name)
        if (!name.trim() || /\s/.test(name)) continue
        out.push({ name, description: str(c.description).trim() })
    }
    return out
}

/** One sign-in method the provider manager can drive on opencode 2: an API key, or an OAuth
 *  method whose form needs nothing the manager cannot fill from defaults. */
export type OpencodeV2Method =
    | { type: 'api'; label: string }
    | {
          type: 'oauth'
          label: string
          methodId: string
          answer: Record<string, unknown> | null
      }

/** The drivable methods of one integration, in opencode's order. An OAuth method whose form has a
 *  required field with no default (an enterprise URL, a cloud project) is left out — the manager
 *  has no form to ask it with — as are env, external-credential and command methods. Pure. */
export function opencodeV2Methods(integration: unknown): OpencodeV2Method[] {
    const methods = obj(integration).methods
    if (!Array.isArray(methods)) return []
    const out: OpencodeV2Method[] = []
    for (const raw of methods) {
        const m = obj(raw)
        if (m.type === 'key') {
            const form = Array.isArray(m.form) ? m.form : []
            if (form.some(f => obj(f).required === true)) continue
            out.push({ type: 'api', label: str(m.label) || 'API key' })
        } else if (m.type === 'oauth' && str(m.id)) {
            const form = Array.isArray(m.form) ? m.form.map(obj) : []
            if (form.some(f => f.required === true && f.default === undefined))
                continue
            const answer: Record<string, unknown> = {}
            for (const f of form)
                if (str(f.key) && f.default !== undefined)
                    answer[str(f.key)] = f.default
            out.push({
                type: 'oauth',
                label: str(m.label) || 'Sign in',
                methodId: str(m.id),
                answer: Object.keys(answer).length ? answer : null,
            })
        }
    }
    return out
}

/** `GET /api/integration` → the provider manager's lists. Connected = any connection; its kind is
 *  `env` for an environment-variable connection, else the credential's method. The local-model
 *  provider Bismuth injects is configured in `.settings`, so it is in neither list, and an
 *  integration with no drivable method is not offered. Pure. */
export function providerListFromV2(raw: unknown[]): OpencodeProviderList {
    const connected: OpencodeProviderList['connected'] = []
    const available: OpencodeProviderList['available'] = []
    for (const r of raw) {
        const i = obj(r)
        const id = str(i.id)
        if (!id || id === LOCAL_PROVIDER_ID) continue
        const name = str(i.name) || id
        const conns = Array.isArray(i.connections) ? i.connections.map(obj) : []
        if (conns.length) {
            const c = conns[0]
            const kind: 'api' | 'oauth' | 'env' =
                c.type === 'env'
                    ? 'env'
                    : c.method === 'oauth'
                      ? 'oauth'
                      : 'api'
            connected.push({ id, name, kind })
            continue
        }
        const methods: OpencodeAuthMethod[] = opencodeV2Methods(i).map(m => ({
            type: m.type,
            label: m.label,
        }))
        if (methods.length) available.push({ id, name, methods })
    }
    const byName = (a: { name: string }, b: { name: string }) =>
        a.name.localeCompare(b.name)
    return {
        connected: connected.sort(byName),
        available: available.sort(byName),
    }
}

/** An OAuth attempt's status off `integration.oauth.status`: still waiting, done, or failed with
 *  the server's message (an expired or cancelled attempt is a failure too). Pure. */
export function opencodeV2AttemptStatus(
    raw: unknown,
):
    | { kind: 'pending' }
    | { kind: 'complete' }
    | { kind: 'failed'; message: string } {
    const s = obj(raw)
    if (s.status === 'pending') return { kind: 'pending' }
    if (s.status === 'complete') return { kind: 'complete' }
    return {
        kind: 'failed',
        message:
            str(s.message) ||
            (str(s.status)
                ? `The sign-in ${str(s.status)}.`
                : 'The sign-in failed.'),
    }
}
