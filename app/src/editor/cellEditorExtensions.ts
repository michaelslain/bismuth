// app/src/editor/cellEditorExtensions.ts
//
// The SHARED markdown reading+writing stack, factored out so the note editor (Editor.tsx) and the
// in-cell table editor (cellEditor.ts, mounted by tableWidget.ts) render from the SAME code — the
// crux of #15 and #49. Both surfaces call `markdownEditingExtensions`, so the cell's edit face gets:
//   • per-token LIVE PREVIEW as literally the same `livePreview` extension the note body uses, so a
//     cell reveals only the token under the caret (bold shows bold, `- ` shows a bullet, a heading
//     renders, math renders) exactly like the outside editor — permanent parity, not a copy (#15);
//   • the EXACT SAME `:emoji:` / `[[wikilink]]` / `#tag` autocomplete popup (`vaultCompletion` +
//     `completionTheme`), with the full emoji library — same source, same styling (#49).
//
// "Same code, not copied" is the whole point: whenever the note editor's live-preview or completion
// behavior changes, the cell's changes with it, because they are one extension array.
//
// NOTE: this module transitively imports `livePreview`, which pulls in Solid `.tsx` that bun's test
// transform can't compile — so it must only ever be reached from a `.tsx` (Editor.tsx) or via a
// DYNAMIC import (cellEditor.ts is dynamically imported by tableWidget.ts), never statically from a
// headless-tested `.ts`.
import { keymap } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting } from "@codemirror/language";
import type { CompletionContext } from "@codemirror/autocomplete";
import { toggleBold, toggleItalic } from "./markdownFormat";
import { livePreview } from "./livePreview";
import { enterKeymap } from "./enterKeymap";
import { mathBlock } from "./mathBlock";
import { latexHighlightTheme } from "./latexHighlight";
import { vaultCompletion } from "./autocomplete";
import { completionTheme } from "./completionDisplay";
import { codeHighlightStyle } from "./codeHighlight";
import type { NoteCandidate } from "./wikilink";
import type { FileCandidate } from "./atMention";
import type { Schema } from "../../../core/src/schema/types";

/** The vault-aware autocomplete inputs `vaultCompletion` needs — supplied by whichever host mounts
 *  the stack (the note editor from its props / registry; the table cell from the outer view's
 *  facets). Identical shape either way, so the popup is byte-for-byte the same (#49). */
export interface CellCompletionOptions {
  getNotes: () => NoteCandidate[];
  getTags: () => string[];
  getSchema: () => Schema;
  getIconNames: () => string[];
  inFrontmatter: (ctx: CompletionContext) => boolean;
  readNote: (path: string) => Promise<string>;
  /** Composer-only (Row 79a): the full vault file list for the `@file` mention switcher, plus a
   *  callback fired with the picked file's path so the chat wires it into its context. Absent
   *  everywhere else (note editor, table cell) — then the at-mention source isn't added. */
  getFiles?: () => FileCandidate[];
  onFileMention?: (path: string) => void;
}

export interface MarkdownStackOptions {
  completion: CellCompletionOptions;
  /** Include the live-preview + math layer (default true). Mirrors `settings.editor.livePreview`,
   *  so a cell renders raw (like the note editor with live preview off) when the user turns it off. */
  livePreview?: boolean;
}

/** The markdown editing stack shared by the note editor and the in-cell table editor: bold/italic
 *  toggles, the markdown language + code-block syntax highlighting, Enter list/blockquote
 *  continuation, vault autocomplete (wikilinks / tags / emoji) + its themed popup, and — gated —
 *  per-token live preview + math. Returned as an extension array both callers spread into their own
 *  config (each adds its own history/theme/keymaps around it). */
export function markdownEditingExtensions(opts: MarkdownStackOptions): Extension[] {
  return [
    // Cmd/Ctrl-B bold, Cmd/Ctrl-I italic (Prec.high so they beat any default Mod-b/Mod-i binding),
    // matching the note editor.
    Prec.high(keymap.of([
      { key: "Mod-b", run: toggleBold },
      { key: "Mod-i", run: toggleItalic },
    ])),
    // `remove: ["IndentedCode"]` keeps a 4-space-indented line prose, not a code block.
    markdown({ codeLanguages: languages, extensions: [{ remove: ["IndentedCode"] }] }),
    // Enter continues list/blockquote markup, else a plain newline (no stray auto-indent).
    enterKeymap,
    syntaxHighlighting(codeHighlightStyle),
    // The vault autocomplete — wikilinks, tags, `:emoji:` (full library), etc. — plus its themed
    // popup, so the note editor and the cell pop the identical menu (#49).
    vaultCompletion(opts.completion),
    completionTheme,
    // Per-token live preview (the same code that drives the note body's reveal, #15) + math.
    ...(opts.livePreview !== false ? [livePreview, mathBlock(), latexHighlightTheme] : []),
  ];
}
