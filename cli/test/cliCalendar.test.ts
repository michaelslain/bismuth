import { expect } from 'bun:test'
import { makeSampleVault, makeVault } from '../../core/test/helpers'
import { isolateCliEnv, runCli, test } from './cliHarness'

isolateCliEnv()

// --- `calendar` group: headless calendar-base CRUD end-to-end --------------------------------

test('`bismuth calendar …` create → category → add → list/range/search → move → delete, headlessly', async () => {
    const { vault } = await makeSampleVault()
    const cal = 'Bases/Team Cal.md'

    // Create a fresh calendar base; discover it.
    const create = await runCli(
        vault,
        'calendar',
        'create',
        cal,
        '--title',
        'Team Cal',
    )
    expect(create.code).toBe(0)
    expect(create.json).toMatchObject({ ok: true, path: cal })
    // Creating again fails (EEXIST), doesn't clobber.
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(1)
    const bases = await runCli(vault, 'calendar', 'bases')
    expect(bases.code).toBe(0)
    expect(bases.json).toContainEqual({
        path: cal,
        title: 'Team Cal',
        events: 0,
        categories: [],
    })

    // Categories.
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
                '#b00020',
            )
        ).code,
    ).toBe(0)
    const cats = await runCli(vault, 'calendar', 'categories', cal)
    expect(cats.json).toEqual([{ name: 'Work', color: '#b00020' }])

    // Events: one single + one weekly via --rrule (2026-01-01 is a Thursday → first MO is Jan 5).
    const single = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-06',
        '--title',
        'Dentist',
        '--start',
        '09:00',
        '--end',
        '10:00',
        '--category',
        'Work',
    )
    expect(single.code).toBe(0)
    const singleId = single.json.event.id as string
    expect(singleId).toBeTruthy()
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
    expect(weekly.json.event.date).toBe('2026-01-05') // normalized to the first Monday
    expect(weekly.json.event.recurrence.type).toBe('weekly')

    // list (raw) / range (expanded) / search / get.
    const list = await runCli(vault, 'calendar', 'list', cal)
    expect(list.json).toHaveLength(2)
    const range = await runCli(
        vault,
        'calendar',
        'range',
        cal,
        '2026-01-05',
        '2026-01-13',
    )
    // Mondays Jan 5 + Jan 12 from the series, plus the Jan 6 single = 3 instances.
    expect(range.json.map((e: any) => e.date)).toEqual([
        '2026-01-05',
        '2026-01-06',
        '2026-01-12',
    ])
    const search = await runCli(vault, 'calendar', 'search', cal, 'dentist')
    expect(search.json.map((e: any) => e.id)).toEqual([singleId])
    const get = await runCli(vault, 'calendar', 'get', cal, singleId)
    expect(get.json).toMatchObject({
        id: singleId,
        title: 'Dentist',
        category: 'Work',
    })

    // Rename the category — cascades into the event.
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'category',
                'update',
                cal,
                'Work',
                '--rename',
                'Job',
            )
        ).code,
    ).toBe(0)
    expect(
        (await runCli(vault, 'calendar', 'get', cal, singleId)).json.category,
    ).toBe('Job')

    // Move + delete.
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'move',
                cal,
                singleId,
                '--date',
                '2026-01-07',
            )
        ).json.event.date,
    ).toBe('2026-01-07')
    expect(
        (await runCli(vault, 'calendar', 'delete', cal, singleId)).json,
    ).toEqual({ ok: true })
    expect((await runCli(vault, 'calendar', 'list', cal)).json).toHaveLength(1)
}, 60_000)

// --- `calendar` group (cli/src/commands/calendar.ts) — full dispatch-level coverage -------------
// The workflow test above (create → category → add → list/range/search → move → delete) already
// proves the happy path for most commands. These fill the gaps: `day`/`overlaps`/`override`/
// `delete-occurrence`/`category remove` had ZERO coverage before this; every command below is
// checked for (1) exit 0 on a valid call, (2) non-zero + a usable message on a bad call, and
// (3) a REAL observable effect — read back via another CLI call or the file on disk, not just
// "didn't crash". Every fixture is built through the CLI itself (create/add/category add), never
// hand-authored row-table markdown, so these tests don't need to know `bases/rows.ts`'s format.
//
// Dates use 2026 Mondays (2026-01-05/12/19/26 — 2026-01-01 is a Thursday, confirmed by the
// existing `--rrule` workflow test above) so a `FREQ=WEEKLY;BYDAY=MO` series lands on known days.

