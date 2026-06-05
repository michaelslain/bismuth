// core/src/replace.ts
// Vault-wide find-and-replace. replaceInText is pure; replaceInVault applies it
// across files and writes the changed ones. The caller (server) takes a git
// backup BEFORE invoking replaceInVault so bulk edits are recoverable.
import { buildMatcher, type SearchOpts } from "./search";
import { getFileAccess } from "./fileAccess";

export interface ReplaceResult {
  /** Total number of individual matches replaced across all files. */
  replaced: number;
  /** Vault-relative paths of the files that were changed. */
  files: string[];
}

/** Replace every match of `query` with `replacement` in `text`. Counts matches.
 *  In regex mode, `replacement` may use `$1`/`$&` capture references. */
export function replaceInText(
  text: string,
  query: string,
  replacement: string,
  opts: SearchOpts,
): { text: string; count: number } {
  if (!query) return { text, count: 0 };
  const re = buildMatcher(query, opts);
  let count = 0;
  const out = text.replace(re, (...args) => {
    count++;
    // For literal (non-regex) queries, treat replacement as a literal string so
    // `$` in the replacement isn't interpreted as a capture reference.
    if (!opts.regex) return replacement;
    // Re-run the standard replacement substitution for the single match.
    const matched = args[0] as string;
    return matched.replace(re, replacement);
  });
  return { text: out, count };
}

/** Apply replaceInText across the vault (scope "vault") or a single note (scope = path).
 *  Writes only files whose content changed; returns the change summary. */
export async function replaceInVault(
  root: string,
  query: string,
  replacement: string,
  opts: SearchOpts,
  scope: string,
): Promise<ReplaceResult> {
  const { listMarkdown, readNote, writeNote } = await getFileAccess();
  const paths = scope === "vault" ? await listMarkdown(root) : [scope];
  let replaced = 0;
  const files: string[] = [];
  for (const p of paths) {
    const before = await readNote(root, p);
    const { text, count } = replaceInText(before, query, replacement, opts);
    if (count > 0 && text !== before) {
      await writeNote(root, p, text);
      replaced += count;
      files.push(p);
    }
  }
  return { replaced, files };
}
