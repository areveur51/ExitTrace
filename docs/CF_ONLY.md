# Cloudflare-only origin check

`exittrace.onrender.com` answers on the public internet. On Render, `CF-Ray`, `CF-Connecting-IP`, and an `X-Forwarded-For` hop inside Cloudflare's ranges are present on every request, because Render's edge is Cloudflare. Those signals do not prove the request went through the areveur.com zone. `Host` does the practical work: it must be a configured name (default `exittrace.areveur.com`). The hop only blocks traffic that never touched Cloudflare. The real control is `ET_CF_ORIGIN_SECRET`, the header `X-ET-Origin-Auth` injected by an areveur-zone Cloudflare Transform Rule. That secret, with the Transform Rule, is the closure for a direct onrender bypass. The closure is not disabling the onrender hostname.

The helper is `app/lib/cf-origin.mjs`. It runs at the top of `handle()` in `app/server.mjs`, before the rate limiter and before any body is read. Order: Cloudflare check, exemptions, rate limit, routes.

The ranges are vendored in `app/data/cloudflare-ips.json`. The app does not fetch them. `app/data` is not the file store (`DATA_DIR`, default `./data`) and it is not gitignored.

## Env

| Variable | Default | Meaning |
|---|---|---|
| `ET_CF_ONLY` | `off` | `off`, `report`, or `enforce`. Read on each request. Trimmed and lowercased. Anything else is `off`. |
| `ET_CF_HOSTS` | `exittrace.areveur.com` | Comma-separated hostnames, lowercase, no ports. The request `Host` is compared after the port is stripped. An IPv6 `Host` may use brackets. |
| `ET_CF_EXEMPT_PATHS` | `/health` | Comma-separated exact paths. Blank keeps the default. Render's health check is `/health`. |
| `ET_INTERNAL_BYPASS_TOKEN` | unset | GET and HEAD only. Header `X-ET-Internal` must match. Unset means no bypass. When set, at least 32 characters after trim. A shorter value grants no bypass. |
| `ET_CF_ORIGIN_SECRET` | unset | The real control. When set, `X-ET-Origin-Auth` must match, and the value must be at least 32 characters after trim. A shorter value fails `origin_auth` and, in `report` or `enforce`, refuses to start. |
| `TRUSTED_PROXY_HOPS` | `0` | Which `X-Forwarded-For` entry is the hop. Report and enforce on Render use `2`. See below. |
| `ET_TRUST_CF_CONNECTING_IP` | on | Rate-limit switch from the per-IP limiter. `0`, `false`, `off`, `no` turn it off. |

Values stay on the host. Do not commit them. The two secrets are never logged, never written into `/api/health`, and never copied into an error body. A set secret shorter than 32 characters is a configuration error. The boot line names the variable only. It does not print the value, the length, or a hash.

## Modes

- `off` (default): the check does not run. The rate limiter keeps its existing `ET_TRUST_CF_CONNECTING_IP` behavior.
- `report`: the request is still served. Each rejected request (not exempt) increments `rejected_since_boot`. Logging is throttled the same way as `enforce`.
- `enforce`: the same counter and the same throttle, then `403` with body `Forbidden\n` and `Content-Type: text/plain`. The body does not say which check failed.

The first 10 rejects in a fixed 60 second window each log one line. The window starts at the first reject. Further rejects in that window are counted and not logged. The summary is lazy: there is no timer. When the first reject of a later window arrives, and the previous window suppressed K>0, this line is logged first:

```
cf_only reject_summary suppressed=<K> window_s=60
```

The summary has no path and no hop. A quiet process prints it on the next reject, not when the window ends.

Detail line, pathname only:

```
cf_only reject mode=<report|enforce> reason=<code> path=<pathname> hop=<cf-ip|masked|none>
```

`hop` is the address only when that address is inside the vendored Cloudflare ranges. Any other non-empty hop is `masked`. An empty hop is `none`. The path has no query, control characters are removed, and it is capped at 200 characters. Headers and secrets are not logged.

`/api/health` and the `/health` payload always include:

```json
"cf_only": { "mode": "off", "rejected_since_boot": 0 }
```

`mode` is the current env. Exempt paths stay 200 in `enforce`.

## Reason codes

Checked in this order. The first failure wins.

| Code | Why |
|---|---|
| `host` | Practical check. `Host` (port stripped, lowercased) is not in `ET_CF_HOSTS`. |
| `cf_ray` | Hygiene only, not proof. `CF-Ray` is missing or blank. On Render this header is on every request. |
| `cf_ip` | Hygiene only, not proof. `CF-Connecting-IP` is missing, blank, or not an IP. On Render this header is on every request. |
| `hop` | Not proof of the areveur.com zone. `TRUSTED_PROXY_HOPS` is 0, the `X-Forwarded-For` list is too short, the chosen entry is not an IP, or that IP is not in the vendored Cloudflare ranges. On Render a Cloudflare hop is on every request. The hop only blocks traffic that never touched Cloudflare. |
| `origin_auth` | The real control. `ET_CF_ORIGIN_SECRET` is set and `X-ET-Origin-Auth` does not match, or the secret is set but shorter than 32 characters. A short secret always fails. It is never treated as unset. |

Both sides of a secret compare are SHA-256 digested and then compared with `timingSafeEqual`, so the raw lengths are not compared.

## Hop

The hop is the same `xffHop` helper the rate limiter uses for client IP. It is the N-th `X-Forwarded-For` entry from the right, where N is `TRUSTED_PROXY_HOPS`. N = 1 is the rightmost entry. Entries further left are ignored. The list is still clipped to the last 1024 characters and the last 20 entries. The socket address is not a hop.

