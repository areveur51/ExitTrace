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

1. The poller POSTs `/api/mention-queue/preflight` with the bot token before it calls X. If that probe is unreachable, an HTML challenge, or 5xx, the pass skips the mentions API and backs off in process. A JSON 401 is config fail-closed: log it, do not call X, do not advance `since_id`. On a probe ack it reads mentions and resolves `subject_status_id`: a referenced post snowflake when one is present (quoted, then replied_to, then any other reference), otherwise the mention id. `since_id` does not move past a mention that was not enqueued.
2. It POSTs JSON to the Render queue with `Authorization: Bearer` `MENTION_QUEUE_BOT_TOKEN`. The same `subject_status_id` is idempotent. The first row wins. A later mention of that subject is a duplicate (no second dig). Soft-ack defaults off. When `MENTION_SOFT_ACK` is on, it is sent only for an enqueue with `created: true`. `since_id` advances only after that POST returns JSON `ok: true` with `created: true` or `duplicate: true`.
3. The worker GETs `/api/mention-queue/work` with `MENTION_QUEUE_WORKER_TOKEN`. That body is `{ pending, unreplied }`. Zero pending rows means no claim and no dig. An empty unreplied list skips the final-reply sweep. Claim-next POSTs an empty `subject_status_id` (`SKIP LOCKED`) until `claimed: false`, at most 5 claims per pass. The claim lease defaults to 12 minutes and is clamped to 10–15 minutes. The dig timeout is 9 minutes, under that lease.
4. The host dig command reads one mention JSON object on stdin and writes one JSON envelope on stdout. It does not receive queue tokens or X tokens. If it is unset, the worker refuses to claim.
5. `digMention` parks a lead with `source=x_mention` and empty cites. The dig classifies `subject_kind` as `person`, `operation`, `dog_comm` (add-request kind `dog`), `corona_comms` (add-request kind `person`, category `corona_comms`), `red_folder` (add-request kind `red_folder`, catalog `red_folder_comms`), or `central_casting_comms` (add-request kind `central_casting`). Person, operation, and corona comms still need at least two official cites that are not the mention or the subject status. A dog comm uses the existing official-government post gate. A red folder comm uses the existing official-government or news-org post gate. Neither post is put in `cite_urls`. Central casting annotates an existing person when the existing cite-standing gate is met and does not create a person. Otherwise the queue row becomes `fail_closed` or `rejected`. A holiday or other non-subject is `missing_subject`.
6. Complete sends only queue status fields (`subject_status_id`, `claim_owner`, `status`, `kept_person_slug`, `error_reason`). It does not insert a person.
7. Soft-ack, when enabled, is exactly `Queued for ExitTrace review.` Leave it off. A final reply is sent only when the dig status is `kept`, and only to the first mentioner for that subject (the row that won enqueue on `subject_status_id`). The text is `ExitTrace kept {name}.` using the person, operation, dog-comm, red-folder, or central-casting display name, or the slug as plain words. That text has no `http` or `https`. The worker host then screenshots the public KEEP detail page and attaches the PNG on the X reply (`media.media_ids`). The page is `EXITTRACE_PUBLIC_ORIGIN` plus `/people/{slug}` (person, corona comms, and central casting), `/operations/{slug}`, `/dog-comms/{id}`, or `/red-folder-comms/{id}`, served in the standing glass theme (the public dark chrome). The shot is not an X media download and is not a lab-auth, admin, localhost, or port 5220 session. Production capture opens that public https page. Tests may stub the browser. A local HTML file is not the source. `fail_closed`, `rejected`, `ambiguous_subject`, and dig failures get no reply. A later mention of the same subject is a duplicate and gets no second final. Another KEEP that shares the slug does not get a second final; later rows stay silent. A failed soft-ack or final reply does not stop the rest of the pass and does not change queue status. A successful enqueue ack (`ok: true` with `created: true` or `duplicate: true`) advances `since_id` even when the soft-ack fails. A mentions GET without that ack does not. A queue 401 does not advance `since_id`. A 403 HTML challenge or a 5xx backs off in process and does not advance `since_id`. The next worker pass retries unreplied KEEP rows that still owe that one final.

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

