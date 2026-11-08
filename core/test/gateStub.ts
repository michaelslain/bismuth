// Stand-ins for the fitted source gate, so recall tests choose what the gate admits without
// depending on the numbers a refit writes.
import type { GateModel } from '../src/sourceGate'

const zero = { cosine: 0, margin: 0, logRank: 0, rerank: 0, noRerank: 0, chat: 0, docs: 0, inRange: 0, logPromptChars: 0 }
const fit = { cases: 1, heldOut: 1, objective: 'test stand-in', at: '' }

/** Admits only a source's best candidate (rank 0) whose cross-encoder logit is at least -6 (chats -4, docs 0);
 *  a dated chat, which carries no logit, is admitted at rank 0. */
export const logitGate: GateModel = {
    version: 1,
    weights: { ...zero, rerank: 1, chat: -2, docs: -6, logRank: -100 },
    bias: 6,
    threshold: 0.5,
    fitOn: fit,
}

/** Admits a candidate whose cosine is at least 0.55, whatever the cross-encoder says. */
export const cosineGate: GateModel = { version: 1, weights: { ...zero, cosine: 20 }, bias: -11, threshold: 0.5, fitOn: fit }
