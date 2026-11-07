import { createEffect, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import { TEXT_FONT_FAMILY, TEXT_STYLE, type TextLineBox, type TextPage, type TextRun } from './bookText'
import { mathHtml } from './bookMath'
import { texOf } from './bookTextRaster'
import { BOOK_TEXT_INK, BOOK_TEXT_MUTED, PDF_PAGE_PAPER } from '../../../core/src/theme/tokens'
import { markSpanAt, quotesFromSelection, type BookQuote, type SelectionLine } from './bookSelection'
import styles from './TextSpread.module.css'

/** Reads the quotes the current selection covers; empty when nothing inside the spread is selected. */
export type TextSpreadReader = () => BookQuote[]

export type TextSpreadProps = {
    /** The left and right text pages; null where the spread has no page (the cover's left side). */
    pages: [TextPage | null, TextPage | null]
    layout: 'spread' | 'single'
    /** One page, CSS px; the size the pages were typeset for. */
    pageSize: { w: number; h: number }
    /** Text size, as a multiple of the size the page's width picks; the pages were typeset at it. */
    textScale?: number
    /** The tint behind a highlighted run (any CSS colour). */
    markColor: string
    /** A click in a page's outer third: 1 turns forward, -1 back. */
    onTurn: (dir: 1 | -1) => void
    /** Hands the parent a function that reads the current selection as quotes, one per notebook page. */
    readerRef?: (read: TextSpreadReader) => void
    /** A pointer press ended inside the spread: a drag-selection is final. */
    onSelectEnd?: () => void
    /** A click landed on a highlighted run; the whole highlight is passed. */
    onMarkClick?: (mark: BookQuote) => void
    /** A right-click on a line of text, with the notebook page (leaf index) the line came from. */
    onLineContextMenu?: (e: MouseEvent, leaf: number) => void
    /** The type face; the pages were typeset in it. Defaults to the serif stack the stories use. */
    fontFamily?: string
    /** Paper, ink and placeholder ink; default the light sheet, a PDF page's white. */
    colors?: { paper: string; ink: string; muted: string }
    className?: string
}

const pageOf = (l: TextLineBox) => l.source.pdfPage ?? 1

/** The transcriptions as the still pages of an open book: justified serif lines at the exact
 *  positions `paginateText` computed, each carrying its source file, page and first word so a
 *  selection maps back to the notebook pages it covers. Plain positioned spans rather than
 *  paragraph text: a justified line is laid out word by word to the px, which flowing text cannot
 *  reproduce. A formula is KaTeX's markup in a run that selects whole and quotes as its source. */
const TextSpread: Component<TextSpreadProps> = props => {
    let root!: HTMLDivElement
    let probe!: HTMLDivElement
    let strut!: HTMLSpanElement

    const fontPx = () => TEXT_STYLE(props.pageSize, props.textScale ?? 1).fontPx
    const family = () => props.fontFamily ?? TEXT_FONT_FAMILY
    const font = () => `${fontPx()}px ${family()}`
    const [metrics, setMetrics] = createSignal({ space: fontPx() * 0.25, baseline: fontPx() })
    const measure = () => {
        const g = document.createElement('canvas').getContext('2d')
        if (g) g.font = font()
        const space = g ? g.measureText(' ').width : fontPx() * 0.25
        const baseline = strut.getBoundingClientRect().top - probe.getBoundingClientRect().top
        setMetrics({ space, baseline: baseline > 0 ? baseline : fontPx() })
    }
    onMount(() => createEffect(() => (font(), measure())))

    const lineEls = () => Array.from(root.querySelectorAll<HTMLElement>('[data-text-line]'))
    const runEls = (line: HTMLElement) => Array.from(line.querySelectorAll<HTMLElement>(':scope > [data-text-run]'))
    /** A run's text as the transcript holds it: a formula's is its `$…$` source. */
    const runText = (el: HTMLElement) => el.dataset.source ?? el.textContent ?? ''
    const describe = (el: HTMLElement): SelectionLine => {
        const runs = runEls(el)
        return {
            file: el.dataset.file ?? '',
            page: Number(el.dataset.page) || 1,
            text: runs.map(runText).join(''),
            runs: runs.map(c => ({ length: runText(c).length, mark: c.hasAttribute('data-text-mark') })),
        }
    }
    /** Characters of the line's transcript text before the point (node, offset). A point inside a
     *  formula counts as its end, so a selection never splits one. */
    const offsetIn = (el: HTMLElement, node: Node, offset: number) => {
        let at = 0
        for (const run of runEls(el)) {
            if (run === node || run.contains(node)) {
                if (run.dataset.source !== undefined) return at + (run === node && offset === 0 ? 0 : run.dataset.source.length)
                const r = document.createRange()
                r.setStart(run, 0)
                r.setEnd(node, offset)
                return at + r.toString().length
            }
            at += runText(run).length
        }
        return at
    }

    const read: TextSpreadReader = () => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return []
        const range = sel.getRangeAt(0)
        const els = lineEls().filter(el => range.intersectsNode(el))
        if (els.length === 0) return []
        const all = lineEls()
        const first = els[0]
        const last = els[els.length - 1]
        const startsIn = first.contains(range.startContainer)
        const endsIn = last.contains(range.endContainer)
        return quotesFromSelection(
            all.map(describe),
            { line: all.indexOf(first), offset: startsIn ? offsetIn(first, range.startContainer, range.startOffset) : 0 },
            {
                line: all.indexOf(last),
                offset: endsIn ? offsetIn(last, range.endContainer, range.endOffset) : (last.textContent?.length ?? 0),
            },
        )
    }
    props.readerRef?.(read)

    const hasSelection = () => {
        const sel = window.getSelection()
        return !!sel && !sel.isCollapsed && root.contains(sel.anchorNode)
    }

    const markAt = (target: EventTarget | null): BookQuote | null => {
        const run = (target as HTMLElement | null)?.closest<HTMLElement>('[data-text-mark]')
        const line = run?.closest<HTMLElement>('[data-text-line]')
        if (!run || !line) return null
        const all = lineEls()
        const offset = offsetIn(line, run, 0)
        return markSpanAt(all.map(describe), all.indexOf(line), offset)
    }

    const click = (side: 'left' | 'right') => (e: MouseEvent) => {
        if (hasSelection()) return
        const mark = markAt(e.target)
        if (mark && props.onMarkClick) return props.onMarkClick(mark)
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const f = (e.clientX - box.left) / box.width
        if (props.layout === 'single') {
            if (f >= 2 / 3) props.onTurn(1)
            else if (f <= 1 / 3) props.onTurn(-1)
        } else if (side === 'right' && f >= 2 / 3) props.onTurn(1)
        else if (side === 'left' && f <= 1 / 3) props.onTurn(-1)
    }

    const menu = (e: MouseEvent) => {
        if (!props.onLineContextMenu) return
        // the line under the pointer, else the page's first line: a right-click in a margin names the page too
        const target = e.target as HTMLElement | null
        const line =
            target?.closest<HTMLElement>('[data-text-line]') ??
            (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-text-line]')
        const leaf = line ? Number(line.dataset.leaf) : NaN
        if (Number.isNaN(leaf)) return
        props.onLineContextMenu(e, leaf)
    }

    const up = () => props.onSelectEnd?.()
    onMount(() => {
        window.addEventListener('pointerup', up)
        onCleanup(() => window.removeEventListener('pointerup', up))
    })

    // The same sheet as the scan: white paper and dark ink, or both turned as the dark pages are.
    const colors = () => props.colors ?? { paper: PDF_PAGE_PAPER, ink: BOOK_TEXT_INK, muted: BOOK_TEXT_MUTED }
    const pageStyle = () => ({ width: `${props.pageSize.w}px`, height: `${props.pageSize.h}px`, background: colors().paper, color: colors().ink })

    /** A line holding a formula sits by its own baseline: the strut at its start says where that
     *  landed, and the line moves so it is the typesetter's `y`. */
    const settle = (el: HTMLElement, line: TextLineBox) => {
        if (!line.runs.some(r => r.math)) return
        requestAnimationFrame(() => {
            const strut = el.querySelector<HTMLElement>(':scope > [data-text-strut]')
            if (!strut || !el.isConnected) return
            const off = strut.getBoundingClientRect().top - el.getBoundingClientRect().top
            el.style.top = `${line.y - off}px`
        })
    }

    const Run: Component<{ run: TextRun }> = r => (
        <Show
            when={r.run.math}
            fallback={
                <Text
                    as="span"
                    inherit
                    weight={r.run.bold ? 'bold' : undefined}
                    class={r.run.mark ? styles.mark : undefined}
                    style={r.run.mark ? { background: props.markColor } : undefined}
                    data-text-run
                    data-text-mark={r.run.mark ? '' : undefined}
                >
                    {r.run.text}
                </Text>
            }
        >
            <Text
                as="span"
                inherit
                class={[styles.math, r.run.mark ? styles.mark : ''].filter(Boolean).join(' ')}
                style={r.run.mark ? { background: props.markColor } : undefined}
                data-text-run
                data-text-math={r.run.math}
                data-source={r.run.text}
                data-text-mark={r.run.mark ? '' : undefined}
                innerHTML={mathHtml(texOf(r.run), r.run.math === 'display') || undefined}
            >
                {mathHtml(texOf(r.run), r.run.math === 'display') ? undefined : r.run.text}
            </Text>
        </Show>
    )

    const Page: Component<{ side: 'left' | 'right'; page: TextPage | null }> = p => (
        <div class={styles.page} style={pageStyle()} data-text-page={p.side} onClick={click(p.side)} onContextMenu={menu}>
            <Show when={p.page}>
                {page => (
                    <For each={page().lines}>
                        {line => (
                            <Text
                                as="div"
                                inherit
                                class={styles.line}
                                style={{
                                    left: `${line.x}px`,
                                    top: `${line.y - metrics().baseline}px`,
                                    'word-spacing': `${line.gap - metrics().space}px`,
                                    ...(line.placeholder ? { color: colors().muted } : {}),
                                    ...(line.scale ? { transform: `scale(${line.scale})`, 'transform-origin': 'left top' } : {}),
                                }}
                                data-text-line
                                data-text-placeholder={line.placeholder ? '' : undefined}
                                data-file={line.source.file}
                                data-page={pageOf(line)}
                                data-leaf={line.source.leaf}
                                data-start={line.start}
                                ref={el => settle(el, line)}
                            >
                                <For each={line.runs}>{run => <Run run={run} />}</For>
                                <Text as="span" inherit class={styles.strut} data-text-strut />
                            </Text>
                        )}
                    </For>
                )}
            </Show>
        </div>
    )

    return (
        <div
            ref={root}
            class={[styles.spread, props.className].filter(Boolean).join(' ')}
            style={{ 'font-family': family(), 'font-size': `${fontPx()}px` }}
            data-text-spread
        >
            <Text as="div" inherit class={styles.probe} ref={probe} aria-hidden="true">
                x<Text as="span" inherit ref={strut} class={styles.strut} />
            </Text>
            <Show when={props.layout === 'spread'}>
                <Page side="left" page={props.pages[0]} />
            </Show>
            <Page side="right" page={props.pages[1]} />
        </div>
    )
}

export default TextSpread
