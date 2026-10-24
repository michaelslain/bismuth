import { expect } from 'bun:test'
import { makeVault } from '../../core/test/helpers'
import { isolateCliEnv, runCli, test } from './cliHarness'

isolateCliEnv()

test('`calendar override` splits a weekly series and overrides exactly ONE occurrence (verified via `range`)', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    const weekly = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-01',
        '--title',
        'Standup',
        '--rrule',
        'FREQ=WEEKLY;BYDAY=MO',
    )
    expect(weekly.code).toBe(0)
    const masterId = weekly.json.event.id as string

    const overrideResult = await runCli(
        vault,
        'calendar',
        'override',
        cal,
        masterId,
        '2026-01-12',
        '--title',
        'Standup (offsite)',
    )
    expect(overrideResult.code).toBe(0)
    expect(overrideResult.json).toEqual({ ok: true })

    const range = await runCli(
        vault,
        'calendar',
        'range',
        cal,
        '2026-01-05',
        '2026-01-19',
    )
    expect(range.code).toBe(0)
    const byDate = Object.fromEntries(
        range.json.map((e: any) => [e.date, e.title]),
    )
    expect(byDate['2026-01-05']).toBe('Standup') // untouched — before the split
    expect(byDate['2026-01-12']).toBe('Standup (offsite)') // the overridden occurrence
    expect(byDate['2026-01-19']).toBe('Standup') // untouched — series resumed after the split

    // Raw storage now holds 3 events: the truncated head segment, the resumed tail segment, and the
    // standalone override — not the 1 master it started as.
    expect((await runCli(vault, 'calendar', 'list', cal)).json).toHaveLength(3)
})

test('`calendar delete-occurrence` removes exactly ONE occurrence from a weekly series, no replacement (verified via `range`)', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    const weekly = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-01',
        '--title',
        'Standup',
        '--rrule',
        'FREQ=WEEKLY;BYDAY=MO',
    )
    const masterId = weekly.json.event.id as string

    const result = await runCli(
        vault,
        'calendar',
        'delete-occurrence',
        cal,
        masterId,
        '2026-01-12',
    )
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ ok: true })

    const range = await runCli(
        vault,
        'calendar',
        'range',
        cal,
        '2026-01-05',
        '2026-01-19',
    )
    expect(range.json.map((e: any) => e.date)).toEqual([
        '2026-01-05',
        '2026-01-19',
    ]) // Jan 12 gone, nothing put in its place
})

test('`calendar override` and `calendar delete-occurrence` both refuse a NON-recurring event, writing nothing', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    const single = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-05',
        '--title',
        'OneOff',
    )
    const id = single.json.event.id as string

    const override = await runCli(
        vault,
        'calendar',
        'override',
        cal,
        id,
        '2026-01-05',
        '--title',
        'Nope',
    )
    expect(override.code).toBe(1)
    expect(override.err).toContain('not a recurring event')

    const del = await runCli(
        vault,
        'calendar',
        'delete-occurrence',
        cal,
        id,
        '2026-01-05',
    )
    expect(del.code).toBe(1)
    expect(del.err).toContain('not a recurring event')

    expect((await runCli(vault, 'calendar', 'list', cal)).json).toHaveLength(1) // neither failed call wrote anything
})

test('`calendar category add` a duplicate name fails; categories on disk unchanged', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'category',
                'add',
                cal,
                'Work',
                '--color',
                '#111',
            )
        ).code,
    ).toBe(0)

    const dup = await runCli(
        vault,
        'calendar',
        'category',
        'add',
        cal,
        'Work',
        '--color',
        '#222',
    )
    expect(dup.code).toBe(1)
    expect(dup.err).toContain('already exists')

    expect((await runCli(vault, 'calendar', 'categories', cal)).json).toEqual([
        { name: 'Work', color: '#111' },
    ])
})

test("`calendar category update` on an unknown category fails, doesn't crash", async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    const result = await runCli(
        vault,
        'calendar',
        'category',
        'update',
        cal,
        'Ghost',
        '--color',
        '#fff',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('no category named Ghost')
})

