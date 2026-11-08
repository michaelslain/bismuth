// core/src/aiTranscribe.ts
// Page transcription with one headless turn per page image on an agent backend chosen like chat's
// provider. The turn runs in an empty temp dir with only the page image attached, so the backend
// reads nothing else. Reached only through a dynamic import() from the book route.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import {
    AUTO_PROVIDER,
    BACKENDS,
    can,
    isBackendId,
    resolveBackendId,
    type BackendId,
} from './agentBackends/catalog'
import { AppError } from './error'
import { installedBackendIds } from './freeAgent'
import { runHeadlessTurn, type HeadlessTurn } from './chatProviders/headlessTurn'
import type { PageText } from './transcript'
import { aiChecks } from './transcriptChecks'

export type AiTarget = { provider: string; model?: string }

export const TRANSCRIBE_PROMPT = [
    'Transcribe the text on the attached page image.',
    'Reply with the page text only, no commentary and no code fence.',
    'Transcribe faithfully: handwriting as written, do not correct, summarise or add words. Keep the original line breaks.',
    'Write mathematics as LaTeX in $...$. Mark any word you cannot read as [?].',
    'When you are not sure of a word, write your best guess followed by [?] with no space, like house[?].',
].join('\n')

const MEDIA_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
}

/** The backend a target names: an explicit id wins; `auto` follows the chat provider setting
 *  (itself possibly `auto`, then the first installed backend). */
export function resolveAiBackend(
    target: AiTarget,
    chatProvider: unknown,
    installed: () => readonly string[],
): BackendId {
    if (isBackendId(target.provider)) return target.provider
    return resolveBackendId(
        target.provider === AUTO_PROVIDER ? undefined : target.provider,
        chatProvider,
        installed,
    )
}

export async function aiTranscribe(
    images: { page: number; path: string }[],
    target: AiTarget & { chatProvider?: unknown },
    deps: {
        installed?: () => readonly string[]
        runTurn?: (turn: HeadlessTurn) => Promise<string>
    } = {},
): Promise<PageText[]> {
    const installed = deps.installed ?? (() => installedBackendIds())
    const id = resolveAiBackend(target, target.chatProvider, installed)
    const label = BACKENDS[id].label
    if (!installed().includes(id)) {
        throw new AppError('AI_UNAVAILABLE', `${label} is not installed on this machine`, 503)
    }
    if (!can(id, 'images')) {
        throw new AppError('AI_UNAVAILABLE', `${label} cannot read images`, 503)
    }
    const run = deps.runTurn ?? runHeadlessTurn
    const dir = await mkdtemp(join(tmpdir(), 'bismuth-transcribe-'))
    try {
        const out: PageText[] = []
        for (const img of images) {
            const media_type = MEDIA_TYPES[extname(img.path).toLowerCase()] ?? 'image/png'
            const data = (await readFile(img.path)).toString('base64')
            const text = await run({
                backend: id,
                ...(target.model ? { model: target.model } : {}),
                cwd: dir,
                text: TRANSCRIBE_PROMPT,
                images: [{ media_type, data }],
            })
            // The reader's guess marks become checks; an unreadable word's [?] stays in the text.
            const read = aiChecks(text.trim())
            out.push(read.checks.length ? { page: img.page, ...read } : { page: img.page, text: read.text })
        }
        return out
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}
