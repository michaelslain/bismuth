// app/src/chatTranscript.ts
//
// The PURE frame → transcript reducer for the visual chat (ChatView.tsx). The backend translates the
// Agent SDK's message stream into `ChatFrame`s (core/src/chat.ts is the single source of truth for
// that wire contract) and pushes them down the /chat WebSocket; this module folds those frames into
// the ordered `TurnItem[]` the transcript renders from.
//
// Split out of ChatView.tsx (a ~2,700-line component) for the same reason as its ~13 sibling
// chat*.ts modules: the frames are PLAIN DATA, so the whole transcript-building rule set — when a
// new assistant turn starts, when a streamed delta merges into the trailing part vs. opens a new
// one, how a late `tool-result` finds its chip — is expressible without a WebSocket, a signal, or a
// DOM. Keeping it here makes it unit-testable (chatTranscript.test.ts) and lets a static
// `ChatFrame[]` drive the transcript in Storybook, neither of which was reachable while the logic
// lived inline in a component fed only by a live Agent-SDK session.
//
// SCOPE — this module owns the TRANSCRIPT only. Eight frame kinds build it (see applyChatFrame);
// the other eight drive session/header state that is irreducibly effectful and stays in ChatView:
// `manifest` (pushes set_permission_mode/set_effort/set_model back DOWN the socket and writes
// localStorage), `models`/`auth`/`context` (header signals), `title`/`session` (cross-module
// publishers — chatTitles.ts, chatSessionStore.ts, chatOrigin.ts), `done` (streaming flag + the
// queued-turn dispatcher), and `error` (the setup / visibility-refusal / per-turn error signals).
// Those are not transcript state and are deliberately NOT pretended to be pure here.
//
// MUTATES IN PLACE. `applyChatFrame` takes the transcript array and edits it, which is exactly the
// shape Solid's `produce` draft wants (ChatView calls it inside `setTranscript(produce(...))`), and
// what a fold in `buildTranscript` wants too. It is otherwise pure: no I/O, no globals, no clock.

import type { ChatFrame, ChatQuestion } from "../../core/src/chat";

// ── Transcript model ──────────────────────────────────────────────────────────────────────
// The transcript is an ordered list of turn ITEMS. A `user` item is one sent message. An
// `assistant` item is a whole assistant turn — a list of ordered PARTS (prose / thinking / a
// tool call / an inline permission prompt) interleaved in arrival order, plus an optional
// result footer. Streaming deltas append into the current assistant turn's trailing part.

/** A run of streamed assistant prose (markdown), accumulated across `assistant-text` deltas. */
export interface TextPart { kind: "text"; text: string }
/** A run of streamed extended-thinking text, accumulated across `thinking` deltas. */
export interface ThinkingPart { kind: "thinking"; text: string }
/** A tool invocation chip; `result`/`isError` fill in when the matching tool-result arrives.
 *  `toolKind` (NOT `kind` — that name is already the part discriminant) is the frame's optional
 *  machine token for the call, used only to pick the icon; see chatToolIcon.ts. */
export interface ToolPart {
  kind: "tool";
  id: string;
  name: string;
  toolKind?: string;
  input: unknown;
  result: string | null;
  isError: boolean;
  pending: boolean;
}
/** An inline permission prompt; `answered` records the user's choice once they pick. `cancelled`
 *  marks a prompt orphaned by Stop (the backend denied it when the turn aborted) — rendered as a
 *  muted "Cancelled" note, NOT as a user denial, and its buttons stop being actionable. */
export interface PermissionPart {
  kind: "permission";
  id: string;
  toolName: string;
  input: unknown;
  answered: null | { behavior: "allow" | "deny"; always: boolean };
  cancelled?: boolean;
}
/** An interactive AskUserQuestion prompt: 1-4 multiple-choice questions rendered as option buttons.
 *  `answered` records the submitted answers (question text → chosen answer string) once the user picks;
 *  `cancelled` marks a prompt skipped or orphaned by Stop (rendered as a muted "Skipped", buttons
 *  inert). Only one of answered/cancelled is ever set. */