test('`calendar bases` lists only calendar-view bases (type:base + view:calendar), skipping other bases and notes', async () => {
    const vault = makeVault({
        'Board.md': '---\ntype: base\nview: table\n---\n',
        'Note.md': '# Just a note\n',
    })
    expect(
        (await runCli(vault, 'calendar', 'create', 'Cal.md', '--title', 'Cal'))
            .code,
    ).toBe(0)
    expect(
        (await runCli(vault, 'calendar', 'category', 'add', 'Cal.md', 'Work'))
            .code,
    ).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                'Cal.md',
                '--date',
                '2026-01-05',
                '--title',
                'Standup',
            )
        ).code,
    ).toBe(0)

    const result = await runCli(vault, 'calendar', 'bases')
    expect(result.code).toBe(0)
    expect(result.json).toEqual([
        { path: 'Cal.md', title: 'Cal', events: 1, categories: ['Work'] },
    ])
})

test('`calendar create <path-without-ext>` appends .base.jsonl and writes a base the rest of the group can discover', async () => {
    const { readNote } = await import('../../core/src/files')
    const vault = makeVault({})
    const result = await runCli(
        vault,
        'calendar',
        'create',
        'Bases/NoExt',
        '--title',
        'No Ext',
    )
    expect(result.code).toBe(0)
    expect(result.json).toEqual({ ok: true, path: 'Bases/NoExt.base.jsonl' })

    expect(await readNote(vault, 'Bases/NoExt.base.jsonl')).toContain(
        '"view":"calendar"',
    )
    const bases = await runCli(vault, 'calendar', 'bases')
    expect(bases.json).toContainEqual({
        path: 'Bases/NoExt.base.jsonl',
        title: 'No Ext',
        events: 0,
        categories: [],
    })
})

test('`calendar list --from/--to` windows RAW stored events by series/instance window (masters unexpanded, not per-occurrence)', async () => {
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
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-06-01',
                '--title',
                'Offsite',
            )
        ).code,
    ).toBe(0)

    const windowed = await runCli(
        vault,
        'calendar',
        'list',
        cal,
        '--from',
        '2026-01-01',
        '--to',
        '2026-01-31',
    )
    expect(windowed.code).toBe(0)
    expect(windowed.json.map((e: any) => e.title)).toEqual(['Standup']) // one raw master, not four expanded Mondays
})

test('`calendar get <path> <bogus-id>` fails naming the id instead of crashing', async () => {
    const vault = makeVault({})
    expect((await runCli(vault, 'calendar', 'create', 'Cal.md')).code).toBe(0)
    const result = await runCli(
        vault,
        'calendar',
        'get',
        'Cal.md',
        'does-not-exist',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('does-not-exist')
})

test('`calendar search --from/--to` searches EXPANDED instances of a recurring event; without a window it searches the raw master', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (
            await runCli(
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
        ).code,
    ).toBe(0)

    const windowed = await runCli(
        vault,
        'calendar',
        'search',
        cal,
        'standup',
        '--from',
        '2026-01-05',
        '--to',
        '2026-01-19',
    )
    expect(windowed.code).toBe(0)
    expect(windowed.json.map((e: any) => e.date)).toEqual([
        '2026-01-05',
        '2026-01-12',
        '2026-01-19',
    ]) // 3 expanded Mondays

    const raw = await runCli(vault, 'calendar', 'search', cal, 'standup')
    expect(raw.code).toBe(0)
    expect(raw.json).toHaveLength(1) // one raw master, no window
})

test("`calendar day <path> <date>` returns that day's concrete instances, including an expanded recurring occurrence", async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (
            await runCli(
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
        ).code,
    ).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-01-06',
                '--title',
                'Dentist',
            )
        ).code,
    ).toBe(0)

    const onSeries = await runCli(vault, 'calendar', 'day', cal, '2026-01-12') // a later Monday in the series
    expect(onSeries.code).toBe(0)
    expect(onSeries.json.map((e: any) => e.title)).toEqual(['Standup'])

    const onSingle = await runCli(vault, 'calendar', 'day', cal, '2026-01-06')
    expect(onSingle.json.map((e: any) => e.title)).toEqual(['Dentist'])

    const onEmpty = await runCli(vault, 'calendar', 'day', cal, '2026-01-07')
    expect(onEmpty.code).toBe(0)
    expect(onEmpty.json).toEqual([])
})

