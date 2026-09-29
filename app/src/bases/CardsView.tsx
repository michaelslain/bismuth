import { For, Index, Show } from 'solid-js'
import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { resolveProperty } from '../../../core/src/bases/query'
import { api } from '../api'
import { BodyCard } from './BodyCard'
import { CardBody } from './CardBody'
import TaskRow from './TaskRow'
import CardFrame from './CardFrame'
import CardBodyInner from './CardBodyInner'
import CardCover from './CardCover'
import { autoGroupColor } from './groupHue'
import { useRowEditor } from './useRowEditor'
import GroupHeader from '../ui/GroupHeader'
import EmptyState from '../ui/EmptyState'
import { isActivateKey } from '../ui/widgetKeys'
import { titleOf } from './kanbanMeta'
import styles from './CardsView.module.css'

/** A value is already a usable image src (remote URL or inline data) vs a vault path. */
function isDirectUrl(s: string): boolean {
    return /^(https?:|data:|blob:)/i.test(s)
}

/**
 * The card grid. In tasks mode a card's BODY is a <TaskRow> — one card per TASK, with the
 * checkbox, description and field chips every other row view renders.
 *
 * That is a different picture from `cardContent: tasks`, which stays exactly as it was: that
 * renders one card per NOTE showing that note's checklist lines. Both are legitimate, they
 * answer different questions, and `mode` never touches `cardContent`.
 */
