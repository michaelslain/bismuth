import { Show, type JSX } from 'solid-js'
import Heading from './Heading'
import Text from './Text'
import styles from './EmptyState.module.css'

export type EmptyStateTone = 'default' | 'quiet'

export type EmptyStateProps = {
    /** Optional icon rendered above the title. Ignored when `compact`. */
    icon?: JSX.Element
    /** Optional heading shown above the message. Ignored when `compact` unless there is no body,
     *  in which case the title is the one line. */
    title?: string
    /** Centre the block in the box it is placed in — both axes, filling that box. Without it the
     *  block only centres itself when its parent happens to be a flex column (`margin: auto`). */
    fill?: boolean
    /** The one-line form: one muted line, no icon, no heading, left-aligned and unpadded — for a
     *  list, a table cell, a small panel. Combine with `fill` to centre that line in a box. */
    compact?: boolean
    /** A call to action under the body — a button, a link. Rendered in its own row. */
    action?: JSX.Element
    /** 'default' is a foreground title over a muted body, upright. 'quiet' mutes the title too
     *  and sets both in italics — for a state that is a pause rather than a result ("no cards
     *  due"), which should not compete with the content around it. */
    tone?: EmptyStateTone
    class?: string
    /** Extra class on the root `.ui-empty-block` (alongside `class` — for a caller composing
     *  both a layout class and a look-and-feel class, e.g. FlashcardsView's italic-prose variant). */
    blockClass?: string
    /** Extra class on the inner title `<h2>`. */
    titleClass?: string
    /** Extra class on the inner body `<p>`. */
    bodyClass?: string
    children?: JSX.Element
}

/**
 * The "nothing here / all done" message block, previously hand-rolled as
 * `<div class="review-done"><h2/><p class="deck-empty"/></div>` and bare
 * `<p class="deck-empty">` across flashcards and base settings.
 *
 * CASING: titles are lowercase, and sentence case once they are a sentence — "no rows", "nothing
 * due", "couldn't load image". Nothing here is transformed by CSS: the text is shown exactly as
 * written, so a caller's capitalisation is a caller's decision and this is the rule for it.
 *
 * The title is a real `Heading` (an h2, for the document outline) and the body a `Text`, so both
 * take their type from the primitives rather than a rule of their own.
 */
function EmptyState(props: EmptyStateProps) {
    const quiet = () => props.tone === 'quiet'
    const line = () => props.children ?? props.title
    return (
        <div
            class={[
                styles['ui-empty-block'],
                props.compact && styles['ui-empty-block--compact'],
                props.fill && styles['ui-empty-block--fill'],
                quiet() && styles['ui-empty-block--quiet'],
                props.class,
                props.blockClass,
            ]
                .filter(Boolean)
                .join(' ')}
            data-testid="ui-empty-block"
        >
            <Show
                when={!props.compact}
                fallback={
                    <Show when={line()}>
                        <Text
                            as="p"
                            size="inherit"
                            tone="muted"
                            weight="inherit"
                            italic={quiet()}
                            class={[styles['ui-empty'], props.bodyClass].filter(Boolean).join(' ')}
                            data-testid="ui-empty"
                        >
                            {line()}
                        </Text>
                    </Show>
                }
            >
                <Show when={props.icon}>
                    <div class={styles['ui-empty-icon']}>{props.icon}</div>
                </Show>
                <Show when={props.title}>
                    {t => (
                        <Heading
                            level={2}
                            class={[styles['ui-empty-title'], props.titleClass]
                                .filter(Boolean)
                                .join(' ')}
                        >
                            {t()}
                        </Heading>
                    )}
                </Show>
                <Show when={props.children}>
                    <Text
                        as="p"
                        size="inherit"
                        tone="muted"
                        weight="inherit"
                        italic={quiet()}
                        class={[styles['ui-empty'], props.bodyClass].filter(Boolean).join(' ')}
                        data-testid="ui-empty"
                    >
                        {props.children}
                    </Text>
                </Show>
            </Show>
            <Show when={props.action}>
                <div class={styles['ui-empty-action']}>{props.action}</div>
            </Show>
        </div>
    )
}

export default EmptyState

/** The repeated `<div class="loading">Loading…</div>` placeholder. */
export function Loading(props: { children?: JSX.Element }) {
    return <div class={styles['ui-loading']}>{props.children ?? 'Loading…'}</div>
}
