import type { Component, JSX } from 'solid-js'
import { openNote } from './openNote'
import styles from './NoteLink.module.css'

export type NoteLinkProps = {
    /** Vault path of the note to open, e.g. `journal/2026-08-04.md`. */
    path: string
    /** Visible label. Defaults to the path when omitted. */
    children?: JSX.Element
    class?: string
    /** `link` (default) is accent-coloured; `title` reads as the row's title (--fg), accent on hover. */
    tone?: 'link' | 'title'
    /** `path` is a web address (http / https / mailto), not a note: the click opens it in a new tab
     *  instead of dispatching `bismuth-open`. The SAME treatment as a note link — accent, underline
     *  on hover only — so a wikilink and an external link in one line read as one kind of thing. */
    external?: boolean
}

/**
 * The ONE way to render "open this note". Every base view, every search result and every card
 * field that links to a note goes through here.
 *
 * WHY IT EXISTS AS A COMPONENT rather than a shared CSS rule: the house rule is that a shared
 * stylesheet means a missing component, and this was the largest instance of it — three views of
 * one dataset rendered the same affordance three different ways (see NoteLink.module.css for the
 * three). A rule would have fixed the color; only a component also fixes the BEHAVIOUR, which was
 * equally inconsistent: Table and Bullets dispatched `bismuth-open`, List did nothing at all.
 *
 * `href="#"` with `preventDefault` is kept deliberately: it is what makes the element a real link
 * to the platform, so it is focusable, announced as a link, and reachable by the browser's own
 * find-link affordances — none of which a `<span onClick>` gets. The navigation itself rides the
 * existing `bismuth-open` CustomEvent so this component stays free of any router or store import
 * and can render in Storybook with no backend.
 */
const NoteLink: Component<NoteLinkProps> = props => (
    <a
        href="#"
        data-tone={props.tone ?? 'link'}
        title={props.external ? props.path : undefined}
        class={[styles.noteLink, props.class].filter(Boolean).join(' ')}
        onClick={e => {
            e.preventDefault()
            if (props.external) {
                // The row around a task line owns its own clicks; a link in it is not one of them.
                e.stopPropagation()
                window.open(props.path, '_blank', 'noopener')
                return
            }
            openNote(props.path)
        }}
    >
        {props.children ?? props.path}
    </a>
)

export default NoteLink
export { NoteLink }
