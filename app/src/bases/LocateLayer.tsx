// app/src/bases/LocateLayer.tsx
// Boxes drawn over one page image, and clicks on it reported as page fractions. It fills its
// positioned parent (the page image) and lets nothing but a click through to the caller.
import { For, type Component } from 'solid-js'
import styles from './LocateLayer.module.css'

export type LocateBox = { x: number; y: number; w: number; h: number } // page fractions, origin top-left

export type LocateLayerProps = {
    boxes: LocateBox[]
    /** a click on the page, in page fractions */
    onPoint?: (x: number, y: number) => void
    className?: string
}

const LocateLayer: Component<LocateLayerProps> = props => {
    const onClick = (e: MouseEvent) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return
        props.onPoint?.((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
    }
    return (
        <div class={`${styles.layer} ${props.className ?? ''}`} data-locate-layer onClick={onClick}>
            <For each={props.boxes}>
                {b => (
                    <div
                        class={styles.box}
                        data-locate-box
                        style={{
                            left: `${b.x * 100}%`,
                            top: `${b.y * 100}%`,
                            width: `${b.w * 100}%`,
                            height: `${b.h * 100}%`,
                        }}
                    />
                )}
            </For>
        </div>
    )
}

export default LocateLayer