Values are milliseconds. Nothing in this band is under 5 minutes. Host timers in `ops/systemd/` use `OnUnitActiveSec=10min`. The poll `OnBootSec` is 5 minutes and the worker `OnBootSec` is 8 minutes, about 3 minutes later, so the passes stay staggered. HTTP 402 and 429 on X, an unreachable queue, a queue HTML challenge, or a queue 5xx stop that poll pass and back off inside the process. They do not shorten either timer. A JSON 401 logs fail-closed and does not call X. Copy the templates with `MENTION_INSTALL_PREFIX` set to the host checkout. This repo change does not edit live systemd:

```bash
MENTION_INSTALL_PREFIX=/path/to/ExitTrace node scripts/install-mention-units.mjs --out /tmp/mention-units
```

Set `WorkingDirectory` from that prefix on the host. Do not commit the filled units or the env file.

## Env names

Values are never stored in git. Admiral and Q place the names on the host env file and on the Render service.

Render app:

- `MENTION_QUEUE_BOT_TOKEN` — poller POST enqueue and soft-ack stamp only
- `MENTION_QUEUE_WORKER_TOKEN` — pending, claim, complete, final reply stamp only
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
- `MENTION_STATE_PATH` — durable host file for the since id. It must survive reboot. Do not put it on an ephemeral disk.
- `MENTION_INSTALL_PREFIX`

Worker host:

