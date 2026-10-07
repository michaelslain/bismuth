// app/src/preview/OutlineTree.stories.tsx
// Visual + behavioural spec for <OutlineTree> — a PDF's embedded table of contents as a
// collapsible, file-tree-style tree. Covers: expand/collapse + jump on a leaf, a dead destination
// (`page: null`) that renders dimmed and does nothing on click, the WAI-ARIA roving-focus keyboard
// pattern (see OutlineTree.tsx's own header comment), and the reader's current-section highlight.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import OutlineTree from './OutlineTree'
import type { OutlineNode } from './annotationTypes'
import { hoverDeclarations, hoverProps } from '../ui/_hoverRules'

const meta = {
    title: 'Preview/OutlineTree',
    component: OutlineTree,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof OutlineTree>

export default meta
type Story = StoryObj<typeof meta>

const nodes: OutlineNode[] = [
    {
        title: 'Introduction',
        page: 0,
        children: [
            { title: 'Background', page: 1, children: [] },
            { title: 'Scope', page: 2, children: [] },
        ],
    },
    { title: 'Methods', page: 3, children: [] },
]

/** A parent + two children + a sibling leaf: the disclosure toggle collapses/expands the parent's
 *  children, a leaf click jumps to its page, and arrow keys rove focus between rows (down into a
 *  child, up back out, Home/End to the ends) per the WAI-ARIA tree pattern. */
export const Nested: Story = {
    render: () => {
        const [jumped, setJumped] = createSignal<number | null>(null)
        return (
            <div style={{ width: '260px' }}>
                <OutlineTree nodes={nodes} onJump={setJumped} />
                <div
                    data-testid="jumped"
                    style={{ position: 'absolute', left: '-9999px' }}
                >
                    {jumped()}
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const tree = canvasElement.querySelector(
            '[role="tree"]',
        ) as HTMLElement
        // A clickable row never paints a background on hover; the pointer lifts the ink only.
        const liveRow = canvas
            .getByText('Methods')
            .closest('[role="treeitem"]') as HTMLElement
        await expect(hoverProps(liveRow, 'background')).toEqual([])
        await expect(
            hoverDeclarations(liveRow).map(d => d.prop),
        ).toContain('color')
        // Open by default: parent + both children + the sibling leaf all render.
        await expect(canvas.getByText('Introduction')).toBeInTheDocument()
        await expect(canvas.getByText('Background')).toBeInTheDocument()
        await expect(canvas.getByText('Scope')).toBeInTheDocument()
        await expect(canvas.getByText('Methods')).toBeInTheDocument()
        await expect(
            tree.querySelectorAll('[role="treeitem"]').length,
        ).toBe(4)

        // The three column gaps are margins set on `Label`/`Text` through this module's own classes.
        // Both compose `Text`, whose `.text { margin: 0 }` has the same specificity — so which wins
        // is stylesheet source order, which nothing else covers. Read the computed values.
        const introRow = canvas
            .getByText('Introduction')
            .closest('[role="treeitem"]') as HTMLElement
        const [prefixEl, slotEl, titleEl] = Array.from(introRow.children) as HTMLElement[]
        await expect(parseFloat(getComputedStyle(prefixEl!).marginRight)).toBeGreaterThan(4)
        await expect(parseFloat(getComputedStyle(slotEl!).marginRight)).toBeGreaterThan(4)
        await expect(parseFloat(getComputedStyle(titleEl!).marginRight)).toBeGreaterThan(0)

        // Collapse "Introduction" — its two children leave the tree entirely.
        const toggle = canvas.getByLabelText('Collapse Introduction')
        await fireEvent.click(toggle)
        await waitFor(() =>
            expect(
                tree.querySelectorAll('[role="treeitem"]').length,
            ).toBe(2),
        )
        await expect(canvas.queryByText('Background')).toBeNull()
        await fireEvent.click(canvas.getByLabelText('Expand Introduction'))
        await waitFor(() =>
            expect(
                tree.querySelectorAll('[role="treeitem"]').length,
            ).toBe(4),
        )

        // A leaf click jumps to its (0-based) page.
        await fireEvent.click(canvas.getByText('Methods'))
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="jumped"]')
                    ?.textContent,
            ).toBe('3'),
        )

        // Roving focus: ArrowDown from the container steps onto the first row (depth 1), a
        // second ArrowDown steps INTO the open parent's first child (depth 2), End jumps to the
        // last row, Home back to the first.
        tree.focus()
        await fireEvent.keyDown(tree, { key: 'ArrowDown' })
        await waitFor(() =>
            expect(document.activeElement?.getAttribute('aria-level')).toBe(
                '1',
            ),
        )
        await fireEvent.keyDown(document.activeElement!, {
            key: 'ArrowDown',
        })
        await waitFor(() =>
            expect(document.activeElement?.textContent).toContain(
                'Background',
            ),
        )
        await expect(
            document.activeElement?.getAttribute('aria-level'),
        ).toBe('2')
        await fireEvent.keyDown(document.activeElement!, { key: 'End' })
        await waitFor(() =>
            expect(document.activeElement?.textContent).toContain(
                'Methods',
            ),
        )
        await fireEvent.keyDown(document.activeElement!, { key: 'Home' })
        await waitFor(() =>
            expect(document.activeElement?.textContent).toContain(
                'Introduction',
            ),
        )
        // Nothing draws focus: the focused row and the tree itself carry no outline (the browser's
        // own :focus-visible ring is suppressed too, and nothing replaces it).
        await expect(getComputedStyle(document.activeElement!).outlineStyle).toBe('none')
        await expect(getComputedStyle(tree).outlineStyle).toBe('none')
    },
}

