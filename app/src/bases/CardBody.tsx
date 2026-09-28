import { Show } from 'solid-js'
import { resolveProperty } from '../../../core/src/bases/query'
import type { Row, BaseConfig } from '../../../core/src/bases/types'
import { renderTitle } from './renderValue'
import {
    isStatusColumn,
    isRatingColumn,
    isPagesColumn,
    findColumn,
    asNumber,
} from './columnKinds'
import { titleOf } from './kanbanMeta'
import Stars from '../ui/Stars'
import { StatusText } from '../ui/StatusDot'
import Label from '../ui/Label'
import Text from '../ui/Text'
import CardTitle from './CardTitle'
import styles from './CardBody.module.css'

/**
 * Compact book-card body matching the design's Cards/Kanban layout: a serif title
 * (the cover already carries it on Cards, so `titleAsField` suppresses it), a faint
 * author line, then a single meta row — status word on the LEFT, star rating (or a
 * "N pages" count) on the RIGHT. Replaces the old label:value field dump.
 *
 * Used by CardsView (`titleAsField` — cover shows title/author) and KanbanView
 * (stacks its own title + author). Status/rating/pages columns are detected from
 * `cols`; title = first column, author = next non-status/rating/pages column.
 */
export function CardBody(props: {
    cols: string[]
    row: Row
    config: BaseConfig
    titleAsField?: boolean
    plainTitle?: boolean
}) {
    const titleCol = (): string => props.cols[0] ?? 'file.name'

    // Plain (non-link) title text — used when the whole card is already a click target
    // (CardsView), so the title isn't a competing inner link.
    const titleText = (): string => titleOf(props.row, titleCol())

    const statusCol = (): string | undefined =>
        findColumn(props.cols, isStatusColumn)
    const ratingCol = (): string | undefined =>
        findColumn(props.cols, isRatingColumn)
    const pagesCol = (): string | undefined =>
        findColumn(props.cols, isPagesColumn)

    // Author = first column that isn't the title or one of the meta columns.
    const authorCol = (): string | undefined =>
        props.cols.find(
            (c, i) =>
                (props.titleAsField || i !== 0) &&
                !isStatusColumn(c) &&
                !isRatingColumn(c) &&
                !isPagesColumn(c),
        )

    const status = (): string | null => {
        const c = statusCol()
        if (!c) return null
        const v = resolveProperty(c, props.row)
        return v == null || typeof v === 'object' ? null : String(v)
    }

    const rating = (): number | null => {
        const c = ratingCol()
        if (!c) return null
        const n = asNumber(resolveProperty(c, props.row))
        return n != null && n > 0 ? n : null
    }

    const pages = (): number | null => {
        const c = pagesCol()
        if (!c) return null
        return asNumber(resolveProperty(c, props.row)) ?? null
    }

    const author = (): string | null => {
        const c = authorCol()
        if (!c) return null
        const v = resolveProperty(c, props.row)
        return v == null || typeof v === 'object' ? null : String(v)
    }

    // The right-hand meta: stars when there's a rating, otherwise a page count.
    const hasMeta = (): boolean =>
        status() != null || rating() != null || pages() != null

    return (
        <>
            {/* Cards already shows the title on the cover; Kanban stacks its own. */}
            <Show when={!props.titleAsField}>
                <CardTitle>
                    {props.plainTitle
                        ? titleText()
                        : renderTitle(titleCol(), props.row)}
                </CardTitle>
            </Show>
            {/* Cards shows the author on the cover; Kanban stacks its own faint line. */}
            <Show when={!props.titleAsField && author()}>
                <Label as="div" tone="muted" class={styles.cardAuthor}>
                    {author()}
                </Label>
            </Show>
            <Show when={hasMeta()}>
                <div class={styles.cardMeta}>
                    <Text as="span" inherit class={styles.cardMetaLeft}>
                        <Show when={status()}>
                            {s => <StatusText status={s()} />}
                        </Show>
                    </Text>
                    <Text as="span" inherit class={styles.cardMetaRight}>
                        <Show
                            when={rating()}
                            fallback={
                                <Show when={pages()}>
                                    {p => (
                                        <Text
                                            as="span"
                                            size="inherit"
                                            tone="muted"
                                            weight="inherit"
                                            class={styles.cardPages}
                                        >
                                            {p()} pages
                                        </Text>
                                    )}
                                </Show>
                            }
                        >
                            {r => <Stars value={r()} />}
                        </Show>
                    </Text>
                </div>
            </Show>
        </>
    )
}
