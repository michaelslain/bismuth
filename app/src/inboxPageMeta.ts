// app/src/inboxPageMeta.ts
// Pure text for an inbox page's chrome: the ViewBar readout and the action bar's status phrase.
import type { DaemonPage } from '../../core/src/daemonPages'
import { STATUS_WORD } from './daemon/daemonInboxLogic'
import { relTimeISO } from './relTime'

/** `needs review // from answer-emails // 2h ago` as three strings (the caller adds the `//`). */
export function inboxPageReadouts(
    page: Pick<DaemonPage, 'status' | 'source' | 'createdAt'>,
): string[] {
    const out = [STATUS_WORD[page.status]]
    if (page.source) out.push(`from ${page.source.replace(/^cron:/, '')}`)
    out.push(relTimeISO(page.createdAt))
    return out
}

/** The action bar's left-hand phrase for a page's status. */
export function actionBarPhrase(
    page: Pick<DaemonPage, 'status' | 'daemonNote' | 'pressedAt'>,
): string {
    switch (page.status) {
        case 'pending':
            return 'waiting on you'
        case 'working':
            return 'working…'
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
