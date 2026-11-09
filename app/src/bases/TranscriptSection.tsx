// app/src/bases/TranscriptSection.tsx
// One page's section of a book's text, the same in text mode and side by side: it binds a page to its
// TranscriptPage. Layout around it (the column, the row beside the picture) belongs to the caller.
import { onCleanup, type Component, type JSX } from 'solid-js'
import TranscriptPage, { type TranscriptPageHandle } from './TranscriptPage'
import type { TranscriptCheck } from '../../../core/src/transcript'

export type TranscriptSectionPage = {
    key: string
    label?: string
    text: string
    status?: JSX.Element
    /** the page's review checks, their approve and their scan strip (TranscriptPage's props) */
    checks?: TranscriptCheck[]
    onApprove?: (line: string) => void
    crop?: (line: string) => JSX.Element | undefined
}

export type TranscriptSectionProps = {
    page: TranscriptSectionPage
    onSave: (key: string, text: string) => void
    pageRef?: (key: string, handle: TranscriptPageHandle | undefined) => void
    fontFamily?: string
    textScale?: number
    onSelect?: (selection: string) => void
    onContextMenu?: (e: MouseEvent, key: string, selection: string) => void
    className?: string
}

const TranscriptSection: Component<TranscriptSectionProps> = props => (
    <TranscriptPage
        label={props.page.label}
        text={props.page.text}
        status={props.page.status}
        checks={props.page.checks}
        onApprove={props.page.onApprove}
        crop={props.page.crop}
        onSave={text => props.onSave(props.page.key, text)}
        ref={handle => {
            const key = props.page.key
            props.pageRef?.(key, handle)
            onCleanup(() => props.pageRef?.(key, undefined))
        }}
        fontFamily={props.fontFamily}
        textScale={props.textScale}
        onSelect={props.onSelect}
        onContextMenu={(e, selection) => props.onContextMenu?.(e, props.page.key, selection)}
        className={props.className}
    />
)

export default TranscriptSection
