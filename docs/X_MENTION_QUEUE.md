# X mention queue

`mention_queue` is the @ExitTrace mention queue on the **Render app database**. Account display is ExitTrace (`exittracebot@areveur.com`).

`mention_queue` is excluded from `exittrace_lab_pub` / publication SQL / the [NEW_KIND_RENDER_SYNC.md](NEW_KIND_RENDER_SYNC.md) checklist. It is not gap-upserted and it is not on the media-delta path. Do not add a publication script for it.

KEEP rows are written on the lab database through the existing add-request promote path (`leadIngest` → `queueAddRequest` / `processAddRequest`) with `source=x_mention`. Lab → Render for those KEEP rows is the existing logical replication plus media-delta. The X poller and the worker do not dual-write KEEP to Render.

The mention post and the referenced subject post are leads, never cites. A dig needs two official cites that are not those posts. Fail closed. Do not invent cites, snippets, or counts.

## Place order

1. Place the lab database path used by `scripts/process-add-request.mjs` (the existing promote path).
2. Apply `scripts/mention-queue.sql` on the Render app database. The Render server also applies that file on boot, after `scripts/bootstrap-db.sql`.
3. Set the env names below. Enable the Render queue routes only after the tokens exist (unset or identical tokens fail closed).
4. Install the host poll and worker timers. GitHub Actions does not run the dig.
5. Worf before merge.

Do not point the worker at a parked database. Do not wipe media.

## Flow

1. The poller reads mentions and resolves `subject_status_id`: a referenced post snowflake when one is present (quoted, then replied_to, then any other reference), otherwise the mention id.
2. It POSTs JSON to the Render queue with `Authorization: Bearer` `MENTION_QUEUE_BOT_TOKEN`. The same `subject_status_id` is idempotent. The first row wins. A later mention of that subject is a duplicate (no second dig). Soft-ack defaults off. When `MENTION_SOFT_ACK` is on, it is sent only for an enqueue with `created: true`.
3. The worker GETs `/api/mention-queue/work` with `MENTION_QUEUE_WORKER_TOKEN`. That body is `{ pending, unreplied }`. Zero pending rows means no claim and no dig. An empty unreplied list skips the final-reply sweep. Claim-next POSTs an empty `subject_status_id` (`SKIP LOCKED`) until `claimed: false`, at most 5 claims per pass. The claim lease defaults to 12 minutes and is clamped to 10–15 minutes. The dig timeout is 9 minutes, under that lease.
4. The host dig command reads one mention JSON object on stdin and writes one JSON envelope on stdout. It does not receive queue tokens or X tokens. If it is unset, the worker refuses to claim.
5. `digMention` parks a name lead with `source=x_mention` and empty cites, then calls `processAddRequest` only when the envelope already has a subject and at least two official cites that are not the mention or the subject status. Otherwise the queue row becomes `fail_closed` or `rejected`.
6. Complete sends only queue status fields (`subject_status_id`, `claim_owner`, `status`, `kept_person_slug`, `error_reason`). It does not insert a person.
7. Soft-ack, when enabled, is exactly `Queued for ExitTrace review.` A final reply prefers one `https` URL `/people/{slug}` per KEEP. A fail-closed or rejected reason is sent only when that subject was soft-acked. A failed soft-ack or final reply does not stop the rest of the pass and does not change queue status. A successful enqueue advances `since_id` even when the soft-ack fails. The next worker pass retries unreplied rows.

## Attribution

The poller fills `mention_queue.author_display_name` (`TEXT DEFAULT ''`) from the mention author's X display name (`user.fields` includes `name`). That column is Render-only. It is not published and it is not the display source.

On lab KEEP success from the x_mention promote path only, the worker copies the winning queue row into lab `request_attributions` (`channel` defaults to `x_mention`). Fail-closed and rejected digs do not write a row. The partial unique `(channel, subject_status_id) WHERE subject_status_id IS NOT NULL` keeps the first subject. A different subject kept onto the same target inserts another row.

`request_attributions` is on `exittrace_lab_pub`. Checklist B: schema on both sides, `ALTER PUBLICATION … ADD TABLE request_attributions`, `REFRESH PUBLICATION WITH (copy_data = false)`, empty backfill is OK, then prove. See [NEW_KIND_RENDER_SYNC.md](NEW_KIND_RENDER_SYNC.md). Never `copy_data=true`. No dual-write of KEEP rows to Render. Attribution reaches Render only by logical replication. `mention_url` is meta only and is not a cite. Media-delta does not apply.

The shared `RequestAttribution` partial is a muted line under the title and above cites when rows exist, oldest first:

`Requested via X by {display_name} @{handle} · {date ET}`

Empty attributions hide the line. Multiple rows for one target all show, oldest first. Central Casting and Corona show that line on the person unless the dig kept a comms row. A kept comms row shows the line on that comm detail instead.

## Cadence, lease, limits

| Knob | Default | Band |
|--|--|--|
| `MENTION_POLL_MS` | 10 minutes | clamped to 5–15 minutes |
| `MENTION_WORKER_POLL_MS` | same as poll | clamped to 5–15 minutes |
| `MENTION_CLAIM_LEASE_MS` | 12 minutes | clamped to 10–15 minutes |
| dig timeout | 9 minutes | under the lease |
| `MENTION_AUTHOR_MAX` | 5 | per author, per window |
| `MENTION_AUTHOR_WINDOW_MS` | 1 hour | rate-limit window |
| `MENTION_BLOCKLIST` | empty | comma-separated handles or author ids |