test("`calendar category update --color` (no --rename) recolors without touching the name or any event's category string", async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'category',
                'add',
                cal,
                'Work',
                '--color',
                '#111',
            )
        ).code,
    ).toBe(0)
    const added = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-05',
        '--title',
        'Standup',
        '--category',
        'Work',
    )
    const id = added.json.event.id as string

    const result = await runCli(
        vault,
        'calendar',
        'category',
        'update',
        cal,
        'Work',
        '--color',
        '#222',
    )
    expect(result.code).toBe(0)
    expect(result.json.categories).toEqual([{ name: 'Work', color: '#222' }])

    const event = await runCli(vault, 'calendar', 'get', cal, id)
    expect(event.json.category).toBe('Work') // no rename happened — the event's category string is untouched
})

test('`calendar category remove` (no --reassign) clears the category off every event referencing it', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (await runCli(vault, 'calendar', 'category', 'add', cal, 'Work')).code,
    ).toBe(0)
    const added = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-05',
        '--title',
        'One',
        '--category',
        'Work',
    )
    const id = added.json.event.id as string

    const result = await runCli(
        vault,
        'calendar',
        'category',
        'remove',
        cal,
        'Work',
    )
    expect(result.code).toBe(0)
    expect(result.json.categories).toEqual([])

    const event = await runCli(vault, 'calendar', 'get', cal, id)
    expect(event.json.category).toBeUndefined()
})

test('`calendar category remove --reassign <other>` reassigns events instead of clearing them', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (await runCli(vault, 'calendar', 'category', 'add', cal, 'Work')).code,
    ).toBe(0)
    expect(
        (await runCli(vault, 'calendar', 'category', 'add', cal, 'Personal'))
            .code,
    ).toBe(0)
    const added = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-05',
        '--title',
        'One',
        '--category',
        'Work',
    )
    const id = added.json.event.id as string

    const result = await runCli(
        vault,
        'calendar',
        'category',
        'remove',
        cal,
        'Work',
        '--reassign',
        'Personal',
    )
    expect(result.code).toBe(0)
    expect(result.json.categories).toEqual([
        { name: 'Personal', color: 'accent' },
    ])

    const event = await runCli(vault, 'calendar', 'get', cal, id)
    expect(event.json.category).toBe('Personal')
})

test('`calendar category remove` errors: unknown category, unknown reassign target, and reassigning to itself — none of them write', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (await runCli(vault, 'calendar', 'category', 'add', cal, 'Work')).code,
    ).toBe(0)

    const unknownCat = await runCli(
        vault,
        'calendar',
        'category',
        'remove',
        cal,
        'Ghost',
    )
    expect(unknownCat.code).toBe(1)
    expect(unknownCat.err).toContain('no category named Ghost')

    const unknownReassign = await runCli(
        vault,
        'calendar',
        'category',
        'remove',
        cal,
        'Work',
        '--reassign',
        'Ghost',
    )
    expect(unknownReassign.code).toBe(1)
    expect(unknownReassign.err).toContain('Ghost')

    const selfReassign = await runCli(
        vault,
        'calendar',
        'category',
        'remove',
        cal,
        'Work',
        '--reassign',
        'Work',
    )
    expect(selfReassign.code).toBe(1)
    expect(selfReassign.err).toContain('cannot reassign')

    expect((await runCli(vault, 'calendar', 'categories', cal)).json).toEqual([
        { name: 'Work', color: 'accent' },
    ]) // untouched
})

