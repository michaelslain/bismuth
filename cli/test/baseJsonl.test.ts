import { test as bunTest, expect, describe } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
    readManifest,
    writeManifest,
    manifestKey,
} from '../../core/src/gcal/manifest'
import { makeVault } from '../../core/test/helpers'
import {
    parseCalendarFile,
    serializeCalendarFile,
} from '../../core/src/calendar'
import { baseFormatOf } from '../../core/src/bases/baseFile'
import { loadAppConfig } from '../../core/src/settings'
import { listGcalSyncTargets } from '../../core/src/gcal/discover'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, 30_000)

type Run = { code: number; stdout: string; stderr: string }

async function cli(vault: string, ...args: string[]): Promise<Run> {
    return cliAs(undefined, vault, ...args)
}

async function cliAs(
    channel: string | undefined,
    vault: string,
    ...args: string[]
): Promise<Run> {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    if (channel) env.BISMUTH_AGENT_CHANNEL = channel
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
    delete env.BISMUTH_APP_PATH
    env.BISMUTH_GCAL_DIR =
        process.env.BISMUTH_GCAL_DIR ??
        mkdtempSync(join(tmpdir(), 'bismuth-gcal-'))
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            join(REPO_ROOT, 'cli/src/index.ts'),
            ...args,
            '--vault',
            vault,
        ],
        { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

const read = (vault: string, rel: string) =>
    readFileSync(join(vault, rel), 'utf8')

const EVENTS = [
    {
        id: 'e1',
        title: 'Standup',
        date: '2026-10-08',
        startTime: '09:00',
        endTime: '09:15',
    },
    { id: 'e2', title: 'Lunch', date: '2026-10-09' },
]

function mdCalendar(title = 'Cal'): string {
    return serializeCalendarFile(
        { type: 'base', view: 'calendar', title },
        EVENTS as never,
        'md',
    )
}

const FLASH_MD = [
    '---',
    'type: base',
    'view: flashcards',
    'source: notes',
    '---',
    '',
    '| front | back |',
    '| --- | --- |',
    '| 2+2 | 4 |',
    '| capital of France | Paris |',
    '',
].join('\n')

const NOTES_MD = '---\ntype: base\nview: table\nsource: notes\n---\n'

describe('base create / calendar create', () => {
    test('create writes .base.jsonl; an explicit .md path stays markdown', async () => {
        const vault = makeVault({})
        let r = await cli(vault, 'base', 'create', 'Tasks', '--view', 'table')
        expect(r.code, r.stderr).toBe(0)
        expect(existsSync(join(vault, 'Tasks.base.jsonl'))).toBe(true)
        expect(existsSync(join(vault, 'Tasks.md'))).toBe(false)
        expect(baseFormatOf(read(vault, 'Tasks.base.jsonl'))).toBe('jsonl')

        r = await cli(vault, 'base', 'create', 'Old.md', '--view', 'table')
        expect(r.code, r.stderr).toBe(0)
        expect(baseFormatOf(read(vault, 'Old.md'))).toBe('md')

        r = await cli(vault, 'calendar', 'create', 'Cal', '--title', 'Mine')
        expect(r.code, r.stderr).toBe(0)
        expect(baseFormatOf(read(vault, 'Cal.base.jsonl'))).toBe('jsonl')

        r = await cli(vault, 'calendar', 'create', 'Legacy.md')
        expect(r.code, r.stderr).toBe(0)
        expect(baseFormatOf(read(vault, 'Legacy.md'))).toBe('md')
        expect(parseCalendarFile(read(vault, 'Legacy.md')).format).toBe('md')
    })
})

describe('path resolution + format preservation', () => {
    test('extensionless resolves to .base.jsonl when present, else .md', async () => {
        const vault = makeVault({
            'Both.md': mdCalendar('md'),
            'Both.base.jsonl': '{"type":"base","view":"table"}\n{"a":1}\n',
            'OnlyMd.md': mdCalendar('md'),
        })
        const both = await cli(vault, 'base', 'read', 'Both')
        expect(both.code, both.stderr).toBe(0)
        expect(JSON.parse(both.stdout).rows[0].note.a).toBe(1)
        const only = await cli(vault, 'base', 'read', 'OnlyMd')
        expect(only.code, only.stderr).toBe(0)
        expect(JSON.parse(only.stdout).config.view).toEqual({
            type: 'calendar',
        })
    })

    test('calendar + row writes keep each file in its own format', async () => {
        const vault = makeVault({ 'Md.md': mdCalendar() })
        await cli(vault, 'calendar', 'create', 'Js')
        for (const base of ['Md', 'Js']) {
            const add = await cli(
                vault,
                'calendar',
                'add',
                base,
                '--date',
                '2026-10-10',
                '--title',
                'Dentist',
            )
            expect(add.code, add.stderr).toBe(0)
            const cat = await cli(
                vault,
                'calendar',
                'category',
                'add',
                base,
                'Work',
            )
            expect(cat.code, cat.stderr).toBe(0)
        }
        expect(baseFormatOf(read(vault, 'Md.md'))).toBe('md')
        expect(baseFormatOf(read(vault, 'Js.base.jsonl'))).toBe('jsonl')
        const day = await cli(vault, 'calendar', 'day', 'Js', '2026-10-10')
        expect(day.stdout).toContain('Dentist')

        await cli(vault, 'base', 'create', 'T', '--view', 'table')
        const add = await cli(vault, 'row', 'add', 'T', '--json', '{"a":"x"}')
        expect(add.code, add.stderr).toBe(0)
        expect(baseFormatOf(read(vault, 'T.base.jsonl'))).toBe('jsonl')
        expect(existsSync(join(vault, 'T.md'))).toBe(false)
        const upd = await cli(
            vault,
            'row',
            'update',
            'T',
            '0',
            '--json',
            '{"a":"y"}',
        )
        expect(upd.code, upd.stderr).toBe(0)
        expect(read(vault, 'T.base.jsonl')).toContain('"a":"y"')
    })

    test('calendar bases lists jsonl and markdown calendars', async () => {
        const vault = makeVault({ 'Md.md': mdCalendar() })
        await cli(vault, 'calendar', 'create', 'sub/Js')
        const r = await cli(vault, 'calendar', 'bases')
        expect(r.code, r.stderr).toBe(0)
        const paths = (JSON.parse(r.stdout) as { path: string }[]).map(
            x => x.path,
        )
        expect(paths.sort()).toEqual(['Md.md', 'sub/Js.base.jsonl'])
    })

    test('calendar bases lists a calendar with a broken line as unparseable and carries on', async () => {
        const vault = makeVault({
            'Good.md': mdCalendar(),
            'Broken.base.jsonl':
                '{"type":"base","view":"calendar","title":"Broken"}\n{"id":"a","date":"2026-10-08"\nnot json\n',
        })
        const r = await cli(vault, 'calendar', 'bases')
        expect(r.code, r.stderr).toBe(0)
        const rows = JSON.parse(r.stdout) as {
            path: string
            error?: string
            events: number
        }[]
        expect(rows.map(x => x.path).sort()).toEqual([
            'Broken.base.jsonl',
            'Good.md',
        ])
        expect(rows.find(x => x.path === 'Broken.base.jsonl')?.error).toBe(
            'unparseable',
        )
        expect(rows.find(x => x.path === 'Good.md')?.error).toBeUndefined()
        expect(rows.find(x => x.path === 'Good.md')?.events).toBe(2)
    })

    test('card review --file resolves an extensionless jsonl base', async () => {
        const vault = makeVault({})
        await cli(vault, 'base', 'create', 'Deck', '--view', 'flashcards')
        await cli(
            vault,
            'row',
            'add',
            'Deck',
            '--json',
            '{"front":"q","back":"a"}',
        )
        const r = await cli(
            vault,
            'card',
            'review',
            '--file',
            'Deck',
            '--index',
            '0',
            '--response',
            'good',
        )
        expect(r.code, r.stderr).toBe(0)
        expect(baseFormatOf(read(vault, 'Deck.base.jsonl'))).toBe('jsonl')
    })
})

describe('base migrate', () => {
    test('re-keys Google sync state onto the migrated path', async () => {
        const vault = makeVault({ 'Cal.md': mdCalendar() })
        const gdir = mkdtempSync(join(tmpdir(), 'bismuth-gcal-'))
        const prev = process.env.BISMUTH_GCAL_DIR
        process.env.BISMUTH_GCAL_DIR = gdir
        try {
            const links = { g1: { bismuthId: 'e1', etag: 'x' } }
            writeManifest({
                bases: {
                    [manifestKey(vault, 'Cal.md')]: {
                        links,
                        syncToken: 'tok',
                    },
                },
            })
            const r = await cli(vault, 'base', 'migrate', 'Cal.md')
            expect(r.code, r.stderr).toBe(0)
            const m = readManifest()
            expect(m.bases[manifestKey(vault, 'Cal.base.jsonl')]).toEqual({
                links,
                syncToken: 'tok',
            })
            expect(m.bases[manifestKey(vault, 'Cal.md')]).toBeUndefined()
            expect(Object.keys(m.bases)).toHaveLength(1)
        } finally {
            if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
            else process.env.BISMUTH_GCAL_DIR = prev
            rmSync(gdir, { recursive: true, force: true })
        }
    })

    const withGcal = async (fn: (gdir: string) => Promise<void>) => {
        const root = mkdtempSync(join(tmpdir(), 'bismuth-gcal-'))
        const gdir = join(root, 'gcal')
        const prev = process.env.BISMUTH_GCAL_DIR
        process.env.BISMUTH_GCAL_DIR = gdir
        try {
            await fn(gdir)
        } finally {
            if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
            else process.env.BISMUTH_GCAL_DIR = prev
            rmSync(root, { recursive: true, force: true })
        }
    }

    test('leaves a bare legacy manifest key alone without BISMUTH_APP_PATH', () =>
        withGcal(async () => {
            const vault = makeVault({ 'Cal.md': mdCalendar() })
            const bare = {
                bases: {
                    'Cal.md': { links: { g1: { bismuthId: 'e1', etag: 'x' } } },
                },
            }
            writeManifest(bare)
            const r = await cli(vault, 'base', 'migrate', 'Cal.md')
            expect(r.code, r.stderr).toBe(0)
            expect(readManifest()).toEqual(bare)
        }))

    test('--dry-run leaves the manifest unchanged', () =>
        withGcal(async () => {
            const vault = makeVault({ 'Cal.md': mdCalendar() })
            const m = {
                bases: {
                    [manifestKey(vault, 'Cal.md')]: {
                        links: {},
                        syncToken: 't',
                    },
                },
            }
            writeManifest(m)
            const r = await cli(vault, 'base', 'migrate', 'Cal.md', '--dry-run')
            expect(r.code, r.stderr).toBe(0)
            expect(readManifest()).toEqual(m)
            expect(existsSync(join(vault, 'Cal.base.jsonl'))).toBe(false)
        }))

    test('a held sync lock fails the migrate before anything is written', () =>
        withGcal(async gdir => {
            const vault = makeVault({ 'Cal.md': mdCalendar() })
            writeManifest({
                bases: { [manifestKey(vault, 'Cal.md')]: { links: {} } },
            })
            writeFileSync(join(gdir, 'sync.lock'), `${process.pid} now`)
            const r = await cli(vault, 'base', 'migrate', 'Cal.md')
            expect(r.code).not.toBe(0)
            expect(existsSync(join(vault, 'Cal.base.jsonl'))).toBe(false)
            expect(existsSync(join(vault, 'Cal.md'))).toBe(true)
        }))

    test('an occupied destination key refuses with EEXIST and leaves no target', () =>
        withGcal(async () => {
            const vault = makeVault({ 'Cal.md': mdCalendar() })
            const m = {
                bases: {
                    [manifestKey(vault, 'Cal.md')]: {
                        links: {},
                        syncToken: 'a',
                    },
                    [manifestKey(vault, 'Cal.base.jsonl')]: {
                        links: {},
                        syncToken: 'b',
                    },
                },
            }
            writeManifest(m)
            const r = await cli(vault, 'base', 'migrate', 'Cal.md')
            expect(r.code).not.toBe(0)
            expect(r.stderr + r.stdout).toContain('destination already has')
            expect(existsSync(join(vault, 'Cal.base.jsonl'))).toBe(false)
            expect(existsSync(join(vault, 'Cal.md'))).toBe(true)
            expect(readManifest()).toEqual(m)
        }))

    test('no manifest: the gcal dir is never created', () =>
        withGcal(async gdir => {
            const vault = makeVault({ 'Cal.md': mdCalendar() })
            const r = await cli(vault, 'base', 'migrate', 'Cal.md')
            expect(r.code, r.stderr).toBe(0)
            expect(existsSync(join(vault, 'Cal.base.jsonl'))).toBe(true)
            expect(existsSync(gdir)).toBe(false)
        }))

    const files = () => ({
        'Cal.md': mdCalendar(),
        'Deck.md': FLASH_MD,
        'Notes.md': NOTES_MD,
        'plain.md': '# just a note\n',
    })

    test('--all converts every markdown base, trashes the .md, output unchanged', async () => {
        const vault = makeVault(files())
        const before = {
            day: await cli(vault, 'calendar', 'day', 'Cal.md', '2026-10-08'),
            read: await cli(vault, 'base', 'read', 'Deck.md'),
            render: await cli(vault, 'base', 'render', 'Notes.md'),
        }
        for (const r of Object.values(before)) expect(r.code, r.stderr).toBe(0)

        const dry = await cli(vault, 'base', 'migrate', '--all', '--dry-run')
        expect(dry.code, dry.stderr).toBe(0)
        expect(dry.stdout).toContain('would migrate Cal.md -> Cal.base.jsonl')
        expect(existsSync(join(vault, 'Cal.md'))).toBe(true)
        expect(existsSync(join(vault, 'Cal.base.jsonl'))).toBe(false)

        const run = await cli(vault, 'base', 'migrate', '--all')
        expect(run.code, run.stderr).toBe(0)
        expect(run.stdout).toContain(
            'migrated Cal.md -> Cal.base.jsonl (2 rows)',
        )
        expect(run.stdout).toContain(
            'migrated Deck.md -> Deck.base.jsonl (2 rows)',
        )
        expect(run.stdout).toContain('Notes.md -> Notes.base.jsonl (0 rows)')
        expect(run.stdout).not.toContain('plain.md')
        for (const n of ['Cal', 'Deck', 'Notes']) {
            expect(existsSync(join(vault, `${n}.md`))).toBe(false)
            expect(baseFormatOf(read(vault, `${n}.base.jsonl`))).toBe('jsonl')
        }
        expect(existsSync(join(vault, 'plain.md'))).toBe(true)
        const trashed = readdirSync(join(vault, '.trash')).join(' ')
        for (const n of ['Cal', 'Deck', 'Notes']) expect(trashed).toContain(n)

        const day = await cli(vault, 'calendar', 'day', 'Cal', '2026-10-08')
        expect(day.stdout).toBe(before.day.stdout)
        const rd = await cli(vault, 'base', 'read', 'Deck')
        expect(rd.code, rd.stderr).toBe(0)
        const strip = (s: string) =>
            JSON.parse(s).rows.map((r: { note: unknown }) => r.note)
        expect(strip(rd.stdout)).toEqual(strip(before.read.stdout))
        expect(JSON.parse(rd.stdout).config).toEqual(
            JSON.parse(before.read.stdout).config,
        )
        const render = await cli(vault, 'base', 'render', 'Notes')
        expect(render.code, render.stderr).toBe(0)
        // A source:notes base lists the vault's notes, and the migrated .md files left the vault
        // by design, so compare the one surviving note's row (plus the view shape).
        const survivors = (s: string) => {
            const r = JSON.parse(s)
            return {
                view: r.view,
                rows: r.groups
                    .flatMap((g: { rows: unknown[] }) => g.rows)
                    .filter(
                        (x: { file: { path: string } }) =>
                            x.file.path === 'plain.md',
                    )
                    .map((x: { file: { name: string }; note: unknown }) => [
                        x.file.name,
                        x.note,
                    ]),
            }
        }
        expect(survivors(render.stdout)).toEqual(
            survivors(before.render.stdout),
        )
        expect(survivors(render.stdout).rows).toHaveLength(1)
    })

    test('refuses an existing target and a non-base file; dry-run writes nothing', async () => {
        const vault = makeVault({
            'Cal.md': mdCalendar(),
            'Cal.base.jsonl': '{"type":"base","view":"calendar"}\n',
            'plain.md': '# note\n',
        })
        let r = await cli(vault, 'base', 'migrate', 'Cal.md')
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('already exists')
        expect(existsSync(join(vault, 'Cal.md'))).toBe(true)
        r = await cli(vault, 'base', 'migrate', 'plain.md')
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('not a `type: base` markdown file')
        r = await cli(vault, 'base', 'migrate', 'Cal.base.jsonl')
        expect(r.code).not.toBe(0)
        r = await cli(vault, 'base', 'migrate')
        expect(r.code).not.toBe(0)
    })

    test('migrating the legacy google sync base keeps sync targeting it', async () => {
        const vault = makeVault({
            '.settings':
                'googleCalendar:\n  enabled: true\n  basePath: Cal.md\n  calendarId: work@x.com\n',
            'Cal.md': mdCalendar(),
        })
        const legacy = (await loadAppConfig(vault)).googleCalendar
        expect(
            (await listGcalSyncTargets(vault, legacy)).map(t => t.basePath),
        ).toEqual(['Cal.md'])
        const r = await cli(vault, 'base', 'migrate', 'Cal.md')
        expect(r.code, r.stderr).toBe(0)
        const targets = await listGcalSyncTargets(vault, legacy)
        expect(targets).toEqual([
            { basePath: 'Cal.base.jsonl', calendarId: 'work@x.com' },
        ])
        const line1 = JSON.parse(read(vault, 'Cal.base.jsonl').split('\n')[0])
        expect(line1.googleCalendarSync).toBe(true)
    })

    test('prose around a table is reported as dropped; a body with no rows is refused', async () => {
        const vault = makeVault({
            'Mixed.md':
                '---\ntype: base\nview: table\n---\nSome prose here.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
            'Bad.md':
                '---\ntype: base\nview: table\n---\nonly prose, no rows\n',
        })
        let r = await cli(vault, 'base', 'migrate', 'Mixed.md')
        expect(r.code, r.stderr).toBe(0)
        expect(r.stdout).toContain('dropped 1 non-row lines')
        expect(existsSync(join(vault, 'Mixed.base.jsonl'))).toBe(true)
        r = await cli(vault, 'base', 'migrate', 'Bad.md')
        expect(r.code).not.toBe(0)
        expect(r.stderr).toContain('body text but no parseable rows')
        expect(existsSync(join(vault, 'Bad.md'))).toBe(true)
        expect(existsSync(join(vault, 'Bad.base.jsonl'))).toBe(false)
    })

    test('a body of only a table header migrates as 0 rows and says the header was dropped', async () => {
        const vault = makeVault({
            'Empty.md':
                '---\ntype: base\nview: table\n---\n| a | b |\n|---|---|\n',
        })
        const r = await cli(vault, 'base', 'migrate', 'Empty.md')
        expect(r.code, r.stderr).toBe(0)
        expect(r.stdout).toContain('(0 rows, dropped the table header')
        expect(existsSync(join(vault, 'Empty.base.jsonl'))).toBe(true)
        expect(existsSync(join(vault, 'Empty.md'))).toBe(false)
    })

    test('./Calendar.md and Calendar.md carry the legacy googleCalendar.basePath identically', async () => {
        for (const spelling of ['./Calendar.md', 'Calendar.md']) {
            const vault = makeVault({
                '.settings':
                    'googleCalendar:\n  enabled: true\n  basePath: Calendar.md\n  calendarId: work@x.com\n',
                'Calendar.md': mdCalendar(),
            })
            const r = await cli(vault, 'base', 'migrate', spelling)
            expect(r.code, r.stderr).toBe(0)
            expect(r.stdout).toContain(
                'migrated Calendar.md -> Calendar.base.jsonl',
            )
            const line1 = JSON.parse(
                read(vault, 'Calendar.base.jsonl').split('\n')[0],
            )
            expect(line1.googleCalendarSync).toBe(true)
            expect(line1.googleCalendarId).toBe('work@x.com')
        }
    })

    test('a hidden target is never named in the refusal', async () => {
        const vault = makeVault({
            'Cal.md': mdCalendar(),
            'Cal.base.jsonl':
                '{"type":"base","view":"calendar","visibility":"hidden"}\n',
        })
        const agent = await cliAs('daemon', vault, 'base', 'migrate', 'Cal.md')
        expect(agent.code).not.toBe(0)
        expect(agent.stderr).not.toContain('Cal.base.jsonl')
        const owner = await cli(vault, 'base', 'migrate', 'Cal.md')
        expect(owner.stderr).toContain('Cal.base.jsonl already exists')
    })

    test('a hidden markdown base keeps visibility: hidden on line 1 after migrating', async () => {
        const vault = makeVault({
            'Secret.md':
                '---\ntype: base\nview: table\nvisibility: hidden\n---\n| a |\n|---|\n| 1 |\n',
        })
        const r = await cli(vault, 'base', 'migrate', 'Secret.md')
        expect(r.code, r.stderr).toBe(0)
        const line1 = read(vault, 'Secret.base.jsonl').split('\n')[0]
        expect(line1).toContain('"visibility":"hidden"')
    })
})

describe('visibility gate', () => {
    test('an extensionless path into a hidden folder is refused for agents when it names a .base.jsonl', async () => {
        const vault = makeVault({
            '.settings': 'folderVisibility:\n  Vault Hidden: hidden\n',
            'Vault Hidden/Secret.base.jsonl':
                '{"type":"base","view":"table"}\n{"k":"SECRETTOKEN"}\n',
            'Open.base.jsonl': '{"type":"base","view":"table"}\n{"k":"OPEN"}\n',
        })
        const run = async (channel: string | undefined, path: string) => {
            const env: Record<string, string | undefined> = { ...process.env }
            delete env.BISMUTH_AGENT_CHANNEL
            delete env.BISMUTH_MCP_CHANNEL
            if (channel) env.BISMUTH_AGENT_CHANNEL = channel
            const proc = Bun.spawn(
                [
                    'bun',
                    'run',
                    join(REPO_ROOT, 'cli/src/index.ts'),
                    'base',
                    'read',
                    path,
                    '--vault',
                    vault,
                ],
                { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' },
            )
            const [stdout, code] = await Promise.all([
                new Response(proc.stdout).text(),
                proc.exited,
            ])
            return { stdout, code }
        }
        const owner = await run(undefined, 'Vault Hidden/Secret')
        expect(owner.stdout).toContain('SECRETTOKEN')
        const agent = await run('daemon', 'Vault Hidden/Secret')
        expect(agent.code).not.toBe(0)
        expect(agent.stdout).not.toContain('SECRETTOKEN')
        const open = await run('daemon', 'Open')
        expect(open.code).toBe(0)
        expect(open.stdout).toContain('OPEN')
    })
})
