// app/src/chatEditorContext.ts
// Pure "what should the <editor-context> preamble say" logic, split out of ChatView.tsx
// (like fileTreeRefresh.ts's decideTreeRefresh) so it's unit-testable headlessly without
// importing the component tree. Drops any file whose RESOLVED AI visibility is "hidden" —
// a hidden note's path/content must never reach the model via this channel, even though
// the user can see it fine in their own editor. "chat-only" files stay IN; that's the
// whole point of that tier. See docs/vault/visibility.md.

export interface EditorContextInput {
  activeFile: string | null;
  openFiles: { path: string; label: string }[];
  selection: string;
  selectionPath?: string | null;
  /** Paths whose RESOLVED visibility is "hidden" (core/src/visibility.ts isVisibleToChat). */
  hiddenPaths: ReadonlySet<string>;
}

/** Build the `<editor-context>` preamble text, or "" when there's nothing visible worth
 *  telling the model (mirrors the original buildEditorContext's empty-return contract). */
export function buildEditorContextText(input: EditorContextInput): string {
  const activeFile = input.activeFile && !input.hiddenPaths.has(input.activeFile) ? input.activeFile : null;
  const openFiles = input.openFiles.filter((f) => !input.hiddenPaths.has(f.path));
  const selectionHidden = !!input.selectionPath && input.hiddenPaths.has(input.selectionPath);
  const selection = selectionHidden ? "" : input.selection;
  if (!activeFile && !selection) return "";
  const lines: string[] = ["<editor-context>"];
  if (activeFile) lines.push(`Active file: ${activeFile}`);
  if (openFiles.length) lines.push(`Open tabs: ${openFiles.map((f) => f.path).join(", ")}`);
  if (selection) {
    lines.push(`Current selection${input.selectionPath ? ` (from ${input.selectionPath})` : ""}:`);
    lines.push("```", selection, "```");
  }
  lines.push("</editor-context>");
  return lines.join("\n");
}
