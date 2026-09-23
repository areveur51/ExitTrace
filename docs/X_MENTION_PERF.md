# X mention performance

Picard CLEAR ~6:16pm ET 2026-09-23 reinforces the Riker DESIGN LOCK ~2:05pm ET. Poller and worker only. `MENTION_DIG_COMMAND` stays a separate program. This note does not change dig rules.

`mention_queue` stays on the Render app database. It is not on `exittrace_lab_pub` and it is not gap-upserted. Place order, the performance stamp, and the hub runbook note are in [X_MENTION_QUEUE.md](X_MENTION_QUEUE.md).

## Pass behavior

- Soft-ack defaults off (`MENTION_SOFT_ACK` unset). When it is on, the fixed line `Queued for ExitTrace review.` is sent only when enqueue returns `created: true`. Duplicates are not soft-acked. Leave it off.
- A final reply is one plain-text confirmation to the first mentioner, and only when the dig status is `kept`. No URL and no media. Fail-closed, rejected, ambiguous, and dig failures stay silent. A later mention of that subject, or another KEEP that shares the slug, does not get a second final.
- A failed soft-ack or final reply does not stop the rest of the pass. A successful enqueue advances `since_id` even when the soft-ack fails. The unreplied sweep and the claim loop each continue after one reply failure.
- The worker uses one `GET /api/mention-queue/work` (`{ pending, unreplied }`). Zero pending rows means no claim and no dig. An empty unreplied list skips that final-reply sweep.
- Claim-next POSTs an empty `subject_status_id` (`SKIP LOCKED`) until `claimed: false`, at most 5 claims per pass. Digs run one at a time. No dig is spawned when nothing was claimed.
- The claim lease stays in the 10–15 minute band (default 12 minutes). The dig timeout is 9 minutes, under that lease.
- The poller POSTs `/api/mention-queue/preflight` before the mentions GET. An unreachable origin, an HTML challenge, or a 5xx skips that X GET and backs off inside the process. A JSON 401 is config fail-closed: one log line, no X call, no backoff sleep. The host timer stays on its band.
- Mentions are one GET with `since_id` and `max_results=10`. Author name comes from that expansion. There is no per-mention user lookup and no pagination. HTTP 402 and 429 stop that pass and back off inside the process. They do not issue a second mentions GET and they do not shorten the timer.
- A queue 401 is fail-closed for that pass: `since_id` does not advance and the pass is not a success. A 403 HTML challenge (Bot Fight, "Just a moment", `cf-mitigated`) or a 5xx backs off inside the process, does not advance `since_id`, and is not a successful enqueue.
- `since_id` advances only after an enqueue returns JSON `ok: true` with `created: true` or `duplicate: true`. The mentions GET alone does not move it. A failed soft-ack does not move it back.

## Warm helper

On the worker host, prefer a long-lived helper so the dig runtime is already up when a claim arrives. `node scripts/x-mention-dig-warm.mjs` stays running. `MENTION_DIG_INNER` is the one-shot dig program. `MENTION_DIG_COMMAND` is `node scripts/x-mention-dig-call.mjs`. The helper does not spawn a dig until the client sends a row, and the worker does not spawn the client until a claim succeeds. This PR does not install that service.

## Timers

Host units stay on a 10 minute band (`OnUnitActiveSec=10min`, inside 5–15 minutes, nothing under 5). The worker `OnBootSec` is 8 minutes, about 3 minutes after the poll `OnBootSec` of 5 minutes. Do not install a tighter interval from this note. Live host units change only when an operator installs the templates.

A pass with `results=0` does not write a success line to the journal. Non-empty work and errors do. A 402/429, a queue challenge, or a queue 5xx writes one `mention_poll backoff=` line. A skipped preflight or a 401 writes one line and leaves the timer alone.

## Ops checklist

- Cloudflare: skip Bot Fight and managed challenges for `/api/mention-queue` (the whole prefix). A 403 HTML page ("Just a moment") or a `cf-mitigated` response is not a successful enqueue.
- Soft-ack stays OFF (`MENTION_SOFT_ACK` unset). When it is on, the fixed line is sent only for `created: true`.
- Preflight: `POST /api/mention-queue/preflight` with the bot token runs before the X mentions GET. Unreachable, HTML challenge, and 5xx skip that X GET and back off. A JSON 401 logs fail-closed and does not call X.
- `since_id` advances only after enqueue JSON `ok: true` with `created: true` or `duplicate: true`. An X GET alone does not move it. A failed soft-ack does not undo it.
- `mention_queue` stays on the Render app database. It is not on `exittrace_lab_pub` and it is not gap-upserted.
