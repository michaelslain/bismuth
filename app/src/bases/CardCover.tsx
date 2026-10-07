import { Show, createMemo, type Component } from 'solid-js'
import Label from '../ui/Label'
import CardTitle from './CardTitle'
import { coverNoise } from './coverFingerprint'
import styles from './CardCover.module.css'

export type CardCoverProps = {
    /** The note's vault path — seeds the glyph fingerprint, so it never changes on re-sort. */
    path: string
    title: string
    author?: string | null
    /** The card's GROUP colour (a `var(--…)` token), only when the base is grouped. Omitted →
     *  a neutral cover: the category ramp means category, never decoration. */
    hue?: string
    class?: string
}

/**
 * The generated cover of a cards-view card with no image: a neutral ground typed over with a
 * sparse field of the app's own glyphs (`| - + / \ _ # . o @`), seeded by the note's path — its
 * fingerprint — with the title and author on a cleared band at the foot, the way the graph clears
 * its noise under a label. A grouped card's glyphs and ground take its group's hue.
 */
const CardCover: Component<CardCoverProps> = props => {
    const noise = createMemo(() => coverNoise(props.path))
    return (
        <div
            class={`${styles.cover} ${props.class ?? ''}`}
            classList={{ [styles.hued]: !!props.hue }}
            style={props.hue ? { '--cover-hue': props.hue } : undefined}
            data-testid="card-cover"
        >
            <pre class={styles.field} aria-hidden="true">
                {noise()}
            </pre>
            <div class={styles.band}>
                <CardTitle lines={2} class={styles.title}>
                    {props.title}
                </CardTitle>
                <Show when={props.author}>
                    <Label as="div" tone="muted" class={styles.author}>
                        {props.author}
                    </Label>
                </Show>
            </div>
        </div>
    )
}

export default CardCover
