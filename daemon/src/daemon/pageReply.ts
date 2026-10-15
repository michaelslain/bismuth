// Reads a plain-language reply to an inbox page (core/src/daemonPages.ts's replyToPage — from the
// app's reply field, `bismuth page reply`, or an email) and turns it into ONE of three outcomes:
// press a button, press it with a rewritten draft, or ask a question back. A reply that is exactly
// a button's id or label is pressed without a model call. Anything else goes to one short model
// call that only CLASSIFIES — it is told not to act — and its answer is validated against the
// page's own buttons, so a misread can at worst press one of them, never run anything new.
// The press itself goes through core's resolvePage, the same path as a click.

/** The page as the reader needs it — a structural subset of core's DaemonPage. */
export interface ReplyPage {
    title: string
    body: string
    actions: Array<{ id: string; label: string; prompt?: string }>
    thread: Array<{ from: 'you' | 'daemon'; text: string }>
}

export type ReplyDecision =
    | { kind: 'press'; actionId: string; draft: string | null }
    | { kind: 'ask'; question: string }

/** The action a reply names outright, by id or label, ignoring case, brackets and end punctuation. */
export function exactAction<A extends { id: string; label: string }>(
    actions: A[],
    reply: string,
): A | undefined {
    const c = reply
        .trim()
        .replace(/^[[(\s]+|[\])\s.!]+$/g, '')
        .trim()
        .toLowerCase()
    if (!c || c.includes('\n')) return undefined
    return (
        actions.find(a => a.id.toLowerCase() === c) ??
        actions.find(a => a.label.toLowerCase() === c)
    )
}

/** The classification prompt. The model answers with one JSON object and does nothing else. */
export function buildReplyPrompt(page: ReplyPage, reply: string): string {
    const buttons = page.actions
        .map(
            a =>
                `- id "${a.id}", label "${a.label}": ${a.prompt ? `approves; the daemon will then do: ${a.prompt}` : 'closes the page without doing anything'}`,
        )
        .join('\n')
    const earlier = page.thread
        .slice(0, -1)
        .map(t => `${t.from === 'you' ? 'User' : 'You asked'}: ${t.text}`)
        .join('\n')
    return [
        'You are reading the user\'s reply to an inbox page you wrote, to work out which of its buttons they mean.',
        'Do NOT carry out anything, call no tools, and read no files. Your whole answer is ONE JSON object and nothing else.',
        '',
        `Page title: ${page.title}`,
        'Page draft (between the lines):',
        '-----',
        page.body.trim() || '(empty)',
        '-----',
        'Buttons:',
        buttons || '(none)',
        ...(earlier ? ['', 'Earlier in this conversation:', earlier] : []),
        '',
        `The user's reply: ${reply}`,
        '',
        'Answer with exactly one of:',
        '{"decision":"press","action":"<button id>","draft":null}',
        '  when the reply clearly means one button and leaves the draft as it is;',
        '{"decision":"press","action":"<button id>","draft":"<the whole new draft>"}',
        '  when it means a button AND asks for changes to the draft: write the complete draft with their changes applied;',
        '{"decision":"ask","question":"<one short question>"}',
        '  when you cannot tell which button they mean, or they asked something instead of deciding.',
        'Prefer asking over guessing when an approve button would act on something the user has not clearly agreed to.',
    ].join('\n')
}

/** Validate the model's answer against the page. Anything malformed or naming a button the page
 *  does not have becomes a question, never a press. */
export function parseDecision(
    text: string,
    actions: Array<{ id: string }>,
): ReplyDecision {
    const fallback: ReplyDecision = {
        kind: 'ask',
        question: `I couldn't tell what you meant. Reply with one of: ${actions.map(a => a.id).join(', ')}, or say what to change.`,
    }
    const m = /\{[\s\S]*\}/.exec(text)
    if (!m) return fallback
    let raw: Record<string, unknown>
    try {
        raw = JSON.parse(m[0])
    } catch {
        return fallback
    }
    if (raw.decision === 'ask' && typeof raw.question === 'string' && raw.question.trim())
        return { kind: 'ask', question: raw.question.trim() }
    if (raw.decision === 'press' && typeof raw.action === 'string') {
        const action = actions.find(a => a.id === raw.action)
        if (!action) return fallback
        const draft =
            typeof raw.draft === 'string' && raw.draft.trim() ? raw.draft.trim() : null
        return { kind: 'press', actionId: action.id, draft }
    }
    return fallback
}

/** Replace the body of a page file, keeping its frontmatter byte for byte. */
export function replaceBody(raw: string, body: string): string {
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(raw)
    const fm = m ? m[0] : ''
    return `${fm}\n${body.replace(/\s+$/, '')}\n`
}
