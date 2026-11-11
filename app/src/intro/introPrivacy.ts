export type PrivacyId =
    | 'findAsksAi'
    | 'recall'
    | 'midTurn'
    | 'saveSessions'
    | 'dream'
    | 'notifications'
    | 'inheritUserMcp'
    | 'email'

/** Where a switch is saved: a `.settings` key, or a daemon cron's own `enabled:` line (the switch
 *  the daemon page's cron menu shows). */
export type PrivacyTarget = { path: string[]; cron?: never } | { cron: string; path?: never }

export type PrivacyWrite = PrivacyTarget & { value: boolean }

export type PrivacyOption = PrivacyTarget & {
    id: PrivacyId
    icon: string
    name: string
    desc: string
    needs?: PrivacyId
    /** Shown and written whether or not the daemon power-up is on (it needs only the agent every
     *  intro picks). Absent: a daemon switch, on the slide only with the daemon power-up. */
    noDaemon?: true
}

export const PRIVACY_OPTIONS: PrivacyOption[] = [
    {
        id: 'findAsksAi',
        path: ['editor', 'findAsksAi'],
        icon: 'Search',
        name: 'ask from find',
        desc: 'Find with no match asks your agent.',
        noDaemon: true,
    },
    {
        id: 'recall',
        path: ['daemon', 'recall', 'enabled'],
        icon: 'Brain',
        name: 'memory recall',
        desc: 'Memory notes are added to each prompt.',
    },
    {
        id: 'midTurn',
        path: ['daemon', 'recall', 'midTurn'],
        icon: 'Repeat',
        name: 'mid-turn recall',
        desc: 'Memory is also added between tool calls.',
        needs: 'recall',
    },
    {
        id: 'saveSessions',
        path: ['daemon', 'saveSessions'],
        icon: 'Archive',
        name: 'save sessions',
        desc: 'Finished sessions and chats become memory.',
    },
    {
        id: 'dream',
        cron: 'dream',
        icon: 'Moon',
        name: 'dream',
        desc: 'Hourly, changed notes are folded into memory.',
    },
    {
        id: 'notifications',
        path: ['daemon', 'notifications'],
        icon: 'Megaphone',
        name: 'notifications',
        desc: 'Desktop alerts for new inbox pages.',
    },
    {
        id: 'inheritUserMcp',
        path: ['daemon', 'inheritUserMcp'],
        icon: 'Server',
        name: 'your mcp servers',
        desc: 'Daemon runs can use your own MCP servers.',
    },
    {
        id: 'email',
        path: ['daemon', 'email', 'enabled'],
        icon: 'Send',
        name: 'email bridge',
        desc: 'Inbox pages by email; reply to act on them.',
    },
]

export type PrivacyLevelId = 'private' | 'ask' | 'recall' | 'assist' | 'full'

export type PrivacyLevel = { id: PrivacyLevelId; label: string; on: PrivacyId[] }

export const PRIVACY_LEVELS: PrivacyLevel[] = [
    { id: 'private', label: 'private', on: [] },
    { id: 'ask', label: 'ask', on: ['findAsksAi'] },
    { id: 'recall', label: 'recall', on: ['findAsksAi', 'recall'] },
    {
        id: 'assist',
        label: 'assist',
        on: ['findAsksAi', 'recall', 'midTurn', 'saveSessions', 'dream', 'notifications'],
    },
    { id: 'full', label: 'full', on: PRIVACY_OPTIONS.map(o => o.id) },
]

export type PrivacyValues = Record<PrivacyId, boolean>

/** Where the slide starts: the `ask` level, ask from find on and every daemon switch off. */
export const DEFAULT_PRIVACY: PrivacyValues = {
    findAsksAi: true,
    recall: false,
    midTurn: false,
    saveSessions: false,
    dream: false,
    notifications: false,
    inheritUserMcp: false,
    email: false,
}

export function applyLevel(level: PrivacyLevelId): PrivacyValues {
    const on = PRIVACY_LEVELS.find(l => l.id === level)?.on ?? []
    const values = Object.fromEntries(PRIVACY_OPTIONS.map(o => [o.id, on.includes(o.id)])) as PrivacyValues
    return values
}

export function levelOf(values: PrivacyValues): PrivacyLevelId | 'custom' {
    for (const level of PRIVACY_LEVELS) {
        if (PRIVACY_OPTIONS.every(o => values[o.id] === level.on.includes(o.id))) return level.id
    }
    return 'custom'
}

export function togglePrivacy(values: PrivacyValues, id: PrivacyId): PrivacyValues {
    const option = PRIVACY_OPTIONS.find(o => o.id === id)
    if (option?.needs && !values[option.needs]) return values
    const next = { ...values, [id]: !values[id] }
    if (next[id] === false) {
        for (const o of PRIVACY_OPTIONS) if (o.needs === id) next[o.id] = false
    }
    return next
}

/** The switches the slide shows: all of them with the daemon power-up, else only the noDaemon ones. */
export function privacyOptions(daemon: boolean): PrivacyOption[] {
    return daemon ? PRIVACY_OPTIONS : PRIVACY_OPTIONS.filter(o => o.noDaemon)
}

/** One write per switch the slide showed, off ones included. */
export function privacyWrites(values: PrivacyValues, daemon = true): PrivacyWrite[] {
    return privacyOptions(daemon).map(o =>
        o.cron === undefined
            ? { path: o.path, value: values[o.id] }
            : { cron: o.cron, value: values[o.id] },
    )
}
