// Every pane is `contain: strict` (PaneLeaf.module.css), so work inside one pane re-lays-out and
// repaints that pane only. Containment also makes the pane the containing block of any
// `position: fixed` descendant: an element placed in viewport coordinates from inside a pane lands
// offset by the pane's own position, with no error anywhere. This suite pins the containment and
// keeps every module stylesheet that declares `position: fixed` on a list of components that
// either portal to <body> or never render inside a pane.
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = import.meta.dir

/** Module stylesheets allowed a `position: fixed` rule, and why each is safe. */
const FIXED_OK: Record<string, string> = {
    'chat/ChatTranscript.module.css':
        'the selection reply renders through <Portal>',
    'intro/VaultIntro.module.css':
        'the first-run intro covers the window, outside any pane',
    'quickAsk/QuickAsk.module.css':
        'quick ask is mounted by App, outside the pane tree',
    'shell/DragGhost.module.css': 'the drag ghost is window chrome',
    'shell/GraphFloater.module.css':
        'the graph floater is mounted by App over its host',
    'ui/AnchoredPopover.module.css': 'AnchoredPopover renders through <Portal>',
    'ui/Modal.module.css': 'Modal renders through <Portal>',
    'ui/ToastHost.module.css': 'the toast host is mounted once by App',
    'ui/TooltipHost.module.css': 'the tooltip host renders through <Portal>',
}

const moduleSheets = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = join(dir, e.name)
        if (e.isDirectory()) return moduleSheets(p)
        return e.name.endsWith('.module.css') ? [relative(SRC, p)] : []
    })

/** The CSS with comments removed, so a rule quoted in a comment does not count. */
const rules = (path: string) =>
    readFileSync(join(SRC, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('pane containment', () => {
    it('makes every pane leaf strictly contained', () => {
        const leaf = rules('PaneLeaf.module.css').match(
            /\.pane-leaf\s*\{([^}]*)\}/,
        )
        expect(leaf?.[1]).toMatch(/contain:\s*strict/)
    })

    it('keeps position: fixed to stylesheets that portal or live outside panes', () => {
        const fixed = moduleSheets(SRC).filter(p =>
            /position:\s*fixed/.test(rules(p)),
        )
        expect(fixed.filter(p => !(p in FIXED_OK))).toEqual([])
        // every entry still declares a fixed rule, so the list cannot rot into blanket permission
        expect(Object.keys(FIXED_OK).filter(p => !fixed.includes(p))).toEqual(
            [],
        )
    })

    it('portals the chat selection reply out of the pane', () => {
        const src = readFileSync(join(SRC, 'chat/ChatTranscript.tsx'), 'utf8')
        expect(src).toMatch(
            /<Portal>\s*<Popover\s+class=\{styles\['chat-sel-reply'\]\}/,
        )
    })
})