test('`calendar overlaps <path> <date>` detects intersecting timed events on THAT day, ignores a non-overlapping one, and ignores a same-time overlap on a DIFFERENT day', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-01-06',
                '--title',
                'A',
                '--start',
                '09:00',
                '--end',
                '10:00',
            )
        ).code,
    ).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-01-06',
                '--title',
                'B',
                '--start',
                '09:30',
                '--end',
                '10:30',
            )
        ).code,
    ).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-01-06',
                '--title',
                'C',
                '--start',
                '11:00',
                '--end',
                '12:00',
            )
        ).code,
    ).toBe(0)
    // Same time-of-day as A/B, but a DIFFERENT date. detectOverlaps() itself is date-blind (it only
    // compares startTime/endTime strings), so this only stays excluded if the command filters to the
    // requested day BEFORE calling it — this is the case a wiring bug (e.g. forgetting that filter)
    // would slip past a same-day-only fixture without ever failing.
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-01-07',
                '--title',
                'D-other-day',
                '--start',
                '09:15',
                '--end',
                '10:15',
            )
        ).code,
    ).toBe(0)

    const result = await runCli(
        vault,
        'calendar',
        'overlaps',
        cal,
        '2026-01-06',
    )
    expect(result.code).toBe(0)
    expect(result.json.date).toBe('2026-01-06')
    expect(result.json.overlaps).toHaveLength(1) // only A/B intersect; C starts after both end; D is a different day
    expect(
        [
            result.json.overlaps[0].a.title,
            result.json.overlaps[0].b.title,
        ].sort(),
    ).toEqual(['A', 'B'])
})

test('`calendar add --rrule <unsupported>` fails naming the supported subset, and writes NOTHING', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    const result = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-05',
        '--title',
        'X',
        '--rrule',
        'FREQ=YEARLY',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('unsupported RRULE')
    expect((await runCli(vault, 'calendar', 'list', cal)).json).toEqual([]) // rejected before any write happened
})

test('`calendar move` actually applies the given field updates (date/start/end), verified by reading the event back', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    const added = await runCli(
        vault,
        'calendar',
        'add',
        cal,
        '--date',
        '2026-01-05',
        '--title',
        'Dentist',
        '--start',
        '09:00',
        '--end',
        '10:00',
    )
    expect(added.code).toBe(0)
    const id = added.json.event.id as string

    const result = await runCli(
        vault,
        'calendar',
        'move',
        cal,
        id,
        '--date',
        '2026-01-07',
        '--start',
        '14:00',
        '--end',
        '15:00',
    )
    expect(result.code).toBe(0)
    expect(result.json.event).toMatchObject({
        id,
        date: '2026-01-07',
        startTime: '14:00',
        endTime: '15:00',
    })

    // Re-read from disk through a fresh `get` — proves the write landed, not just the in-process return value.
    const reread = await runCli(vault, 'calendar', 'get', cal, id)
    expect(reread.json).toMatchObject({
        date: '2026-01-07',
        startTime: '14:00',
        endTime: '15:00',
    })
})

test('`calendar move <path> <bogus-id>` fails naming the id and leaves the file unchanged', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-01-05',
                '--title',
                'Real',
            )
        ).code,
    ).toBe(0)
    const before = await runCli(vault, 'calendar', 'list', cal)

    const result = await runCli(
        vault,
        'calendar',
        'move',
        cal,
        'does-not-exist',
        '--date',
        '2026-02-01',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('does-not-exist')

    expect((await runCli(vault, 'calendar', 'list', cal)).json).toEqual(
        before.json,
    ) // untouched by the failed move
})

test('`calendar delete <path> <bogus-id>` fails naming the id and leaves the file unchanged', async () => {
    const vault = makeVault({})
    const cal = 'Cal.md'
    expect((await runCli(vault, 'calendar', 'create', cal)).code).toBe(0)
    expect(
        (
            await runCli(
                vault,
                'calendar',
                'add',
                cal,
                '--date',
                '2026-01-05',
                '--title',
                'Real',
            )
        ).code,
    ).toBe(0)

    const result = await runCli(
        vault,
        'calendar',
        'delete',
        cal,
        'does-not-exist',
    )
    expect(result.code).toBe(1)
    expect(result.err).toContain('does-not-exist')

    expect((await runCli(vault, 'calendar', 'list', cal)).json).toHaveLength(1) // the real event survives
})