// --- `calendar` group: missing/malformed required-arg validation, table-driven over every ------
// command in the group. Each row fails BEFORE any file I/O (verified above per-command for the
// mutating commands; here the table just confirms every command's OWN required-arg guards fire
// with a message that names what's missing, never a raw stack trace). One shared throwaway vault
// is safe since none of these rows ever reach a read/write.
const calendarArgValidationVault = makeVault({})
const calendarArgValidationCases: {
    label: string
    args: string[]
    expect: string
}[] = [
    {
        label: '`calendar create` (no basePath)',
        args: ['calendar', 'create'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar list` (no basePath)',
        args: ['calendar', 'list'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar range` (no basePath)',
        args: ['calendar', 'range'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar range <path>` (missing <from>/<to>)',
        args: ['calendar', 'range', 'X.md'],
        expect: '<from> and <to> (YYYY-MM-DD) required',
    },
    {
        label: '`calendar get` (no basePath)',
        args: ['calendar', 'get'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar get <path>` (no id)',
        args: ['calendar', 'get', 'X.md'],
        expect: '<id> required',
    },
    {
        label: '`calendar search` (no basePath)',
        args: ['calendar', 'search'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar search <path>` (no text)',
        args: ['calendar', 'search', 'X.md'],
        expect: '<text> required',
    },
    {
        label: '`calendar day` (no basePath)',
        args: ['calendar', 'day'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar day <path>` (no date)',
        args: ['calendar', 'day', 'X.md'],
        expect: '<date> (YYYY-MM-DD) required',
    },
    {
        label: '`calendar overlaps` (no basePath)',
        args: ['calendar', 'overlaps'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar overlaps <path>` (no date)',
        args: ['calendar', 'overlaps', 'X.md'],
        expect: '<date> (YYYY-MM-DD) required',
    },
    {
        label: '`calendar add` (no basePath)',
        args: ['calendar', 'add'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar add <path>` (no --date)',
        args: ['calendar', 'add', 'X.md'],
        expect: '--date (YYYY-MM-DD) required',
    },
    {
        label: '`calendar move` (no basePath)',
        args: ['calendar', 'move'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar move <path>` (no id)',
        args: ['calendar', 'move', 'X.md'],
        expect: '<id> required',
    },
    {
        label: '`calendar move <path> <id>` (nothing to update)',
        args: ['calendar', 'move', 'X.md', 'some-id'],
        expect: 'nothing to update',
    },
    {
        label: '`calendar delete` (no basePath)',
        args: ['calendar', 'delete'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar delete <path>` (no id)',
        args: ['calendar', 'delete', 'X.md'],
        expect: '<id> required',
    },
    {
        label: '`calendar override` (no basePath)',
        args: ['calendar', 'override'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar override <path>` (no id)',
        args: ['calendar', 'override', 'X.md'],
        expect: '<id> (recurring event) required',
    },
    {
        label: '`calendar override <path> <id>` (no date)',
        args: ['calendar', 'override', 'X.md', 'some-id'],
        expect: '<date> (YYYY-MM-DD occurrence) required',
    },
    {
        label: '`calendar delete-occurrence` (no basePath)',
        args: ['calendar', 'delete-occurrence'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar delete-occurrence <path>` (no id)',
        args: ['calendar', 'delete-occurrence', 'X.md'],
        expect: '<id> (recurring event) required',
    },
    {
        label: '`calendar delete-occurrence <path> <id>` (no date)',
        args: ['calendar', 'delete-occurrence', 'X.md', 'some-id'],
        expect: '<date> (YYYY-MM-DD occurrence) required',
    },
    {
        label: '`calendar categories` (no basePath)',
        args: ['calendar', 'categories'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar category add` (no basePath)',
        args: ['calendar', 'category', 'add'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar category add <path>` (no name)',
        args: ['calendar', 'category', 'add', 'X.md'],
        expect: '<name> required',
    },
    {
        label: '`calendar category update` (no basePath)',
        args: ['calendar', 'category', 'update'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar category update <path>` (no name)',
        args: ['calendar', 'category', 'update', 'X.md'],
        expect: '<name> required',
    },
    {
        label: '`calendar category update <path> <name>` (nothing to update)',
        args: ['calendar', 'category', 'update', 'X.md', 'SomeCat'],
        expect: 'nothing to update',
    },
    {
        label: '`calendar category remove` (no basePath)',
        args: ['calendar', 'category', 'remove'],
        expect: '<basePath> required',
    },
    {
        label: '`calendar category remove <path>` (no name)',
        args: ['calendar', 'category', 'remove', 'X.md'],
        expect: '<name> required',
    },
]

for (const c of calendarArgValidationCases) {
    test(`${c.label} fails non-zero with a usable message`, async () => {
        const result = await runCli(calendarArgValidationVault, ...c.args)
        expect(result.code).toBe(1)
        expect(result.err).toContain(c.expect)
    })
}
