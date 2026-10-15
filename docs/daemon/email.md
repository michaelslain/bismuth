# Inbox by email

The email bridge connects a vault's daemon inbox to your mailbox. Each new [inbox page](pages.md) arrives as an email, and you answer it by replying in your own words. A fresh email to the vault's address becomes a new page. The daemon does this over your own mail account's SMTP and IMAP, so nothing needs hosting, and it needs a running daemon ([set up the daemon](setup.md)).

A page email, as the bridge sends it:

```text
Subject: Ada: Reply drafts ready

Reply to Jane: Q3 budget looks fine.

-- 
Reply in your own words: approve it, ask for changes to the draft, or say no. The page's buttons: send replies // discard.
From vault // answer-emails
```

A reply that approves the draft with a change:

```text
yes send it, but tell Jane Q3 is fine and to ship it
```

The daemon rewrites the draft with the change, presses **send**, and mails `Done.` and its summary back in the same thread when the action finishes.

## Turn on email for a vault

1. Write the mail-account template, then fill it in:

   ```bash
   bismuth daemon email init
   ```

   It prints `{"path":"/Users/you/.bismuth/email.json","created":true}` and never overwrites an existing file. The file is readable by your user only.
2. Put your address in `to` and `user`, and an app password in `pass` (Gmail: turn on 2-step verification, then create one under App passwords). The template's servers are Gmail's; other providers are in the account keys below.
3. Check the account:

   ```bash
   bismuth daemon email test
   ```

   Expect `{"ok":true,"smtp":"ok","imap":"ok"}`. It logs in to both servers and sends nothing.
4. In the vault's `.settings`, turn the bridge on, and optionally give it an address for new requests:

   ```yaml
   daemon:
     enabled: true
     email:
       enabled: true
       address: you+bismuth@gmail.com
   ```

The bridge starts with the next mail check, within a minute. Pages filed before that are never mailed.

## Answer a page by email

Reply to the page's email in plain words, the same way you would answer at the page's reply prompt in the app. Your mail client's quoted original and your signature are cut before the daemon reads it. The daemon reads the reply and does one of three things:

- Presses the button you mean, as if you clicked it. An approve button runs the action, and the result arrives in the same thread, starting `Done.` or `Failed.`. A dismiss button closes the page and replies `Dismissed.`.
- Rewrites the draft with the changes you asked for, then presses the button.
- Asks one short question back, in the same thread, when it cannot tell which button you mean. Reply to the question in plain words and the daemon reads the whole conversation again.

A reply that is exactly a button's id or label (`send`, `Discard`) is pressed without a model call. The daemon never acts on a reply directly: it only chooses among the page's own buttons, so a misread reply can at most press one of them.

Two replies answer a page that cannot take one:

- `Still working on your last answer; this reply was not used.` while the daemon is reading an earlier reply or running the action.
- `This page is already done; nothing changed.` (or `dismissed`) once the page is closed.

A failed page can be retried by replying again.

## Send the daemon a request by email

Mail the vault's `daemon.email.address` from your own address. The bridge files a page titled with your subject, holding your message, with two buttons: `run` and `dismiss`. The page arrives in your inbox as a reply to your email. Reply to approve it ("go ahead") and the daemon carries it out; its summary comes back in the thread.

The request never runs on the incoming email alone. It runs only on a reply to the page email, whose Message-ID carries a random part, and only you receive that email.

With `address` empty, the bridge reads only replies to page emails.

Gmail and Fastmail deliver `you+anything@…` to your own mailbox, which makes a plus-address the simplest choice.

## Send from a separate address

The bridge sends from the account in `email.json`, so with your own account its mail arrives from yourself. To have pages come from the daemon instead, create a mailbox for it (a free Gmail account works), put that account's login and app password in `user` and `pass`, and keep your own address in `to`. Set the vault's `daemon.email.address` to the daemon's address so mail you send it becomes a request. Nothing needs hosting either way.

## Who the bridge listens to

The bridge acts only on INBOX mail from the last three days that comes from the `to` address and either answers a page email or is addressed to the vault's `address`. A request also has to be sent after the bridge was turned on. Every other message is left untouched. A message it acts on is marked read, and its Message-ID is recorded so it is never acted on twice; whether you already read a message makes no difference, since mail you send to yourself often arrives read.

A reply counts only when it answers the page email's own Message-ID, which carries a random part. Someone who never received the page email cannot press its buttons, even with a forged sender.

## Account keys

`~/.bismuth/email.json` holds the mail account for every vault on the machine. It lives outside the vault because it holds a password, and a vault is synced, backed up and read by agents.

