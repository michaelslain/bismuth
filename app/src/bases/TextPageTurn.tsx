// app/src/bases/TextPageTurn.tsx
// A text page turning like a scan: pictures of the page leaving and the page arriving (textFace.ts),
// curled by the same layer the book's pages use. With `spread`, each picture is an open book (side by
// side's page and text) and one leaf turns over the spine between them. It sits over the text, and
// holds the leaving page still for the frames the arriving page needs to lay out.
import { Show, createEffect, createMemo, type Component } from 'solid-js'
import PageTurnLayer, { type SpreadFaces } from './PageTurnLayer'
import { splitSpread } from './textFace'
import styles from './TextPageTurn.module.css'

export type TextPageTurnProps = {
    /** Where it covers, in px from the positioned parent. */
    box: { left: number; top: number; w: number; h: number }
    from: HTMLCanvasElement
    /** The arriving page; until it is drawn the leaving page stays up. */
    to?: HTMLCanvasElement
    direction: 'forward' | 'back'
    /** Two pages meeting at a spine, the middle of the box; one page otherwise. */
    spread?: boolean
    /** A new value starts a new turn. */
    turnKey: number
    onSettled: () => void
    className?: string
}

const TextPageTurn: Component<TextPageTurnProps> = props => {
    const faces = (c: HTMLCanvasElement): SpreadFaces => (props.spread ? splitSpread(c) : { left: null, right: c })
    // once per picture: the layer reads these props many times over a turn
    const fromFaces = createMemo(() => faces(props.from))
    const toFaces = createMemo(() => (props.to ? faces(props.to) : undefined))
    return (
        <div
            class={`${styles.turn} ${props.className ?? ''}`}
            style={{ left: `${props.box.left}px`, top: `${props.box.top}px`, width: `${props.box.w}px`, height: `${props.box.h}px` }}
            data-text-turn
        >
            <Show when={toFaces()} fallback={<div class={styles.hold} ref={el => createEffect(() => el.replaceChildren(props.from))} />}>
                {to => (
                    <PageTurnLayer
                        width={props.box.w}
                        height={props.box.h}
                        layout={props.spread ? 'spread' : 'single'}
                        from={fromFaces()}
                        to={to()}
                        direction={props.direction}
                        drag={null}
                        turnKey={props.turnKey}
                        onSettled={() => props.onSettled()}
                    />
                )}
            </Show>
        </div>
    )
}

export default TextPageTurn
