// app/src/searchOpts.ts
// Shared search/replace option types + a pure regex-validity check used by
// SearchView to show an inline error before issuing a request.
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
}

/** True if `pattern` compiles as a RegExp. Used to gate regex-mode searches. */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
