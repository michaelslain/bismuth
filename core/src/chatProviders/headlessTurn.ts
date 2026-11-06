// core/src/chatProviders/headlessTurn.ts
// One non-interactive turn on any chat backend: open a throwaway chat, send the text, collect the
// assistant prose, close the chat. Used by features that need a single model answer (page
// transcription) without a UI sink. Tests inject a fake ChatBackend through `deps`.
import { randomUUID } from 'node:crypto'
import { CHAT_BACKENDS, type ChatBackend } from './backends'
import type { BackendId } from '../agentBackends/catalog'
import type { ChatFrame, ChatImage } from '../chat'

export type HeadlessTurn = {
    backend: BackendId
    model?: string
    cwd: string
    text: string
    images?: ChatImage[]
    timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 180_000

export function runHeadlessTurn(
    turn: HeadlessTurn,
    deps: { backends?: Record<BackendId, ChatBackend> } = {},
): Promise<string> {
    const backend = (deps.backends ?? CHAT_BACKENDS)[turn.backend]
    const chatId = `headless-${randomUUID()}`
    const timeoutMs = turn.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return new Promise<string>((resolve, reject) => {
        let text = ''
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined

        const finish = (err?: Error) => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            try {
                // erase the session (page image + text) from the backend's own store
                backend.setPrivate(chatId, true)
            } catch {
                // best effort
            }
            try {
                backend.closeChat(chatId)
            } catch {
                // closing is best effort; the outcome is already decided
            }
            if (err) reject(err)
            else resolve(text)
        }

        const sink = (frame: ChatFrame) => {
            if (settled) return
            if (frame.type === 'assistant-text') text += frame.text
            else if (frame.type === 'error') {
                finish(new Error(frame.message || `${turn.backend} failed (${frame.code})`))
            } else if (frame.type === 'result') {
                if (frame.isError) {
                    finish(new Error(text.trim() || `${turn.backend} turn failed`))
                } else finish()
            } else if (frame.type === 'done') finish()
            else if (frame.type === 'permission' || frame.type === 'question') {
                finish(
                    new Error(
                        `${turn.backend} asked for ${frame.type === 'permission' ? frame.toolName : 'input'}; transcription allows no tools`,
                    ),
                )
            }
        }

        timer = setTimeout(
            () => finish(new Error(`${turn.backend} turn timed out after ${timeoutMs} ms`)),
            timeoutMs,
        )

        try {
            const ctx = { chatId, cwd: turn.cwd, sink }
            // setModel is a no-op until the session exists, so open it first
            if (turn.model) {
                backend.openSession(ctx)
                backend.setModel(chatId, turn.model)
            }
            backend.sendMessage({
                ...ctx,
                text: turn.text,
                ...(turn.images?.length ? { images: turn.images } : {}),
            })
        } catch (e) {
            finish(e instanceof Error ? e : new Error(String(e)))
        }
    })
}
