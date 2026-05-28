export type TokenKind =
  | "number" | "string" | "ident"
  | "op" | "dot" | "comma"
  | "lparen" | "rparen" | "lbracket" | "rbracket"
  | "true" | "false" | "null";

export interface Token { kind: TokenKind; value?: string | number; pos: number; }

const TWO_CHAR = new Set(["==", "!=", ">=", "<=", "&&", "||"]);
const ONE_CHAR_OP = new Set(["+", "-", "*", "/", "%", ">", "<", "!"]);

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let out = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) { out += src[j + 1]; j += 2; }
        else { out += src[j]; j++; }
      }
      toks.push({ kind: "string", value: out, pos: i });
      i = j + 1;
      continue;
    }

    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < n && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      toks.push({ kind: "number", value: Number(src.slice(i, j)), pos: i });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === "true" || word === "false" || word === "null") toks.push({ kind: word, pos: i });
      else toks.push({ kind: "ident", value: word, pos: i });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (TWO_CHAR.has(two)) { toks.push({ kind: "op", value: two, pos: i }); i += 2; continue; }

    if (ONE_CHAR_OP.has(c)) { toks.push({ kind: "op", value: c, pos: i }); i++; continue; }
    if (c === ".") { toks.push({ kind: "dot", pos: i }); i++; continue; }
    if (c === ",") { toks.push({ kind: "comma", pos: i }); i++; continue; }
    if (c === "(") { toks.push({ kind: "lparen", pos: i }); i++; continue; }
    if (c === ")") { toks.push({ kind: "rparen", pos: i }); i++; continue; }
    if (c === "[") { toks.push({ kind: "lbracket", pos: i }); i++; continue; }
    if (c === "]") { toks.push({ kind: "rbracket", pos: i }); i++; continue; }

    // Unknown char: skip it (tolerant lexer)
    i++;
  }
  return toks;
}
