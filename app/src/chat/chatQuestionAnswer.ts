// app/src/chat/chatQuestionAnswer.ts — pure, no framework imports.
// A question's answer is stored as ONE string, the picks (and an "Other" free-text) joined with
// `', '`. Reading it back by splitting on `', '` breaks on any option label that contains a comma
// ("Yes, do it"), and a prefix test breaks on the label that is a prefix of another ("Yes" vs
// "Yes, do it"). So walk the string and consume KNOWN labels, longest first, at each segment
// boundary; whatever is left between boundaries is free text and picks nothing.

/** Which of `labels` the joined `answer` string is made of. */
export function chosenLabels(answer: string, labels: readonly string[]): Set<string> {
    const found = new Set<string>()
    const byLength = [...labels].sort((a, b) => b.length - a.length)
    let at = 0
    while (at < answer.length) {
        const label = byLength.find(
            l =>
                l.length > 0 &&
                answer.startsWith(l, at) &&
                (at + l.length === answer.length || answer.startsWith(', ', at + l.length)),
        )
        if (label !== undefined) {
            found.add(label)
            at += label.length + 2
            continue
        }
        // free text: skip to the next `, ` boundary
        const next = answer.indexOf(', ', at)
        if (next < 0) break
        at = next + 2
    }
    return found
}
