// A workbook snapshot is Univer's IWorkbookData, but this module is Univer-free
// (unit-tests under Bun, no canvas). The adapter casts to/from Univer at the boundary.
export type WorkbookSnapshot = Record<string, unknown>;

export class SheetParseError extends Error {
  constructor(cause: unknown) {
    super(`Invalid .sheet contents: ${(cause as Error)?.message ?? cause}`);
    this.name = "SheetParseError";
  }
}

/** Parse a `.sheet` file's text. Empty/whitespace => blank workbook ({}). */
export function parseSnapshot(text: string): WorkbookSnapshot {
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as WorkbookSnapshot;
  } catch (e) {
    throw new SheetParseError(e);
  }
}

/** Serialize a workbook snapshot to the text written to disk (pretty for diffs). */
export function serializeSnapshot(data: WorkbookSnapshot): string {
  return JSON.stringify(data, null, 2);
}
