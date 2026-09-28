import { For, Match, Switch, type Component } from 'solid-js'
import NoteLink from '../ui/NoteLink'
import PlainButton from '../ui/PlainButton'
import Tag from '../ui/Tag'
import Text from '../ui/Text'
import { parseTaskInline, type TaskInlineSegment } from './taskInline'
import styles from './TaskText.module.css'

export type TaskTextProps = {
    /** The raw task description, inline markdown and all. */
    text: string
    /** Merged onto the root so one caller can adjust one instance without forking this. */
    class?: string
}

/** Schemes a `[label](url)` may open in a new tab. Anything else with a scheme
 *  (`javascript:`, `data:` …) is rendered as inert text. */
const OPENABLE = /^(https?:|mailto:)/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

const notePath = (target: string) =>
    target.endsWith('.md') ? target : `${target}.md`

/** A link segment: external (http/https/mailto) opens a tab, a scheme-less url is a note path
 *  (as TaskRow always treated it), any other scheme is refused and shown as plain text. */
const LinkSegment: Component<{ url: string; label: string }> = props => {
    if (OPENABLE.test(props.url))
        return (
            <PlainButton
                class={styles.link}
                title={props.url}
                onClick={e => {
                    e.stopPropagation()
                    window.open(props.url, '_blank', 'noopener')
                }}
            >
                {props.label}
            </PlainButton>
        )
    if (!HAS_SCHEME.test(props.url))
        return (
            <NoteLink path={notePath(props.url)}>{props.label}</NoteLink>
        )
    return (
        <Text as="span" inherit>
            {props.label}
        </Text>
    )
}

const Segment: Component<{ seg: TaskInlineSegment }> = props => (
    <Switch>
        <Match when={props.seg.kind === 'text' && props.seg}>
            {s => (
                <Text as="span" inherit>
                    {s().text}
                </Text>
            )}
        </Match>
        <Match when={props.seg.kind === 'wikilink' && props.seg}>
            {s => <NoteLink path={notePath(s().target)}>{s().label}</NoteLink>}
        </Match>
        <Match when={props.seg.kind === 'link' && props.seg}>
            {s => <LinkSegment url={s().url} label={s().label} />}
        </Match>
        <Match when={props.seg.kind === 'tag' && props.seg}>
            {s => <Tag name={s().name} />}
        </Match>
        <Match when={props.seg.kind === 'bold' && props.seg}>
            {s => (
                <Text as="span" inherit weight="bold">
                    {s().text}
                </Text>
            )}
        </Match>
        <Match when={props.seg.kind === 'italic' && props.seg}>
            {s => (
                // Task 1 adds `Text italic`; swap this local class for it then.
                <Text as="span" inherit class={styles.italic}>
                    {s().text}
                </Text>
            )}
        </Match>
    </Switch>
)

/**
 * A task description rendered as lightweight inline markdown, the one renderer for TaskRow and
 * the calendar's TaskChip: `[[Note]]` is a `NoteLink`, `#tag` a `Tag`, `**b**` / `*i*` weight and
 * style. Parsing is the pure `taskInline.ts`.
 */
const TaskText: Component<TaskTextProps> = props => (
    <Text as="span" inherit class={`${styles.taskText} ${props.class ?? ''}`.trim()}>
        <For each={parseTaskInline(props.text)}>{seg => <Segment seg={seg} />}</For>
    </Text>
)

export default TaskText