| Key | Type | Default | Effect |
|---|---|---|---|
| `to` | address | none | Where pages are mailed, and the only sender the bridge acts on |
| `from` | address | `smtp.user` when it is an address, else `to` | Sender on outgoing mail |
| `user` | text | none | Login for both servers unless a server sets its own |
| `pass` | text | none | Password for both servers unless a server sets its own |
| `smtp.host`, `imap.host` | host name | none | Required |
| `smtp.port` | number | `465`, or `587` with `secure: false` | SMTP port |
| `imap.port` | number | `993`, or `143` with `secure: false` | IMAP port |
| `smtp.secure`, `imap.secure` | boolean | `true` | TLS from the first byte |
| `smtp.user`, `smtp.pass`, `imap.user`, `imap.pass` | text | `user`, `pass` | Per-server login |
| `pollSeconds` | number | `60`, at least `15` | Seconds between checks for replies |

Common servers:

| Provider | SMTP | IMAP |
|---|---|---|
| Gmail | `smtp.gmail.com`, 465 | `imap.gmail.com`, 993 |
| Fastmail | `smtp.fastmail.com`, 465 | `imap.fastmail.com`, 993 |
| iCloud | `smtp.mail.me.com`, 587, `secure: false` | `imap.mail.me.com`, 993 |

`bismuth daemon email status` prints the account as the bridge reads it, without passwords, or the first thing wrong with the file.

## Vault keys

Each vault opts in through `.settings`. [The settings reference](../settings/reference.md#daemon) has the full descriptions.

| Key | Type | Default | Effect |
|---|---|---|---|
| `daemon.email.enabled` | boolean | `false` | Mail this vault's new pages and read replies to them |
| `daemon.email.address` | address | empty | Fresh mail to this address becomes a request page |

## Failure modes

- If `email.json` is missing or invalid, the bridge sends nothing and logs one line naming the problem to the daemon log. `bismuth daemon email status` prints the same line.
- If a login fails, the bridge logs the error once and retries every check. A page that could not be sent is sent on a later check.
- If the device is not the owner device, it neither sends nor reads mail. See [which device runs the daemon](communication.md#which-device-runs-the-daemon).
- If the machine is asleep, replies wait in the mailbox, unread, and are acted on within one check of waking, as long as they are under three days old.
- If the daemon cannot tell what a reply means, nothing is pressed; a question comes back in the thread instead.
- If your mail client puts its own text above your reply (some phone clients), that text is read as part of the reply.

## How it works

The daemon runs the bridge on the owner device every 15 seconds, and a pass goes ahead once `pollSeconds` have passed since the last one. A pass reads replies first, then mails what is new.

- Outgoing: `sendOutbound` lists the vault's pages through core's `listDaemonPages` and mails every page that is `pending`, due, created after the bridge's `enabledAt`, and not yet mailed. Each mail carries a `Message-ID` of the form `<bismuth.<slug>.<random>@<domain>>` and an `X-Bismuth-Page` header. When a press made by email settles as `done` or `failed`, the outcome is mailed once in the thread.
- Outgoing, in the thread: for a page answered by email, every question the daemon appends to the page's thread is mailed once.
- Incoming: `receiveInbound` searches INBOX for mail from the last three days, read or unread, reads only envelopes and threading headers, and downloads the messages it selects. A message with the `X-Bismuth-Page` header is the bridge's own and is never selected, nor is one whose Message-ID is in the state's `handled` map. A reply is matched to a page through `In-Reply-To`, then `References`. `stripQuoted` cuts the quoted original and the signature.
- A reply goes to core's `replyToPage` with `via: email`, the same function behind the app's reply prompt and `bismuth page reply`. The daemon's page runtime reads it with `readReply`; see [read a reply in plain words](pages.md#read-a-reply-in-plain-words).
- A request becomes a page through core's `createDaemonPage`, with `source: email`, then is mailed at once as a reply to the incoming message.

The bridge's bookkeeping is `<vault>/.daemon/pages/.email/state.json`: `enabledAt`; for each mailed page its `messageId`, `subject`, `sentAt`, whether a reply arrived by email, how many thread entries were mailed, and when its result was sent; and `handled`, the Message-IDs already acted on, each dropped four days after it was handled. An entry whose page was archived or garbage-collected is dropped on the next pass. The dot-prefixed folder keeps it out of the file tree.

Source: `daemon/src/daemon/{emailBridge,emailFormat,emailTransport,pageReply,pages}.ts`, `daemon/src/lib/emailConfig.ts`, `daemon/src/lib/registry.ts`, `core/src/daemonPages.ts`, `cli/src/commands/daemon.ts`
