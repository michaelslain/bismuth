import { test as bunTest, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeVault, tempDir } from '../../core/test/helpers'
import { createServer } from '../../core/src/server'
import {
    manifestKey,
    readManifest,
    writeManifest,
} from '../../core/src/gcal/manifest'
import {
    parseCalendarFile,
    serializeCalendarFile,
} from '../../core/src/calendar'
import type { CalendarEvent } from '../../core/src/calendar'
import { baseFormatOf } from '../../core/src/bases/baseFile'
import { parseBaseFile } from '../../core/src/bases/parse'
import { reassemble } from '../../core/src/bases/rowOps'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, 180_000)

type Run = { code: number; stdout: string; stderr: string }

async function cli(vault: string, ...args: string[]): Promise<Run> {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
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

const ok = (r: Run) => {
    expect(r.code, r.stderr).toBe(0)
    return r
}
const read = (vault: string, rel: string) =>
    readFileSync(join(vault, rel), 'utf8')

const pad = (n: number) => String(n).padStart(2, '0')

function makeEvents(count: number): CalendarEvent[] {
    const events: CalendarEvent[] = []
    for (let i = 0; i < count; i++) {
        const day = new Date(Date.UTC(2026, 0, 1 + (i % 360)))
        const date = day.toISOString().slice(0, 10)
        const ev: CalendarEvent = {
            id: `ev-${i}`,
            title: `Event ${i}`,
            date,
        }
        if (i % 3 !== 0) {
            ev.startTime = `${pad(8 + (i % 9))}:00`
            ev.endTime = `${pad(9 + (i % 9))}:00`
        }
        if (i % 25 === 0) {
            ev.description = `Notes for event ${i}\nsecond line, with: colon`
            ev.category = 'Work'
        }
        if (i % 20 === 0) {
            ev.recurrence = {
                type: 'weekly',
                daysOfWeek: [day.getUTCDay()],
                startDate: date,
                endDate: '2026-12-31',
                seriesId: `series-${i}`,
            }
        }
        events.push(ev)
    }
    // two events pinned to the day check 3 greps for
    events[1].date = '2026-03-17'
    events[2].date = '2026-03-17'
    events[1].recurrence = undefined
    events[2].recurrence = undefined
    return events
}

/** An own-row YAML-list flashcards base, the shape real decks have: no `source:`, block
 *  scalars, LaTeX, image markdown, a `section:` column and SRS state on some rows. */
function makeDeck(count: number): string {
    const lines = [
        '---',
        'type: base',
        'tags: [flashcards]',
        'view: flashcards',
        'frontField: front',
        'backField: back',
        'dueField: due',
        '---',
    ]
    for (let i = 0; i < count; i++) {
        const section = `section ${i % 7}`
        switch (i % 5) {
            case 0:
                lines.push(
                    '- front: |',
                    `    What is the limit ${i}?`,
                    '    Take $x \\sim y$ as given',
                    `  back: |`,
                    `    $\\frac{a}{b}$ equals ${i}`,
                    '    second line: with colon',
                    `  section: ${section}`,
                )
                break
            case 1:
                lines.push(
                    `- front: "![](https://example.com/x${i}.png)"`,
                    `  back: "answer ${i} ![](https://example.com/y${i}.png)"`,
                    `  section: ${section}`,
                )
                break
            case 2:
                lines.push(
                    `- front: 'Simplify $\\frac{a}{b}$ for ${i}'`,
                    `  back: '$\\sim$ ${i}'`,
                )
                break
            case 3:
                lines.push(
                    `- front: question ${i}`,
                    `  back: answer ${i}`,
                    `  section: ${section}`,
                    `  due: 2026-10-${pad(1 + (i % 28))}`,
                    '  ease: 2.5',
                    `  interval: ${1 + (i % 30)}`,
                )
                break
            default:
                lines.push(`- front: question ${i}`, `  back: answer ${i}`)
        }
    }
    return lines.join('\n') + '\n'
}

function makeFiles() {
    return {
        'Calendar.md': serializeCalendarFile(
            {
                type: 'base',
                view: 'calendar',
                title: 'Big',
                categories: [{ name: 'Work', color: '#336699' }],
            },
            makeEvents(300),
            'md',
        ),
        'Deck.md': makeDeck(1500),
        'Ref.md':
            '---\ntype: base\nview: table\nsource: notes\nfrom: "[[Deck]]"\n---\n',
        'plain.md': '---\nstatus: open\n---\n# plain note\n',
    }
}

const rowsOf = (stdout: string) =>
    JSON.parse(stdout).rows.map((r: { note: unknown }) => r.note)

async function migrated() {
    const vault = makeVault(makeFiles())
    const before = {
        day: ok(await cli(vault, 'calendar', 'day', 'Calendar', '2026-03-17')),
        range: ok(
            await cli(
                vault,
                'calendar',
                'range',
                'Calendar',
                '2026-03-01',
                '2026-04-30',
            ),
        ),
        readCal: ok(await cli(vault, 'base', 'read', 'Calendar')),
        readDeck: ok(await cli(vault, 'base', 'read', 'Deck')),
        renderDeck: ok(await cli(vault, 'base', 'render', 'Deck')),
        renderRef: ok(await cli(vault, 'base', 'render', 'Ref')),
    }
    const run = ok(await cli(vault, 'base', 'migrate', '--all'))
    return { vault, before, run }
}

test('1: migrate --all converts calendar, flashcards and from-ref bases', async () => {
    const { vault, run } = await migrated()
    expect(run.stdout).toContain(
        'Calendar.md -> Calendar.base.jsonl (300 rows)',
    )
    expect(run.stdout).toContain('Deck.md -> Deck.base.jsonl (1500 rows)')
    expect(run.stdout).toContain('Ref.md -> Ref.base.jsonl (0 rows)')
    for (const n of ['Calendar', 'Deck', 'Ref']) {
        expect(existsSync(join(vault, `${n}.md`))).toBe(false)
        expect(baseFormatOf(read(vault, `${n}.base.jsonl`))).toBe('jsonl')
    }
    expect(existsSync(join(vault, 'plain.md'))).toBe(true)
    expect(
        read(vault, 'Calendar.base.jsonl').trimEnd().split('\n'),
    ).toHaveLength(301)
    expect(read(vault, 'Deck.base.jsonl').trimEnd().split('\n')).toHaveLength(
        1501,
    )
    expect(
        parseCalendarFile(read(vault, 'Calendar.base.jsonl')).events,
    ).toHaveLength(300)
})

test('2: day, range, read and render outputs are identical after migration', async () => {
    const { vault, before } = await migrated()
    const day = ok(
        await cli(vault, 'calendar', 'day', 'Calendar', '2026-03-17'),
    )
    expect(day.stdout).toBe(before.day.stdout)
    const range = ok(
        await cli(
            vault,
            'calendar',
            'range',
            'Calendar',
            '2026-03-01',
            '2026-04-30',
        ),
    )
    expect(range.stdout).toBe(before.range.stdout)

    const readCal = ok(await cli(vault, 'base', 'read', 'Calendar'))
    expect(rowsOf(readCal.stdout)).toEqual(rowsOf(before.readCal.stdout))
    expect(JSON.parse(readCal.stdout).config).toEqual(
        JSON.parse(before.readCal.stdout).config,
    )
    // The deck is an own-row base: its rows live in the file, so the full output survives
    // migration byte for byte once the renamed file path is normalised.
    const norm = (t: string) => t.replaceAll('Deck.md', 'Deck.base.jsonl')
    const readDeck = ok(await cli(vault, 'base', 'read', 'Deck'))
    expect(rowsOf(readDeck.stdout)).toHaveLength(1500)
    expect(readDeck.stdout).toBe(norm(before.readDeck.stdout))
    const renderDeck = ok(await cli(vault, 'base', 'render', 'Deck'))
    expect(renderDeck.stdout).toBe(norm(before.renderDeck.stdout))
    expect(renderDeck.stdout).toContain('question 4')
    // A source:notes-free Ref lists the vault's notes; the migrated .md files leave the vault
    // by design, so compare the surviving plain note's row.
    const groupsOf = (s: string) =>
        JSON.parse(s).groups.flatMap(
            (g: { rows: { file: { path: string }; note: unknown }[] }) =>
                g.rows.filter(r => r.file.path === 'plain.md').map(r => r.note),
        )
    // Ref selects through `from:`; the migrated .md files leave the vault by design, so
    // the survivors (non-base notes) and the view shape must match.
    const renderRef = ok(await cli(vault, 'base', 'render', 'Ref'))
    expect(JSON.parse(renderRef.stdout).view).toEqual(
        JSON.parse(before.renderRef.stdout).view,
    )
    expect(groupsOf(renderRef.stdout)).toEqual(
        groupsOf(before.renderRef.stdout),
    )
})

test('3: grep for one date returns whole events, one per line', async () => {
    const { vault } = await migrated()
    const lines = read(vault, 'Calendar.base.jsonl')
        .split('\n')
        .filter(l => l.includes('"2026-03-17"'))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const ids = new Set<string>()
    for (const l of lines) {
        const ev = JSON.parse(l)
        expect(typeof ev.title).toBe('string')
        expect(ev.id).toBeTruthy()
        ids.add(ev.id)
    }
    expect(ids.has('ev-1') && ids.has('ev-2')).toBe(true)
    const proc = Bun.spawn(
        ['grep', '2026-03-17', join(vault, 'Calendar.base.jsonl')],
        { stdout: 'pipe' },
    )
    const out = (await new Response(proc.stdout).text()).trimEnd().split('\n')
    expect(out).toEqual(lines)
})

test('4: row update on row 7 changes exactly one line', async () => {
    const { vault } = await migrated()
    const file = 'Deck.base.jsonl'
    const before = read(vault, file).split('\n')
    ok(
        await cli(
            vault,
            'row',
            'update',
            'Deck',
            '7',
            '--json',
            '{"front":"question 7","back":"edited answer"}',
        ),
    )
    const after = read(vault, file).split('\n')
    expect(after).toHaveLength(before.length)
    const changed = after.filter((l, i) => l !== before[i])
    expect(changed).toHaveLength(1)
    expect(changed[0]).toContain('edited answer')
    expect(after[0]).toBe(before[0])
})

test('5: calendar add then a gcal-style reassemble stays valid JSONL with both events', async () => {
    const { vault } = await migrated()
    ok(
        await cli(
            vault,
            'calendar',
            'add',
            'Calendar',
            '--date',
            '2026-11-05',
            '--title',
            'Added by cli',
        ),
    )
    const text = read(vault, 'Calendar.base.jsonl')
    expect(baseFormatOf(text)).toBe('jsonl')
    const { rows, config } = parseBaseFile(text, {
        name: 'Calendar',
        path: 'Calendar.base.jsonl',
    })
    expect(rows).toHaveLength(301)
    const gcalRow = {
        ...rows[0],
        note: {
            id: 'gcal-1',
            title: 'From gcal',
            date: '2026-11-06',
            startTime: '10:00',
            endTime: '11:00',
        },
    }
    const out = reassemble(text, rows.concat([gcalRow as never]), config)
    const lines = out.trimEnd().split('\n')
    expect(lines).toHaveLength(303)
    for (const l of lines) JSON.parse(l)
    const parsed = parseCalendarFile(out)
    expect(parsed.format).toBe('jsonl')
    const titles = parsed.events.map(e => e.title)
    expect(titles).toContain('Added by cli')
    expect(titles).toContain('From gcal')
    // untouched rows stay byte-identical
    expect(lines.slice(0, 302)).toEqual(text.trimEnd().split('\n'))
})

test('6: card review on row 3 changes exactly one line and keeps the config line', async () => {
    const { vault } = await migrated()
    const file = 'Deck.base.jsonl'
    const before = read(vault, file).split('\n')
    ok(
        await cli(
            vault,
            'card',
            'review',
            '--file',
            'Deck',
            '--index',
            '3',
            '--response',
            'good',
        ),
    )
    const after = read(vault, file).split('\n')
    expect(after).toHaveLength(before.length)
    const changed = after.filter((l, i) => l !== before[i])
    expect(changed).toHaveLength(1)
    expect(after[4]).not.toBe(before[4])
    expect(after[0]).toBe(before[0])
    expect(JSON.parse(after[4]).due).toBeTruthy()
})

/** Run `fn` with BISMUTH_GCAL_DIR pointing at a fresh temp dir (never the real ~/.bismuth/gcal),
 *  so the CLI children and the in-process server share one manifest. */
async function withGcalDir<T>(fn: () => Promise<T>): Promise<T> {
    const prev = process.env.BISMUTH_GCAL_DIR
    process.env.BISMUTH_GCAL_DIR = tempDir('bismuth-gcal-e2e-')
    try {
        return await fn()
    } finally {
        if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = prev
    }
}

const syncEntry = (id: string) => ({
    links: { g1: { bismuthId: id } },
    syncToken: 'tok',
})

const CAL = (title: string) =>
    serializeCalendarFile(
        { type: 'base', view: 'calendar', title },
        [{ id: 'e1', title: 'One', date: '2026-03-17' }],
        'md',
    )

test('7: migrate ./Cal.md carries legacy sync, then a move re-keys it', () =>
    withGcalDir(async () => {
        const vault = makeVault({ 'Cal.md': CAL('Cal') })
        writeManifest({
            bases: { [manifestKey(vault, 'Cal.md')]: syncEntry('x') },
        })
        const run = ok(await cli(vault, 'base', 'migrate', './Cal.md'))
        expect(run.stdout).toContain('Cal.md -> Cal.base.jsonl')
        expect(existsSync(join(vault, 'Cal.md'))).toBe(false)
        expect(Object.keys(readManifest().bases)).toEqual([
            manifestKey(vault, 'Cal.base.jsonl'),
        ])

        // Rename through the move route: the manifest entry follows the file.
        const memory = tempDir('bismuth-memory-')
        const server = createServer({ vault, memory, port: 0 })
        try {
            const res = await fetch(`http://localhost:${server.port}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: 'Cal.base.jsonl',
                    to: 'Renamed.base.jsonl',
                }),
            })
            expect(res.status).toBe(200)
        } finally {
            server.stop(true)
        }
        expect(existsSync(join(vault, 'Renamed.base.jsonl'))).toBe(true)
        const bases = readManifest().bases
        expect(Object.keys(bases)).toEqual([
            manifestKey(vault, 'Renamed.base.jsonl'),
        ])
        expect(
            bases[manifestKey(vault, 'Renamed.base.jsonl')]!.links.g1!
                .bismuthId,
        ).toBe('x')
    }))

test('8: rename of an already-migrated synced calendar through the move route', () =>
    withGcalDir(async () => {
        const vault = makeVault({ 'Cal.md': CAL('Cal') })
        ok(await cli(vault, 'base', 'migrate', 'Cal'))
        writeManifest({
            bases: { [manifestKey(vault, 'Cal.base.jsonl')]: syncEntry('y') },
        })
        const server = createServer({
            vault,
            memory: tempDir('bismuth-memory-'),
            port: 0,
        })
        try {
            const res = await fetch(`http://localhost:${server.port}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: 'Cal.base.jsonl',
                    to: 'Work.base.jsonl',
                }),
            })
            expect(res.status).toBe(200)
        } finally {
            server.stop(true)
        }
        expect(Object.keys(readManifest().bases)).toEqual([
            manifestKey(vault, 'Work.base.jsonl'),
        ])
    }))

test('9: calendar bases survives one broken calendar', async () => {
    const good = serializeCalendarFile(
        { type: 'base', view: 'calendar', title: 'Good' },
        [{ id: 'e1', title: 'One', date: '2026-03-17' }],
        'jsonl',
    )
    const broken = good.split('\n')[0] + '\n{"id":"e2","title":"Two","date":\n'
    const vault = makeVault({
        'Good.base.jsonl': good,
        'Broken.base.jsonl': broken,
    })
    const r = ok(await cli(vault, 'calendar', 'bases', '--json'))
    const list = JSON.parse(r.stdout) as {
        path: string
        events: number
        error?: string
    }[]
    const byPath = Object.fromEntries(list.map(c => [c.path, c]))
    expect(byPath['Good.base.jsonl']).toMatchObject({ events: 1 })
    expect(byPath['Good.base.jsonl']!.error).toBeUndefined()
    expect(byPath['Broken.base.jsonl']).toMatchObject({
        events: 0,
        error: 'unparseable',
    })
})
