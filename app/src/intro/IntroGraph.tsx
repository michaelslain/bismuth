// One self-contained 3D graph instance (its own renderer + canvas), drawn inside its positioned
// parent box with no bloom or vignette. Renders its baked-layout graph ONCE (framed instantly, no
// settle/auto-fit motion), recolors on theme change, and pauses when not `active`.
import { createEffect, onCleanup, onMount, type Component } from 'solid-js'
import { AsciiGraphRenderer } from '../graph/AsciiGraphRenderer'
import type { GraphRenderer } from '../graph/graphRenderer'
import type { GraphData } from '../../../core/src/graph'
import type { ThemeName } from '../themes'
import { applyGraphConfig } from './vaultIntroGraph'
import styles from './IntroGraph.module.css'

export type IntroGraphStage = 'backdrop' | 'hero'

export type IntroGraphProps = {
    graph: GraphData
    /** Visible + rendering; inactive instances fade to 0 and pause. */
    active: boolean
    theme: ThemeName
    /** Where the ONE intro graph stands, inside IntroWindow's backdrop slot (the whole window body).
     *  'backdrop' — small and dim behind the palette slide's theme cards. 'hero' — the three-brains
     *  slide: brought forward over the art box, larger and at full strength. Changing it animates
     *  the move (the renderer re-fits as its box grows), so the same graph slides into the
     *  foreground. Absent: it fills its parent box (stories). */
    stage?: IntroGraphStage
    class?: string
}

const IntroGraph: Component<IntroGraphProps> = props => {
    let host!: HTMLDivElement
    const renderer: GraphRenderer = new AsciiGraphRenderer()
    let mounted = false
    onMount(() => {
        renderer.mount(host, () => {})
        renderer.render(props.graph)
        mounted = true
        applyGraphConfig(renderer, props.theme)
        renderer.setVisible(props.active)
    })
    onCleanup(() => renderer.destroy())
    createEffect(() => mounted && applyGraphConfig(renderer, props.theme))
    createEffect(() => mounted && renderer.setVisible(props.active))
    return (
        <div
            class={`${styles['root']}${props.class ? ` ${props.class}` : ''}`}
            classList={{
                [styles['active']]: props.active,
                [styles['stage-backdrop']]: props.stage === 'backdrop',
                [styles['stage-hero']]: props.stage === 'hero',
            }}
        >
            <div class={styles['canvas']} ref={host} />
        </div>
    )
}

export default IntroGraph
