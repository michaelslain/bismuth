# Feedback

Feedback sends what you think of Bismuth to its developer, either written by hand or drawn out by a short interview with your daemon. Nothing leaves your machine until you press `[ send ]`, and the developer's address never appears in the app or the repo.

```bash
bismuth feedback send --title "Graph pans slowly" --body "Panning stutters in a big vault."
```

## Send feedback from the app

Run **Give feedback…** from the command palette or a toolbar button. It opens the feedback page, whose bar toggles between `write` and `interview`.

- **write** is a form: a one-line title, the feedback itself, and an optional `reply to` (an email or a handle, if you want an answer). `[ send ]` stays disabled until the title and the feedback are filled in, and the line beside it says what is missing.
- **interview** starts with `[ start interview ]`. Your daemon asks (when the daemon is off, the agent the chat runs on, such as Claude Code, opencode or Codex, asks under its own name) one short question at a time about what you use Bismuth for, what works, and what gets in your way. After about five answers, or when you say you are done, it writes a draft. The page then switches to the draft's review: the same form, filled in, where you edit it and press `[ send ]`. `[ back to interview ]` goes back to the conversation, which offers `[ open draft ]` to return. Ask for changes and it writes a new draft, which replaces the title and body and opens the review again; your `reply to` is kept.

After a send the form reads `sent // thank you`, with `[ write another ]` to clear it. A failed send shows the error in place and keeps the draft, so pressing `[ send ]` again retries.

The interview is an ordinary chat session that asks before using any tool. Closing the feedback tab ends it, and reopening the page starts a fresh one.

## Send feedback from the CLI

`bismuth feedback send` sends one piece of feedback without the app running.

| Flag | Required | Effect |
|---|---|---|
| `--title <t>` | yes | One line, up to 200 characters |
| `--body <text>` | yes | The feedback, up to 20,000 characters |
| `--kind written\|interview` | no | Defaults to `written` |
| `--contact <email or handle>` | no | A reply-to, up to 200 characters |

It prints `{"sent": true, "id": "<id>"}`. An AI agent is refused: it sends text off the machine, so an agent drafts the feedback for the feedback page instead, where you open draft it.

## What is sent

A submission carries the kind (`written` or `interview`), the title, the body, the `reply to` when you filled one in, and three facts about the install: the Bismuth version, the operating system, and the daemon's name. No vault content is attached beyond what you typed or kept in the draft.

## When sending fails

| Message | Meaning | What to do |
|---|---|---|
| `feedback is not set up in this build (no relay address)` | This build has no feedback relay address | Set `BISMUTH_FEEDBACK_URL` to a running relay's `/feedback` URL |
| `too many feedback submissions, try again later` | The relay accepts five submissions per hour from one address | Wait, then press `[ send ]` again |
| `could not reach the feedback relay: …` | The network or the relay is down | Check your connection and retry |
| `feedback service is not configured` | The relay is running without its email settings | The relay's operator sets `RESEND_API_KEY` and `FEEDBACK_TO` |

## How it works

The app and the CLI both call `submitFeedback` in core, which validates the payload against the shared limits and posts it to the hosted relay. The app reaches it through core's owner-only `POST /feedback`, so an agent channel cannot send. The relay is a small Bun service in `services/feedback/`, deployed on its own. It rate-limits per IP and emails each submission through Resend to the address in its `FEEDBACK_TO` environment variable. Its README covers running and deploying it.

The relay address is `DEFAULT_FEEDBACK_ENDPOINT` in core, overridden by the `BISMUTH_FEEDBACK_URL` environment variable.

The interview is a chat session with a fresh id per start (`feedbackInterviewState.ts`), retained by `App` while a feedback tab is open. Its standing instruction rides each turn's editor-context preamble. The page watches the transcript for the newest complete ` ```feedback ` fence (first line `title: …`, then the body) and copies it into the form.

Source: `core/src/feedback.ts`, `core/src/feedbackContract.ts`, `core/src/routes/system.ts`, `cli/src/commands/feedback.ts`, `app/src/feedback/`, `services/feedback/`
