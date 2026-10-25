// core/test/buttonBlock.test.ts — the pure ```button parser, fence scanner and key.
import { test, expect } from 'bun:test'
import {
    parseButtonBlock,
    buttonKey,
    hostString,
    scanButtonFences,
    BUTTON_FENCE_LANG,
} from '../src/buttons/buttonBlock'

const note = { kind: 'note', path: 'a.md' } as const

test('a mapping parses to one button with defaults', () => {
    const b = parseButtonBlock('label: go\nprompt: do it')
    expect(b.error).toBeNull()
    expect(b.buttons).toEqual([
        {
            label: 'go',
            kind: 'default',
            action: {
                type: 'prompt',
                prompt: 'do it',
                model: 'haiku',
                timeoutSecs: 300,
            },
        },
    ])
})

test('a list parses in source order with every action type', () => {
    const b = parseButtonBlock(
        [
            '- label: one',
            '  kind: primary',
            '  prompt: p',
            '  model: sonnet',
            '  timeout: 60',
            '- label: two',
            '  send: hello',
            '- label: three',
            '  kind: danger',
            '  command: open-daemon',
        ].join('\n'),
    )
    expect(b.error).toBeNull()
    expect(b.buttons.map(x => x.action.type)).toEqual([
        'prompt',
        'send',
        'command',
    ])
    expect(b.buttons[0]).toMatchObject({
        kind: 'primary',
        action: { model: 'sonnet', timeoutSecs: 60 },
    })
    expect(b.buttons[2]!.kind).toBe('danger')
})

const errorCases: [string, string, string][] = [
    ['empty body', '', 'empty'],
    ['whitespace body', '  \n', 'empty'],
    ['bad yaml', 'label: [', 'not valid yaml'],
    ['no label', 'prompt: x', 'label is required'],
    ['blank label', 'label: " "\nprompt: x', 'label is required'],
    ['no action', 'label: a', 'needs exactly one of prompt, send, command'],
    [
        'two actions',
        'label: a\nprompt: x\nsend: y',
        'needs exactly one of prompt, send, command',
    ],
    [
        'model on send',
        'label: a\nsend: x\nmodel: opus',
        'model only works with prompt',
    ],
    [
        'timeout on command',
        'label: a\ncommand: open-daemon\ntimeout: 5',
        'timeout only works with prompt',
    ],
    [
        'timeout zero',
        'label: a\nprompt: x\ntimeout: 0',
        'timeout must be a whole number of seconds from 1 to 3600',
    ],
    [
        'timeout too big',
        'label: a\nprompt: x\ntimeout: 3601',
        'timeout must be a whole number of seconds from 1 to 3600',
    ],
    [
        'timeout fraction',
        'label: a\nprompt: x\ntimeout: 1.5',
        'timeout must be a whole number of seconds from 1 to 3600',
    ],
    [
        'bad kind',
        'label: a\nprompt: x\nkind: loud',
        'kind must be primary, default or danger',
    ],
    [
        'unknown command',
        'label: a\ncommand: open-daemn',
        'unknown command open-daemn',
    ],
    [
        'blocked command',
        'label: a\ncommand: quick-ask',
        "quick-ask can't run from a button",
    ],
]
for (const [name, body, error] of errorCases) {
    test(`error: ${name}`, () => {
        expect(parseButtonBlock(body)).toEqual({ buttons: [], error })
    })
}

test('the first problem in a list wins and no buttons survive', () => {
    const b = parseButtonBlock('- label: ok\n  send: x\n- label: bad')
    expect(b.buttons).toEqual([])
    expect(b.error).toBe('needs exactly one of prompt, send, command')
})

test('buttonKey is 16 hex chars, stable, and changes with any input', () => {
    const k = buttonKey(note, 'label: a', 0)
    expect(k).toMatch(/^[0-9a-f]{16}$/)
    expect(buttonKey({ kind: 'note', path: 'a.md' }, 'label: a', 0)).toBe(k)
    expect(buttonKey({ kind: 'note', path: 'b.md' }, 'label: a', 0)).not.toBe(k)
    expect(buttonKey({ kind: 'chat', chatId: 'a.md' }, 'label: a', 0)).not.toBe(
        k,
    )
    expect(buttonKey(note, 'label: b', 0)).not.toBe(k)
    expect(buttonKey(note, 'label: a', 1)).not.toBe(k)
})

test('hostString names both hosts', () => {
    expect(hostString(note)).toBe('note:a.md')
    expect(hostString({ kind: 'chat', chatId: 'c1' })).toBe('chat:c1')
})

test('scanButtonFences finds button fences with offsets and bodies', () => {
    expect(BUTTON_FENCE_LANG).toBe('button')
    const md =
        'intro\n```button\nlabel: a\nsend: x\n```\ntext\n```js\nno\n```\n~~~button\nlabel: b\nsend: y\n~~~\n'
    const f = scanButtonFences(md)
    expect(f.map(x => x.body)).toEqual([
        'label: a\nsend: x',
        'label: b\nsend: y',
    ])
    expect(md.slice(f[0]!.from, f[0]!.to)).toBe(
        '```button\nlabel: a\nsend: x\n```',
    )
})

test('an unclosed fence is not reported and an empty fence has an empty body', () => {
    expect(scanButtonFences('```button\nlabel: a')).toEqual([])
    expect(scanButtonFences('```button\n```')[0]!.body).toBe('')
})
