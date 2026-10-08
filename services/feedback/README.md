# Bismuth feedback service

A tiny standalone service that receives feedback from Bismuth's local backend and emails it to the developer through [Resend](https://resend.com). It has no dependencies (plain `fetch`) and is not a Bun workspace of the monorepo.

## Environment

| variable | required | meaning |
|---|---|---|
| `RESEND_API_KEY` | yes | Resend API key. Without it `POST /feedback` answers 503. |
| `FEEDBACK_TO` | yes | Address that receives the feedback, e.g. `you@example.com`. Lives only in the server environment. |
| `FEEDBACK_FROM` | no | Sender, default `Bismuth Feedback <onboarding@resend.dev>`. |
| `PORT` | no | Listen port, default `8787`. |

## Routes

- `GET /health` returns `{ "ok": true }`.
- `POST /feedback` takes JSON `{ kind: 'written' | 'interview', title, body, contact?, meta? }` (see `payload.ts`) and returns `{ ok: true, id }`.
  - `400` invalid JSON or payload, `413` body over 64 KB, `429` more than 5 submissions per hour from one IP, `502` the email send failed, `503` not configured.
- Anything else is `404`. There are no CORS headers; only a server calls this.

## Run locally

```bash
RESEND_API_KEY=re_xxx FEEDBACK_TO=you@example.com bun run services/feedback/server.ts
bun test services/feedback
```

```bash
curl -s localhost:8787/feedback -H 'content-type: application/json' \
    -d '{"kind":"written","title":"Hello","body":"Nice app","contact":"me@example.com","meta":{"appVersion":"0.1.0","platform":"macos"}}'
```

## Deploy on Railway

Create a service from this repo with root directory `services/feedback` and start command `bun run server.ts`. Set `RESEND_API_KEY` and `FEEDBACK_TO` (and optionally `FEEDBACK_FROM`) as service variables. Railway supplies `PORT`. The limiter keys on the first `x-forwarded-for` entry, which Railway's proxy sets.