/** A destination that didn't resolve (`page: null`): still listed — dimmed, `p.?` in its page
 *  column — and a click on it does nothing (no `onJump` call). */
export const DeadDestination: Story = {
    render: () => {
        const [jumps, setJumps] = createSignal(0)
        const dead: OutlineNode[] = [
            { title: 'Broken link', page: null, children: [] },
        ]
        return (
            <div style={{ width: '260px' }}>
                <OutlineTree nodes={dead} onJump={() => setJumps(n => n + 1)} />
                <div data-testid="jumps">{jumps()}</div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('p.?')).toBeInTheDocument()
        // Inert stays inert under the pointer: no hover rule paints a fill or recolours a dead row.
        const deadRow = canvas
            .getByText('Broken link')
            .closest('[role="treeitem"]') as HTMLElement
        await expect(hoverDeclarations(deadRow)).toEqual([])
        await fireEvent.click(canvas.getByText('Broken link'))
        // Give any (wrongly) queued jump a tick to land before asserting it never did.
        await new Promise(r => queueMicrotask(r))
        await expect(
            canvasElement.querySelector('[data-testid="jumps"]')?.textContent,
        ).toBe('0')
    },
}

/** The reader's current section (`currentPath`, threaded through recursive calls): only the row
 *  it names gets `aria-current="location"` — not its ancestor, not its sibling. */
export const CurrentSection: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            {/* currentPath [0, 1] → top-level node 0 ("Introduction"), its child 1 ("Scope"). */}
            <OutlineTree nodes={nodes} onJump={() => {}} currentPath={[0, 1]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const scope = canvas.getByText('Scope').closest('[role="treeitem"]')
        const introduction = canvas
            .getByText('Introduction')
            .closest('[role="treeitem"]')
        const background = canvas
            .getByText('Background')
            .closest('[role="treeitem"]')
        // The selected row keeps its background and accent ink under the pointer: no hover rule
        // reaches it (a (0,2,0) hover rule used to replace both).
        await expect(hoverDeclarations(scope as HTMLElement)).toEqual([])
        await expect(scope?.getAttribute('aria-current')).toBe('location')
        await expect(introduction?.getAttribute('aria-current')).toBeNull()
        await expect(background?.getAttribute('aria-current')).toBeNull()
    },
}
