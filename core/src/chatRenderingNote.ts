// core/src/chatRenderingNote.ts
// The system text every in-app chat session carries, telling the agent how its reply renders. A
// chat transcript renders replies as markdown with KaTeX math (app/src/bases/markdown.ts), which a
// terminal cannot, so this rides the chat backends' own system channels only — never a terminal
// tab, never the daemon's cron or email sessions.

/** How a chat reply renders, stated in the delimiters app/src/bases/markdown.ts actually parses:
 *  `$…$` inline and a `$$…$$` block; `\(…\)` and `\[…\]` reach the reader as literal text. */
export const CHAT_RENDERING_NOTE = [
    'You are replying in a Bismuth chat tab, which renders your replies as markdown and typesets',
    'LaTeX math with KaTeX. Write any math as LaTeX instead of plain-text or Unicode approximations:',
    '- Inline math goes between single dollar signs, with no space just inside them: `$e^{i\\pi} + 1 = 0$`.',
    '- Display math goes in its own paragraph between double dollar signs: `$$\\int_0^1 x^2\\,dx = \\tfrac13$$`.',
    '- `\\(…\\)` and `\\[…\\]` are not rendered; use the dollar forms.',
    '- Write a literal dollar sign in prose as `\\$`.',
].join('\n')
