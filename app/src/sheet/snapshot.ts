// A workbook snapshot is Univer's IWorkbookData, but we keep this module
// Univer-free (so it unit-tests under Bun with no canvas). The adapter casts
// to/from Univer's real type at the boundary.
export type WorkbookSnapshot = Record<string, unknown>;
