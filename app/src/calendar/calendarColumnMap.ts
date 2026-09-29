// The calendar settings' column mapping, pure: which note column each calendar role binds to, the
// vocabulary of columns on offer, and the seed a base's view config resolves to. Keys match the
// base view-config keys (parse.ts reads these top-level keys into the default view).
export type FieldDef = {
    key: string
    role: string
    def: string
    req?: boolean
    hint: string
}

export const FIELDS: FieldDef[] = [
    {
        key: 'dateField',
        role: 'date',
        def: 'date',
        req: true,
        hint: 'which day each event lands on. required.',
    },
    {
        key: 'startTimeField',
        role: 'start-time',
        def: 'startTime',
        hint: 'when the event begins (week / day views).',
    },
    {
        key: 'endTimeField',
        role: 'end-time',
        def: 'endTime',
        hint: 'when the event ends — sets the block height.',
    },
    {
        key: 'recurrenceField',
        role: 'recurrence',
        def: 'recurrence',
        hint: 'holds the repeat rule (daily, weekly, …).',
    },
    {
        key: 'categoryField',
        role: 'category',
        def: 'category',
        hint: 'drives the colour each event is drawn in.',
    },
]

/** Columns always offered, unioned with whatever the note's events actually use. */
export const STD_COLS = [
    'date',
    'startTime',
    'endTime',
    'recurrence',
    'category',
    'title',
    'location',
    'link',
]

/** field key → column, seeded from a view config: an explicit string wins; an explicit empty
 *  string means "not set" for an optional field; otherwise the conventional default. */
export function seedColumnMap(
    view: Record<string, unknown> | undefined,
): Record<string, string> {
    const seed: Record<string, string> = {}
    for (const f of FIELDS) {
        const v = view?.[f.key]
        seed[f.key] =
            typeof v === 'string' ? v : f.req ? f.def : v === '' ? '' : f.def
    }
    return seed
}

export function defaultColumnMap(): Record<string, string> {
    return Object.fromEntries(FIELDS.map(f => [f.key, f.def]))
}

/** The standard columns plus every frontmatter key the rows carry (never `id`). */
export function columnVocabulary(
    rows: { note?: Record<string, unknown> }[],
): string[] {
    const found = new Set<string>(STD_COLS)
    for (const r of rows)
        for (const k of Object.keys(r.note ?? {})) if (k !== 'id') found.add(k)
    return [...found]
}

export function columnOptions(
    columns: string[],
    optional: boolean,
): { value: string; label: string }[] {
    return [
        ...(optional ? [{ value: '', label: 'not set' }] : []),
        ...columns.map(c => ({ value: c, label: c })),
    ]
}

/** Persist the column map onto the base's frontmatter in ONE batch. Throws when the base was
 *  deleted out from under the modal (the batch reports it as skipped) so the caller toasts
 *  instead of closing as if the save landed. */
export async function writeColumnMap(
    setProperties: (
        writes: Array<{ path: string; key: string; value: unknown }>,
    ) => Promise<{ skipped: string[] }>,
    basePath: string,
    map: Record<string, string>,
): Promise<void> {
    const { skipped } = await setProperties(
        FIELDS.map(f => ({
            path: basePath,
            key: f.key,
            value: map[f.key] ?? '',
        })),
    )
    if (skipped.includes(basePath)) throw new Error('base no longer exists')
}
