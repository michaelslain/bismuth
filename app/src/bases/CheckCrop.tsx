// app/src/bases/CheckCrop.tsx
// The strip of a page image a flagged line was read from, so a reader can compare the scan with the
// text without leaving text mode. It draws the union of the line's boxes, padded, on a canvas.
import { Show, createEffect, createSignal, on, type Component } from 'solid-js'
import type { Face } from './bookFaces'
import type { LocateBox } from './LocateLayer'
import Text from '../ui/Text'
import styles from './CheckCrop.module.css'

export type CheckCropProps = {
    /** The page's face; the same loader the reader draws pages from. */
    face: () => Promise<Face>
    /** Where the line sits on the page (page fractions); empty when it could not be found. */
    boxes: () => Promise<LocateBox[]>
    className?: string
}

/** Padding around the line, as a share of its height, so ascenders and descenders stay in. */
const PAD = 0.35
/** The crop's drawn width in CSS px; its height follows the line's shape. */
const WIDTH = 360

const CheckCrop: Component<CheckCropProps> = props => {
    let canvas: HTMLCanvasElement | undefined
    const [state, setState] = createSignal<'loading' | 'ready' | 'none'>('loading')
    createEffect(
        on(
            () => [props.face, props.boxes] as const,
            ([face, boxes]) => {
                setState('loading')
                void Promise.all([face(), boxes()]).then(([f, bs]) => {
                    if (f.kind !== 'ready' || bs.length === 0 || !canvas) return setState('none')
                    const src = f.source as CanvasImageSource & { width: number; height: number }
                    const W = Number(src.width) || 0
                    const H = Number(src.height) || 0
                    if (!W || !H) return setState('none')
                    const x0 = Math.min(...bs.map(b => b.x))
                    const y0 = Math.min(...bs.map(b => b.y))
                    const x1 = Math.max(...bs.map(b => b.x + b.w))
                    const y1 = Math.max(...bs.map(b => b.y + b.h))
                    const pad = (y1 - y0) * PAD
                    const sx = Math.max(0, (x0 - pad) * W)
                    const sy = Math.max(0, (y0 - pad) * H)
                    const sw = Math.min(W - sx, (x1 - x0 + 2 * pad) * W)
                    const sh = Math.min(H - sy, (y1 - y0 + 2 * pad) * H)
                    if (sw <= 0 || sh <= 0) return setState('none')
                    const ratio = window.devicePixelRatio || 1
                    const cssH = Math.round((WIDTH * sh) / sw)
                    canvas.width = Math.round(WIDTH * ratio)
                    canvas.height = Math.round(cssH * ratio)
                    canvas.style.height = `${cssH}px`
                    const ctx = canvas.getContext('2d')
                    if (!ctx) return setState('none')
                    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
                    setState('ready')
                }, () => setState('none'))
            },
        ),
    )
    return (
        <div class={[styles.crop, props.className].filter(Boolean).join(' ')} data-check-crop={state()}>
            <canvas ref={el => (canvas = el)} class={styles.canvas} classList={{ [styles.hidden]: state() !== 'ready' }} aria-label="the line on the page" />
            <Show when={state() !== 'ready'}>
                <Text as="span" size="ui" tone="muted">
                    {state() === 'loading' ? 'finding the line on the page' : 'the line could not be found on the page'}
                </Text>
            </Show>
        </div>
    )
}

export default CheckCrop
