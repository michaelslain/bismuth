// The shape rules DESIGN.md declares (`governance.shape`): each one flags the old kanban and status
// menu shapes and passes the typed ones, run through the same checks the commit gate runs.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error plain ESM module without type declarations
import { parseGovernance, runChecks } from './designSystem/checks.mjs'

const root = join(import.meta.dir, '..')
const governance = parseGovernance(readFileSync(join(root, 'DESIGN.md'), 'utf8'))

type Finding = { check: string; path: string }
const shapeFindings = (path: string, content: string): Finding[] =>
    (runChecks(governance, [{ path, content }]) as Finding[]).filter(f => f.check.startsWith('shape'))

const OLD_COLUMN_TSX = `
export const KanbanColumn = props => (
    <CardFrame
        kind={props.tasks ? 'task' : 'note'}
        draggable
        dropTarget={props.dropCardId === id}
        onPointerDown={e => props.onDown(e)}
    >
        <KanbanCard />
    </CardFrame>
)
`
const NEW_COLUMN_TSX = OLD_COLUMN_TSX.replace("'note'}\n", "'note'}\n        typed\n")

const OLD_HEADER_CSS = `.header {\n  border-bottom: 1px solid var(--kb-col-color, var(--border-soft));\n}\n`
const NEW_HEADER_CSS = `.header {\n  position: relative;\n}\n.placeholder { outline: var(--rule-drop); }\n`

const OLD_MENU_TSX = `export const OPTIONS = [\n    { char: 'x', label: 'Done', icon: 'SquareCheck' },\n]\n`
const NEW_MENU_TSX = `export const OPTIONS = [\n    { char: 'x', label: 'done' },\n]\n`

describe('design system shape rules', () => {
    it('flags a kanban CardFrame without typed, and passes one with it', () => {
        expect(shapeFindings('app/src/bases/KanbanColumn.tsx', OLD_COLUMN_TSX)).toHaveLength(1)
        expect(shapeFindings('app/src/bases/KanbanColumn.tsx', NEW_COLUMN_TSX)).toHaveLength(0)
    })

    it('flags a drawn border in a kanban stylesheet, and passes the drop cue outline', () => {
        expect(shapeFindings('app/src/bases/KanbanColumnHeader.module.css', OLD_HEADER_CSS)).toHaveLength(1)
        expect(shapeFindings('app/src/bases/KanbanColumnHeader.module.css', NEW_HEADER_CSS)).toHaveLength(0)
    })

    it('flags a Lucide square icon as a task status, and passes a bracket glyph row', () => {
        expect(shapeFindings('app/src/taskStatusOptions.ts', OLD_MENU_TSX)).toHaveLength(1)
        expect(shapeFindings('app/src/taskStatusOptions.ts', NEW_MENU_TSX)).toHaveLength(0)
    })
})
