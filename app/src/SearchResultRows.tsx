// app/src/SearchResultRows.tsx
// Result rendering for the unified search surface (#8: "the search tab and the cmd+o
// should be the same thing"): keyword CONTENT matches and Bismuth AI results, both rendered
// by the Cmd+O switcher (palette/SwitcherBar.tsx) as identical `.sresult` groups — a
// PaletteRow-shaped file line + optional AI rationale + matched snippet lines. Flat rows, not
// cards, so they read as the same list as the switcher's file-name rows above them. Extracted (originally out of the since-removed
// SearchView tab) so no surface ever forks a lookalike of the result card.
import { For, Show } from 'solid-js'
import { Icon } from './icons/Icon'
import { recordUse, fileKey } from './frecency'
import type { SearchResult } from './searchOpts'
import Label from './ui/Label'
import PlainButton from './ui/PlainButton'
import Text from './ui/Text'
import { snippetLead } from './snippetLead'
import styles from './SearchResultRows.module.css'

/** Split a vault path into its filename (sans extension) and parent folder so each result card
 *  can show a bold title + a faint folder crumb. */
export function splitPath(path: string): { name: string; folder: string } {
    const slash = path.lastIndexOf('/')
    const folder = slash >= 0 ? path.slice(0, slash) : ''
    const file = slash >= 0 ? path.slice(slash + 1) : path
    const dot = file.lastIndexOf('.')
    const name = dot > 0 ? file.slice(0, dot) : file
    return { name, folder }
}

/**
 * Renders a list of search/AI-prompt results (`.sresult` groups). `onOpen` is called with the
 * bare path AFTER frecency has already been recorded — callers should not double-record.
 *
 * Keyboard-nav integration (the switcher walks these rows with Up/Down like palette rows):
 * `selected` highlights the row at that index; `onRowPointerMove` lets the caller reselect on
 * real mouse movement (same stationary-pointer guard idiom as the palette rows).
 */
export function SearchResultRows(props: {
    results: SearchResult[]
    onOpen: (path: string) => void
    selected?: number
    onRowPointerMove?: (index: number, e: MouseEvent) => void
    class?: string
}) {
    return (
        <For each={props.results}>
            {(r, i) => {
                const parts = splitPath(r.path)
                const open = () => {
                    recordUse(fileKey(r.path))
                    props.onOpen(r.path)
                }
                return (
                    <div
                        class={`${styles['sresult']} ${props.class ?? ''}`}
                        data-testid="search-result"
                        data-selected={props.selected === i() ? '' : undefined}
                        onMouseMove={e => props.onRowPointerMove?.(i(), e)}
                    >
                        {/* The whole header opens the file too (not just the snippet rows) — AI results
                carry one byte-exact snippet, but making the title row a hit target keeps every
                result openable even if a row ever comes back without a snippet. */}
                        <PlainButton
                            class={`${styles['sresult-head']} ${styles['sresult-head-open']}`}
                            onClick={open}
                        >
                            <Text
                                as="span"
                                inherit
                                class={styles['sresult-icon']}
                            >
                                <Icon value="FileText" />
                            </Text>
                            <Label class={styles['sresult-title']}>
                                {parts.name}
                            </Label>
                            <Show when={parts.folder}>
                                <Label
                                    tone="faint"
                                    fill
                                    class={styles['sresult-path']}
                                >
                                    // {parts.folder}/
                                </Label>
                            </Show>
                            <Label tone="faint" class={styles['sresult-count']}>
                                {r.matchCount}
                            </Label>
                        </PlainButton>
                        <Show when={r.reason}>
                            <Text
                                as="div"
                                inherit
                                class={styles['sresult-reason']}
                            >
                                {r.reason}
                            </Text>
                        </Show>
                        <For each={r.snippets}>
                            {s => (
                                <PlainButton
                                    class={styles['sresult-snip']}
                                    onClick={open}
                                >
                                    <Text
                                        as="span"
                                        inherit
                                        class={styles['sresult-line']}
                                    >
                                        {s.line}
                                    </Text>
                                    <Label
                                        lines={2}
                                        class={styles['sresult-text']}
                                    >
                                        {snippetLead(s.before)}
                                        <mark>{s.match}</mark>
                                        {s.after}
                                    </Label>
                                </PlainButton>
                            )}
                        </For>
                    </div>
                )
            }}
        </For>
    )
}
