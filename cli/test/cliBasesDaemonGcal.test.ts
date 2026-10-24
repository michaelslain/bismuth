import { expect, mock, spyOn } from 'bun:test'
import {
    mkdtempSync,
    rmSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeVault, tempDir } from '../../core/test/helpers'
import { parseBaseFile } from '../../core/src/bases/parse'
import { manifestKey } from '../../core/src/gcal/manifest'
import {
    isolateCliEnv,
    mockUpdateServer,
    runCli,
    spawnCli,
    test,
} from './cliHarness'

isolateCliEnv()

// --- `base create` (base.ts) -------------------------------------------------------------------

test('`base create --view kanban --group-by ...` writes a file that parses back with the kanban view + defaults', async () => {
    const vault = makeVault({})
    const { parseBaseFile } = await import('../../core/src/bases/parse')
    const { readNote } = await import('../../core/src/files')

    const result = await runCli(
        vault,
        'base',
        'create',
        'Board.md',
        '--view',
        'kanban',
        '--group-by',
        'note.status',
    )
    expect(result.code).toBe(0)
    expect(result.json).toMatchObject({
        ok: true,
        path: 'Board.md',
        view: 'kanban',
        source: 'notes',
    })
    expect(result.json.missing).toBeUndefined() // groupBy was supplied — nothing left to fill in

    const text = await readNote(vault, 'Board.md')
    const { config } = parseBaseFile(text, { name: 'Board', path: 'Board.md' })
    expect(text).not.toContain('views:') // the flat spelling, never a views list
    expect(text).toContain('view: kanban')
    expect(config.view.type).toBe('kanban')
    expect(config.view.groupBy).toEqual({
        property: 'note.status',
        direction: 'ASC',
    })
    expect(config.source).toEqual({ kind: 'notes' }) // --source omitted -> defaults to "notes"
})

test('`base create --view gantt` (not a real view kind) fails and names the valid kinds', async () => {
    const vault = makeVault({})
    const { VIEW_TYPES } = await import('../../core/src/bases/types')

    const result = await runCli(
        vault,
        'base',
        'create',
        'Board.md',
        '--view',
        'gantt',
    )
    expect(result.code).toBe(1)
    for (const kind of VIEW_TYPES) expect(result.err).toContain(kind)
})

test('`base create --view kanban` without --group-by still writes the file, but reports the missing key', async () => {
    const vault = makeVault({})
    const { parseBaseFile } = await import('../../core/src/bases/parse')
    const { readNote } = await import('../../core/src/files')

    const result = await runCli(
        vault,
        'base',
        'create',
        'Board.md',
        '--view',
        'kanban',
    )
    expect(result.code).toBe(0)
    expect(result.json.missing).toEqual(['groupBy'])
    expect(result.json.note).toContain('groupBy')

    // The view still parses — groupBy is present with a blank property, not omitted entirely
    // (an omitted groupBy would make the board silently render a hint message instead of data).
    const text = await readNote(vault, 'Board.md')
    const { config } = parseBaseFile(text, { name: 'Board', path: 'Board.md' })
    expect(config.view.groupBy).toEqual({ property: '', direction: 'ASC' })
})

test('`base create` reports missing config for map (lat/lng) and chart (x) views too, cleared once supplied', async () => {
    const vault = makeVault({})

    const map = await runCli(
        vault,
        'base',
        'create',
        'Atlas.md',
        '--view',
        'map',
    )
    expect(map.code).toBe(0)
    expect(map.json.missing).toEqual(['lat', 'lng'])

    const bar = await runCli(
        vault,
        'base',
        'create',
        'Chart.md',
        '--view',
        'bar',
    )
    expect(bar.code).toBe(0)
    expect(bar.json.missing).toEqual(['x'])

    const mapFilled = await runCli(
        vault,
        'base',
        'create',
        'Atlas2.md',
        '--view',
        'map',
        '--lat',
        'latitude',
        '--lng',
        'longitude',
    )
    expect(mapFilled.code).toBe(0)
    expect(mapFilled.json.missing).toBeUndefined()
})

test('`base create` refuses to clobber an existing file', async () => {
    const vault = makeVault({})
    expect(
        (await runCli(vault, 'base', 'create', 'Board.md', '--view', 'table'))
            .code,
    ).toBe(0)
    expect(
        (await runCli(vault, 'base', 'create', 'Board.md', '--view', 'table'))
            .code,
    ).toBe(1)
})

// --- `base migrate-queries` (base.ts) ------------------------------------------------------------

// Task 10 removed `migrateQueryBody`'s refusal to translate a `sort by priority` DSL line
// into a modern `sort:` key — that refusal existed only because the general Bases sort
// path used to rank priority alphabetically. Prove the refusal is actually gone end to
// end: nothing in core/test/bases/taskDsl.test.ts exercises migrateQueryBody (it's a CLI
// function, and translateTaskDsl never had a priority-specific refusal to begin with —
// SORT_BY_RE always matched `priority`), so this is the only test that would fail if the
// refusal line were re-added.
test('`base migrate-queries` writes a priority sort instead of refusing to convert the block', async () => {
    const noteBody = [
        '# Inbox',
        '',
        '```query',
        'tasks: sort by priority',
        '```',
        '',
    ].join('\n')
    const vault = makeVault({ 'Inbox.md': noteBody })
    const { readNote } = await import('../../core/src/files')

    const result = await runCli(vault, 'base', 'migrate-queries')
    expect(result.code).toBe(0)
    expect(result.json.changed).toBe(1)
    expect(result.json.unconvertible).toEqual([])

    const text = await readNote(vault, 'Inbox.md')
    expect(text).toContain('sort: note.priority')
    expect(text).not.toContain('sort by priority')
})

// --- `base validate` (base.ts) -------------------------------------------------------------------

test('`base validate` on a base with an unknown view type reports it AND exits non-zero', async () => {
    const vault = makeVault({
        'Bad.md': '---\ntype: base\nview: gantt\n---\n',
    })
    const result = await runCli(vault, 'base', 'validate', 'Bad.md')
    expect(result.code).toBe(1)
    expect(result.json.ok).toBe(false)
    expect(result.json.errors.some((e: string) => e.includes('gantt'))).toBe(
        true,
    )
    expect(
        result.json.errors.some((e: string) =>
            e.includes('not a valid view type'),
        ),
    ).toBe(true)
})