Values are milliseconds. Nothing in this band is under 5 minutes. Host timers in `ops/systemd/` use `OnUnitActiveSec=10min`. The poll `OnBootSec` is 5 minutes and the worker `OnBootSec` is 8 minutes, about 3 minutes later, so the passes stay staggered. HTTP 402 and 429 stop that poll pass and back off inside the process. They do not shorten either timer. Copy the templates with `MENTION_INSTALL_PREFIX` set to the host checkout. This repo change does not edit live systemd:

```bash
MENTION_INSTALL_PREFIX=/path/to/ExitTrace node scripts/install-mention-units.mjs --out /tmp/mention-units
```

Set `WorkingDirectory` from that prefix on the host. Do not commit the filled units or the env file.

## Env names

Values are never stored in git. Admiral and Q place the names on the host env file and on the Render service.

Render app:

- `MENTION_QUEUE_BOT_TOKEN` — poller POST enqueue and soft-ack stamp only
- `MENTION_QUEUE_WORKER_TOKEN` — pending, claim, complete, final reply stamp only
- `EXITTRACE_PUBLIC_ORIGIN` — `https` origin used for the one KEEP URL
- `MENTION_AUTHOR_MAX`
- `MENTION_AUTHOR_WINDOW_MS`
- `MENTION_BLOCKLIST`
- `MENTION_CLAIM_LEASE_MS`

The two bearer tokens must differ. If either is unset, or they are equal, every mention route is unauthorized.

Poll host (mentions and replies for @ExitTrace):

- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`
- `X_USER_ID`
- `X_API_BASE` (optional)
- `MENTION_QUEUE_URL` — Render app origin, `https`
- `MENTION_QUEUE_BOT_TOKEN`
- `MENTION_POLL_MS`
- `MENTION_SOFT_ACK` — `1` enables the fixed soft-ack
- `MENTION_STATE_PATH` — host-local since id file
- `MENTION_INSTALL_PREFIX`

Worker host:

- `MENTION_QUEUE_URL`
- `MENTION_QUEUE_WORKER_TOKEN`
- `MENTION_WORKER_DATABASE` — set to `lab` or the worker will not write
- `DATABASE_URL` — lab database for `leadIngest` / `processAddRequest`
- `MENTION_DIG_COMMAND` — host dig program; not a GitHub Actions workflow. On the worker host prefer `node scripts/x-mention-dig-call.mjs` so the long-lived helper stays warm
- `MENTION_DIG_INNER` — one-shot dig program the warm helper runs after a call
- `MENTION_DIG_WARM_SOCKET` — host socket path for that helper
- `MENTION_CLAIM_OWNER`
- `MENTION_CLAIM_LEASE_MS`
- `MENTION_WORKER_POLL_MS`
- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`
- `X_USER_ID`

X app keys for mentions and replies stay on that host. They are not Render env and they are not committed.

## Routes

| Method | Path | Token |
|--|--|--|
| `POST` | `/api/mention-queue` | bot |
| `GET` | `/api/mention-queue/pending` | worker |
| `GET` | `/api/mention-queue/unreplied` | worker |
| `GET` | `/api/mention-queue/work` | worker |
| `POST` | `/api/mention-queue/claim` | worker |
| `POST` | `/api/mention-queue/complete` | worker |
| `POST` | `/api/mention-queue/reply` | bot `kind=soft`, worker `kind=final` |
| `GET` | `/api/mention-queue/reply-plan` | worker |

Status values: `pending`, `processing`, `kept`, `fail_closed`, `rejected`.

## Performance stamp

Picard CLEAR ~6:16pm ET 2026-09-23 reinforces the Riker DESIGN LOCK ~2:05pm ET. Poller and worker only. The dig program stays separate. `mention_queue` stays off `exittrace_lab_pub`.

- One mentions GET per poll, with `since_id` and `max_results=10`. Author fields ride that expansion. There is no per-mention user lookup.
- `MENTION_SOFT_ACK` defaults off. Soft-ack runs only when enqueue returns `created: true`.
- A failed soft-ack or final reply does not stop the pass. Enqueue advances `since_id` on a successful POST even if the soft-ack fails. The unreplied sweep and the pending claim loop each continue after one reply failure.
- `GET /api/mention-queue/work` returns `{ pending, unreplied }`. Zero pending rows: no claim and no dig. Empty unreplied: skip that `deliverFinal` sweep.
- Claim-next uses an empty `subject_status_id` and `FOR UPDATE SKIP LOCKED` until `claimed: false`. Cap is 5 claims per pass. Lease is 10–15 minutes, default 12. Dig timeout is 9 minutes, under the lease. Digs are sequential. The worker does not spawn `MENTION_DIG_COMMAND` when nothing was claimed.
- HTTP 402 and 429 stop that poll pass, back off in process, and do not tighten the 5–15 minute cadence.
- A pass with no results does not write a success line. Non-empty work, errors, and 402/429 do.

## Hub runbook note

Copy this into the hub runbook. This PR does not edit a live hub runbook and does not change live systemd.

- Worker host: prefer the long-lived warm helper `node scripts/x-mention-dig-warm.mjs` (user service, `Type=simple`). Set `MENTION_DIG_INNER` to the one-shot dig program. Set `MENTION_DIG_COMMAND` to `node scripts/x-mention-dig-call.mjs`. The helper stays loaded and runs a dig only when that client is called, which is only after a claim. Digs stay one at a time. GitHub Actions does not run the dig.
- Timers stay on a 10 minute band inside 5–15 minutes. Poll `OnBootSec=5min`, worker `OnBootSec=8min` (about 3 minutes later). Both `OnUnitActiveSec=10min`. No interval under 5 minutes. Install the templates on the host; do not tighten them for 402/429.
- Mentions are leads, not cites. Fail closed. Do not invent cites. Do not publish `mention_queue`. Do not touch the parked database.
