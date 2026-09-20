# iot-sync-simplisafe-blink

[![CI](https://github.com/chrismpettyjohn/iot-sync-simplisafe-blink/actions/workflows/ci.yml/badge.svg)](https://github.com/chrismpettyjohn/iot-sync-simplisafe-blink/actions/workflows/ci.yml)

Watches Gmail for SimpliSafe notifications and arms/disarms your Blink sync modules to match.

SimpliSafe has no public API here — the arm state is read from the **notification emails**
SimpliSafe sends, so the system must be configured to email you on arm and disarm.

## Requirements

* [NodeJS](https://nodejs.org/en/download) 22+
* [Bun](https://bun.sh/docs/installation)
* SimpliSafe set to send email notifications
* A Gmail [app password](https://myaccount.google.com/apppasswords)

## Setup

```sh
bun install
bun run setup
```

`setup` walks through everything:

1. Prompts for your Gmail address and app password, then **verifies IMAP and SMTP live**
   before saving anything.
2. Prompts for your Blink credentials and generates a client id for you.
3. Signs in to Blink, prompting for the 2FA PIN if needed, and **saves the token** to
   `.blink-auth.json` so you are not asked again on later runs.
4. Lists the networks on your account so you can **pick which sync modules to sync**.
5. Asks whether you want notification emails at all.
6. Writes `.env` (mode `600`), backing up any previous version to `.env.bak`.

## Usage

```sh
bun start                       # watch Gmail and sync SimpliSafe -> Blink
bun run src/cli.ts arm          # arm every configured network now
bun run src/cli.ts disarm       # disarm every configured network now
bun run src/cli.ts help         # usage
```

Run `arm` / `disarm` to confirm the setup works without waiting for a real SimpliSafe event.

## Configuration

| Variable | Description |
| --- | --- |
| `GMAIL_EMAIL` | Gmail account to watch, and where sync notifications are sent |
| `GMAIL_PASS` | Gmail **app password** |
| `BLINK_EMAIL` | Blink account email |
| `BLINK_PASS` | Blink account password |
| `BLINK_CLIENT` | Stable unique id; Blink ties 2FA verification to it |
| `BLINK_NETWORKS` | Comma separated network names, e.g. `Indoors,Outdoors` |
| `NOTIFY_EMAIL` | Optional. Where sync summaries go; **leave unset to send no emails** |
| `LOG_LEVEL` | Optional: `debug`, `info` (default), `warn`, `error` |

`BLINK_NETWORK` (singular) is still read as a single-network fallback.

### Turning the notification emails off

Leave `NOTIFY_EMAIL` blank or delete the line. Syncing carries on as normal and the
results are still logged to the console — nothing is emailed. `GMAIL_EMAIL` and
`GMAIL_PASS` stay required either way, because reading SimpliSafe's notification mail is
how the arm state is detected in the first place.

## How it works

Once signed in the process stays running and watches the inbox for mail from
`no-reply@info.simplisafe.com`. A recognised subject is mapped to an arm state and applied
to every configured network in parallel. Networks are applied independently, so one
failing sync module does not stop the others. If `NOTIFY_EMAIL` is set you also get one
summary email per sync reporting each network's result.

Unread messages are processed oldest first and only marked read once handled, so events
that arrive while the process is down are picked up on the next start rather than lost.
The IMAP connection reconnects on its own with backoff if it drops.

Run `bun run setup` before daemonising — the 2FA PIN prompt blocks on stdin, and setup is
what gets past it once and persists the token.

## Development

```sh
bun test         # unit and CLI tests, no credentials needed
bun run typecheck
bun run build    # bundle to dist/cli.js
```

The tests stub the Blink API, IMAP and SMTP, so they cover the multi-network fan-out,
the inbox ordering guarantees and the notification toggle without touching real accounts.

GitHub Actions runs the typecheck and the tests on every push to `main` and on pull
requests, then builds the bundle and smoke tests it. The bundle is uploaded as a build
artifact; nothing is published or deployed.

## References

[Blink API Protocol](https://github.com/MattTW/BlinkMonitorProtocol)
