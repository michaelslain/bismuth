// Flashcards / SRS command group for the `bismuth` CLI.
// Reads mirror the GET /cards/* endpoints; `card review` mirrors the dual-mode
// POST /cards/review handler in core/src/server.ts (legacy inline note cards vs
// base-row cards). Mutating commands call core directly — the app's file watcher
// picks up the writes live.
import type { CommandMap } from "../types";
import { flag, fail, out, positionals, requireVault, today } from "../args";
import { collectDecks, collectCards, dueCards, noteCards, applyReview } from "../../../core/src/srs/cards";
import { applyReviewToRow } from "../../../core/src/srs/reviewRow";
import type { ReviewResponse } from "../../../core/src/srs/types";
import { parseBaseFile } from "../../../core/src/bases/parse";
import { upsertRow } from "../../../core/src/bases/rowOps";
import { fileBasename } from "../../../core/src/pathUtils";
import { readNote, writeNote } from "../../../core/src/files";

const RESPONSES: ReviewResponse[] = ["hard", "good", "easy"];

/** Validate a review response string, failing with a clear message otherwise. */
function asResponse(raw: string | undefined): ReviewResponse {
  if (!raw || !RESPONSES.includes(raw as ReviewResponse)) {
    fail(`response must be one of ${RESPONSES.join(" | ")}`);
  }
  return raw as ReviewResponse;
}

export const commands: CommandMap = {
  "card decks": {
    summary: "List flashcard decks with total + due counts",
    usage: "[--vault <dir>] [--pretty]",
    run: async (args) => {
      out(await collectDecks(requireVault(args), today()), args);
    },
  },

  "card all": {
    summary: "List every flashcard parsed from the vault",
    usage: "[--vault <dir>] [--pretty]",
    run: async (args) => {
      out(await collectCards(requireVault(args)), args);
    },
  },

  "card due": {
    summary: "List flashcards due today (optionally filtered to one deck)",
    usage: "[--deck <name>] [--vault <dir>] [--pretty]",
    run: async (args) => {
      out(await dueCards(requireVault(args), today(), flag(args, "deck")), args);
    },
  },

  "card note": {
    summary: "List every flashcard parsed from a single note, regardless of due date",
    usage: "<path> [--vault <dir>] [--pretty]",
    run: async (args) => {
      const [path] = positionals(args);
      if (!path) fail("usage: card note <path>");
      out(await noteCards(requireVault(args), path), args);
    },
  },

  "card review": {
    summary: "Review a flashcard (markdown: <id> <response> | row: --file <base> --index <n> --response <r>)",
    usage: "<id> <response> | --file <base> --index <n> --response <hard|good|easy> [--dueField <c> --easeField <c> --intervalField <c>]",
    run: async (args) => {
      const vault = requireVault(args);
      const file = flag(args, "file");
      const indexRaw = flag(args, "index");

      // Row-based review (flashcard base): advance scheduling columns on the row.
      if (file != null && indexRaw != null) {
        const index = Number(indexRaw);
        if (!Number.isInteger(index)) fail("--index must be an integer");
        const response = asResponse(flag(args, "response"));
        const text = await readNote(vault, file);
        const name = fileBasename(file);
        const { rows } = parseBaseFile(text, { name, path: file });
        const row = rows[index];
        if (!row) fail(`row not found: ${file}#${index}`);
        const dueField = flag(args, "dueField");
        const easeField = flag(args, "easeField");
        const intervalField = flag(args, "intervalField");
        const fields =
          dueField && easeField && intervalField
            ? { due: dueField, ease: easeField, interval: intervalField }
            : undefined;
        const note = applyReviewToRow(row.note, response, today(), undefined, fields);
        const next = upsertRow(text, { name, path: file }, index, note);
        await writeNote(vault, file, next);
        out({ ok: true }, args);
        return;
      }

      // Legacy: inline note card identified by `${notePath}::${cardIndex}::${subIndex}`.
      const [id, responseRaw] = positionals(args);
      if (!id) fail("usage: card review <id> <response> | --file <base> --index <n> --response <r>");
      const response = asResponse(responseRaw);
      await applyReview(vault, id, response, today());
      out({ ok: true }, args);
    },
  },
};
