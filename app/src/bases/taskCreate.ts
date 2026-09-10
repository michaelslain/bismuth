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
import { refToPath } from '../../../core/src/bases/sourceSpec'

/**
 * Append `- [ ] <body>` to `file`, inserting the separating newline only when the file does
 * not already end in one — so appending to a file that ends mid-line does not join onto it,
 * and appending to a normal file does not leave a blank line behind.
 *
 * `body` is the task line's text AFTER the checkbox: a description, bracket fields, or both
 * (`[scheduled 2026-09-09]`). It is written verbatim — this does not build task syntax.
 *
 * `file` is a `taskFile` value, which the docs and the settings UI both spell as a WIKILINK
 * (`[[Inbox]]`) — the same shape `source.from` and `source.ref` use. It has to go through
 * `refToPath` before it can be read: handed straight to the file API the literal string
 * `[[Inbox]]` reads back empty and the write fails with a 500, so `+ task` did nothing and said
 * nothing. `refToPath` passes a plain path (`Inbox.md`, or a bare `Inbox`) through unchanged,
 * so both spellings work and a vault already written either way keeps working.
 */
export async function appendTaskLine(
    file: string,
    body: string,
): Promise<void> {
    const path = refToPath(file)
    const text = await api.read(path)
    const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n'
    await api.write(path, `${text}${sep}- [ ] ${body}\n`)
}
