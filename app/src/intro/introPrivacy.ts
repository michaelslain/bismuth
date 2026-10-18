export type PrivacyId = 'recall' | 'midTurn' | 'saveSessions' | 'dream' | 'notifications' | 'inheritUserMcp' | 'email'

export type PrivacyOption = {
    id: PrivacyId
    path: string[]
    icon: string
    name: string
    desc: string
    needs?: PrivacyId
}

export const PRIVACY_OPTIONS: PrivacyOption[] = [
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
        path: ['daemon', 'dream'],
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

export type PrivacyLevelId = 'private' | 'recall' | 'assist' | 'full'

export type PrivacyLevel = { id: PrivacyLevelId; label: string; on: PrivacyId[] }

export const PRIVACY_LEVELS: PrivacyLevel[] = [
    { id: 'private', label: 'private', on: [] },
    { id: 'recall', label: 'recall', on: ['recall'] },
    { id: 'assist', label: 'assist', on: ['recall', 'midTurn', 'saveSessions', 'dream', 'notifications'] },
    { id: 'full', label: 'full', on: PRIVACY_OPTIONS.map(o => o.id) },
]

export type PrivacyValues = Record<PrivacyId, boolean>

export const DEFAULT_PRIVACY: PrivacyValues = {
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
    const values = { ...DEFAULT_PRIVACY }
    for (const id of on) values[id] = true
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

export function privacyWrites(values: PrivacyValues): { path: string[]; value: boolean }[] {
    return PRIVACY_OPTIONS.map(o => ({ path: o.path, value: values[o.id] }))
}