export interface QuestionPart {
  kind: "question";
  id: string;
  questions: ChatQuestion[];
  answered: null | Record<string, string>;
  cancelled?: boolean;
}
export type AssistantPart = TextPart | ThinkingPart | ToolPart | PermissionPart | QuestionPart;

export interface UserItem {
  role: "user";
  text: string;
  images?: string[]; // data: URLs, shown in the bubble
  /** Staged while a turn streams (dimmed bubble + cancel); cleared when actually dispatched. */
  queued?: boolean;
  /** Joins the bubble to its entry in the queued-turns list for cancel-before-send. */
  queueId?: string;
}
export interface AssistantItem {
  role: "assistant";
  parts: AssistantPart[];
  /** Set from the turn's `result` frame — a muted footer (turns + cost). */
  footer: { numTurns: number; costUsd: number | null } | null;
  /** True when this turn answers a slash-command input (the preceding user bubble started with
   *  "/"): its prose is a locally-produced command result (e.g. `/context`'s panel), so it renders
   *  in a boxed monospace "command output" container — like the Claude Code TUI — not loose prose (#28). */
  command?: boolean;
}
/** A transient, non-error system notice (BUG #87) — confirms a client-side slash command actually
 *  DID something (e.g. `/chrome` toggling a setting with no other visible surface nearby), without
 *  claiming to be part of the conversation (no "You"/persona label, not sent to the model, not
 *  replayed from session history). Rendered as a quiet one-line notice, like .chat-turn-error but
 *  neutral instead of danger-colored. NEVER produced by a frame — ChatView pushes these directly
 *  from its client-side slash commands — but it is part of the item union the transcript renders. */
export interface SystemItem {
  role: "system";
  text: string;
}
export type TurnItem = UserItem | AssistantItem | SystemItem;

// ── Reducer internals ─────────────────────────────────────────────────────────────────────

/** Ensure the trailing item is an assistant turn (creating one if the transcript is empty or ends
 *  with a user/system item), then hand it to `fn`. A turn answering a slash-command input (the
 *  preceding user bubble starts with "/") is a command result — flagged so its prose renders as a
 *  boxed monospace panel, not prose (#28). */
function withAssistant(transcript: TurnItem[], fn: (a: AssistantItem) => void): void {
  let last: TurnItem | undefined = transcript[transcript.length - 1];
  if (!last || last.role !== "assistant") {
    const command = !!last && last.role === "user" && last.text.trim().startsWith("/");
    const a: AssistantItem = { role: "assistant", parts: [], footer: null, command };
    transcript.push(a);
    last = a;
  }
  fn(last as AssistantItem);
}

/** Append a prose/thinking delta into the assistant turn's trailing part of that kind, or start a
 *  new part (so an interleaved tool call splits prose into separate bubbles). */
function appendStream(transcript: TurnItem[], kind: "text" | "thinking", text: string): void {
  withAssistant(transcript, (a) => {
    const tail = a.parts[a.parts.length - 1];
    if (tail && tail.kind === kind) tail.text += text;
    // `{ kind, text }` widens `kind` to "text"|"thinking", which isn't assignable to the
    // discriminated AssistantPart union — the cast (sound: it IS a TextPart|ThinkingPart) keeps it
    // a one-liner without the narrowing ternary.
    else a.parts.push({ kind, text } as TextPart | ThinkingPart);
  });
}

// ── The reducer ───────────────────────────────────────────────────────────────────────────

/**
 * Apply ONE frame's transcript effect to `transcript`, IN PLACE.
 *
 * Returns whether this frame is a TRANSCRIPT frame — i.e. whether the caller should treat the
 * transcript as touched (ChatView scrolls to the bottom exactly when this is true). It is
 * deliberately a property of the frame KIND, not of whether anything actually changed: a
 * `tool-result` whose chip isn't in the transcript still counts, matching the pre-extraction
 * behaviour where `scrollToBottom()` ran unconditionally after the id lookup.
 *
 * The switch is EXHAUSTIVE over `ChatFrame` (the `never` assignment in `default` is a compile-time
 * guard): a newly-added frame variant fails typecheck here rather than being silently dropped from
 * the transcript, which is the failure mode this seam exists to prevent.
 */
