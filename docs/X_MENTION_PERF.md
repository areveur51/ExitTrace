# X mention performance

Picard CLEAR ~6:16pm ET 2026-09-23 reinforces the Riker DESIGN LOCK ~2:05pm ET. Poller and worker only. `MENTION_DIG_COMMAND` stays a separate program. This note does not change dig rules.

`mention_queue` stays on the Render app database. It is not on `exittrace_lab_pub` and it is not gap-upserted. Place order, the performance stamp, and the hub runbook note are in [X_MENTION_QUEUE.md](X_MENTION_QUEUE.md).

## Pass behavior

- Soft-ack defaults off (`MENTION_SOFT_ACK` unset). When it is on, the fixed line `Queued for ExitTrace review.` is sent only when enqueue returns `created: true`. Duplicates are not soft-acked.
- A failed soft-ack or final reply does not stop the rest of the pass. A successful enqueue advances `since_id` even when the soft-ack fails. The unreplied sweep and the claim loop each continue after one reply failure.
- The worker uses one `GET /api/mention-queue/work` (`{ pending, unreplied }`). Zero pending rows means no claim and no dig. An empty unreplied list skips that final-reply sweep.
- Claim-next POSTs an empty `subject_status_id` (`SKIP LOCKED`) until `claimed: false`, at most 5 claims per pass. Digs run one at a time. No dig is spawned when nothing was claimed.
- The claim lease stays in the 10–15 minute band (default 12 minutes). The dig timeout is 9 minutes, under that lease.
- Mentions are one GET with `since_id` and `max_results=10`. Author name comes from that expansion. There is no per-mention user lookup and no pagination. HTTP 402 and 429 stop that pass and back off inside the process. They do not issue a second mentions GET and they do not shorten the timer.

## Warm helper

On the worker host, prefer a long-lived helper so the dig runtime is already up when a claim arrives. `node scripts/x-mention-dig-warm.mjs` stays running. `MENTION_DIG_INNER` is the one-shot dig program. `MENTION_DIG_COMMAND` is `node scripts/x-mention-dig-call.mjs`. The helper does not spawn a dig until the client sends a row, and the worker does not spawn the client until a claim succeeds. This PR does not install that service.

## Timers

Host units stay on a 10 minute band (`OnUnitActiveSec=10min`, inside 5–15 minutes, nothing under 5). The worker `OnBootSec` is 8 minutes, about 3 minutes after the poll `OnBootSec` of 5 minutes. Do not install a tighter interval from this note. Live host units change only when an operator installs the templates.

A pass with `results=0` does not write a success line to the journal. Non-empty work and errors do. A 402/429 writes one `mention_poll backoff=` line.
