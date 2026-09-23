# X mention performance

Riker DESIGN LOCK CLEAR ~2:05pm ET 2026-09-23. Poller and worker only. `MENTION_DIG_COMMAND` stays a separate program. This note does not change that program.

`mention_queue` stays on the Render app database. It is not on `exittrace_lab_pub` and it is not gap-upserted. Place order and env names stay in [X_MENTION_QUEUE.md](X_MENTION_QUEUE.md).

## Pass behavior

- Soft-ack defaults off (`MENTION_SOFT_ACK` unset). When it is on, the fixed line `Queued for ExitTrace review.` is sent only for a newly created queue row. Duplicates are not soft-acked.
- A failed soft-ack or final reply does not stop the rest of the pass. A successful enqueue advances `since_id` even when the soft-ack fails.
- An empty pending list and an empty unreplied list do no claim, dig, or reply work.
- The worker claims with an empty `subject_status_id` (claim-next), at most 5 claims per pass. Digs run one at a time. No dig is spawned when nothing was claimed.
- The claim lease stays in the 10–15 minute band (default 12 minutes).
- Mentions are one GET with `since_id`. There is no pagination. HTTP 402 and 429 back off inside the process and retry that same GET. They do not shorten the timer.

## Timers

Host units stay on a 10 minute band (`OnUnitActiveSec=10min`, inside 5–15 minutes). The worker `OnBootSec` is 8 minutes, about 3 minutes after the poll `OnBootSec` of 5 minutes, so the passes stay staggered. Do not install a tighter interval from this note. Live host units change only when an operator installs the templates.

A pass with `results=0` does not write a success line to the journal. A 402/429 that is still failing after the in-process retries writes one `mention_poll backoff=` line.
