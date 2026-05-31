export type TokenKind =
  | "number" | "string" | "ident"
  | "op" | "dot" | "comma" | "arrow"
  | "lparen" | "rparen" | "lbracket" | "rbracket"
  | "regex"
  | "true" | "false" | "null";

export interface Token { kind: TokenKind; value?: string | number; pos: number; flags?: string; }

const TWO_CHAR = new Set(["==", "!=", ">=", "<=", "&&", "||"]);
const ONE_CHAR_OP = new Set(["+", "-", "*", "/", "%", ">", "<", "!"]);

// A `/` starts a regex literal (not division) when it appears at the start of
// an expression — i.e. when the previous token would naturally be followed by
// a fresh value rather than by an operand.
function regexAllowedAfter(prev: Token | undefined): boolean {
  if (!prev) return true;
  return (
    prev.kind === "op" ||
    prev.kind === "comma" ||
    prev.kind === "dot" ||
    prev.kind === "lparen" ||
    prev.kind === "lbracket" ||
    prev.kind === "arrow"
  );
}

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    // String literals
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          out += src[j + 1];
          j += 2;
        } else {
          out += src[j];
          j++;
        }
      }
      toks.push({ kind: "string", value: out, pos: i });
      i = j + 1;
      continue;
    }

    // Number literals
    if (c >= "0" && c <= "9") {
      let j = i;
      let dotSeen = false;
      while (j < n) {
        const ch = src[j];
        if (ch >= "0" && ch <= "9") {
          j++;
        } else if (ch === "." && !dotSeen) {
          // Only the first dot is part of the number; a second dot (1.2.3) or a
          // member access ends the literal so it never collapses to a NaN token.
          dotSeen = true;
          j++;
        } else {
          break;
        }
      }
      toks.push({ kind: "number", value: Number(src.slice(i, j)), pos: i });
      i = j;
      continue;
    }

    // Identifiers and keywords
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === "true" || word === "false" || word === "null") {
        toks.push({ kind: word, pos: i });
      } else {
        toks.push({ kind: "ident", value: word, pos: i });
      }
      i = j;
      continue;
    }

    // Arrow operator
    if (src[i] === "=" && src[i + 1] === ">") {
      toks.push({ kind: "arrow", pos: i });
      i += 2;
      continue;
    }

    // Two-char operators
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) {
      toks.push({ kind: "op", value: two, pos: i });
      i += 2;
      continue;
    }

    // Regex literal (contextually)
    if (c === "/" && regexAllowedAfter(toks[toks.length - 1])) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const ch = src[j];
        if (ch === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        else if (ch === "\n") {
          j = -1;
          break;
        }
        j++;
      }
      if (j > 0 && j < n) {
        const source = src.slice(i + 1, j);
        j++;
        let f = j;
        while (f < n && /[a-z]/.test(src[f])) f++;
        const flags = src.slice(j, f);
        toks.push({ kind: "regex", value: source, flags, pos: i });
        i = f;
        continue;
      }
    }

    // Single-char operators and punctuation
    if (ONE_CHAR_OP.has(c)) {
      toks.push({ kind: "op", value: c, pos: i });
      i++;
      continue;
    }

    if (c === ".") {
      toks.push({ kind: "dot", pos: i });
      i++;
      continue;
    }

    if (c === ",") {
      toks.push({ kind: "comma", pos: i });
      i++;
      continue;
    }

    if (c === "(") {
      toks.push({ kind: "lparen", pos: i });
      i++;
      continue;
    }

    if (c === ")") {
      toks.push({ kind: "rparen", pos: i });
      i++;
      continue;
    }

    if (c === "[") {
      toks.push({ kind: "lbracket", pos: i });
      i++;
      continue;
    }

    if (c === "]") {
      toks.push({ kind: "rbracket", pos: i });
      i++;
      continue;
    }

    i++;
  }

  return toks;
}
