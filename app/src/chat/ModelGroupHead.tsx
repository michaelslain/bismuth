// app/src/chat/ModelGroupHead.tsx
// A group heading in the model dialog: `//` in --faint, then the group's name in --text-muted at
// --fs-ui, and an optional detail (`free`) right-aligned in --faint in the rows' detail column.
// Distinct from SectionLabel, which carries no `//` (`models`, `effort`, `providers`).
import { Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import styles from './ModelGroupHead.module.css'

export type ModelGroupHeadProps = {
    label: string
    /** Faint right-aligned text, e.g. `free` when every row in the group is. */
    detail?: string
    class?: string
}

const ModelGroupHead: Component<ModelGroupHeadProps> = props => (
    <div data-model-group-head class={[styles.head, props.class].filter(Boolean).join(' ')}>
        <Text as="span" size="ui" tone="faint" aria-hidden="true">
            //
        </Text>
        <Text as="span" size="ui" tone="muted" class={styles.label}>
            {props.label}
        </Text>
        <Show when={props.detail}>
            {d => (
                <Text as="span" size="ui" tone="faint" class={styles.detail}>
                    {d()}
                </Text>
            )}
        </Show>
    </div>
)

export default ModelGroupHead
