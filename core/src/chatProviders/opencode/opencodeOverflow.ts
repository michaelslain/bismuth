// core/src/chatProviders/opencode/opencodeOverflow.ts
// Pure: recognise a "the prompt does not fit the loaded context window" provider error, and word the
// turn error shown when even the compact prompt does not fit. No imports but a type.
import {
    serverKindName,
    type LocalServerKind,
} from '../../agentBackends/contextWindow'

const OVERFLOW: RegExp[] = [
    // LM Studio
    /tokens to keep from the initial prompt is greater than the context length/i,
    // llama.cpp
    /exceeds the available context size/i,
    // vLLM
    /maximum context length is/i,
    // OpenAI
    /context_length_exceeded/i,
    // generic: "context window/length" phrased as exceeded or too small
    /context (?:window|length)[^.\n]{0,60}(?:exceed|too (?:small|long|large|short)|overflow)/i,
    /(?:exceed|overflow|too (?:long|large))[^.\n]{0,60}context (?:window|length)/i,
]

/** True when `message` says the request did not fit the model's context window. */
export function isContextOverflow(message: string): boolean {
    return OVERFLOW.some(re => re.test(message))
}

function article(n: string): string {
    const lead = n.split(',')[0]
    return /^(8\d{0,2}|11|18)$/.test(lead) ? 'an' : 'a'
}

/** The turn error for a model whose window is too small for an agent prompt. */
export function contextOverflowMessage(o: {
    model: string
    window: number | null
    kind: LocalServerKind | null
}): string {
    const hint =
        o.kind === 'lmstudio' || o.kind === 'ollama'
            ? ` (${serverKindName(o.kind)}: ${
                  o.kind === 'lmstudio'
                      ? "the model's load settings"
                      : 'the num_ctx parameter'
              })`
            : ''
    if (o.window === null)
        return `${o.model} ran out of context before the prompt fit, even with the compact prompt. Load it with a larger context length${hint} and try again.`
    const n = o.window.toLocaleString('en-US')
    return `${o.model} is loaded with ${article(n)} ${n}-token context window, too small for an agent prompt. Load it with a larger context length${hint} and try again.`
}
