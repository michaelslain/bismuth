// The `feedback` command group: send feedback to Bismuth's developer through the hosted relay
// (core/src/feedback.ts). Headless — no running server needed. Owner-only: it sends text off the
// machine, so an agent's hand is refused here, and an agent that interviewed the user drafts the
// feedback for the app's feedback page, where the owner presses send.
import type { CommandMap } from '../types'
import { flag, fail, out } from '../args'
import { submitFeedback } from '../../../core/src/feedback'
import { cliIsAgentHand } from '../../../core/src/visibilityCliGate'

export const commands: CommandMap = {
    'feedback send': {
        summary: "Send feedback to Bismuth's developer (owner only; agents draft it on the feedback page)",
        usage: '--title <t> --body <text> [--kind written|interview] [--contact <email or handle>] [--pretty]',
        run: async args => {
            if (cliIsAgentHand())
                fail(
                    'feedback send is owner-only: draft the feedback for the feedback page instead, where the owner reviews and sends it',
                )
            const r = await submitFeedback({
                kind: flag(args, 'kind') ?? 'written',
                title: flag(args, 'title'),
                body: flag(args, 'body'),
                contact: flag(args, 'contact'),
            })
            if (!r.ok) fail(r.error)
            out({ sent: true, id: r.id }, args)
        },
    },
}
