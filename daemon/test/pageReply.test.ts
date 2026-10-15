import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    createDaemonPage,
    listDaemonPages,
    readPageState,
    replyToPage,
} from '../../core/src/daemonPages.ts'
import { vaultPaths, type VaultContext } from '../src/lib/config'
import {
    buildReplyPrompt,
    exactAction,
    parseDecision,
    replaceBody,
} from '../src/daemon/pageReply'
import { readReply, type PageState } from '../src/daemon/pages'

const actions = [
    { id: 'send', label: 'Send replies', prompt: 'Send each reply.' },
    { id: 'discard', label: 'Discard' },
]

describe('exactAction', () => {
    test('a reply that is a button id or label, in any case', () => {
        expect(exactAction(actions, 'SEND')?.id).toBe('send')
        expect(exactAction(actions, '[ send replies ]')?.id).toBe('send')
        expect(exactAction(actions, 'discard.')?.id).toBe('discard')
    })
    test('anything longer goes to the model', () => {
        expect(exactAction(actions, 'yes send it')).toBeUndefined()
        expect(exactAction(actions, 'send\nbut change it')).toBeUndefined()
        expect(exactAction(actions, '')).toBeUndefined()
    })
})

describe('parseDecision', () => {
    test('a press of a real button, with or without a draft', () => {
        expect(parseDecision('{"decision":"press","action":"send","draft":null}', actions)).toEqual({
            kind: 'press',
            actionId: 'send',
            draft: null,
        })
        expect(
            parseDecision('Sure.\n{"decision":"press","action":"send","draft":"New text"}', actions),
        ).toEqual({ kind: 'press', actionId: 'send', draft: 'New text' })
    })
    test('a question', () => {
        expect(parseDecision('{"decision":"ask","question":"Send to Jane only?"}', actions)).toEqual({
            kind: 'ask',
            question: 'Send to Jane only?',
        })
    })
    test('a made-up button, junk or empty answer becomes a question, never a press', () => {
        for (const text of [
            '{"decision":"press","action":"delete-everything"}',
            'not json',
            '{"decision":"ask","question":""}',
            '{broken',
        ]) {
            const d = parseDecision(text, actions)
            expect(d.kind).toBe('ask')
        }
    })
})

test('the prompt lists the buttons, the draft, the reply and the earlier thread', () => {
    const p = buildReplyPrompt(
        {
            title: 'Reply drafts ready',
            body: 'Reply to Jane: fine.',
            actions,
            thread: [
                { from: 'you', text: 'maybe' },
                { from: 'daemon', text: 'Send it?' },
                { from: 'you', text: 'yes' },
            ],
        },
        'yes',
    )
    expect(p).toContain('id "send", label "Send replies": approves; the daemon will then do: Send each reply.')
    expect(p).toContain('id "discard", label "Discard": closes the page')
    expect(p).toContain('Reply to Jane: fine.')
    expect(p).toContain('User: maybe\nYou asked: Send it?')
    expect(p).toContain("The user's reply: yes")
    expect(p).toContain('Do NOT carry out anything')
})

test('replaceBody keeps the frontmatter byte for byte', () => {
    const raw = '---\ntype: daemon-page\nactions:\n  - id: a\n    label: A\n---\n\nold\n'
    expect(replaceBody(raw, 'new draft\n\n')).toBe(
        '---\ntype: daemon-page\nactions:\n  - id: a\n    label: A\n---\n\nnew draft\n',
    )
})

describe('a reply through core, read by the daemon', () => {
    let root: string
    let ctx: VaultContext
    const path = '.daemon/pages/reply-drafts.md'
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'page-reply-'))
        ctx = vaultPaths(root, 'Ada')
        createDaemonPage(root, {
            slug: 'reply-drafts',
            title: 'Reply drafts ready',
            body: 'Reply to Jane: Q3 budget looks fine.',
            actions: [
                { id: 'send', label: 'Send replies', kind: 'primary', prompt: 'Send each reply.' },
                { id: 'discard', label: 'Discard', kind: 'danger' },
            ],
        })
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    const state = () => readPageState(root, 'reply-drafts') as PageState
    const noModel = async () => {
        throw new Error('the model must not be called')
    }

    test('replyToPage marks the page as reading and drops a trigger', () => {
        expect(replyToPage(root, path, '  yes  ')).toEqual({ status: 'working', alreadyResolved: false })
        expect(state().reply?.text).toBe('yes')
        expect(state().thread).toHaveLength(1)
        expect(existsSync(join(ctx.pageTriggerDir, 'reply-drafts'))).toBe(true)
        expect(listDaemonPages(root, 90)[0]?.replying).toBe(true)
        expect(replyToPage(root, path, 'again').alreadyResolved).toBe(true)
        expect(() => replyToPage(root, path, '   ')).toThrow()
    })

    test('a button name is pressed without the model', async () => {
        replyToPage(root, path, 'send')
        await readReply(ctx, 'reply-drafts', state(), noModel)
        expect(state().status).toBe('working')
        expect(state().prompt).toBe('Send each reply.')
        expect(state().reply).toBeUndefined()
        expect(state().thread?.map(t => t.text)).toEqual(['send'])
    })

    test('a reply that changes the draft rewrites it, then presses', async () => {
        replyToPage(root, path, 'yes but tell her Q3 is fine and to ship it')
        await readReply(ctx, 'reply-drafts', state(), async prompt => {
            expect(prompt).toContain('yes but tell her')
            return '{"decision":"press","action":"send","draft":"Reply to Jane: Q3 is fine, ship it."}'
        })
        expect(state().status).toBe('working')
        expect(state().pressedAction).toBe('send')
        const raw = readFileSync(join(root, path), 'utf8')
        expect(raw).toContain('Reply to Jane: Q3 is fine, ship it.')
        expect(raw).toContain('prompt: Send each reply.')
    })

    test('a dismissing reply closes the page', async () => {
        replyToPage(root, path, 'nah forget it')
        await readReply(ctx, 'reply-drafts', state(), async () => '{"decision":"press","action":"discard","draft":null}')
        expect(state().status).toBe('dismissed')
    })

    test('an unclear reply asks back and waits for the user again', async () => {
        replyToPage(root, path, 'hmm')
        await readReply(ctx, 'reply-drafts', state(), async () => '{"decision":"ask","question":"Send it as is?"}')
        expect(state().status).toBe('pending')
        expect(state().thread?.map(t => [t.from, t.text])).toEqual([
            ['you', 'hmm'],
            ['daemon', 'Send it as is?'],
        ])
        // the next reply carries the conversation
        replyToPage(root, path, 'yes')
        await readReply(ctx, 'reply-drafts', state(), async prompt => {
            expect(prompt).toContain('User: hmm\nYou asked: Send it as is?')
            return '{"decision":"press","action":"send","draft":null}'
        })
        expect(state().status).toBe('working')
        expect(state().thread).toHaveLength(3)
    })

    test('a model failure becomes a question, not a press', async () => {
        replyToPage(root, path, 'whatever')
        await readReply(ctx, 'reply-drafts', state(), async () => {
            throw new Error('timeout')
        })
        expect(state().status).toBe('pending')
        expect(state().thread?.at(-1)?.text).toContain("couldn't read your reply")
    })
})