- `MENTION_QUEUE_URL`
- `MENTION_QUEUE_WORKER_TOKEN`
- `MENTION_WORKER_DATABASE` — set to `lab` or the worker will not write
- `DATABASE_URL` — lab database for `leadIngest` / `processAddRequest`
- `MENTION_DIG_COMMAND` — host dig program; not a GitHub Actions workflow. On the worker host prefer `node scripts/x-mention-dig-call.mjs` so the long-lived helper stays warm
- `MENTION_DIG_INNER` — one-shot dig program the warm helper runs after a call. Recommended plant value and path template are below.
- `MENTION_DIG_WARM_SOCKET` — host socket path for that helper
- `MENTION_CLAIM_OWNER`
- `MENTION_CLAIM_LEASE_MS`
- `MENTION_WORKER_POLL_MS`
- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`
- `X_USER_ID`
- `EXITTRACE_PUBLIC_ORIGIN` — public `https` origin for the KEEP page screenshot. Not the reply text.
- `MENTION_PAGE_SHOT_BIN` — optional chromium binary. Default is `chromium` or `google-chrome` on `PATH`.

X app keys for mentions and replies stay on that host. They are not Render env and they are not committed. The dig process does not receive them: the worker strips `MENTION_QUEUE_BOT_TOKEN`, `MENTION_QUEUE_WORKER_TOKEN`, `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` from the child environment. The KEEP screenshot runs in the worker after the public page returns the glass theme. It is not a lab session and it is not passed to the dig.

## Dig command

The worker spawns `MENTION_DIG_COMMAND` with `shell: true`. On the worker host that command is `node scripts/x-mention-dig-call.mjs`. `MENTION_DIG_INNER` is the one-shot dig. Stdin is one `mention_queue` JSON row (`subject_status_id`, `mention_status_id`, `subject_url`, `mention_url`, `author_handle`, `text`, `referenced_json`, `media_json`, and `author_display_name` when the row has it). Stdout is one JSON object. Exit 0 after that object, including fail-closed, so the worker can complete. A non-zero exit is `dig_failed` in the worker. The dig does not load `mention.env` and does not write KEEP rows to the lab or to Render. Soft-ack stays off unless `MENTION_SOFT_ACK` is set.

Recommended plant value for `MENTION_DIG_INNER` on the GrokBuild checkout:

```
/opt/GrokBuild/tools/node/bin/node /opt/GrokBuild/projects/ExitTrace/scripts/x-mention-dig.mjs
```

Path template using the GrokBuild node and `MENTION_INSTALL_PREFIX` (that checkout prefix is `/opt/GrokBuild/projects/ExitTrace`):

```
/opt/GrokBuild/tools/node/bin/node $MENTION_INSTALL_PREFIX/scripts/x-mention-dig.mjs
```

Optional wrapper `scripts/x-mention-dig.sh` execs `GROKBUILD_NODE` and `MENTION_INSTALL_PREFIX` and does not embed a second copy of the path. Do not commit the filled unit or `mention.env`.

The dig resolves the subject post from `subject_url`, then `subject_status_id`, and follows the quote/ref chain. A success envelope has `subject` and `subject_kind` (`person`, `operation`, `dog_comm`, `corona_comms`, `red_folder`, or `central_casting_comms`). Person, operation, and corona envelopes also have `cite_urls`. A dog-comm or red-folder envelope carries the official post as `source_url` and `posted_at` and does not list that URL as a cite. A central-casting envelope carries `cite_urls` plus that post as `source_url`. Optional fields the promote path already accepts may be present when the post text states them: `category`, `event_date`, `position`, `organization`, `reason`, `comments`, and for an operation the signed tag plus `agencies`. `event_date` is not copied from the post time. `author_display_name` is the mention submitter and is not the subject. Holidays and other text that is not one of those six surfaces fail closed.

Cites are official gov handles (including prior-POTUS), official news-org handles, `.gov` pages, and `OFFICIAL_NEWS_HOSTS` pages reached from the subject post or the chain. The mention URL and the subject status URL are removed. Fewer than two cites, or no single named subject, is fail-closed:

```
{ "outcome": "fail_closed", "error_reason": "cites_floor" }
```

`error_reason` is a short code such as `invalid_row`, `subject_unresolved`, `missing_subject`, `ambiguous_subject`, or `cites_floor`. Cites are not invented.

## Routes

| Method | Path | Token |
|--|--|--|
| `POST` | `/api/mention-queue/preflight` | bot |
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

- `POST /api/mention-queue/preflight` runs before the mentions GET. A failed probe does not call X.
- One mentions GET per poll, with `since_id` and `max_results=10`. Author fields ride that expansion. There is no per-mention user lookup.
- `MENTION_SOFT_ACK` defaults off. Soft-ack runs only when enqueue returns `created: true`.
- A failed soft-ack or final reply does not stop the pass. `since_id` advances only after enqueue JSON `ok: true` with `created: true` or `duplicate: true`, including when the soft-ack then fails. The mentions GET alone does not advance it. A queue 401 does not advance it. A 403 HTML challenge or a 5xx backs off in process and does not advance it. The unreplied sweep and the pending claim loop each continue after one reply failure.
- `GET /api/mention-queue/work` returns `{ pending, unreplied }`. Zero pending rows: no claim and no dig. Empty unreplied: skip that `deliverFinal` sweep.
- Claim-next uses an empty `subject_status_id` and `FOR UPDATE SKIP LOCKED` until `claimed: false`. Cap is 5 claims per pass. Lease is 10–15 minutes, default 12. Dig timeout is 9 minutes, under the lease. Digs are sequential. The worker does not spawn `MENTION_DIG_COMMAND` when nothing was claimed.
- HTTP 402 and 429 stop that poll pass, back off in process, and do not tighten the 5–15 minute cadence. A queue HTML 403 or 5xx does the same. A 401 is fail-closed for that pass with no `since_id` advance.
- A pass with no results does not write a success line. Non-empty work, errors, 402/429, queue challenges, and preflight skips do.

## Ops checklist

- CF Skip on `/api/mention-queue` (the whole prefix). Bot Fight must not answer the poll host with an HTML challenge.
- Bot and worker tokens differ: `MENTION_QUEUE_BOT_TOKEN` ≠ `MENTION_QUEUE_WORKER_TOKEN`. Unset or identical tokens fail closed.
- Soft-ack is `0` (`MENTION_SOFT_ACK` unset). Leave it off. Do not enable it.
- Final X reply (Riker DESIGN LOCK AMEND ~2026-09-23 7:11pm ET and Admiral CLEAR ~2026-09-23 7:28pm ET; person, operation, dog_comm, corona_comms, red_folder, central_casting_comms): only when dig status is `kept`. One reply to the first mentioner for that `subject_status_id`. Text is `ExitTrace kept {name}.` with that surface's display name, or the slug as plain words. No `http` or `https` in the text. The same post attaches a host screenshot of the public KEEP detail page (glass theme on `EXITTRACE_PUBLIC_ORIGIN` + `/people/{slug}` for a person, corona comms, and central casting, `/operations/{slug}`, `/dog-comms/{id}`, or `/red-folder-comms/{id}`). Not an X media download. Not lab-auth, admin, localhost, or port 5220. Not a local HTML file. No reply on `fail_closed`, `rejected`, `ambiguous_subject`, a holiday, or dig failure. No second final for a later mention of the same subject, and no second final when another KEEP shares the slug. Soft-ack stays off. Cite floors stay at two for person, operation, and corona comms. Dog, red folder, and central casting keep their existing gates.
- `MENTION_STATE_PATH` is a durable host file. The since id must still be there after a reboot.
- Warm dig helper: on the worker host run `node scripts/x-mention-dig-warm.mjs` and set `MENTION_DIG_COMMAND` to `node scripts/x-mention-dig-call.mjs`. Digs stay one at a time. This checklist does not change the dig program.
- Prove a queue 401 is JSON `{"ok":false,"error":"unauthorized"}`, not an HTML page. An HTML 401 is a challenge, not a token mismatch.

Out of this pass: turning soft-ack on, webhooks, parallel digs, publishing `mention_queue`, cite or attribution changes, and a poll interval under 5 minutes.

## Hub runbook note

Copy this into the hub runbook. This PR does not edit a live hub runbook and does not change live systemd.

- Cloudflare: skip Bot Fight and managed challenges for `/api/mention-queue`. Soft-ack stays OFF unless `MENTION_SOFT_ACK` is set. The poller preflights `POST /api/mention-queue/preflight` before the mentions GET. `since_id` moves only after enqueue JSON `ok: true` with `created: true` or `duplicate: true`.
- Worker host: prefer the long-lived warm helper `node scripts/x-mention-dig-warm.mjs` (user service, `Type=simple`). Set `MENTION_DIG_INNER` to the one-shot dig program. Set `MENTION_DIG_COMMAND` to `node scripts/x-mention-dig-call.mjs`. The helper stays loaded and runs a dig only when that client is called, which is only after a claim. Digs stay one at a time. GitHub Actions does not run the dig.
- Timers stay on a 10 minute band inside 5–15 minutes. Poll `OnBootSec=5min`, worker `OnBootSec=8min` (about 3 minutes later). Both `OnUnitActiveSec=10min`. No interval under 5 minutes. Install the templates on the host; do not tighten them for 402/429.
- Mentions are leads, not cites. Fail closed. Do not invent cites. Do not publish `mention_queue`. Do not touch the parked database.
- Final reply (Admiral CLEAR ~2026-09-23 7:28pm ET): `ExitTrace kept {name}.` plus a host screenshot of the public KEEP detail page, to the first mentioner only when the dig status is `kept` for a person, operation, dog comm, corona comm, red folder comm, or central casting comm. The text has no URL. The page is the public glass theme (dark chrome the world sees), not lab-auth, admin, localhost, or port 5220, and not an X post screenshot or a local HTML file. No reply on fail-closed, rejected, ambiguous, holiday, or dig failure. No second final for a later mention of that subject or another KEEP that shares the slug. Soft-ack stays off.
