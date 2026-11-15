// core/src/chatProviders/codex/codexBudget.ts
// Pure: how much a codex chat opens with, given the loaded context window of a local model. Twin of
// ../claudeBudget.ts. Codex's own opening is 11,795 tokens (base instructions 4,396, tools 5,915:
// multi_agent 2,537, goals 819, the Bismuth namespace 985, ...) and `model_context_window` only
// sizes its budgets, so an 8192 window failed on the first request. The lean profile switches off
// the multi-agent and goals tools and web search, replaces the base instructions with a short
// prompt, and arms auto-compaction explicitly. Measured against codex@mock, codex-cli 0.169.0
// (diag3-windows #2): 8,497 with the features off, 4,228 with the short base prompt too.

import { CHAT_GROWTH_TOKENS } from '../claudeBudget'

export type CodexTier = 'full' | 'lean'

/** The opening request of a full-profile codex chat, measured against codex@mock (diag3 #2). */
export const CODEX_FULL_OPENING_TOKENS = 11_800

/** The lean profile's opening: 4,228 with a 39-token base prompt; rounded up for the longer one. */
export const CODEX_LEAN_OPENING_TOKENS = 4_400

/** The tier for a loaded window: `full` when the full opening plus a chat's growth fits, else
 *  `lean`. `null` (a cloud model, a server that reports no window) is `full`. */
export function codexTier(window: number | null | undefined): CodexTier {
    if (!window) return 'full'
    return window >= CODEX_FULL_OPENING_TOKENS + CHAT_GROWTH_TOKENS
        ? 'full'
        : 'lean'
}

/**
 * Codex compacts from server-reported usage once it passes this; `model_context_window` alone does
 * not arm it for a model outside its catalog. Three quarters of the window leaves the next turn and
 * the reply room (6,144 at 8192, where the probe compacted at 6,000), and never less than the lean
 * opening plus a margin, so a tiny window still gets one turn before it compacts.
 */
export function codexCompactLimit(window: number): number {
    return Math.max(
        Math.floor(window * 0.75),
        CODEX_LEAN_OPENING_TOKENS + 512,
    )
}

/** The short base prompt of the lean profile: what codex's 4,396-token one says that a vault chat
 *  needs (use the shell, edit with patches, report briefly), then the shared chat instructions, so
 *  the daemon name and the CLI note stay. */
export function codexLeanBasePrompt(instructions: string): string {
    return [
        'You are a coding agent. Use the shell tool to read and search files and to run commands, and edit files with apply_patch. Keep going until the task is done, then answer briefly.',
        instructions,
    ].join('\n\n')
}

/** A TOML basic string (the same escaping the driver uses). */
const toml = (s: string) =>
    JSON.stringify(s.toWellFormed()).replace(/\x7f/g, '\\u007f')

/**
 * The per-exec `--config` args of the lean profile, `[]` for the full tier. `promptFile` is the
 * short base prompt Bismuth wrote in its own dir (never ~/.codex). The Bismuth MCP server is not
 * touched here: it stays.
 */
export function codexLeanArgs(
    window: number | null | undefined,
    promptFile: string,
): string[] {
    if (!window || codexTier(window) === 'full') return []
    return [
        '--config',
        'features.multi_agent=false',
        '--config',
        'features.goals=false',
        '--config',
        'web_search="disabled"',
        '--config',
        `model_instructions_file=${toml(promptFile)}`,
        '--config',
        `model_auto_compact_token_limit=${codexCompactLimit(window)}`,
    ]
}

/** The error codex's compaction hits when the user messages it keeps verbatim outgrow a small window
 *  ("tokens to keep from the initial prompt is greater than the context length", diag3-windows #2).
 *  Matched on the message text of an error frame or stderr. */
export function isCodexWindowOverflow(text: string): boolean {
    return /tokens to keep from the initial prompt is greater than the context length/i.test(
        text,
    )
}

export type CodexChatLine = { role: 'user' | 'assistant'; text: string }

/** Tokens a condensed chat may take: a quarter of the window, and never more than what is left
 *  after the lean opening and room for the reply and the new message; never under 256. */
export function codexSummaryBudget(window: number): number {
    return Math.max(
        256,
        Math.min(
            Math.floor(window * 0.25),
            window - CODEX_LEAN_OPENING_TOKENS - 1_024,
        ),
    )
}

/** Longest a single earlier message may run in the summary, in characters. */
const CONDENSED_LINE_CHARS = 400

/**
 * Pure: the chat so far as a short seed for a fresh codex session. Newest messages first claim the
 * budget (about 3 characters a token), each cut to a few hundred characters; older ones that no
 * longer fit are dropped and counted. `''` for an empty chat.
 */
export function condenseChat(
    lines: readonly CodexChatLine[],
    tokenBudget: number,
): string {
    if (!lines.length) return ''
    let left = tokenBudget * 3
    const kept: string[] = []
    let dropped = 0
    for (let i = lines.length - 1; i >= 0; i--) {
        const flat = lines[i].text.replace(/\s+/g, ' ').trim()
        const cut =
            flat.length > CONDENSED_LINE_CHARS
                ? `${flat.slice(0, CONDENSED_LINE_CHARS)}...`
                : flat
        const row = `${lines[i].role}: ${cut}`
        if (row.length > left) {
            dropped = i + 1
            break
        }
        left -= row.length + 1
        kept.unshift(row)
    }
    return [
        'The chat so far, condensed to fit the model window:',
        ...(dropped ? [`(${dropped} earlier messages omitted)`] : []),
        ...kept,
    ].join('\n')
}

/** The first message of the fresh session: the condensed chat in a `<bismuth-condensed-chat>` block
 *  (codexHistory.ts strips it when the thread is replayed, so it never shows as typed text or titles
 *  the history row), then the new message. */
export function codexSeededPrompt(summary: string, text: string): string {
    return summary
        ? `<bismuth-condensed-chat>\n${summary}\n</bismuth-condensed-chat>\n\n${text}`
        : text
}
