// app/src/editor/slashComplete.ts
// CodeMirror wiring for the `/` slash-insertion menu. All the logic (trigger match, item
// catalog, ranking, snippet parsing) is pure in slashMenu.ts; this file is just the thin
// CompletionSource that reads the editor state, builds the option rows, and applies the
// chosen snippet — mirroring queryComplete.ts. Added to the ONE shared override array in
// autocomplete.ts (a second autocompletion() would conflict).
import {
    pickedCompletion,
    startCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
    type CompletionSource,
} from '@codemirror/autocomplete'
import { Compartment, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { IconedCompletion } from './completionDisplay'
import {
    SLASH_ITEMS,
    matchSlashPrefix,
    filterSlashItems,
    parseSnippet,
    inCodeFence,
    type SlashItem,
} from './slashMenu'
import { extractFrontmatterBoundary } from './frontmatterUtils'
import { todayISO } from '../../../core/src/dates'
import { queryFenceText } from './queryBuilderEdit'

// Today's date as an extra, dynamic item (can't live in the static catalog). YYYY-MM-DD to
// match the vault's daily-note / frontmatter date convention.
function dateItem(): SlashItem {
    const today = todayISO()
    return {
        id: 'date',
        label: "Today's date",
        icon: 'Calendar',
        info: "Insert today's date (YYYY-MM-DD).",
        keywords: ['today', 'date', 'now'],
        snippet: today,
    }
}

/** `/` slash menu: on a line whose first content char is `/`, offer insertions (headings,
 *  lists, table, query/code/math blocks, quote, callout, divider, page break, links,
 *  properties, date). Gated out of frontmatter (the property sources own it there) and
 *  fenced code/query blocks.
 *
 *  `getHostPath` — supplied ONLY by the note Editor (never the chat composer or a table cell,
 *  neither of which passes it through `vaultCompletion`/`markdownEditingExtensions`) — gates the
 *  "Query builder" item: it opens a modal that needs to know which note will host the resulting
 *  ```query block, so a surface with no host note never offers it. */
export function slashSource(
    inFrontmatter: (ctx: CompletionContext) => boolean,
    getHostPath?: () => string | null,
): CompletionSource {
    return (context: CompletionContext): CompletionResult | null => {
        if (inFrontmatter(context)) return null
        const line = context.state.doc.lineAt(context.pos)
        const textBefore = line.text.slice(0, context.pos - line.from)
        const match = matchSlashPrefix(textBefore)
        if (!match) return null

        // Inside a ``` fence the text is literal (or the query source owns the popup) — stay quiet.
        const upto: string[] = []
        for (let n = 1; n <= line.number; n++)
            upto.push(context.state.doc.line(n).text)
        if (inCodeFence(upto, line.number - 1)) return null

        const from = line.from + match.from
        // Frontmatter must be the FIRST thing in a file, so the Properties item is offered only
        // when the `/` sits at the true document start (line 1, column 0 — NOT after indentation
        // or a list marker) AND no frontmatter block already exists below the line being typed.
        // Without the second check, typing `/` on a fresh line 1 above existing frontmatter would
        // offer Properties and insert a SECOND `---` block, orphaning the real frontmatter.
        const atDocStart = line.number === 1 && match.from === 0
        const allowProps =
            atDocStart &&
            extractFrontmatterBoundary(
                context.state.doc.sliceString(line.to + 1),
            ) === null
        let pool = allowProps
            ? SLASH_ITEMS
            : SLASH_ITEMS.filter(i => i.when !== 'docStart')
        if (!getHostPath)
            pool = pool.filter(i => i.action !== 'queryBuilder')
        const items = filterSlashItems([...pool, dateItem()], match.query)

        const options: IconedCompletion[] = items.map(item => ({
            label: item.label,
            info: item.info,
            iconName: item.icon,
            apply(
                view: EditorView,
                completion: Completion,
                applyFrom: number,
                applyTo: number,
            ) {
                if (item.action === 'queryBuilder') {
                    applyQueryBuilder(
                        view,
                        completion,
                        applyFrom,
                        applyTo,
                        getHostPath,
                    )
                    return
                }
                const { text, caret } = parseSnippet(item.snippet)
                view.dispatch({
                    changes: { from: applyFrom, to: applyTo, insert: text },
                    selection: { anchor: applyFrom + caret },
                    annotations: pickedCompletion.of(completion),
                })
                if (item.reTrigger) startCompletion(view)
            },
        }))
        // filter:false → keep OUR keyword-aware ranking; no validFor → re-query each keystroke
        // (matchSlashPrefix re-runs, so the list narrows and a space/non-word char closes it).
        return { from, options, filter: false }
    }
}

/** Apply branch for the "Query builder" item: delete the `/…` trigger text, open the modal, and
 *  on confirm insert the generated ```query fence at the trigger's position — on cancel nothing
 *  is inserted (the trigger text is already gone).
 *
 *  The doc can change while the modal is open (autosave reflow, a wikilink edit elsewhere, even
 *  another keystroke once focus returns to the editor before confirm) — a raw remembered offset
 *  would then insert into the wrong place. So the insertion point is tracked LIVE through every
 *  intervening change via a transient `EditorView.updateListener`, added through a throwaway
 *  Compartment right on the deletion transaction and torn down in the same dispatch that inserts
 *  the fence (confirm) or on close (cancel) — `ChangeSet.mapPos` is CodeMirror's own answer to
 *  "where did this position go", so this never has to re-validate a stale guess.
 *
 *  `openQueryBuilder` is loaded via a DYNAMIC import, not a static one: it transitively imports
 *  `../bases/QueryBuilder` (a Solid component), which bun's test transform can't compile outside
 *  a `.tsx` or a dynamic import — the same trap cellEditorExtensions.ts documents for
 *  `livePreview`. A static import here would break every headless test that reaches this module
 *  through `autocomplete.ts` (autocomplete.test.ts, emojiSource.test.ts, memoryRefSource.test.ts),
 *  none of which ever exercises this branch. */
function applyQueryBuilder(
    view: EditorView,
    completion: Completion,
    applyFrom: number,
    applyTo: number,
    getHostPath?: () => string | null,
): void {
    const tracker = new Compartment()
    let pos = applyFrom
    view.dispatch({
        changes: { from: applyFrom, to: applyTo, insert: '' },
        effects: StateEffect.appendConfig.of(
            tracker.of(
                EditorView.updateListener.of(update => {
                    if (update.docChanged) pos = update.changes.mapPos(pos)
                }),
            ),
        ),
        annotations: pickedCompletion.of(completion),
    })
    void import('./openQueryBuilder').then(({ default: openQueryBuilder }) => {
        openQueryBuilder({
            hostPath: getHostPath?.() ?? undefined,
            onConfirm: body => {
                view.dispatch({
                    changes: {
                        from: pos,
                        to: pos,
                        insert: queryFenceText(body),
                    },
                    effects: tracker.reconfigure([]),
                })
            },
            onClose: () => {
                view.dispatch({ effects: tracker.reconfigure([]) })
            },
        })
    })
}
