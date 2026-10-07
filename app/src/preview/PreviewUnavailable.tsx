// app/src/preview/PreviewUnavailable.tsx — PreviewUnavailable.tsx is the ONLY importer of
// PreviewUnavailable.module.css. The centred "can't show this here" block + an "open in default
// app" action, written once for the two cases that need it (an image that failed to load, a binary
// format with no preview) instead of hand-composed twice in PreviewView.
import type { Component } from 'solid-js'
import EmptyState from '../ui/EmptyState'
import { IconTextButton } from '../ui/IconTextButton'
import { isTauri } from '../platform'
import styles from './PreviewUnavailable.module.css'

export type PreviewUnavailableProps = {
    title: string
    /** The first sentence, e.g. `"a.png" could not be displayed.` */
    what: string
    /** What opening it externally is for: 'view it' / 'view or edit it'. */
    verb: string
    /** Open the file in its default app. The action renders only in the desktop app. */
    onOpenExternal: () => void
}

const PreviewUnavailable: Component<PreviewUnavailableProps> = props => (
    <div class={styles['preview-unavailable']}>
        <EmptyState title={props.title}>
            {`${props.what} ${
                isTauri() ? 'Open it in its default app to' : 'Open it externally to'
            } ${props.verb}.`}
        </EmptyState>
        {isTauri() ? (
            <IconTextButton icon="ExternalLink" onClick={props.onOpenExternal}>
                open in default app
            </IconTextButton>
        ) : null}
    </div>
)

export default PreviewUnavailable
