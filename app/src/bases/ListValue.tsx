// app/src/bases/ListValue.tsx
// A `multiselect` or `tags` property as ONE line of text with the note editor's completion popup
// (ui/TagsField), typed like a frontmatter `tags:` line. A tag column is drawn in the tag look and
// suggests the column's values then the vault's; any other list suggests its own column's values;
// a declared `multiselect` suggests only its options — a typed value outside them is still kept
// (legacy tolerance). Commits once, the parsed list, on Enter or blur.
import { createEffect, createSignal, type Component } from 'solid-js'
import TagsField from '../ui/TagsField'
import { api } from '../api'
import type { PropertyEditKind } from './propertyEdit'
import { multiselectCommitValue, multiselectValues } from './propertyEdit'
import {
    createVaultTagsCache,
    mergeTagOptions,
    vaultTagNames,
} from './tagSuggestions'

// The vault's tag names, shared by every tags editor — a field suggests the last-known set at
// once, then the refreshed set once its own load lands (suggestions are read per keystroke).
const vaultTags = createVaultTagsCache(() => api.graph().then(vaultTagNames))

/** Forget the cached vault tags — for a story that swaps in its own fake graph. */
export function resetVaultTagsCache(): void {
    vaultTags.reset()
}

export type ListValueProps = {
    kind: Extract<PropertyEditKind, { kind: 'multiselect' | 'tags' }>
    value: unknown
    /** Focus the field on mount. */
    autofocus?: boolean
    /** Editing in place where the value is shown (a table cell): drops the chrome, takes the
     *  host's font. */
    inline?: boolean
    onCommit: (value: string[] | null) => void
    onCancel: () => void
}

const ListValue: Component<ListValueProps> = props => {
    // A `tags` editor suggests every tag in the vault — the SAME source the note editor's `#tag`
    // and frontmatter `tags:` completion read (the graph's `tag` nodes) — after this column's and
    // this row's own values (`kind.options`).
    const [vault, setVault] = createSignal(vaultTags.last())
    const wantsVault = () => props.kind.kind === 'tags' && props.kind.tag
    // Load once per false->true transition of `wantsVault()`; a result landing after it has gone
    // false again is ignored.
    let loading = false
    createEffect(() => {
        if (!wantsVault()) {
            loading = false
            return
        }
        if (loading) return
        loading = true
        vaultTags.load().then(
            tags => {
                if (wantsVault()) setVault(tags)
            },
            () => {
                // offline / no graph yet — the column's own values still stand
            },
        )
    })
    const options = (): string[] =>
        props.kind.kind === 'tags'
            ? mergeTagOptions(props.kind.options, wantsVault() ? vault() : [])
            : props.kind.options
    return (
        <TagsField
            value={multiselectValues(props.value)}
            suggestions={options}
            tags={props.kind.tag === true}
            autofocus={props.autofocus}
            bare={props.inline}
            onCommit={next => props.onCommit(multiselectCommitValue(next))}
            onCancel={props.onCancel}
        />
    )
}

export default ListValue
