// The ONE place a new task is appended to a note as a `- [ ] ` line.
//
// It was the tail of the calendar toolbar's `createTask`, reachable only from a calendar in
// its tasks register. Every other view kind grew the same "+ task" action in tasks mode, and a
// second copy of "read the file, decide whether it needs a newline, append a checkbox line"
// is exactly the drift this plan removes elsewhere — so the calendar now calls this too.
//
// What is NOT here: the stored-row branch. Creating a row is a single `api.rowCreate` call
// whose NOTE differs per caller (the calendar dates the row on the day its grid is showing;
// every other kind has no day to date it on), so wrapping it would hide the one part that
// actually varies behind a function that adds nothing.
import { api } from '../api'

/**
 * Append `- [ ] <body>` to the note `file` (a taskFile REF, e.g. `[[General Tasks]]`) resolves
 * to. Resolution and the write both happen SERVER-SIDE (`POST /tasks/create` →
 * `core/src/taskCreate.ts`'s `resolveTaskFilePath`/`appendTaskLine`), against the vault's real
 * note list — not by turning the ref into a path client-side, which is what used to write a
 * brand-new note at the vault ROOT whenever the real note lived in a subfolder (see
 * taskCreate.ts's header on the backend for the reproduced defect).
 *
 * `body` is the task line's text AFTER the checkbox: a description, bracket fields, or both
 * (`[scheduled 2026-09-09]`). It is written verbatim — this does not build task syntax.
 *
 * Returns the vault-relative path actually written, so a caller that needs to react to the new
 * row (open it, invalidate a specific base) knows exactly where it landed.
 */
export async function appendTaskLine(
    file: string,
    body: string,
): Promise<string> {
    const { path } = await api.createTask(file, body)
    return path
}
