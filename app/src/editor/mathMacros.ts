// app/src/editor/mathMacros.ts
//
// Parse a LaTeX math preamble (Obsidian preamble.sty style) into a KaTeX `macros`
// object — `{ "\\name": "body" }`. The object is passed as KaTeX's `macros` option,
// where user definitions silently OVERRIDE builtins (e.g. redefining `\R`) with no
// redefinition error — matching MathJax/Obsidian, and unlike KaTeX's `\newcommand`,
// which throws "attempting to redefine \R; use \renewcommand". KaTeX infers each macro's
// argument count from the highest `#n` in its body, so we drop the `[argc]` count.
//
// Supported definition forms:
//   \newcommand{\name}{body}      \newcommand\name{body}
//   \newcommand{\name}[2]{body}   \renewcommand{...}{...}   \providecommand{...}{...}
//   \def\name{body}               \def\name#1#2{body}
// Bodies may contain balanced nested braces and \{ \} escapes. Unparseable fragments
// are skipped rather than aborting the whole preamble (one bad macro can't disable the
// rest). `%` line comments are NOT stripped (KaTeX has no comment syntax either).

const isLetter = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

// A valid TeX control-sequence name (WITHOUT the backslash): a control WORD (≥1 letters)
// or a control SYMBOL (exactly one non-letter). `\1st` / `\(x` / `\123` are invalid and
// KaTeX can't use them, so we reject rather than register a dead macro.
const isValidCsName = (name: string): boolean => /^[a-zA-Z]+$/.test(name) || name.length === 1;

export function parseMathMacros(preamble: string): Record<string, string> {
  const out: Record<string, string> = {};
  const src = preamble ?? "";
  const n = src.length;
  let i = 0;

  const skipWs = (): void => { while (i < n && /\s/.test(src[i])) i++; };

  // Read a control sequence at src[i] === '\\'; return its name WITHOUT the backslash.
  // A control word is `\` + letters; a control symbol is `\` + one non-letter char.
  function readCsName(): string | null {
    if (src[i] !== "\\") return null;
    let j = i + 1;
    if (j < n && isLetter(src[j])) { while (j < n && isLetter(src[j])) j++; }
    else if (j < n) j++; // single-char control symbol
    const name = src.slice(i + 1, j);
    i = j;
    return name || null;
  }

  // Read a brace group at src[i] === '{', returning its inner content with braces
  // balanced and `\{`/`\}` escapes respected. Advances past the closing brace.
  function readGroup(): string | null {
    if (src[i] !== "{") return null;
    let depth = 0;
    const start = i;
    for (; i < n; i++) {
      const c = src[i];
      if (c === "\\") { i++; continue; } // skip the escaped next char
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { const inner = src.slice(start + 1, i); i++; return inner; } }
    }
    return null; // unbalanced — give up on this fragment
  }

  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (src[i] !== "\\") { i++; continue; }
    const before = i;
    const cmd = readCsName();

    if (cmd === "newcommand" || cmd === "renewcommand" || cmd === "providecommand") {
      skipWs();
      // Name as either `{\name}` or bare `\name`. The braced form takes whatever's between
      // the braces, so validate it's a real control-sequence name (the bare form is already
      // constrained by readCsName).
      let name: string | null = null;
      if (src[i] === "{") { const g = readGroup(); const t = g?.trim() ?? ""; const n = t.startsWith("\\") ? t.slice(1) : ""; name = isValidCsName(n) ? n : null; }
      else if (src[i] === "\\") { name = readCsName(); }
      if (!name) continue;
      skipWs();
      // Consume an optional `[argc]` (and a possible `[default]`) — KaTeX re-infers argc.
      while (src[i] === "[") { const close = src.indexOf("]", i); if (close < 0) break; i = close + 1; skipWs(); }
      const body = readGroup();
      if (body != null) out["\\" + name] = body;
    } else if (cmd === "def") {
      skipWs();
      const name = readCsName();
      if (!name) continue;
      while (i < n && src[i] !== "{") i++; // skip the param text (e.g. #1#2)
      const body = readGroup();
      if (name && body != null) out["\\" + name] = body;
    } else {
      i = before + 1; // unrecognized command — step past the backslash and continue
    }
  }

  return out;
}
