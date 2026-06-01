export interface ChangeDecision {
  /** Vault-relative path of the open sheet. */
  path: string;
  /** Paths reported changed by the SSE event. */
  changedPaths: string[];
  /** True while the pane has unsaved edits. */
  isDirty: boolean;
  /** Current on-disk text of the sheet. */
  diskText: string;
  /** Text we last wrote ourselves, or null if we never wrote. */
  lastWrittenText: string | null;
}

/**
 * Should the open sheet reload from disk in response to a server change?
 * Reload only when: the change touches our file, the pane is clean, and the
 * on-disk text differs from what we last wrote (i.e. an external edit, not our echo).
 */
export function isExternalChange(d: ChangeDecision): boolean {
  if (!d.changedPaths.includes(d.path)) return false;
  if (d.isDirty) return false;
  if (d.lastWrittenText !== null && d.diskText === d.lastWrittenText) return false;
  return true;
}
