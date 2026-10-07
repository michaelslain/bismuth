import type { ViewResult, BaseConfig, Row } from '../../../core/src/bases/types'
import { renderValue } from './valueRenderers'
import { titleOf } from './kanbanMeta'
import { CardEditor } from './CardEditor'
import CardFrame from './CardFrame'
import CardTitle from './CardTitle'
import styles from './BodyCard.module.css'

/**
 * A body/tasks card: a title chip over a SEAMLESS inline editor of the note (`CardEditor`). Clicking
 * places a cursor, dragging selects, edits autosave to the note — it edits like normal markdown.
 * In `body` mode the whole note body is editable (frontmatter + a duplicated `# Title` heading are
 * kept out so the title isn't shown twice). In `tasks` mode the editor is scoped to the note's
 * checklist (first task line → last), keeping the card a focused but fully-editable list — add,
 * delete, or retype task lines — while prose before/after the checklist is preserved untouched.
 */
export function BodyCard(props: {
    row: Row
    result: ViewResult
    config: BaseConfig
    mode?: 'body' | 'tasks'
    class?: string
}) {
    const firstCol = () => props.result.columns[0] ?? 'file.name'
    // Plain-string title used both as the chip and to detect+strip a duplicate `# Title` heading.
    const titleText = (): string => titleOf(props.row, firstCol())

    return (
        // overflow visible: the embedded CodeMirror editor's completion popup must be able to
        // leave the card.
        <CardFrame overflow="visible" class={props.class}>
            <div class={styles.bodyCard}>
                <CardTitle>
                    {renderValue(firstCol(), props.row)}
                </CardTitle>
                <CardEditor
                    path={props.row.file.path}
                    title={titleText()}
                    mode={props.mode === 'tasks' ? 'tasks' : 'body'}
                />
            </div>
        </CardFrame>
    )
}
