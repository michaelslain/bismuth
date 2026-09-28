import { type Component, createEffect, onCleanup, onMount } from 'solid-js'
import { onMathReady, renderMath } from '../editor/katexLoader'
import { sanitizeHtml } from '../sanitizeHtml'
import styles from './Tex.module.css'

export type TexProps = {
    /** The math source, WITHOUT delimiters (no `$…$`/`$$…$$` — this is not markdown). */
    tex: string
    /** Display (block, centered) mode vs inline. Default false. */
    display?: boolean
    class?: string
}

/**
 * The KaTeX primitive — the ONE non-text output the chart views are allowed (DESIGN.md's
 * "Typed, Not Drawn" north star exempts KaTeX explicitly). Renders `props.tex` through the
 * app's shared lazy KaTeX loader (`editor/katexLoader.ts`) so every math surface — the editor,
 * `bases/markdown.ts`'s reading surfaces, and this — shares one config and one lazy chunk.
 * KaTeX loads asynchronously on first use; `onMathReady` re-renders once it lands (and on every
 * later mount, since a still-loading chunk resolves for everyone at once).
 */
const Tex: Component<TexProps> = props => {
    let el: HTMLElement | undefined

    const render = () => {
        if (!el) return
        el.innerHTML = props.tex
            ? sanitizeHtml(renderMath(props.tex, props.display ?? false))
            : ''
    }

    createEffect(render)

    onMount(() => {
        onCleanup(onMathReady(render))
    })

    const cls = () => [styles.tex, props.class].filter(Boolean).join(' ')

    return props.display ? (
        <div ref={e => (el = e)} class={cls()} />
    ) : (
        <span ref={e => (el = e)} class={cls()} />
    )
}

export default Tex
