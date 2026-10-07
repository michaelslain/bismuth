// app/src/SearchResultRows.tsx
// Result rendering for the unified search surface (#8: "the search tab and the cmd+o
// should be the same thing"): keyword CONTENT matches and Bismuth AI results, both rendered
// by the Cmd+O switcher (palette/SwitcherBar.tsx) as identical `.sresult` groups — a
// PaletteRow-shaped file line + optional AI rationale + matched snippet lines. Flat rows, not
// cards, so they read as the same list as the switcher's file-name rows above them. Extracted (originally out of the since-removed
// SearchView tab) so no surface ever forks a lookalike of the result card.
import { For, Show } from 'solid-js'
import { recordUse, fileKey } from './frecency'
import type { SearchResult } from './searchOpts'
import Label from './ui/Label'
import PaletteRow from './ui/PaletteRow'
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
                        role="group"
                        aria-label={parts.name}
                        data-group-selected={
                            props.selected === i() ? '' : undefined
                        }
                        onMouseMove={e => props.onRowPointerMove?.(i(), e)}
                    >
                        {/* The head IS a PaletteRow (ui/PaletteRow) — the same selectable row the
                file-name rows above it render, so the keyboard cursor, the inset and the selection
                wash are one implementation. The whole head opens the file (not just the snippet
                rows): AI results carry one byte-exact snippet, and a title hit target keeps every
                result openable even if a row ever comes back without one. The match count rides the
                row's shortcut slot, muted — a count is content, not structure. */}
                        <PaletteRow
                            class={styles['sresult-head']}
                            icon="FileText"
                            selected={props.selected === i()}
                            label={parts.name}
                            sublabel={
                                parts.folder ? `// ${parts.folder}/` : undefined
                            }
                            shortcut={
                                <Text as="span" size="micro" tone="muted">
                                    {r.matchCount}
                                </Text>
                            }
                            onPick={open}
                        />
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