The hop is not proof that the request used the areveur.com zone. On Render every request already carries a Cloudflare hop, because Render's edge is Cloudflare. The hop only blocks traffic that never touched Cloudflare.

On Render's chain, counted from the right: 1 = Render load balancer, 2 = Cloudflare edge, 3 = client. Worf approved only `TRUSTED_PROXY_HOPS=2` for `report` and `enforce`.

| N | What it checks |
|---|---|
| 0 (default) | `X-Forwarded-For` is ignored. Every non-exempt request fails `hop`. |
| 1 | The Render load balancer address. That address is not in Cloudflare's ranges, so every request fails `hop` (fail closed). |
| 2 | The Cloudflare edge address. This is the only approved value for report and enforce. |
| 3 | The visitor's own IP. That is the wrong address, and it is PII. The reject line prints `hop=masked` for it. Do not use 3. |
| 4 or more | An entry the client chose. An attacker can put a Cloudflare address there. |

Confirm the areveur path depth from `hop=` values in `report` mode before `enforce`. With N = 2, a real areveur request logs a Cloudflare address. `hop=none` or `hop=masked` means the depth is wrong.

## Exemptions

Exemptions are evaluated only when the mode is `report` or `enforce`. An exempt request is served even when the Cloudflare checks fail. A request that passes the Cloudflare checks is not marked exempt.

| Traffic | Rule |
|---|---|
| Health | Path exactly matches `ET_CF_EXEMPT_PATHS`. Default is `/health` only, which is Render's health-check path. `/api/health` is not exempt. Monitors should read `/api/health` via `exittrace.areveur.com`. |
| Mention queue | Path starts with `/api/mention-queue` and `mentionRole` returns a role. A missing, wrong, or misconfigured bearer is not exempt and goes through the Cloudflare check. `mentionRole` stays fail-closed unless `MENTION_QUEUE_BOT_TOKEN` and `MENTION_QUEUE_WORKER_TOKEN` are both set and different. |
| Internal reads | Method is GET or HEAD, `ET_INTERNAL_BYPASS_TOKEN` is set, at least 32 characters after trim, and `X-ET-Internal` matches. A shorter token grants no bypass. POST and other methods are not exempt. |
| Static `/styles.css`, `/app.js` | Not exempt. |

Postgres logical replication and gap upsert do not speak HTTP to this process. They are not checked here and they are not blocked by this flag. The HTTP lab callers in this repo are the mention-queue poll (`POST /api/mention-queue/preflight`, `POST /api/mention-queue`, reply) with the bot bearer, and the mention-queue worker routes with the worker bearer. Render's health check uses `/health`. A monitor that wants the JSON body should read `/api/health` via `exittrace.areveur.com`. A verify read can go through `exittrace.areveur.com` or send a long enough internal token on GET or HEAD. Any other direct caller needs one of those before `enforce`.

## Rate limit key

When the mode is `off`, the limiter is unchanged: `CF-Connecting-IP` when `ET_TRUST_CF_CONNECTING_IP` is on, otherwise the XFF hop, otherwise the shared `unknown` bucket.

When the mode is `report` or `enforce`, the limiter trusts `CF-Connecting-IP` only if this request passed the Cloudflare check and `ET_TRUST_CF_CONNECTING_IP` is on. Exempt traffic and failed checks use the XFF hop or `unknown`. A forged `CF-Connecting-IP` on a direct request is not the key.

## Rollback

Set `ET_CF_ONLY=off` in the Render environment. Render restarts the service. That is not a build and not a deploy. Unset, blank, or any value other than `report` or `enforce` is also off.

## Refresh the ranges

1. Take the current lists from `https://www.cloudflare.com/ips-v4` and `https://www.cloudflare.com/ips-v6` (a normal developer machine, not the running app).
2. Replace `ipv4` and `ipv6` in `app/data/cloudflare-ips.json`. Keep the published order. Set `fetched` to that day.
3. If the lengths changed, update the count pin in `tests/cf-origin.test.mjs` (15 IPv4, 7 IPv6, 22 total as of 2026-10-23).
4. Ship it as a normal PR. There is no runtime fetch and no hot patch.

The file is a snapshot. Cloudflare can publish a range that is not in it yet. Until the file is updated, an edge address in a new range fails `hop` (fail closed). A proposed check, not enabled, is a weekly diff of `app/data/cloudflare-ips.json` against `https://www.cloudflare.com/ips-v4` and `https://www.cloudflare.com/ips-v6` on a developer machine. The running app does not fetch those lists.

## Dormant secret

`ET_CF_ORIGIN_SECRET` is the chosen closure for a direct onrender bypass. Render's edge is Cloudflare, so CF headers and a Cloudflare hop do not prove the request came through the areveur.com zone. The closure is this secret plus an areveur-zone Cloudflare Transform Rule that injects `X-ET-Origin-Auth` on requests to the origin. It is not closing the bypass by disabling the onrender hostname.

The variable can stay unset until that rule is in place. Unset means `origin_auth` is not required. The rollout runbook (the rule, the header, the secret on Render, report, then enforce) lives in the PR body.

When the variable is set, it must be at least 32 characters after trim. A shorter value fails closed: in `report` or `enforce` the process refuses to start, and a request fails `origin_auth` instead of treating the secret as unset. The compare is SHA-256 then `timingSafeEqual`. The value is never logged. `ET_INTERNAL_BYPASS_TOKEN` has the same length rule. In mode `off`, a short secret does not change request handling and does not refuse to start.
