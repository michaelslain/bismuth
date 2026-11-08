// core/src/transcribeJobTypes.ts
// The shapes a background transcription job answers with, shared by core's job runner
// (transcribeJob.ts), its routes, and the app's reader. Pure types, so the app imports them freely.
import type { TranscribeEngine, TranscriptEngine } from './transcript'

export type PageReadStatus = 'queued' | 'reading' | 'done' | 'failed'

/** One page of a running or finished job. `engine` is, while reading, the engine reading it; once
 *  done, the reader whose text the page holds; `error` the one-line reason when failed; `ms` how long the page took. */
export type TranscribePageState = {
    page: number
    status: PageReadStatus
    engine?: TranscriptEngine
    error?: string
    ms?: number
}

export type TranscribeJobRequest = {
    file: string
    engine?: TranscribeEngine
    pages?: number[]
    book?: string
    onlyMissing?: boolean
    /** auto only. `ask` reads math pages fast and lists them in `mathPending` until a choice arrives. */
    math?: 'ask' | 'careful' | 'fast'
}

export type TranscribeJobState = {
    file: string
    state: 'running' | 'done' | 'failed' | 'cancelled'
    /** every page the job covers, in page order */
    pages: TranscribePageState[]
    startedAt: number
    /** ms left: mean `ms` of the pages done so far × pages not yet done; absent until one page is done */
    etaMs?: number
    /** math 'ask' only: pages that look like math, read fast, awaiting a choice */
    mathPending: number[]
    /** the math reader is not installed (a careful choice needs `POST /transcribe/setup` first) */
    markerMissing?: boolean
    error?: string
}
