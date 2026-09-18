// app/src/palette/PaletteModal.tsx
// Reusable Obsidian-style command/search overlay: an autofocused search input over
// a fuzzy-filtered, keyboard-navigable list. Knows nothing about commands or files —
// callers pass `items` and an `onSelect`. See CommandPalette.tsx (the in-window Cmd+O
// switcher is SwitcherBar.tsx, which reuses the shared ranking + Highlight from PaletteRow.tsx).
import { createSignal, createMemo, For, Show, onMount } from 'solid-js'
import Kbd from '../ui/ascii/Kbd'
import { createMenuNav } from '../ui/popover/createMenuNav'
import {
    createPointerGuard,
    resetActiveOnChange,
    scrollSelectedIntoView,
} from './paletteNav'
import { rankItems, type Match, type PaletteItem } from './rankItems'
import PaletteFrame, { PaletteEmpty } from './PaletteFrame'
import PaletteRow, { Highlight, paletteRowClass } from './PaletteRow'
import styles from './PaletteModal.module.css'

// Re-exported so existing importers (CommandPalette, and SwitcherBar) keep resolving
// PaletteItem from here; the canonical definition now lives in rankItems.ts.
export type { PaletteItem }
// Re-exported so existing importers (SwitcherBar) keep resolving Highlight from here; the
// canonical definition now lives in PaletteRow.tsx alongside the styles it needs.
export { Highlight }

type Props = {
    placeholder: string
    items: PaletteItem[]
    onSelect: (item: PaletteItem) => void
    onClose: () => void
    emptyText?: string
    // Optional frecency score for an item id (see frecency.ts) — higher = used more/recently.
    // When provided, the list LEARNS from usage: an empty query lists most-frecent first, and
    // a non-empty query blends frecency into the fuzzy ranking as a gentle tiebreaker/booster
    // (a strong text match still wins — see FRECENCY_WEIGHT). Omit it for a plain fuzzy list.
    frecency?: (id: string) => number
}

export function PaletteModal(props: Props) {
    const [query, setQuery] = createSignal('')
    let inputRef: HTMLInputElement | undefined
    let listRef: HTMLDivElement | undefined

    // Fuzzy rank + frecency blend live in the shared pure helper (see rankItems.ts).
    const results = createMemo<Match[]>(() =>
        rankItems(props.items, query(), props.frecency),
    )

    // Up/Down/Enter/Escape come from the shared menu-nav hook (same logic as the
    // context menu); the palette clamps instead of wrapping, hence wrap:false.
    const nav = createMenuNav({
        count: () => results().length,
        wrap: false,
        onSelect: i => {
            const r = results()[i]
            if (r) props.onSelect(r.item)
        },
        onEscape: () => props.onClose(),
    })
    const selected = nav.active

    // Hover must not steal the selection from the keyboard default until the cursor genuinely
    // moves (see createPointerGuard).
    const onRowPointerMove = createPointerGuard(nav.setActive)

    // Reset the highlighted row to the top whenever the query changes.
    resetActiveOnChange(
        () => {
            query()
        },
        () => nav.setActive(0),
    )

    // Keep the highlighted row scrolled into view. `selected` is the app-wide bare state-class
    // convention (see PaletteRow.module.css's header) — it never hashes, so this selector stays
    // a plain string; only `palette-row` needs the module lookup (via PaletteRow's exported
    // class, so this file never imports PaletteRow.module.css itself).
    scrollSelectedIntoView(
        () => {
            selected()
            results()
        },
        () => listRef,
        `.${paletteRowClass}.selected`,
    )

    onMount(() => inputRef?.focus())

    return (
        <PaletteFrame
            onClose={props.onClose}
            label={props.placeholder}
            placeholder={props.placeholder}
            value={query()}
            onInput={setQuery}
            onKeyDown={nav.onKeyDown}
            inputRef={el => (inputRef = el)}
        >
            <div class={styles['palette-list']} ref={listRef}>
                <For each={results()}>
                    {(r, i) => (
                        <PaletteRow
                            icon={r.item.icon}
                            selected={selected() === i()}
                            onMouseMove={e => onRowPointerMove(i(), e)}
                            onClick={() => props.onSelect(r.item)}
                            label={
                                <Highlight
                                    text={r.item.label}
                                    indices={r.indices}
                                />
                            }
                            desc={r.item.description}
                            sublabel={r.item.sublabel}
                            shortcut={
                                r.item.shortcut ? (
                                    <Kbd combo={r.item.shortcut} />
                                ) : undefined
                            }
                        />
                    )}
                </For>
                <Show when={results().length === 0}>
                    <PaletteEmpty>{props.emptyText ?? 'No matches'}</PaletteEmpty>
                </Show>
            </div>
        </PaletteFrame>
    )
}
