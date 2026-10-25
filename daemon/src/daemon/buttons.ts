// The ```button prompt-job runtime: runs the daemon job a button press queued. Core
// (core/src/buttons/buttonState.ts) writes `.daemon/buttons/.state/<key>.json` with status
// "working" and a fully composed prompt, then drops `.daemon/buttons/.triggers/<key>`. Same shape
// as pages.ts: listTriggers/consumeTrigger (owner-gated, unlink before processing), one isolated
// session per press, and completion written HERE deterministically — the model's output is never
// a status signal. This module writes "done"/"failed" and nothing else.
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { sendMessage, composeBackendRefusalNote } from './session'
import { isOwner } from '../lib/owner'
import { consumeTrigger, listTriggers } from '../lib/drainTriggers'
import type { VaultContext } from '../lib/config.ts'
import { atomicWriteJson } from '../lib/atomicJson.ts'

/** A button's sidecar, as written by core/src/buttons/buttonState.ts. Only the fields this
 *  runtime reads/writes are typed; core's ButtonState is the canonical shape. */
export interface ButtonState {
    status: 'working' | 'done' | 'failed'
    host?: string
    label?: string
    prompt?: string
    model?: string
    timeoutSecs?: number
    pressedAt?: string
    completedAt?: string | null
    note?: string | null
}

/** Seams for tests; production passes nothing. */
export type ButtonRuntimeDeps = {
    send?: typeof sendMessage
    owner?: () => Promise<boolean>
}

// Keyed by `${ctx.root}::${key}` so two vaults never collide and an overlapping poll never
// double-fires a button already mid-run.
const runningButtons = new Set<string>()
const runKey = (ctx: VaultContext, key: string): string => `${ctx.root}::${key}`

async function readState(
    ctx: VaultContext,
    key: string,
): Promise<ButtonState | null> {
    try {
        return JSON.parse(
            await readFile(join(ctx.buttonStateDir, `${key}.json`), 'utf-8'),
        ) as ButtonState
    } catch {
        return null
    }
}

async function writeState(
    ctx: VaultContext,
    key: string,
    state: ButtonState,
): Promise<void> {
    await atomicWriteJson(join(ctx.buttonStateDir, `${key}.json`), state, {
        ensureDir: true,
    })
}

function summarize(text: string): string {
    const trimmed = text.trim()
    return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed
}

/** Run any pressed button jobs pending for one vault. Called right after processPageTriggers in
 *  cron.ts's processAllTriggers. */
export async function processButtonTriggers(
    ctx: VaultContext,
    deps: ButtonRuntimeDeps = {},
): Promise<void> {
    const send = deps.send ?? sendMessage
    const triggers = await listTriggers(
        ctx.buttonTriggerDir,
        deps.owner ?? isOwner,
    )

    for (const key of triggers) {
        await consumeTrigger(ctx.buttonTriggerDir, key)

        const rk = runKey(ctx, key)
        if (runningButtons.has(rk)) continue

        const state = await readState(ctx, key)
        // A missing sidecar, a non-"working" status or a missing prompt means nothing is queued
        // (stale or duplicate trigger).
        if (!state || state.status !== 'working' || !state.prompt) continue

        runningButtons.add(rk)
        console.log(`[buttons] Firing "${state.label ?? key}" (${ctx.name})`)

        void (async () => {
            try {
                const response = await send(state.prompt!, ctx, {
                    newSession: true,
                    model: state.model,
                    timeoutSecs: state.timeoutSecs,
                })
                await writeState(ctx, key, {
                    ...state,
                    status: 'done',
                    note: composeBackendRefusalNote(
                        summarize(response.result),
                        response.backendRefusal,
                    ).slice(0, 500),
                    completedAt: new Date().toISOString(),
                })
            } catch (err) {
                await writeState(ctx, key, {
                    ...state,
                    status: 'failed',
                    note: String(err).slice(0, 500),
                    completedAt: new Date().toISOString(),
                })
            } finally {
                runningButtons.delete(rk)
            }
        })()
    }
}