export function applyChatFrame(transcript: TurnItem[], frame: ChatFrame): boolean {
  switch (frame.type) {
    case "user-message":
      // A replayed past user turn (history only — live user messages come from ChatView's send(),
      // not the wire). Rendered as a user bubble, identical to a freshly-sent one — including any
      // persisted image attachments (data: URLs), so an image-only turn doesn't vanish.
      transcript.push({ role: "user", text: frame.text, images: frame.images });
      return true;

    case "assistant-text":
      appendStream(transcript, "text", frame.text);
      return true;

    case "thinking":
      appendStream(transcript, "thinking", frame.text);
      return true;

    case "tool-use":
      withAssistant(transcript, (a) => {
        a.parts.push({
          kind: "tool",
          id: frame.id,
          name: frame.name,
          toolKind: frame.kind,
          input: frame.input,
          result: null,
          isError: false,
          pending: true,
        });
      });
      return true;

    case "tool-result":
      // Match the chip by id anywhere in the transcript (results can arrive out of band) — the
      // FIRST match in transcript order wins, and a result for an unknown id is simply dropped.
      for (const item of transcript) {
        if (item.role !== "assistant") continue;
        const part = item.parts.find((p) => p.kind === "tool" && p.id === frame.id) as ToolPart | undefined;
        if (part) {
          part.result = frame.content;
          part.isError = frame.isError;
          part.pending = false;
          break;
        }
      }
      return true;

    case "permission":
      withAssistant(transcript, (a) => {
        a.parts.push({
          kind: "permission",
          id: frame.id,
          toolName: frame.toolName,
          input: frame.input,
          answered: null,
        });
      });
      return true;

    case "question":
      // AskUserQuestion: rendered as an interactive card (QuestionCard). Parking the dialog
      // server-side keeps the turn from ending, so no extra client-side gating is needed — a
      // follow-up message the user sends meanwhile is STAGED (ChatView's streaming() is still true)
      // and dispatched on `done`, which only fires once the question is answered or skipped.
      withAssistant(transcript, (a) => {
        a.parts.push({ kind: "question", id: frame.id, questions: frame.questions, answered: null });
      });
      return true;

    case "result":
      // The turn's muted footer (turns + cost). The `isError` flag ALSO raises ChatView's inline
      // turn-error notice, which is signal state, not transcript state — handled by the caller.
      withAssistant(transcript, (a) => {
        a.footer = { numTurns: frame.numTurns, costUsd: frame.costUsd };
      });
      return true;

    // ── Frames with NO transcript effect ────────────────────────────────────────────────────
    // Listed explicitly (never a bare `default`) so the exhaustiveness guard below stays live.
    // Each drives session/header state ChatView owns — see the SCOPE note in this file's header.
    case "manifest": // → header model / permission mode / effort, and set_* pushes back down the socket
    case "done": // → streaming flag + queued-turn dispatch
    case "models": // → header model picker
    case "auth": // → header auth pill (opencode credentials)
    case "title": // → publishChatTitle (names the TAB, not a transcript item)
    case "session": // → rememberChatSession / publishChatOrigin
    case "context": // → header context-usage pill
    case "error": // → setup / visibility-refusal / per-turn error signals
      return false;

    default: {
      // Compile-time exhaustiveness: if `ChatFrame` gains a variant, this assignment fails to
      // typecheck — the variant must be handled (or explicitly listed as transcript-neutral above).
      const exhaustive: never = frame;
      void exhaustive;
      return false;
    }
  }
}

/**
 * Fold a whole frame stream into a fresh transcript — the same result the live socket would have
 * produced by applying each frame in arrival order. This is what makes a STATIC `ChatFrame[]` able
 * to drive the transcript UI (Storybook, tests) with no WebSocket and no Agent-SDK session.
 */
export function buildTranscript(frames: readonly ChatFrame[]): TurnItem[] {
  const transcript: TurnItem[] = [];
  for (const frame of frames) applyChatFrame(transcript, frame);
  return transcript;
}
