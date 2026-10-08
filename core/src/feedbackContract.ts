// core/src/feedbackContract.ts — the feedback wire contract (types + limits) with no runtime
// imports, so the app (and its mobile bundle) can share it without pulling in node: modules.
// core/src/feedback.ts validates and sends against it; services/feedback/payload.ts carries its own
// copy for the separately deployed relay — keep the limits in step.
export type FeedbackKind = 'written' | 'interview'

export type FeedbackPayload = {
    kind: FeedbackKind
    title: string
    body: string
    /** An optional reply-to the user typed: an email or a handle. */
    contact?: string
    meta?: { appVersion?: string; platform?: string; daemonName?: string }
}

export const FEEDBACK_LIMITS = { title: 200, body: 20000, contact: 200, meta: 100 } as const
