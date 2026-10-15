// app/src/inboxPageMeta.ts
// Pure text for an inbox page's chrome: the ViewBar readout, the draft's sender, and the transcript
// tail's status phrases and reply hint.
import type { DaemonPage } from '../../core/src/daemonPages'
import { STATUS_WORD } from './daemon/daemonInboxLogic'
import { relTimeISO } from './relTime'

/** The ViewBar readout: the page's status word. Sender and time are in the message header. */
export function inboxPageReadouts(page: Pick<DaemonPage, 'status'>): string[] {
    return [STATUS_WORD[page.status]]
}

/** The action bar's left-hand phrase for a page's status. */
export function actionBarPhrase(
    page: Pick<DaemonPage, 'status' | 'daemonNote' | 'pressedAt' | 'replying'>,
): string {
    switch (page.status) {
        case 'pending':
            return 'waiting on you'
        case 'working':
            return page.replying ? 'reading your reply…' : 'working…'
        case 'failed':
            return `failed // ${page.daemonNote || 'the daemon could not finish'}`
        case 'done':
            return page.daemonNote ? `done // ${page.daemonNote}` : 'done'
        case 'dismissed':
            return page.pressedAt
                ? `dismissed // ${relTimeISO(page.pressedAt)}`
                : 'dismissed'
    }
}

/** Can the page be answered in words right now? The same states a button press accepts. */
export function canReply(page: Pick<DaemonPage, 'status'>): boolean {
    return page.status === 'pending' || page.status === 'failed'
}

/** The reply field's placeholder: what typing does in this state. */
export function replyPlaceholder(page: Pick<DaemonPage, 'status'>): string {
    return page.status === 'failed'
        ? 'reply to retry, or say what to change'
        : 'reply in your own words'
}

/** The hint under the reply prompt, from the `ui-confirm` binding (its first combo, lowercase):
 *  `enter sends // shift+enter new line`. An empty binding has no send key, so no hint. */
export function replyHint(confirm: string | undefined): string {
    const key = confirm?.split(',')[0]?.trim().toLowerCase()
    if (!key) return ''
    // Shift+Enter is the field's own new line; with another send key, Enter already is.
    return key === 'enter' ? 'enter sends // shift+enter new line' : `${key} sends`
}

/** The line above the chips: why the page failed. (The daemon's questions are in the thread.) */
export function actionBarNote(
    page: Pick<DaemonPage, 'status' | 'daemonNote'>,
): string | null {
    if (page.status === 'failed') return actionBarPhrase({ ...page, pressedAt: undefined })
    return null
}

/** Who sent the page, after `daemon`: its source without the `cron:` prefix. */
export function pageSender(page: Pick<DaemonPage, 'source'>): string | null {
    return page.source ? page.source.replace(/^cron:/, '') : null
}