test('`base validate` on a well-formed base returns ok: true, exit 0', async () => {
    const vault = makeVault({
        'Good.md': '---\ntype: base\nsource: notes\nview: table\n---\n',
    })
    const result = await runCli(vault, 'base', 'validate', 'Good.md')
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ ok: true, errors: [] })
})

test('`base validate` flags a declared property default that fails its own type', async () => {
    const vault = makeVault({
        'Typed.md':
            '---\ntype: base\nproperties:\n  - name: age\n    type: number\n    default: not-a-number\nview: table\n---\n',
    })
    const result = await runCli(vault, 'base', 'validate', 'Typed.md')
    expect(result.code).toBe(1)
    expect(result.json.ok).toBe(false)
    expect(
        result.json.errors.some((e: string) =>
            e.includes('properties.age.default'),
        ),
    ).toBe(true)
})

test("`base validate` flags a source ref that doesn't resolve to a file in the vault", async () => {
    const vault = makeVault({
        'Composed.md':
            "---\ntype: base\nsource:\n  kind: base\n  ref: '[[Nonexistent]]'\nview: table\n---\n",
    })
    const result = await runCli(vault, 'base', 'validate', 'Composed.md')
    expect(result.code).toBe(1)
    expect(result.json.ok).toBe(false)
    expect(
        result.json.errors.some((e: string) => e.includes('Nonexistent')),
    ).toBe(true)
})

