// app/src/chat/modelPickerGroups.ts
// Pure grouping for ChatModelPicker's model list — no framework imports, so it is unit-testable.
// opencode model values are `provider/model` (the model part may itself contain `/`): they group by
// the part before the FIRST `/` and show only the rest. Every other connector is one flat, unnamed
// group showing the model's own label.
import type { ChatModelOption } from './chatSession'
import type { ChatProviderChoice } from './chatProvider'

export type PickerModel = ChatModelOption & { shortLabel: string }
export type PickerGroup = { name: string; models: PickerModel[] }

export function groupModels(
    models: ChatModelOption[],
    provider: ChatProviderChoice,
): PickerGroup[] {
    if (provider !== 'opencode') {
        return [
            {
                name: '',
                models: models.map(m => ({ ...m, shortLabel: m.label })),
            },
        ]
    }
    const groups: PickerGroup[] = []
    for (const m of models) {
        const slash = m.value.indexOf('/')
        const name = slash > 0 ? m.value.slice(0, slash).toLowerCase() : ''
        const shortLabel = slash > 0 ? m.value.slice(slash + 1) : m.label
        let g = groups.find(x => x.name === name)
        if (!g) groups.push((g = { name, models: [] }))
        g.models.push({ ...m, shortLabel })
    }
    return groups
}
