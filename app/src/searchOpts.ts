// app/src/searchOpts.ts
// Shared search types for the unified Cmd+O search surface: the option flags POST /search
// accepts and the result shape both /search (keyword content matches) and /search-prompt
// (Bismuth AI) return, rendered by searchResults.tsx.
export interface SearchOpts {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface MatchSnippet {
  line: number;
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  path: string;
  matchCount: number;
  snippets: MatchSnippet[];
  /** Optional one-line rationale — only set by the AI prompt-search path (/search-prompt); the
   *  literal /search path never sets it. Rendered as a faint caption on the result card. */
  reason?: string;
}
