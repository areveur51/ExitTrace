# ExitTrace live X screenshot recipe (standing fail-closed)

## Required before every shot
1. **FULL EXPAND** — `expandAllShowMore(page, article)` clicks every **Show more** (status, RT body, quoted) until none remain. **HARD FAIL** if any Show more still visible.
2. **FULL TIMESTAMP** — `proveNativeTimestamp(page, article)` requires expanded native datetime **in crop**: `H:MM AM/PM · Mon DD[, YYYY]` (or `<time>` text showing AM/PM). **Relative Mon DD alone is NOT enough** (timeline/RT cards). **HARD FAIL** with `timestamp_relative_only` / `timestamp_full_format_required`.
3. **RT → original fallback** — `ensureFullTimestampArticle` navigates to the embedded original `/status/ID` when the RT/timeline card lacks full datetime, then re-expands + re-proves. **Re-allowlist before `page.goto(alt)`:** only `/^https:\/\/(x|twitter)\.com\/[^/?#]+\/status\/\d+\/?$/i` — absolute off-site status links **HARD FAIL** (`embedded_status_url_not_allowlisted`).
4. **Dark + border-crop** — left grey column border, bottom cell line, top avatar side-equal inset, right follows content after tall-media tighten (no empty right gutter).

## API
- `forceXDarkTheme(page)`
- `expandAllShowMore(page, article)` → `{ok, clicks, remain}`
- `proveNativeTimestamp(page, article)` → `{ok, hasFull, dateNode, ...}`
- `ensureFullTimestampArticle(page, article, statusUrl)` → `{ok, article, navigated, url, timestamp}`
- `tightenTallMedia(page, article)`
- `screenshotArticlePadded(page, article, outPath, { statusUrl })` — expand + full-ts fail-closed (with RT fallback), then dark border-crop

## Commands
- Single: `DISPLAY=:2 ET_SS_MODE=border node capture-live-x.mjs <out.png> <status-url>`
- Batch: `DISPLAY=:2 ET_SS_MODE=border node batch-capture.mjs`

Live x.com only — no fxtwitter/vx, no ExitTrace cards. Dog / people / ops must use this helper forever.
