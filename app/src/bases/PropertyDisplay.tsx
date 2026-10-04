import { For, Show, type Component, type JSX } from 'solid-js'
import { resolveProperty } from '../../../core/src/bases/query'
import { propertyType } from '../../../core/src/bases/properties'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import { renderInline, renderMarkdown } from './markdown'
import { formatNumberDisplay } from './numberFormat'
import { multiselectValues } from './propertyEdit'
import {
    renderStars,
    renderStatus,
    renderTags,
    renderValue,
} from './valueRenderers'
import { isRatingColumn, isStatusColumn, isTagColumn } from './columnKinds'
import EmptyValue from '../ui/EmptyValue'
import Text from '../ui/Text'
import ValueChip from '../ui/ValueChip'
import styles from './PropertyDisplay.module.css'

export type PropertyDisplayProps = {
    /** The property id (column id) to show. */
    id: string
    row: Row
    /** Declared property types come from `config.properties`. */
    config?: BaseConfig
    /** Kanban meta-row sizing. */
    dense?: boolean
    /** Table: a declared markdown value renders on one line via `renderInline`. */
    inline?: boolean
    /** Render as a markdown block though the type is undeclared (a bare `description` on a card). */
    markdown?: boolean
    class?: string
}

/**
 * Read-only, type-aware display of ONE property on ONE row — the single spelling every Bases
 * view shares, so a declared type looks the same in Table, List, Cards and Kanban.
 *
 * Branch order: declared number (through its format) -> declared multiselect (a bracket chip per
 * value) -> declared boolean (`Yes` / `No`) -> declared markdown (a block, or one line when
 * `inline`) -> everything else is the heuristic renderers + `renderValue` (status dots, `#tags`, stars, links, dates…),
 * so an UNDECLARED value keeps the look it always had (status / tags / rating heuristics first).
 */
const PropertyDisplay: Component<PropertyDisplayProps> = props => {
    const value = () => resolveProperty(props.id, props.row)
    const declared = () =>
        props.config ? propertyType(props.config, props.id) : undefined

    const body = (): JSX.Element => {
        const kind = declared()?.kind
        const v = value()
        if (kind === 'number' && typeof v === 'number') {
            return (
                <Text as="span" inherit>
                    {formatNumberDisplay(v, declared()?.number, declared()?.unit)}
                </Text>
            )
        }
        // A declared multiselect `tags` column is still tags: `#tag`, not bracket chips.
        if (kind === 'multiselect' && isTagColumn(props.id))
            return renderTags(v, props.dense)
        if (kind === 'multiselect') {
            const vals = multiselectValues(v)
            if (vals.length === 0) return <EmptyValue />
            return (
                <Text as="span" inherit class={styles.chips}>
                    <For each={vals}>
                        {t => <ValueChip>{t}</ValueChip>}
                    </For>
                </Text>
            )
        }
        if (kind === 'boolean' && typeof v === 'boolean') {
            return (
                <Text as="span" inherit tone={v ? 'default' : 'muted'}>
                    {v ? 'Yes' : 'No'}
                </Text>
            )
        }
        if ((kind === 'markdown' || props.markdown) && v != null && v !== '') {
            const src = String(v)
            return props.inline ? (
                <Text
                    as="span"
                    inherit
                    class={styles.inlineMd}
                    innerHTML={renderInline(src)}
                />
            ) : (
                <Text
                    as="div"
                    register="prose"
                    size="body"
                    tone="muted"
                    class={styles.markdown}
                    innerHTML={renderMarkdown(src)}
                />
            )
        }
        // Undeclared (or declared-but-unhandled) values keep the themed heuristics.
        if (isStatusColumn(props.id) && v != null && typeof v !== 'object')
            return renderStatus(String(v))
        if (isTagColumn(props.id)) return renderTags(v, props.dense)
        if (isRatingColumn(props.id) && typeof v === 'number')
            return renderStars(v)
        return renderValue(props.id, props.row)
    }

    return (
        <Show when={props.class} fallback={body()}>
            <Text as="span" inherit class={props.class}>
                {body()}
            </Text>
        </Show>
    )
}

export default PropertyDisplay
