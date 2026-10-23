# Cloudflare-only origin check

`exittrace.onrender.com` answers on the public internet. Host and `CF-*` headers can be forged on that direct path. This check also requires the proxy hop Render recorded to sit in Cloudflare's published address ranges.

The helper is `app/lib/cf-origin.mjs`. It runs at the top of `handle()` in `app/server.mjs`, before the rate limiter and before any body is read. Order: Cloudflare check, exemptions, rate limit, routes.

The ranges are vendored in `app/data/cloudflare-ips.json`. The app does not fetch them. `app/data` is not the file store (`DATA_DIR`, default `./data`) and it is not gitignored.

## Env

| Variable | Default | Meaning |
|---|---|---|
| `ET_CF_ONLY` | `off` | `off`, `report`, or `enforce`. Read on each request. Trimmed and lowercased. Anything else is `off`. |
| `ET_CF_HOSTS` | `exittrace.areveur.com` | Comma-separated hostnames, lowercase, no ports. The request `Host` is compared after the port is stripped. An IPv6 `Host` may use brackets. |
| `ET_CF_EXEMPT_PATHS` | `/health,/api/health` | Comma-separated exact paths. Blank keeps the default. |
| `ET_INTERNAL_BYPASS_TOKEN` | unset | GET and HEAD only. Header `X-ET-Internal` must match. Unset means no bypass. |
| `ET_CF_ORIGIN_SECRET` | unset | Dormant. When set, `X-ET-Origin-Auth` must also match. |
| `TRUSTED_PROXY_HOPS` | `0` | Which `X-Forwarded-For` entry is the hop. See below. |
| `ET_TRUST_CF_CONNECTING_IP` | on | Rate-limit switch from the per-IP limiter. `0`, `false`, `off`, `no` turn it off. |

Values stay on the host. Do not commit them. The two secrets are never logged, never written into `/api/health`, and never copied into an error body.

## Modes

- `off` (default): the check does not run. The rate limiter keeps its existing `ET_TRUST_CF_CONNECTING_IP` behavior.
- `report`: the request is still served. Each rejected request (not exempt) logs one line and increments `rejected_since_boot`.
- `enforce`: the same log and counter, then `403` with body `Forbidden\n` and `Content-Type: text/plain`. The body does not say which check failed.

Log line, one line, pathname only:

```
cf_only reject mode=<report|enforce> reason=<code> path=<pathname> hop=<ip|none>
```

The path has no query, control characters are removed, and it is capped at 200 characters. Headers and secrets are not logged.

`/api/health` and the `/health` payload always include:

```json
"cf_only": { "mode": "off", "rejected_since_boot": 0 }
```

`mode` is the current env. Exempt paths stay 200 in `enforce`.

## Reason codes

Checked in this order. The first failure wins.

| Code | Why |
|---|---|
| `host` | `Host` (port stripped, lowercased) is not in `ET_CF_HOSTS`. |
| `cf_ray` | `CF-Ray` is missing or blank. |
| `cf_ip` | `CF-Connecting-IP` is missing, blank, or not an IP. |
| `hop` | `TRUSTED_PROXY_HOPS` is 0, the `X-Forwarded-For` list is too short, the chosen entry is not an IP, or that IP is not in the vendored Cloudflare ranges. |
| `origin_auth` | `ET_CF_ORIGIN_SECRET` is set and `X-ET-Origin-Auth` does not match. |

Both sides of a secret compare are SHA-256 digested and then compared with `timingSafeEqual`, so the raw lengths are not compared.

## Hop

The hop is the same `xffHop` helper the rate limiter uses for client IP. It is the N-th `X-Forwarded-For` entry from the right, where N is `TRUSTED_PROXY_HOPS`. N = 1 is the rightmost entry. Entries further left are ignored. The list is still clipped to the last 1024 characters and the last 20 entries. The socket address is not a hop.

`TRUSTED_PROXY_HOPS` must be at least 1 for `enforce` to pass Cloudflare traffic on Render. The default 0 ignores `X-Forwarded-For`, so every non-exempt request fails with `hop`. Set N so the chosen entry is the Cloudflare address Render appended, not the original client. On a single proxy hop that is `1`: the rightmost address should be inside the vendored ranges. A larger N selects an entry further left and will reject real Cloudflare traffic if that entry is the visitor.

## Exemptions

Exemptions are evaluated only when the mode is `report` or `enforce`. An exempt request is served even when the Cloudflare checks fail. A request that passes the Cloudflare checks is not marked exempt.

| Traffic | Rule |
|---|---|
| Health | Path exactly matches `ET_CF_EXEMPT_PATHS`. Default `/health` and `/api/health`. |
| Mention queue | Path starts with `/api/mention-queue` and `mentionRole` returns a role. A missing, wrong, or misconfigured bearer is not exempt and goes through the Cloudflare check. `mentionRole` stays fail-closed unless `MENTION_QUEUE_BOT_TOKEN` and `MENTION_QUEUE_WORKER_TOKEN` are both set and different. |
| Internal reads | Method is GET or HEAD, `ET_INTERNAL_BYPASS_TOKEN` is set and non-empty after trim, and `X-ET-Internal` matches. POST and other methods are not exempt. |
| Static `/styles.css`, `/app.js` | Not exempt. |

Postgres logical replication and gap upsert do not speak HTTP to this process. They are not checked here and they are not blocked by this flag. The HTTP lab callers in this repo are the mention-queue poll (`POST /api/mention-queue/preflight`, `POST /api/mention-queue`, reply) with the bot bearer, and the mention-queue worker routes with the worker bearer. Health checks use the exempt paths. A verify read can go through `exittrace.areveur.com` or send the internal token on GET or HEAD. Any other direct caller needs one of those before `enforce`.

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

## Dormant secret

`ET_CF_ORIGIN_SECRET` ships unset. Turning it on needs a Cloudflare Transform Rule that injects `X-ET-Origin-Auth` on requests to the origin. That is a zone change and is out of scope for this check. Leave the variable unset until that rule exists. The code path is constant-time and stays quiet when the variable is empty.
