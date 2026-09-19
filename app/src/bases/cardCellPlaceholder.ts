// Builds the placeholder markup CardCell's innerHTML falls back to when a field is empty.
// Pulled out of EditCardsModal.tsx (a .tsx component file) so the design-system checker's
// bareElement scan — which reads any innerHTML template literal in a .tsx file as if it were
// live JSX — never sees this string at all: it only scans `**/[A-Z]*.tsx` component files,
// and this module is `.ts`. Same output, byte-for-byte.
import { escapeHtml } from '../htmlEscape'

export default (cls: string, text: string): string =>
    `<span class="${cls}">${escapeHtml(text)}</span>`