export function CardsView(props: {
    result: ViewResult
    config: BaseConfig
    // See ListView for why the mode and the write seam arrive as props.
    mode?: 'normal' | 'tasks'
    onToggle?: (row: Row, e: Event) => void
    onSetStatus?: (row: Row, e: MouseEvent) => void
    /** The base file, so a "properties" card can open the row/property editor — same gate as
     *  TableView's/ListView's/BulletsView's. Body/tasks cards ignore this (out of scope). */
    basePath?: string
    /** Refetch after a row edit/delete lands — BaseView's `refetchAll`. */
    onChange?: () => void
}) {
    const cols = () => props.result.columns
    // TASKS MODE IS A DECLARATION, NOT A SHAPE. This branches on `props.mode`, never on
    // `isTaskRow(row, mode)` — that helper ALSO returns true for a row merely SHAPED like a
    // task, which is right for ListView (it has rendered task lines off the shape since long
    // before this mode existed) and wrong here: an existing `source: tasks` cards base with no
    // `mode:` key would silently lose its cover, its columns and its click-to-open.
    const isTasks = () => props.mode === 'tasks'
    const toggle = (row: Row, e: Event) => props.onToggle?.(row, e)
    const setStatus = (row: Row, e: MouseEvent) => props.onSetStatus?.(row, e)
    // "body" (full markdown) and "tasks" (checklist-only) both render via BodyCard's masonry;
    // "tasks" just passes a mode that filters the body to its todo lines.
    const cardMode = () => props.result.view.cardContent
    const isBody = () => cardMode() === 'body' || cardMode() === 'tasks'
    // Title = first column; author = second column (used for the generated text cover).
    const titleCol = (): string => cols()[0] ?? 'file.name'
    const authorCol = (): string | undefined => cols()[1]

    const editor = useRowEditor({
        config: () => props.config,
        view: () => props.result.view,
        columns: () => props.result.columns,
        onChanged: () => props.onChange?.(),
    })
    // `editable` also refuses a task-line row (its `file` is the containing NOTE, so the shared
    // editor would rename/trash the whole file) and a pending placeholder.
    const rowEditable = (row: Row) => !!props.basePath && editor.editable(row)
    const empty = () => props.result.groups.every(g => g.rows.length === 0)

    // Cover image config: which property holds the cover, plus fit/aspect-ratio.
    const imageProp = (): string | undefined => props.result.view.image
    const imageFit = (): 'cover' | 'contain' =>
        props.result.view.imageFit ?? 'cover'
    const aspectRatio = (): number =>
        props.result.view.imageAspectRatio ?? 0.667

    // The cover src for a row, or null when no image is configured / the property is empty.
    // A bare value (e.g. "covers/x.jpg") is served through the vault asset endpoint; a full
    // URL (Google Books, data:) is used as-is.
    const coverUrl = (row: Row): string | null => {
        const prop = imageProp()
        if (!prop) return null
        const v = resolveProperty(prop, row)
        if (v == null || typeof v === 'object') return null
        const s = String(v).trim()
        if (!s) return null
        return isDirectUrl(s) ? s : api.assetUrl(s)
    }

    const coverTitle = (row: Row): string => titleOf(row, titleCol())
    const coverAuthor = (row: Row): string | null => {
        if (!authorCol()) return null
        const v = resolveProperty(authorCol()!, row)
        return v == null || typeof v === 'object' ? null : String(v)
    }

    // A generated cover is coloured only when the base is grouped — the category ramp means
    // category, never decoration — with the same key→colour rule (and per-view `groupColors`
    // overrides) as a kanban column, so one group reads as one hue across views.
    const groupHue = (key: string): string | undefined =>
        key === ''
            ? undefined
            : (props.result.view.groupColors?.[key] ?? autoGroupColor(key))

    // A stored row has no note to open, so it never gets a link.
    const linkable = (row: Row) => !Number.isInteger(row.index)
    const cardActive = (row: Row) => rowEditable(row) || linkable(row)
    // Click anywhere on a (non-body) card opens its note. `bismuth-open` always opens a
    // fresh tab now (#56), so this needs no flag to get that.
    const openCard = (row: Row) =>
        window.dispatchEvent(
            new CustomEvent('bismuth-open', {
                detail: { path: row.file.path },
            }),
        )
    /** An editable card opens the row editor on click, Enter/Space or right-click; a
     *  non-editable but linkable card opens its note instead. A stored, non-linkable row is
     *  inert. */
    const cardClick = (row: Row) => {
        if (rowEditable(row)) editor.open(row)
        else if (linkable(row)) openCard(row)
    }
    const cardContextMenu = (row: Row, e: MouseEvent) => {
        if (!rowEditable(row)) return
        e.preventDefault()
        e.stopPropagation()
        editor.open(row)
    }

    return (
        <Show
            when={!empty()}
            fallback={
                <EmptyState title="no rows">
                    nothing in this view matches its filters
                </EmptyState>
            }
        >
            <div class={styles.cards}>
                {/* Index-keyed groups (see ListView): keep each group mounted across a re-resolve so only
          the inner reference-keyed row <For> diffs — no whole-grid remount/masonry-reflow flash
          on a task toggle. */}
                <Index each={props.result.groups}>
                    {group => (
                        <>
                            <Show when={group().key !== ''}>
                                <GroupHeader
                                    class={styles.groupHeader}
                                    label={group().key}
                                    count={group().rows.length}
                                />
                            </Show>
                            <div
                                class={
                                    isTasks()
                                        ? styles.taskCardGrid
                                        : isBody()
                                          ? styles.bodyGrid
                                          : styles.cardGrid
                                }
                            >
                                <For each={group().rows}>
                                    {row => (
                                        <Show
                                            when={isTasks()}
                                            fallback={
                                                <Show
                                                    when={isBody()}
                                                    fallback={
                                                        <CardFrame
                                                            class={
                                                                styles.cardSlot
                                                            }
                                                            interactive={cardActive(
                                                                row,
                                                            )}
                                                            role={
                                                                cardActive(row)
                                                                    ? 'button'
                                                                    : undefined
                                                            }
                                                            tabindex={
                                                                cardActive(row)
                                                                    ? 0
                                                                    : undefined
                                                            }
                                                            onClick={e => {
                                                                // A click on a link/button inside the card is that control's.
                                                                const inner = (
                                                                    e.target as Element
                                                                ).closest(
                                                                    'a, button',
                                                                )
                                                                if (
                                                                    inner &&
                                                                    inner !==
                                                                        e.currentTarget
                                                                )
                                                                    return
                                                                cardClick(row)
                                                            }}
                                                            onContextMenu={e =>
                                                                cardContextMenu(
                                                                    row,
                                                                    e,
                                                                )
                                                            }
                                                            onKeyDown={e => {
                                                                if (
                                                                    e.target !==
                                                                    e.currentTarget
                                                                )
                                                                    return
                                                                if (
                                                                    isActivateKey(
                                                                        e,
                                                                    )
                                                                ) {
                                                                    e.preventDefault()
                                                                    cardClick(
                                                                        row,
                                                                    )
                                                                }
                                                            }}
                                                        >
                                                            {/* An image cover (when configured + present) replaces the generated
                                    text cover; title/author then move into the body below. A row whose
                                    cover property is empty falls back to the text cover. */}
                                                            <Show
                                                                when={coverUrl(
                                                                    row,
                                                                )}
                                                                fallback={
                                                                    <CardCover
                                                                        path={
                                                                            row
                                                                                .file
                                                                                .path
                                                                        }
                                                                        title={coverTitle(
                                                                            row,
                                                                        )}
                                                                        author={coverAuthor(
                                                                            row,
                                                                        )}
                                                                        hue={groupHue(
                                                                            group()
                                                                                .key,
                                                                        )}
                                                                    />
                                                                }
                                                            >
                                                                {url => (
                                                                    <div
                                                                        class={
                                                                            styles.cardCoverImg
                                                                        }
                                                                        style={{
                                                                            'aspect-ratio':
                                                                                String(
                                                                                    aspectRatio(),
                                                                                ),
                                                                        }}
                                                                    >
                                                                        <img
                                                                            src={url()}
                                                                            alt={coverTitle(
                                                                                row,
                                                                            )}
                                                                            loading="lazy"
                                                                            style={{
                                                                                'object-fit':
                                                                                    imageFit(),
                                                                            }}
                                                                            onError={e => {
                                                                                ;(
                                                                                    e.currentTarget as HTMLImageElement
                                                                                ).style.visibility =
                                                                                    'hidden'
                                                                            }}
                                                                        />
                                                                    </div>
                                                                )}
                                                            </Show>
                                                            <CardBodyInner>
                                                                {/* With an image cover the title/author aren't on the cover, so show
                                      them as fields; with the text cover they already appear there. */}
                                                                <CardBody
                                                                    cols={cols()}
                                                                    row={row}
                                                                    config={
                                                                        props.config
                                                                    }
                                                                    titleAsField={
                                                                        !coverUrl(
                                                                            row,
                                                                        )
                                                                    }
                                                                    plainTitle={
                                                                        rowEditable(
                                                                            row,
                                                                        ) ||
                                                                        !linkable(
                                                                            row,
                                                                        )
                                                                    }
                                                                />
                                                            </CardBodyInner>
                                                        </CardFrame>
                                                    }
                                                >
                                                    <BodyCard
                                                        class={
                                                            styles.bodyGridCard
                                                        }
                                                        row={row}
                                                        result={props.result}
                                                        config={props.config}
                                                        mode={
                                                            cardMode() ===
                                                            'tasks'
                                                                ? 'tasks'
                                                                : 'body'
                                                        }
                                                    />
                                                </Show>
                                            }
                                        >
                                            {/* A task card carries no cover and no open-on-click: its
                                            description is the whole card, and TaskRow's own wikilinks
                                            are what open a note from it. The TaskChip register
                                            (.taskCard), not the book-cover .card frame. */}
                                            <CardFrame kind="task">
                                                <TaskRow
                                                    row={row}
                                                    variant="card"
                                                    onToggle={toggle}
                                                    onSetStatus={setStatus}
                                                />
                                            </CardFrame>
                                        </Show>
                                    )}
                                </For>
                            </div>
                        </>
                    )}
                </Index>
            </div>
        </Show>
    )
}
