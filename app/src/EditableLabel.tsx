// app/src/EditableLabel.tsx
import { onCleanup } from 'solid-js'
import { api } from './api'
import { pushToast } from './Toast'
import { NOTE_EXT_RE } from '../../core/src/pathUtils'
import { flushEditorsAtOrUnder } from './editorRegistry'
import type { TreeNode } from './fileTreeModel'
import { parentOf, joinPath } from './fileTreeOps'
import styles from './EditableLabel.module.css'

/** Inline-editable name. Renders an auto-selected input; Enter commits via move, Escape cancels. */
export function EditableLabel(props: {
    node: TreeNode
    isDir: boolean
    setEditing: (p: string | null) => void
    refresh: () => void
    optimisticRename: (from: string, to: string) => void
    trackPending: <T>(fn: () => Promise<T>) => Promise<T>
    awaitCreate: (path: string) => Promise<void>
    onSettled: (createPath: string, finalPath: string) => void
}) {
    let inputRef: HTMLInputElement | undefined
    const initial = props.node.name
    const startPath = props.node.path
    // The input shows the extension-STRIPPED stem (like Obsidian hides `.md`), so the
    // user never sees or has to preserve the `.md`/`.yaml`/`.yml`. The extension is
    // re-applied on commit. Dirs (and any name without a hidden ext) have ext="" and
    // stem === initial. `.slice` (not `.replace`) so a multi-dot name like
    // `notes.v2.md` strips only the trailing `.md`, leaving `notes.v2`.
    const ext = props.isDir ? '' : (initial.match(NOTE_EXT_RE)?.[0] ?? '')
    const stem = ext ? initial.slice(0, initial.length - ext.length) : initial
    // setEditing(null) unmounts the input, which fires blur → a second commit.
    // `done` makes the rename (or cancel) run exactly once.
    let done = false
    // Report this row's resting place EXACTLY once, whichever way the edit ended. A brand-new
    // note's template write is waiting on this (renameSettle, in FileTree above) — it has to fire
    // on the abandon paths too (Escape, empty/unchanged input, a failed move), otherwise a user
    // who keeps "Untitled" would silently get no template at all.
    let reported = false
    const settle = (finalPath: string) => {
        if (reported) return
        reported = true
        props.onSettled(startPath, finalPath)
    }

    const commit = async () => {
        if (done) return
        done = true
        const raw = inputRef?.value.trim() ?? ''
        props.setEditing(null)
        if (!raw || raw === stem) {
            settle(startPath)
            return
        } // no-op (input holds the stem, not the full name)
        // Re-apply the original hidden extension (.md/.yaml/.yml) if the user dropped it — but
        // NOT if they typed a DIFFERENT recognized hidden extension (NOTE_EXT_RE, the shared
        // source of truth), or 'config.yaml' renamed to 'config.yml' comes out 'config.yml.yaml'.
        // A name that merely contains a dot (no recognized extension) still gets it appended.
        const newName = ext && !NOTE_EXT_RE.test(raw) ? `${raw}${ext}` : raw
        if (newName === initial) {
            settle(startPath)
            return
        } // typed the exact current name back (e.g. with the ext) → silent no-op, not an EEXIST error
        const from = startPath
        const to = joinPath(parentOf(from), newName)
        // Persist any unsaved edits to the OLD path and AWAIT it BEFORE moving, so the move carries
        // the complete buffer and the editor's path-change cleanup has nothing left to stray-write
        // to the old path afterward (re-creating it as an orphan) (B6). Must land before both the
        // dispatch below (which retargets the tab and triggers the Editor's path-change cleanup)
        // and optimisticRename.
        await flushEditorsAtOrUnder(from)
        props.optimisticRename(from, to) // instant; reverted via refresh() on failure
        // Keep any open tab pointing at the renamed path.
        window.dispatchEvent(
            new CustomEvent('bismuth-moved', { detail: { from, to } }),
        )
        try {
            // If this row was just created, its `api.create` may still be in flight —
            // wait for it so the move never races ahead of the file's existence on disk.
            await props.awaitCreate(from)
            await props.trackPending(() => api.move(from, to))
            // Only NOW is the file actually at `to` on disk, so anything waiting to write to it
            // (the new-note template) can go ahead without racing the move.
            settle(to)
        } catch (e) {
            // Reverse the optimistic retarget so panes pointing at the now-nonexistent `to` path
            // are rewritten back to `from` (App.tsx's renamePath) before refresh() reverts the tree.
            window.dispatchEvent(
                new CustomEvent('bismuth-moved', {
                    detail: { from: to, to: from },
                }),
            )
            props.refresh()
            pushToast(`Rename failed: ${(e as Error).message}`)
            settle(from) // the move never landed — the note is still at the path it was created at
        }
    }

    const cancel = () => {
        if (done) return
        done = true
        props.setEditing(null)
        settle(startPath)
    }

    // Safety net: if the edit box goes away without either path running (an external
    // setEditing(null), a tree rebuild that drops the row), the row is still on disk at the name
    // it had — report that, so a pending template write can never be stranded forever. `done` is
    // set BEFORE commit()'s own setEditing(null) unmounts us, so this can't pre-empt a commit
    // that is still awaiting its move.
    onCleanup(() => {
        if (!done) settle(startPath)
    })

    return (
        <input
            ref={el => {
                inputRef = el
                // The value is already the extension-stripped stem, so just select it all.
                queueMicrotask(() => {
                    el.focus()
                    el.select()
                })
            }}
            value={stem}
            class={styles['ft-edit-input']}
            onClick={e => e.stopPropagation()}
            // The row starts a drag on POINTERDOWN, not click — stopPropagation on onClick alone
            // doesn't reach it. Stop it here so a press placing the caret can never be read as a
            // row-drag start, instead of the parent DOM-matching a hashed class name to find out.
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') cancel()
            }}
            onBlur={commit}
        />
    )
}
