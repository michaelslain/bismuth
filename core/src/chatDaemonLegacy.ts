// core/src/chatDaemonLegacy.ts
// The ONE-TIME BACKFILL of daemon session provenance for sessions minted before the durable set
// (`<vault>/.daemon/session-ids`) existed.
//
// WHY THIS IS NEEDED AND THE DURABLE SET IS NOT ENOUGH. The set is written from the fix forward, so
// on the machine that reported this bug it starts EMPTY while the store already holds the entire
// problem: ~1000 transcripts for the vault, of which 129 are daemon boot sessions and 759 are cron
// sessions — 89% of the picker. Shipping only the set would leave every chat the user actually
// complained about still listed, aging out over ~30 days. This recovers them once, up front.
//
// WHY THIS IS NOT A CONTENT HEURISTIC. The distinction that matters is not "does this transcript
// look automated" — that would be exactly the fragile signal the durable set replaced. It is: the
// daemon SENT a prompt it composed from its own hardcoded constants, and that prompt is the first
// user message of the transcript. Matching those constants identifies the sessions the daemon
// minted with certainty, because nothing else writes them. The two anchors, both verified against
// the real store (see the counts above):
//
//   * boot     — first user message EXACTLY equals DAEMON_BOOT_PROMPT (129/129 matched).
//   * cron     — first user message starts with `[Cron: ` AND contains CRON_RESULT_INSTRUCTION
//                (759/759 matched). The middle (`job.name`, `job.prompt`) is user-editable, so it
//                is deliberately NOT part of the test; the daemon-authored wrapper is.
//
// THESE LITERALS ARE FROZEN HISTORY, NOT DUPLICATES TO KEEP IN SYNC. They describe bytes already
// written to disk by daemon versions that shipped. DAEMON_BOOT_PROMPT no longer exists in the
// daemon at all (this fix removed the boot session that emitted it) and CRON_RESULT_INSTRUCTION may
// be reworded tomorrow — neither can change what old transcripts already say. Editing these to
// "match" the current daemon would only un-recover real daemon sessions. Nothing new needs adding
// here either: every session minted from this fix forward is recorded by saveSessionId as it
// happens (daemon/src/daemon/sessionIds.ts), which is the durable mechanism this merely backfills.
//
// SAFETY: a false positive HIDES A USER'S OWN CONVERSATION, which is far worse than leaving a
// daemon chat listed. Every rule here is therefore an exact match against a daemon-authored
// constant, anchored at the FIRST USER MESSAGE — never a search of the transcript body. A user who
// merely discusses crons (quoting the marker, pasting the prompt, asking what `[Cron: dream]` in
// their logs means) trips nothing: their first message is their own prose. When in doubt this
// module says "not the daemon's", which lists the chat.
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { listSessions, getSessionMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { extractText, type TranscriptEntry } from "@bismuth/memory";
import { vaultDaemonDir, vaultLegacySessionIdsFile } from "./daemon";

/** The prompt the pre-fix daemon sent on EVERY startup, minting a session per boot/relaunch.
 *  Frozen: the daemon no longer sends this (that boot session is what this card removed), but 129
 *  transcripts on the reporting machine still open with it. */
export const DAEMON_BOOT_PROMPT =
  "You are now running as a background daemon for this vault. Check memory for prior context.";

/** The prefix fireJob puts on every cron prompt: `[Cron: <job.name>] `. */
export const CRON_PROMPT_PREFIX = "[Cron: ";

/** The instruction fireJob appends to EVERY cron prompt, unconditionally. Paired with the prefix
 *  above so that a user typing either one alone is never mistaken for the daemon. Frozen. */
export const CRON_RESULT_INSTRUCTION =
  "IMPORTANT: When you are done, print exactly [CRON_RESULT:SUCCESS] if the task completed successfully, or [CRON_RESULT:FAILURE] if it failed. This must be the last thing you print.";

/**
 * Pure: did the daemon compose this first-user-message, using prompts only it writes?
 *
 * `true` only for an exact match on a daemon-authored constant — see the safety note above. Total:
 * any other text (including a user chat ABOUT crons) is the user's.
 */
export function isDaemonPrompt(firstUserText: string): boolean {
  const text = firstUserText.trim();
  if (text === DAEMON_BOOT_PROMPT) return true;
  return text.startsWith(CRON_PROMPT_PREFIX) && text.includes(CRON_RESULT_INSTRUCTION);
}

/**
 * Pure: the text of a transcript's opening user message, or null when there isn't one to judge.
 *
 * Null (not "") for anything unjudgeable — an assistant-first or tool-result-first transcript, an
 * empty/odd message — so the caller treats it as the user's rather than guessing.
 */
export function firstUserMessageText(messages: readonly SessionMessage[]): string | null {
  const first = messages[0];
  if (!first || first.type !== "user") return null;
  const text = extractText((first as { message?: TranscriptEntry["message"] }).message);
  return text || null;
}

/** Hard ceiling on transcripts inspected in one backfill, so an enormous store can't turn the
 *  first History open into an unbounded read. The reporting machine holds ~1000; this is headroom,
 *  not a target. Sessions past it stay listed and age out — a miss, never a false positive. */
export const LEGACY_SCAN_CAP = 5000;

/** Sessions per listSessions page while scanning. */
const SCAN_PAGE = 200;

/**
 * Scan the store for `cwd` and return the ids of every session the daemon minted, judged by its
 * opening prompt. Bounded: reads only the FIRST message of each transcript (`limit: 1`), never the
 * body — ~1.3s for the reporting machine's 997 transcripts, versus reading 167MB to parse them all.
 * Tolerant per session: one unreadable transcript is skipped, not fatal.
 */
async function scanForDaemonSessions(cwd: string): Promise<string[]> {
  const found: string[] = [];
  for (let offset = 0; offset < LEGACY_SCAN_CAP; ) {
    const page = await listSessions({ dir: cwd, limit: SCAN_PAGE, offset });
    if (page.length === 0) break;
    offset += page.length;
    await Promise.all(
      page.map(async (s) => {
        let messages: SessionMessage[];
        try {
          messages = await getSessionMessages(s.sessionId, { dir: cwd, limit: 1 });
        } catch {
          return; // unreadable → not judged → the user's
        }
        const text = firstUserMessageText(messages);
        if (text !== null && isDaemonPrompt(text)) found.push(s.sessionId);
      }),
    );
    if (page.length < SCAN_PAGE) break; // short page = store exhausted
  }
  return found;
}

// One in-flight backfill per vault. Opening History twice in a row (or History + search) must not
// race two full scans against each other; both callers await the same promise.
const inFlight = new Map<string, Promise<void>>();

/**
 * Run the backfill for `vault` at most ONCE, ever.
 *
 * Idempotent on two levels: the written file's own existence is the marker (a completed scan that
 * found nothing writes an empty file, which still means "done" — never rescanned), and concurrent
 * callers in this process share one promise. Two core processes racing is safe by construction:
 * they compute the same answer and the temp-then-rename swap is atomic.
 *
 * Gated on `<vault>/.daemon` existing: only a vault that has a daemon can have daemon sessions, and
 * a vault without one must not have a `.daemon` dir conjured into it just to record "nothing".
 *
 * NEVER throws and never deletes: this records provenance so the chat page can FILTER. Every
 * transcript stays on disk — the crons need them, and the daemon-chats surface this card defers
 * will read exactly this set to find them. A failure here leaves the file unwritten, so the next
 * open retries; the worst case is the pre-fix behavior, never a hidden user chat.
 *
 * KNOWN, DELIBERATE GAP: being one-time, this cannot see a session minted AFTER it runs by a daemon
 * too old to record its own (i.e. the app updated but the launchd daemon binary hasn't restarted
 * yet). Such sessions would list as the user's. The window is small (core reinstalls + restarts the
 * daemon service on boot, well before a History open) and self-healing (the new daemon records
 * every session from its first cron fire), and closing it would mean re-scanning the store on every
 * open — paying a permanent per-open cost to cover a transient one. Left as a miss, which is the
 * safe direction: it lists a daemon chat, it never hides a user's.
 */
export async function backfillLegacyDaemonSessions(vault: string): Promise<void> {
  const file = vaultLegacySessionIdsFile(vault);
  if (existsSync(file)) return; // already done
  if (!existsSync(vaultDaemonDir(vault))) return; // no daemon here → no daemon sessions

  const running = inFlight.get(vault);
  if (running) return running;

  const run = (async () => {
    try {
      const ids = await scanForDaemonSessions(vault);
      // Re-check under the same guard: a concurrent process may have finished while we scanned.
      if (existsSync(file)) return;
      await mkdir(vaultDaemonDir(vault), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      await writeFile(tmp, ids.length ? `${ids.join("\n")}\n` : "", "utf-8");
      await rename(tmp, file);
    } catch {
      // Unwritable/unreadable store → leave the marker absent and retry on the next open.
    } finally {
      inFlight.delete(vault);
    }
  })();
  inFlight.set(vault, run);
  return run;
}
