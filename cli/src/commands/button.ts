// The `button` command group: the CLI twin of a ```button fence (core/src/buttons). Both commands
// run HEADLESSLY against the vault's files, like `page`: `list` reads the note and the state
// sidecars, `press` calls pressButton directly (the HTTP route's owner token does not apply). Only
// a prompt button can be pressed here; send and command buttons need the running app.
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { CommandMap } from '../types'
import { requireVault, positionals, fail, out } from '../args'
import {
    buttonKey,
    parseButtonBlock,
    scanButtonFences,
} from '../../../core/src/buttons/buttonBlock'
import {
    pressButton,
    readButtonStates,
} from '../../../core/src/buttons/buttonState'
import type { ButtonHost } from '../../../core/src/buttons/buttonTypes'

type Entry = {
    fence: number
    index?: number
    label?: string
    type?: string
    key?: string
    status?: string
    error?: string
    body: string
}

/** Every button of every fence in the note, with its stored status. An invalid fence is one entry
 *  carrying `error`. */
function entriesOf(
    vault: string,
    note: string,
): { entries: Entry[]; notePath: string } {
    const full = resolve(vault, note)
    const rel = relative(resolve(vault), full)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
        fail(`${note} is outside the vault — pass a vault-relative note path`)
    if (!existsSync(full))
        fail(`no note at ${note} in the vault — run \`bismuth tree\` to list notes`)
    const notePath = rel.split(sep).join('/')
    const host: ButtonHost = { kind: 'note', path: notePath }
    const fences = scanButtonFences(readFileSync(full, 'utf8'))
    const entries: Entry[] = []
    fences.forEach((f, fence) => {
        const block = parseButtonBlock(f.body)
        if (block.error) {
            entries.push({ fence, error: block.error, body: f.body })
            return
        }
        block.buttons.forEach((b, index) =>
            entries.push({
                fence,
                index,
                label: b.label,
                type: b.action.type,
                key: buttonKey(host, f.body, index),
                body: f.body,
            }),
        )
    })
    const states = readButtonStates(
        vault,
        entries.flatMap(e => (e.key ? [e.key] : [])),
    )
    for (const e of entries)
        if (e.key) e.status = states[e.key]?.status ?? 'idle'
    return { entries, notePath }
}

export const commands: CommandMap = {
    'button list': {
        summary:
            'List the ```button fences in a note: each button with its label, action type, key and status',
        usage: '<note> [--vault <dir>] [--pretty]',
        run: args => {
            const [note] = positionals(args)
            if (!note) fail('usage: bismuth button list <note> [--vault <dir>]')
            out(
                entriesOf(requireVault(args), note).entries.map(
                    ({ body: _body, ...rest }) => rest,
                ),
                args,
            )
        },
    },
    'button press': {
        summary:
            'Press a prompt button by label (the daemon runs its prompt); send and command buttons run in the app',
        usage: '<note> <label...> [--vault <dir>] [--pretty]',
        run: args => {
            const [note, ...words] = positionals(args)
            const label = words.join(' ').trim()
            if (!note || !label)
                fail('usage: bismuth button press <note> <label> [--vault <dir>]')
            const vault = requireVault(args)
            const { entries: all, notePath } = entriesOf(vault, note)
            const hits = all.filter(
                e => e.label?.toLowerCase() === label.toLowerCase(),
            )
            const known = all
                .filter(e => e.label !== undefined)
                .map(e => `"${e.label}"`)
                .join(', ')
            if (!hits.length)
                fail(
                    `no button labelled "${label}" in ${note}` +
                        (known
                            ? ` — buttons here: ${known}`
                            : ' — the note has no valid button; run `bismuth button list` to see why'),
                )
            if (hits.length > 1)
                fail(
                    `${hits.length} buttons in ${note} are labelled "${label}" (fences ${hits
                        .map(h => h.fence)
                        .join(', ')}) — rename one so the label is unique`,
                )
            const hit = hits[0]
            if (hit.type !== 'prompt')
                fail(`a ${hit.type} button runs in the app; press it there`)
            const result = pressButton(vault, {
                host: { kind: 'note', path: notePath },
                body: hit.body,
                index: hit.index as number,
            })
            out(result, args)
            if (!result.ok) process.exit(1)
        },
    },
}