test('`base validate` flags an expression a yaml comment truncated', async () => {
    const vault = makeVault({
        'B.md': [
            '---',
            'type: base',
            'filters: tags.contains(" #book")',
            'view: table',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'B.md')
    expect(result.code).toBe(1)
    expect(result.json.ok).toBe(false)
    const joined = result.json.errors.join('\n')
    expect(joined).toMatch(/filters/)
    expect(joined).toMatch(/comment/i)
    // The message has to name the FIX, not just the symptom.
    expect(joined).toMatch(/quote/i)
})

test('`base validate` does not flag a hashtag with no space before it', async () => {
    const vault = makeVault({
        'B.md': '---\ntype: base\nfilters: tags.contains("#book")\n---\n',
    })
    const result = await runCli(vault, 'base', 'validate', 'B.md')
    expect(result.code).toBe(0)
    expect(result.json.ok).toBe(true)
})

test('`base validate` on a truncated `and:` leaf suggests quoting the VALUE, not replacing the list', async () => {
    // `key` for a bare sequence item is the nearest ENCLOSING key ("and"), not the item's own
    // — it has none. A fix printed as `and: '<value>'` would tell a reader to replace the
    // whole two-item list with a single string, silently dropping `status == "done"`.
    const vault = makeVault({
        'B.md': [
            '---',
            'type: base',
            'filters:',
            '  and:',
            '    - tags.contains(" #book")',
            '    - status == "done"',
            'view: table',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'B.md')
    expect(result.code).toBe(1)
    const joined = result.json.errors.join('\n')
    expect(joined).toMatch(/quote/i)
    // Must NOT print a `key: value`-shaped replacement for the enclosing list key.
    expect(joined).not.toMatch(/and:\s*'/)
    // The suggested fix is the quoted truncated expression on its own, with the real
    // whitespace before the "#" reproduced — not silently dropped (that used to read
    // '...contains("#book")' here, missing the space that caused the truncation).
    expect(joined).toMatch(/'tags\.contains\(" #book"\)'/)
})

test('`base validate` names the FILE line for a yaml comment truncation, not the frontmatter-relative one', async () => {
    // The `---` delimiters sit on file lines 1 and 7; the filter itself is file line 4, but
    // findCommentTruncations only ever sees the BODY between the delimiters, where that same
    // line is line 3. The message has to say 4 — a reader opens their editor to the file, not
    // to an internal slice of it.
    const vault = makeVault({
        'Multi.md': [
            '---',
            'type: base',
            'source: notes',
            'filters: tags.contains(" #book")',
            'view: table',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'Multi.md')
    expect(result.code).toBe(1)
    const joined = result.json.errors.join('\n')
    expect(joined).toMatch(/\(line 4\)/)
    expect(joined).not.toMatch(/\(line 3\)/)
})

test('`base validate` suggested fix reproduces real internal whitespace exactly', async () => {
    // Two spaces before the "#", both meaningful to the expression. A fix that collapses
    // them to zero (`kept + dropped`, dropping the whitespace that triggered the truncation)
    // parses fine but silently matches something else than what the user wrote.
    const vault = makeVault({
        'B.md': [
            '---',
            'type: base',
            'filters: description.contains("a  #b")',
            'view: table',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'B.md')
    expect(result.code).toBe(1)
    const msg = result.json.errors.find((e: string) => /comment/i.test(e))
    expect(msg).toBeDefined()
    const suggestion = msg?.match(/whole: (.+)$/)?.[1]
    expect(suggestion).toBe(`'description.contains("a  #b")'`)
})

test('`base validate` suggested fix escapes an embedded apostrophe and round-trips through real YAML', async () => {
    const vault = makeVault({
        'B.md': [
            '---',
            'type: base',
            `filters: description.contains("don't #panic")`,
            'view: table',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'B.md')
    expect(result.code).toBe(1)
    const msg = result.json.errors.find((e: string) => /comment/i.test(e))
    expect(msg).toBeDefined()
    const suggestion = msg?.match(/whole: (.+)$/)?.[1]
    expect(suggestion).toBeDefined()
    // Prove the suggestion actually works when pasted into a real base file, parsed by the
    // SAME code path (`parseBaseFile`, already a `cli` dependency via `@bismuth/core` and
    // already imported by this very command) that will read it when a user pastes it back —
    // not just that some standalone YAML parser happens to accept the string in isolation.
    const fixed = [
        '---',
        'type: base',
        `filters: ${suggestion}`,
        'view: table',
        '---',
        '',
    ].join('\n')
    const { config } = parseBaseFile(fixed, { name: 'B', path: 'B.md' })
    expect(config.filters).toBe(`description.contains("don't #panic")`)
})

test('`base validate` flags a taskFile outside the from: scope', async () => {
    // Keep.md scopes itself with a top-level `where:` (the field `source: notes` shorthand
    // actually reads — see sourceSpec.ts's normalizeSource) to notes in keep/, so keep/A.md is
    // in scope and Inbox.md is not.
    const vault = makeVault({
        'Keep.md':
            '---\ntype: base\nsource: notes\nwhere: file.inFolder("keep")\n---\n',
        'keep/A.md': '- [ ] inside\n',
        'Inbox.md': '- [ ] outside\n',
        'T.md': [
            '---',
            'type: base',
            'source:',
            '  kind: tasks',
            '  from: "[[Keep]]"',
            'view: list',
            'mode: tasks',
            'taskFile: "[[Inbox]]"',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'T.md')
    expect(result.code).toBe(1)
    expect(result.json.ok).toBe(false)
    const joined = result.json.errors.join('\n')
    expect(joined).toMatch(/taskFile/)
    expect(joined).toMatch(/Inbox/)
})

test('`base validate` accepts a taskFile INSIDE the from: scope', async () => {
    const vault = makeVault({
        'Keep.md':
            '---\ntype: base\nsource: notes\nwhere: file.inFolder("keep")\n---\n',
        'keep/A.md': '- [ ] inside\n',
        'T.md': [
            '---',
            'type: base',
            'source:',
            '  kind: tasks',
            '  from: "[[Keep]]"',
            'view: list',
            'mode: tasks',
            'taskFile: "[[keep/A]]"',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'T.md')
    expect(result.code).toBe(0)
    expect(result.json.ok).toBe(true)
})

test('`base validate` says nothing about taskFile when there is no from: scope', async () => {
    // An unscoped `source: tasks` collects the whole vault, so no destination can be stranded
    // by scope. Warning there would be noise on the most common shape.
    const vault = makeVault({
        'Inbox.md': '- [ ] x\n',
        'T.md': [
            '---',
            'type: base',
            'source: tasks',
            'view: list',
            'mode: tasks',
            'taskFile: "[[Inbox]]"',
            '---',
            '',
        ].join('\n'),
    })
    const result = await runCli(vault, 'base', 'validate', 'T.md')
    expect(result.code).toBe(0)
    expect(result.json.ok).toBe(true)
})

// --- `base render` (base.ts) ---------------------------------------------------------------------

test('`base render` on a kanban base returns GROUPED output, not raw rows', async () => {
    const vault = makeVault({
        'Board.md':
            '---\ntype: base\nsource: notes where status\nview: kanban\ngroupBy: { property: note.status }\n---\n',
        'Task1.md': '---\nstatus: todo\n---\nfirst\n',
        'Task2.md': '---\nstatus: done\n---\nsecond\n',
        'Task3.md': '---\nstatus: todo\n---\nthird\n',
    })
    const result = await runCli(vault, 'base', 'render', 'Board.md')
    expect(result.code).toBe(0)
    expect(Array.isArray(result.json.groups)).toBe(true)
    const keys = result.json.groups.map((g: any) => g.key).sort()
    expect(keys).toEqual(['done', 'todo'])
    const todoGroup = result.json.groups.find((g: any) => g.key === 'todo')
    expect(todoGroup.rows).toHaveLength(2)
})

test('`base render` on a stat base returns a computed aggregate, not the row list', async () => {
    const vault = makeVault({
        'Chart.md':
            '---\ntype: base\nsource: notes where amount\nview: stat\nx: category\n---\n',
        'Sale1.md': '---\ncategory: A\namount: 10\n---\n',
        'Sale2.md': '---\ncategory: A\namount: 20\n---\n',
        'Sale3.md': '---\ncategory: B\namount: 5\n---\n',
    })
    const result = await runCli(vault, 'base', 'render', 'Chart.md')
    expect(result.code).toBe(0)
    expect(result.json.groups).toBeUndefined() // aggregate series, not raw grouped rows
    expect(Array.isArray(result.json.chart.points)).toBe(true)
    const byKey = Object.fromEntries(
        result.json.chart.points.map((p: any) => [p.key, p.value]),
    )
    expect(byKey.A).toBe(30) // sum of the two "A" rows' amount
    expect(byKey.B).toBe(5)
})

test("`base render` runs the base's one view, and reads a legacy single-entry views list", async () => {
    const vault = makeVault({
        'Flat.md': '---\ntype: base\nsource: notes\nview: list\n---\n',
        'Legacy.md':
            '---\ntype: base\nsource: notes\nviews:\n  - type: list\n    name: List\n---\n',
    })
    const flat = await runCli(vault, 'base', 'render', 'Flat.md')
    expect(flat.code).toBe(0)
    expect(flat.json.view.type).toBe('list')
    const legacy = await runCli(vault, 'base', 'render', 'Legacy.md')
    expect(legacy.code).toBe(0)
    expect(legacy.json.view.type).toBe('list')
})

test('`base validate` errors on a legacy views list with more than one entry, naming the fix', async () => {
    const vault = makeVault({
        'Multi.md':
            '---\ntype: base\nsource: notes\nviews:\n  - type: table\n    name: Table\n  - type: list\n    name: List\n---\n',
    })
    const result = await runCli(vault, 'base', 'validate', 'Multi.md')
    expect(result.code).toBe(1)
    expect(result.json.ok).toBe(false)
    const joined = result.json.errors.join('\n')
    expect(joined).toContain('2 views')
    expect(joined).toContain('source: base')
    expect(joined).toContain('[[Multi]]')
})

test('`base validate` accepts a legacy single-entry views list and flags a bad kind in it', async () => {
    const vault = makeVault({
        'One.md':
            '---\ntype: base\nsource: notes\nviews:\n  - type: table\n---\n',
        'Bad.md':
            '---\ntype: base\nsource: notes\nviews:\n  - type: gantt\n---\n',
    })
    const one = await runCli(vault, 'base', 'validate', 'One.md')
    expect(one.code).toBe(0)
    const bad = await runCli(vault, 'base', 'validate', 'Bad.md')
    expect(bad.code).toBe(1)
    expect(bad.json.errors.join('\n')).toContain('gantt')
})

// --- `daemon stop` / `daemon restart` (daemon.ts) — wiring to the platform module ---------------
// unloadDaemon/restartDaemon drive REAL launchctl/systemctl, so a round-trip isn't testable in
// CI (and must never run against this machine's real daemon — see the hard constraint in the
// task brief). These assert the WIRING instead: the command calls the platform function with the
// right args, forwards its result through `out()`, and exits non-zero when `ok` is false.
//
// The platform module is mocked BEFORE daemon.ts is ever imported in this process, so
// daemonConfigPath/unloadDaemon/restartDaemon are stubbed and any real spawnSync of
// launchctl/systemctl is never invoked here. Each test reconfigures `platformMock`'s fields
// rather than re-registering the mock, since mock.module's replacement module object is shared
// (live ES-module bindings) across every already-resolved import of the specifier. The
// replacement spreads the REAL module's other exports (notify, planEnsureInstalled, …) first —
// mock.module swaps the module out for every consumer process-wide (not just this file), so a
// bare `{ daemonConfigPath, unloadDaemon, restartDaemon }` would erase those exports for any
// daemon-workspace test that imports platform.ts later in the same `bun test` run.
const realPlatform = await import('../../daemon/src/lib/platform')
const platformMock: {
    configPath: string
    unload: (configPath: string) => { ok: boolean; error?: string }
    restart: () => { ok: boolean; error?: string }
} = {
    configPath: '/fake/.bismuth-test/config.plist',
    unload: () => ({ ok: true }),
    restart: () => ({ ok: true }),
}
mock.module('../../daemon/src/lib/platform', () => ({
    ...realPlatform,
    daemonConfigPath: () => platformMock.configPath,
    unloadDaemon: (configPath: string) => platformMock.unload(configPath),
    restartDaemon: () => platformMock.restart(),
}))
const { commands: daemonCommands } = await import('../src/commands/daemon')

/** Capture console.log output AND process.exit's code around `fn()`, restoring both afterward.
 *  process.exit is stubbed to record the code and abort via throw (a real exit would kill the
 *  test runner) — that throw is swallowed here so callers get a plain `{ logs, code }` back
 *  whether or not `fn()`'s command called process.exit. A single combined helper (rather than
 *  nesting a logs-capture inside an exit-capture) matters: if `fn()` throws to unwind the stubbed
 *  exit, an *outer* capture's `return` after `await fn()` never runs, silently discarding
 *  whatever the inner capture collected. */
async function captureLogsAndExit(
    fn: () => void | Promise<void>,
): Promise<{ logs: string[]; code: number | undefined }> {
    const logs: string[] = []
    const originalLog = console.log
    const originalExit = process.exit
    let code: number | undefined
    console.log = (s: unknown) => {
        logs.push(String(s))
    }
    process.exit = ((c?: number) => {
        code = c
        throw new Error('__test_process_exit__')
    }) as never
    try {
        await fn()
    } catch (e) {
        if (!(e instanceof Error) || e.message !== '__test_process_exit__')
            throw e
    } finally {
        console.log = originalLog
        process.exit = originalExit
    }
    return { logs, code }
}

test('`daemon stop`/`daemon restart` are registered, take no positionals, and accept --pretty', () => {
    expect(daemonCommands['daemon stop']).toBeDefined()
    expect(daemonCommands['daemon restart']).toBeDefined()
    expect(daemonCommands['daemon stop'].usage).toBe('[--pretty]')
    expect(daemonCommands['daemon restart'].usage).toBe('[--pretty]')
})

test('`daemon stop` calls unloadDaemon(daemonConfigPath()) and reports {ok:true} on success', async () => {
    let calledWith: string | undefined
    platformMock.unload = configPath => {
        calledWith = configPath
        return { ok: true }
    }

    const { logs, code } = await captureLogsAndExit(() =>
        daemonCommands['daemon stop'].run([]),
    )

    expect(calledWith).toBe(platformMock.configPath)
    expect(JSON.parse(logs[0])).toEqual({ ok: true })
    expect(code).toBeUndefined() // success never calls process.exit
})

test('`daemon stop` exits non-zero and reports {ok:false,error} when unloadDaemon reports failure', async () => {
    platformMock.unload = () => ({
        ok: false,
        error: 'launchctl unload failed: boom',
    })

    const { logs, code } = await captureLogsAndExit(() =>
        daemonCommands['daemon stop'].run([]),
    )

    expect(code).toBe(1)
    expect(JSON.parse(logs[0])).toEqual({
        ok: false,
        error: 'launchctl unload failed: boom',
    })
})

test('`daemon restart` calls restartDaemon() and forwards {ok:true}, exit 0', async () => {
    let restartCalled = false
    platformMock.restart = () => {
        restartCalled = true
        return { ok: true }
    }

    const { logs, code } = await captureLogsAndExit(() =>
        daemonCommands['daemon restart'].run([]),
    )

    expect(restartCalled).toBe(true)
    expect(JSON.parse(logs[0])).toEqual({ ok: true })
    expect(code).toBeUndefined() // success never calls process.exit
})

test('`daemon restart` exits non-zero when restartDaemon() reports {ok:false,error}', async () => {
    platformMock.restart = () => ({
        ok: false,
        error: 'launchctl kickstart failed: boom',
    })

    const { logs, code } = await captureLogsAndExit(() =>
        daemonCommands['daemon restart'].run([]),
    )

    expect(code).toBe(1)
    expect(JSON.parse(logs[0])).toEqual({
        ok: false,
        error: 'launchctl kickstart failed: boom',
    })
})

test('`daemon restart --pretty` pretty-prints the JSON result (argument parsing works)', async () => {
    platformMock.restart = () => ({ ok: true })

    const { logs } = await captureLogsAndExit(() =>
        daemonCommands['daemon restart'].run(['--pretty']),
    )

    expect(logs[0]).toBe(JSON.stringify({ ok: true }, null, 2))
})

// --- `daemon logs` (daemon.ts) — the CLI half of the activity log --------------------------------

test('daemon logs prints this vault’s activity events, newest first', async () => {
    const vault = tempDir('bismuth-cli-logs-')
    const logs = join(vault, '.daemon', 'logs')
    mkdirSync(logs, { recursive: true })
    writeFileSync(
        join(logs, 'activity-2026-08-29.jsonl'),
        [
            '{"ts":"2026-08-29T09:00:00.000Z","kind":"cron","name":"dream","event":"started"}',
            '{"ts":"2026-08-29T09:30:00.000Z","kind":"cron","name":"dream","event":"finished","outcome":"success","durationMs":1800000}',
        ].join('\n') + '\n',
    )

    const { commands } = await import('../src/commands/daemon')
    const printed: string[] = []
    const spy = spyOn(console, 'log').mockImplementation(l =>
        printed.push(String(l)),
    )
    try {
        await commands['daemon logs']!.run(['--vault', vault])
    } finally {
        spy.mockRestore()
    }

    const events = JSON.parse(printed.join('\n'))
    expect(events).toHaveLength(2)
    expect(events[0].event).toBe('finished')
    expect(events[0].outcome).toBe('success')
    rmSync(vault, { recursive: true, force: true })
})

test('daemon logs on a vault with no daemon prints an empty list, not an error', async () => {
    const vault = tempDir('bismuth-cli-logs-empty-')
    const { commands } = await import('../src/commands/daemon')
    const printed: string[] = []
    const spy = spyOn(console, 'log').mockImplementation(l =>
        printed.push(String(l)),
    )
    try {
        await commands['daemon logs']!.run(['--vault', vault])
    } finally {
        spy.mockRestore()
    }
    expect(JSON.parse(printed.join('\n'))).toEqual([])
    rmSync(vault, { recursive: true, force: true })
})

test('daemon logs honours --limit', async () => {
    const vault = tempDir('bismuth-cli-logs-limit-')
    const logs = join(vault, '.daemon', 'logs')
    mkdirSync(logs, { recursive: true })
    writeFileSync(
        join(logs, 'activity-2026-08-29.jsonl'),
        Array.from(
            { length: 10 },
            (_, i) =>
                `{"ts":"2026-08-29T0${i}:00:00.000Z","kind":"cron","name":"j${i}","event":"started"}`,
        ).join('\n') + '\n',
    )
    const { commands } = await import('../src/commands/daemon')
    const printed: string[] = []
    const spy = spyOn(console, 'log').mockImplementation(l =>
        printed.push(String(l)),
    )
    try {
        await commands['daemon logs']!.run(['--vault', vault, '--limit', '3'])
    } finally {
        spy.mockRestore()
    }
    expect(JSON.parse(printed.join('\n'))).toHaveLength(3)
    rmSync(vault, { recursive: true, force: true })
})

// --- `daemon cron create/delete` + `daemon process create/delete` — #followup-1 -----------------
// These exist so the daemon's OWN chat can supervise its crons/services through the CLI (Bash),
// with the user approving each tool call in chat. Spawned as a REAL subprocess (not
// `commands[...].run()` in-process) because the agent-channel gate the second test proves is
// checked only at `cli/src/index.ts`'s real dispatch point (see the BISMUTH_AGENT_CHANNEL tests
// near the top of this file) — calling `.run()` directly bypasses it entirely.

test('`daemon cron create <name> --vault <dir>` creates a display-named cron; `daemon cron delete` removes it', async () => {
    const vault = makeVault({})
    const create = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'daemon',
            'cron',
            'create',
            'Answer Emails!',
            '--vault',
            vault,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [createOut, createErr, createCode] = await Promise.all([
        new Response(create.stdout).text(),
        new Response(create.stderr).text(),
        create.exited,
    ])
    expect(createErr).toBe('')
    expect(createCode).toBe(0)
    expect(JSON.parse(createOut)).toEqual({ file: 'answer-emails' })
    const md = readFileSync(
        join(vault, '.daemon', 'crons', 'answer-emails.md'),
        'utf8',
    )
    expect(md).toContain('name: "Answer Emails!"')

    const del = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'daemon',
            'cron',
            'delete',
            'Answer Emails!',
            '--vault',
            vault,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [delOut, , delCode] = await Promise.all([
        new Response(del.stdout).text(),
        new Response(del.stderr).text(),
        del.exited,
    ])
    expect(delCode).toBe(0)
    expect(delOut.trim()).toBe('ok')
    expect(
        existsSync(join(vault, '.daemon', 'crons', 'answer-emails.md')),
    ).toBe(false)
})

test('`daemon process create <name> --vault <dir>` creates a display-named process; `daemon process delete` removes it', async () => {
    const vault = makeVault({})
    const create = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'daemon',
            'process',
            'create',
            'Web Search',
            '--vault',
            vault,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [createOut, , createCode] = await Promise.all([
        new Response(create.stdout).text(),
        new Response(create.stderr).text(),
        create.exited,
    ])
    expect(createCode).toBe(0)
    expect(JSON.parse(createOut)).toEqual({ file: 'web-search' })
    const md = readFileSync(
        join(vault, '.daemon', 'processes', 'web-search.md'),
        'utf8',
    )
    expect(md).toContain('name: "Web Search"')

    const del = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'daemon',
            'process',
            'delete',
            'Web Search',
            '--vault',
            vault,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [delOut, , delCode] = await Promise.all([
        new Response(del.stdout).text(),
        new Response(del.stderr).text(),
        del.exited,
    ])
    expect(delCode).toBe(0)
    expect(delOut.trim()).toBe('ok')
    expect(
        existsSync(join(vault, '.daemon', 'processes', 'web-search.md')),
    ).toBe(false)
})

test("`daemon cron create` SUCCEEDS under BISMUTH_AGENT_CHANNEL=daemon — the daemon's own chat must be able to supervise its crons, not just read/write vault notes", async () => {
    const vault = makeVault({})
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'daemon',
            'cron',
            'create',
            'Nightly Sync',
            '--vault',
            vault,
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, BISMUTH_AGENT_CHANNEL: 'daemon' },
        },
    )
    const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(err).toBe('')
    expect(code).toBe(0)
    expect(JSON.parse(out)).toEqual({ file: 'nightly-sync' })
})

// --- `update status` / `update apply` (commands/update.ts) — dispatch + route JSON passthrough --

test("`bismuth update status` GETs /update/status and prints the route's JSON", async () => {
    const mockSrv = mockUpdateServer({
        status: {
            available: true,
            behind: 3,
            localSha: 'abc123',
            remoteSha: 'def456',
            builtSha: 'abc123',
            dirty: false,
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'update',
                'status',
                '--api',
                mockSrv.url,
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(mockSrv.calls).toEqual([
            { method: 'GET', path: '/update/status' },
        ])
        expect(JSON.parse(outText)).toEqual({
            available: true,
            behind: 3,
            localSha: 'abc123',
            remoteSha: 'def456',
            builtSha: 'abc123',
            dirty: false,
        })
    } finally {
        mockSrv.stop()
    }
})

test("`bismuth update apply` POSTs /update/apply and prints the route's JSON", async () => {
    const mockSrv = mockUpdateServer({
        apply: { phase: 'pulling', message: 'pulling latest…' },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'update',
                'apply',
                '--api',
                mockSrv.url,
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(mockSrv.calls).toEqual([
            { method: 'POST', path: '/update/apply' },
        ])
        expect(JSON.parse(outText)).toEqual({
            phase: 'pulling',
            message: 'pulling latest…',
        })
    } finally {
        mockSrv.stop()
    }
})

test('`bismuth update status` fails cleanly (no crash) when no server is running', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'update',
            'status',
            '--api',
            'http://localhost:59998',
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
})

// --- `gcal targets` / `gcal health` (commands/gcal.ts) — headless, no server needed ------------
// Both had NO caller reachable from the CLI/an agent before this: `listGcalSyncTargets` was only
// called by the internal 60s auto-sync ticker; `readManifest` reads a file OUTSIDE the vault that
// no vault-scoped command could reach either.
//
// `health` now needs `--vault` (Task 11): the manifest is keyed by `manifestKey(vault, basePath)`,
// not bare basePath, so resolving an entry requires knowing the vault. `health` is READ-ONLY — it
// must never create, move or claim an entry — so these tests also prove that: a legacy (bare-key,
// pre-namespacing) entry is reported (marked `legacy: true`) but the manifest file on disk is
// byte-identical after `health` runs.

test('`gcal targets` lists calendar bases with Google sync enabled — ignores sync-off bases and non-base notes', async () => {
    const vault = makeVault({
        'Work.md':
            '---\ntype: base\nviews:\n  - type: calendar\n    googleCalendarSync: true\n    googleCalendarId: work-cal\ncategories: []\n---\n',
        'Off.md':
            '---\ntype: base\nviews:\n  - type: calendar\n    googleCalendarSync: false\ncategories: []\n---\n',
        'Note.md': '# Just a note, not a base\n',
    })
    const result = await runCli(vault, 'gcal', 'targets')
    expect(result.code).toBe(0)
    expect(result.json).toEqual([
        { basePath: 'Work.md', calendarId: 'work-cal' },
    ])
})

// A core that refuses a Google Calendar action (every route that calls Google or writes the machine-wide
// gcal state answers 403 with a JSON `{ error }` outside the installed app) must reach the person as that
// sentence, not as a raw JSON body behind a status code — for every command that hits one of those routes.

/** A fake core answering every POST /gcal/* route with a 403 `{ error: message }`; records each path. */
function refusingGcalServer(message: string) {
    const paths: string[] = []
    const server = Bun.serve({
        port: 0,
        fetch: req => {
            const { pathname } = new URL(req.url)
            paths.push(pathname)
            return pathname.startsWith('/gcal/')
                ? Response.json({ error: message }, { status: 403 })
                : new Response('not found', { status: 404 })
        },
    })
    return {
        url: `http://localhost:${server.port}`,
        paths,
        stop: () => server.stop(true),
    }
}

const GCAL_REFUSAL =
    'Google Calendar is off on this core. Set BISMUTH_GCAL_AUTOSYNC=1 on the core to enable it deliberately.'

test('`gcal sync` surfaces a refused sync as its readable error message', async () => {
    const srv = refusingGcalServer(GCAL_REFUSAL)
    try {
        const r = await spawnCli(['gcal', 'sync', 'Cal.md', '--api', srv.url])
        expect(r.code).toBe(1)
        expect(r.err.trim()).toBe(
            `error: POST /gcal/sync → 403: ${GCAL_REFUSAL}`,
        )
    } finally {
        srv.stop()
    }
})

test('`gcal disconnect` surfaces a refused disconnect as its readable error message', async () => {
    const srv = refusingGcalServer(GCAL_REFUSAL)
    try {
        const r = await spawnCli(['gcal', 'disconnect', '--api', srv.url])
        expect(r.code).toBe(1)
        expect(r.err.trim()).toBe(
            `error: POST /gcal/disconnect → 403: ${GCAL_REFUSAL}`,
        )
    } finally {
        srv.stop()
    }
})

test('`gcal connect` surfaces a refused credentials store (and stops there) as its readable error message', async () => {
    const srv = refusingGcalServer(GCAL_REFUSAL)
    try {
        const r = await spawnCli([
            'gcal',
            'connect',
            '--client-id',
            'id',
            '--client-secret',
            'secret',
            '--api',
            srv.url,
        ])
        expect(r.code).toBe(1)
        expect(r.err.trim()).toBe(
            `error: POST /gcal/credentials → 403: ${GCAL_REFUSAL}`,
        )
        expect(srv.paths).toEqual(['/gcal/credentials'])
    } finally {
        srv.stop()
    }
})

test('`gcal connect` without credentials surfaces a refused auth start as its readable error message', async () => {
    const srv = refusingGcalServer(GCAL_REFUSAL)
    try {
        const r = await spawnCli(['gcal', 'connect', '--api', srv.url])
        expect(r.code).toBe(1)
        expect(r.err.trim()).toBe(
            `error: POST /gcal/auth/start → 403: ${GCAL_REFUSAL}`,
        )
    } finally {
        srv.stop()
    }
})

/** Spawn `bismuth gcal health [<basePath>]` against a throwaway `BISMUTH_GCAL_DIR`, with `--vault`. */
function gcalHealth(gcalDir: string, vault: string, basePath?: string) {
    const args = basePath ? ['health', basePath] : ['health']
    return Bun.spawn(
        ['bun', 'run', 'cli/src/index.ts', 'gcal', ...args, '--vault', vault],
        {
            stdout: 'pipe',
            env: { ...process.env, BISMUTH_GCAL_DIR: gcalDir },
        },
    )
}

test('`gcal health` reads the manifest at BISMUTH_GCAL_DIR (outside the vault) — bare (unclaimed legacy) entries via explicit <basePath> only, never via "list all"', async () => {
    const vault = makeVault({})
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const gcalDir = mkdtempSync(join(tmpdir(), 'bismuth-gcal-health-'))
    mkdirSync(gcalDir, { recursive: true })
    writeFileSync(
        join(gcalDir, 'sync.json'),
        JSON.stringify({
            bases: {
                'Work.md': {
                    lastSyncAt: '2026-01-01T00:00:00.000Z',
                    syncToken: 'tok1',
                    calendarId: 'work-cal',
                    links: {
                        ev1: { bismuthId: 'b1' },
                        ev2: { bismuthId: 'b2' },
                    },
                },
                'Home.md': { calendarId: 'home-cal', links: {} },
            },
        }),
    )
    try {
        // "list all" reports only entries NAMESPACED to this vault — neither bare entry is, so
        // the list is empty. A legacy entry has no vault association, so "list all" for ANY
        // vault must not surface it as if it were that vault's own history (fix round 1).
        const all = gcalHealth(gcalDir, vault)
        const allOut = await new Response(all.stdout).text()
        expect(await all.exited).toBe(0)
        expect(JSON.parse(allOut)).toEqual([])

        // The explicit single-<basePath> lookup still falls back to the legacy bare entry and
        // marks it as such — that fallback is a named, deliberate lookup, not an inference over
        // the whole manifest.
        const single = gcalHealth(gcalDir, vault, 'Work.md')
        const singleOut = await new Response(single.stdout).text()
        expect(await single.exited).toBe(0)
        expect(JSON.parse(singleOut)).toEqual({
            basePath: 'Work.md',
            calendarId: 'work-cal',
            lastSyncAt: '2026-01-01T00:00:00.000Z',
            linkedEvents: 2,
            hasSyncToken: true,
            legacy: true,
        })

        const singleHome = gcalHealth(gcalDir, vault, 'Home.md')
        const singleHomeOut = await new Response(singleHome.stdout).text()
        expect(await singleHome.exited).toBe(0)
        expect(JSON.parse(singleHomeOut)).toEqual({
            basePath: 'Home.md',
            calendarId: 'home-cal',
            linkedEvents: 0,
            hasSyncToken: false,
            legacy: true,
        }) // no lastSyncAt key — never synced
    } finally {
        rmSync(gcalDir, { recursive: true, force: true })
    }
})

test('`gcal health` reads a NAMESPACED entry directly, with no legacy fallback and no `legacy` flag', async () => {
    const vault = makeVault({})
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const gcalDir = mkdtempSync(join(tmpdir(), 'bismuth-gcal-health-ns-'))
    mkdirSync(gcalDir, { recursive: true })
    const key = manifestKey(vault, 'Work.md')
    writeFileSync(
        join(gcalDir, 'sync.json'),
        JSON.stringify({
            bases: {
                [key]: {
                    lastSyncAt: '2026-02-02T00:00:00.000Z',
                    syncToken: 'tok2',
                    calendarId: 'work-cal',
                    links: {
                        ev1: { bismuthId: 'b1' },
                        ev2: { bismuthId: 'b2' },
                        ev3: { bismuthId: 'b3' },
                    },
                },
            },
        }),
    )
    try {
        const single = gcalHealth(gcalDir, vault, 'Work.md')
        const singleOut = await new Response(single.stdout).text()
        expect(await single.exited).toBe(0)
        expect(JSON.parse(singleOut)).toEqual({
            basePath: 'Work.md',
            calendarId: 'work-cal',
            lastSyncAt: '2026-02-02T00:00:00.000Z',
            linkedEvents: 3,
            hasSyncToken: true,
            // no `legacy` key — the namespaced entry was found directly.
        })

        // "list all" mode also finds it via the vault's own namespace prefix.
        const all = gcalHealth(gcalDir, vault)
        const allOut = await new Response(all.stdout).text()
        expect(await all.exited).toBe(0)
        expect(JSON.parse(allOut)).toEqual([
            {
                basePath: 'Work.md',
                calendarId: 'work-cal',
                lastSyncAt: '2026-02-02T00:00:00.000Z',
                linkedEvents: 3,
                hasSyncToken: true,
            },
        ])
    } finally {
        rmSync(gcalDir, { recursive: true, force: true })
    }
})

test('`gcal health` is READ-ONLY: a legacy entry it falls back to is never claimed, moved or mutated', async () => {
    const vault = makeVault({})
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const gcalDir = mkdtempSync(join(tmpdir(), 'bismuth-gcal-health-ro-'))
    mkdirSync(gcalDir, { recursive: true })
    const manifestPath = join(gcalDir, 'sync.json')
    const raw = JSON.stringify({
        bases: {
            'Legacy.md': {
                lastSyncAt: '2026-03-03T00:00:00.000Z',
                syncToken: 'tok3',
                calendarId: 'legacy-cal',
                links: { ev1: { bismuthId: 'b1' } },
            },
        },
    })
    writeFileSync(manifestPath, raw)
    try {
        const single = gcalHealth(gcalDir, vault, 'Legacy.md')
        const singleOut = await new Response(single.stdout).text()
        expect(await single.exited).toBe(0)
        expect(JSON.parse(singleOut)).toEqual({
            basePath: 'Legacy.md',
            calendarId: 'legacy-cal',
            lastSyncAt: '2026-03-03T00:00:00.000Z',
            linkedEvents: 1,
            hasSyncToken: true,
            legacy: true,
        })
        // Never created the namespaced key, never moved/deleted the bare one, never wrote at all.
        expect(readFileSync(manifestPath, 'utf8')).toBe(raw)
    } finally {
        rmSync(gcalDir, { recursive: true, force: true })
    }
})

test('`gcal health` "list all" mode never leaks another vault\'s namespaced entry, or an unclaimed legacy entry, into this vault\'s list', async () => {
    const vaultA = makeVault({})
    const vaultB = makeVault({})
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const gcalDir = mkdtempSync(join(tmpdir(), 'bismuth-gcal-health-multi-'))
    mkdirSync(gcalDir, { recursive: true })
    const manifestPath = join(gcalDir, 'sync.json')
    const raw = JSON.stringify({
        bases: {
            [manifestKey(vaultA, 'A.md')]: {
                lastSyncAt: '2026-04-01T00:00:00.000Z',
                calendarId: 'a-cal',
                links: { ev1: { bismuthId: 'b1' } },
            },
            [manifestKey(vaultB, 'B.md')]: {
                lastSyncAt: '2026-04-02T00:00:00.000Z',
                calendarId: 'b-cal',
                links: {
                    ev2: { bismuthId: 'b2' },
                    ev3: { bismuthId: 'b3' },
                },
            },
            // A legacy, pre-namespacing bare entry: no vault it can be safely attributed to.
            'Legacy.md': {
                lastSyncAt: '2026-04-03T00:00:00.000Z',
                calendarId: 'legacy-cal',
                links: { ev4: { bismuthId: 'b4' } },
            },
        },
    })
    writeFileSync(manifestPath, raw)
    try {
        const all = gcalHealth(gcalDir, vaultA)
        const allOut = await new Response(all.stdout).text()
        expect(await all.exited).toBe(0)
        // Exactly vault A's own namespaced entry — not B's, not the unclaimed legacy one. A
        // legacy entry has no vault association, so listing it under vault A's "list all" would
        // misattribute someone else's (or nobody's) history as A's.
        expect(JSON.parse(allOut)).toEqual([
            {
                basePath: 'A.md',
                calendarId: 'a-cal',
                lastSyncAt: '2026-04-01T00:00:00.000Z',
                linkedEvents: 1,
                hasSyncToken: false,
            },
        ])
        // Still fully read-only: the manifest file is untouched.
        expect(readFileSync(manifestPath, 'utf8')).toBe(raw)
    } finally {
        rmSync(gcalDir, { recursive: true, force: true })
    }
})

// --- `gcal status/connect/sync/disconnect` (commands/gcal.ts) — server-backed, fake server ------
// Per the hard constraint (never touch the user's real Google account), these hit a throwaway
// in-test HTTP server that mimics the real `/gcal/*` route contracts, never core/src/gcal/index.ts
// itself — proving the CLI's dispatch/argument-building/output-passthrough, not live OAuth/sync.

function mockGcalServer(
    replies: { status?: unknown; authStart?: unknown; sync?: unknown } = {},
): {
    url: string
    calls: { method: string; path: string; body: unknown }[]
    stop: () => void
} {
    const calls: { method: string; path: string; body: unknown }[] = []
    const server = Bun.serve({
        port: 0,
        fetch: async req => {
            const { pathname } = new URL(req.url)
            let body: unknown
            if (req.method !== 'GET') {
                try {
                    body = await req.json()
                } catch {
                    body = undefined
                }
            }
            calls.push({ method: req.method, path: pathname, body })
            if (req.method === 'GET' && pathname === '/gcal/status')
                return Response.json(
                    replies.status ?? {
                        connected: false,
                        needsCredentials: true,
                    },
                )
            if (req.method === 'POST' && pathname === '/gcal/credentials')
                return Response.json({ ok: true })
            if (req.method === 'POST' && pathname === '/gcal/auth/start')
                return Response.json(
                    replies.authStart ?? {
                        url: 'https://accounts.google.com/o/oauth2/v2/auth?fake=1',
                    },
                )
            if (req.method === 'POST' && pathname === '/gcal/sync') {
                return Response.json(
                    replies.sync ?? {
                        total: 0,
                        pulledNew: 0,
                        pulledUpdate: 0,
                        pushedNew: 0,
                        pushedUpdate: 0,
                        deletedLocal: 0,
                        deletedRemote: 0,
                        conflicts: 0,
                        skipped: 0,
                        failed: 0,
                        relinked: 0,
                    },
                )
            }
            if (req.method === 'POST' && pathname === '/gcal/disconnect')
                return Response.json({ ok: true })
            return new Response('not found', { status: 404 })
        },
    })
    return {
        url: `http://localhost:${server.port}`,
        calls,
        stop: () => server.stop(true),
    }
}

test("`gcal status` GETs /gcal/status and prints the route's JSON", async () => {
    const mockSrv = mockGcalServer({
        status: {
            connected: true,
            needsCredentials: false,
            account: 'me@example.com',
            timeZone: 'UTC',
            connectedAt: '2026-01-01T00:00:00Z',
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'gcal',
                'status',
                '--api',
                mockSrv.url,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(mockSrv.calls).toEqual([
            { method: 'GET', path: '/gcal/status', body: undefined },
        ])
        expect(JSON.parse(outText)).toEqual({
            connected: true,
            needsCredentials: false,
            account: 'me@example.com',
            timeZone: 'UTC',
            connectedAt: '2026-01-01T00:00:00Z',
        })
    } finally {
        mockSrv.stop()
    }
})

test('`gcal connect --client-id --client-secret` POSTs credentials then auth/start, prints the consent URL + a browser note (never claims the flow completed)', async () => {
    const mockSrv = mockGcalServer({
        authStart: { url: 'https://accounts.google.com/fake-consent' },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'gcal',
                'connect',
                '--client-id',
                'cid',
                '--client-secret',
                'csecret',
                '--api',
                mockSrv.url,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(
            mockSrv.calls.map(c => ({ method: c.method, path: c.path })),
        ).toEqual([
            { method: 'POST', path: '/gcal/credentials' },
            { method: 'POST', path: '/gcal/auth/start' },
        ])
        expect(mockSrv.calls[0].body).toEqual({
            clientId: 'cid',
            clientSecret: 'csecret',
        })
        const parsed = JSON.parse(outText)
        expect(parsed.url).toBe('https://accounts.google.com/fake-consent')
        expect(String(parsed.note).toLowerCase()).toContain('browser') // must say a PERSON finishes this, never imply it already did
    } finally {
        mockSrv.stop()
    }
})

test('`gcal connect --client-id` without --client-secret fails before ever reaching the network', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'gcal',
            'connect',
            '--client-id',
            'cid',
            '--api',
            'http://localhost:59999',
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [err, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
    expect(err).toContain('usage: gcal connect')
})

test('`gcal sync <basePath>` POSTs {basePath} to /gcal/sync and prints the SyncResult', async () => {
    const mockSrv = mockGcalServer({
        sync: {
            total: 3,
            pulledNew: 1,
            pulledUpdate: 0,
            pushedNew: 2,
            pushedUpdate: 0,
            deletedLocal: 0,
            deletedRemote: 0,
            conflicts: 1,
            skipped: 0,
            failed: 0,
            relinked: 0,
        },
    })
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'gcal',
                'sync',
                'Bases/Team.md',
                '--api',
                mockSrv.url,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(mockSrv.calls).toHaveLength(1)
        expect(mockSrv.calls[0]).toMatchObject({
            method: 'POST',
            path: '/gcal/sync',
            body: { basePath: 'Bases/Team.md' },
        })
        expect(JSON.parse(outText).conflicts).toBe(1)
    } finally {
        mockSrv.stop()
    }
})

test('`gcal sync` without <basePath> fails before ever reaching the network', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'gcal',
            'sync',
            '--api',
            'http://localhost:59999',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [err, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
    expect(err).toContain('usage: gcal sync')
})

test('`gcal disconnect` POSTs /gcal/disconnect and prints {ok:true}', async () => {
    const mockSrv = mockGcalServer()
    try {
        const proc = Bun.spawn(
            [
                'bun',
                'run',
                'cli/src/index.ts',
                'gcal',
                'disconnect',
                '--api',
                mockSrv.url,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [outText, , code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ])
        expect(code).toBe(0)
        expect(mockSrv.calls).toEqual([
            { method: 'POST', path: '/gcal/disconnect', body: undefined },
        ])
        expect(JSON.parse(outText)).toEqual({ ok: true })
    } finally {
        mockSrv.stop()
    }
})

test('`gcal status` fails cleanly (no crash) when no server is running', async () => {
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'cli/src/index.ts',
            'gcal',
            'status',
            '--api',
            'http://localhost:59997',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const [, code] = await Promise.all([
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    expect(code).toBe(1)
})
