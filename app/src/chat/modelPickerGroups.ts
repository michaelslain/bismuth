// app/src/chat/modelPickerGroups.ts
// Pure grouping for ChatModelPicker's model list — no framework imports, so it is unit-testable.
// opencode models group by the `group` core stamps on each entry (`id` keys it, `label` heads it,
// `kind` orders it: local, cloud, zen); an entry without one falls back to the part of its value
// before the FIRST `/` (`bismuth`, the rotating free entry, joins `opencode`). Rows show the model's
// own name through `modelWord`, the id's remainder only when the label is the bare id. Every other
// connector is one flat, unnamed group showing the model's own label.
import type { ChatModelOption } from './chatSession'
import type { ChatProviderChoice } from './chatProvider'
import { modelWord } from './modelWord'

export type PickerModel = ChatModelOption & { shortLabel: string }
export type PickerGroup = {
    name: string
    kind: 'local' | 'cloud' | 'zen' | ''
    /** Every row in the group is free: the heading carries `free` and no row repeats it. */
    free: boolean
    models: PickerModel[]
}

const KIND_ORDER = { local: 0, cloud: 1, zen: 2 } as const

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function groupModels(
    models: ChatModelOption[],
    provider: ChatProviderChoice,
): PickerGroup[] {
    if (provider !== 'opencode') {
        return [
            {
                name: '',
                kind: '',
                free: false,
                models: models.map(m => ({ ...m, shortLabel: m.label })),
            },
        ]
    }
    const groups: (PickerGroup & { id: string })[] = []
    for (const m of models) {
        const slash = m.value.indexOf('/')
        const prefix = slash > 0 ? m.value.slice(0, slash) : ''
        const fallbackId = prefix.toLowerCase() === 'bismuth' ? 'opencode' : prefix.toLowerCase()
        const id = m.group?.id ?? fallbackId
        const name = (m.group?.label ?? fallbackId).toLowerCase()
        const kind =
            m.group?.kind ??
            (id === 'opencode' || id === 'bismuth' ? 'zen' : 'cloud')
        const rest = slash > 0 ? m.value.slice(slash + 1) : m.value
        const shortLabel =
            !m.label || m.label === m.value
                ? rest
                : modelWord(m.label).replace(
                      new RegExp(`\\s*\\(${escapeRe(prefix.toLowerCase())}\\)$`),
                      '',
                  )
        let g = groups.find(x => x.id === id)
        if (!g) groups.push((g = { id, name, kind, free: false, models: [] }))
        g.models.push({ ...m, shortLabel })
    }
    for (const g of groups) g.free = g.models.every(m => m.free === true)
    return groups
        .map((g, i) => ({ g, i }))
        .sort(
            (a, b) =>
                KIND_ORDER[a.g.kind as 'local'] - KIND_ORDER[b.g.kind as 'local'] ||
                a.i - b.i,
        )
        .map(({ g }) => ({
            name: g.name,
            kind: g.kind,
            free: g.free,
            models: g.models,
        }))
}
