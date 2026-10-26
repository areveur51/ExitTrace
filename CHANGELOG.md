# Changelog

All notable user-facing changes to ExitTrace are documented in this file. Newest entries come first.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The source of truth is the `version` field in `package.json`. An app tag is `v` plus that version (`vX.Y.Z`). Data releases (`data-*` and `data-latest`) are not app versions.

## [Unreleased]

### Added

- App-side Cloudflare-only origin check (`ET_CF_ONLY` `off` | `report` | `enforce`, default `off`). On Render, `CF-Ray`, `CF-Connecting-IP`, and a Cloudflare `X-Forwarded-For` hop are on every request, so they are hygiene, not proof of the areveur.com zone. `Host` does the practical work. The hop only blocks traffic that never touched Cloudflare. `ET_CF_ORIGIN_SECRET` (an areveur-zone Transform Rule sets `X-ET-Origin-Auth`) is the real control and closes a direct onrender bypass. Report and enforce on Render use `TRUSTED_PROXY_HOPS=2` after `hop=` is confirmed in report. The default exempt path is `/health`. A set origin secret or internal bypass token must be at least 32 characters. Reject logs keep the first 10 lines per 60 seconds, then a count. Exempt paths, a valid mention-queue bearer, and a long enough GET/HEAD internal bypass still get a response. Rollback is `ET_CF_ONLY=off` and a Render restart, not a deploy. See `docs/CF_ONLY.md`.
- Per-IP process-local rate limits keyed by CF-Connecting-IP when `ET_TRUST_CF_CONNECTING_IP` is on (default), then rightmost X-Forwarded-For after `TRUSTED_PROXY_HOPS` (default 0). Live buckets stay under a 10000-key LRU cap (120/min global, 12/min `/search`, 5/min `POST /add`). Search queries are capped at 64 characters with one ILIKE escape, SQL `LIMIT 200`, a bounded search-slot queue, and statement/request timeouts so a slow search cannot wedge the pool.
- Fact tag Fraud (`/tags/fraud`). It records a stored fraud charge, plea, conviction, indictment or official fraud finding. It is not an identity filter and is separate from the Operations category `/group-operations/fraud`.

### Changed

- A recorded-no companion row in `person_events` is the newest-dated roll of that kind. The same date keeps the roll id that sorts later. The same roll keeps the first row. List SQL reads that `person_events.event_date`. A duplicate of any other kind still folds to the first event, so its companion row stays that event.
- Media stored on a recorded-no event stays on `people.events`. The card does not render it. It is not orphaned and must not be cleaned up.
- List pages share one results-controls bar: view, card size, pager, and rows per page. Wide screens use a single toolbar from 1200px; narrower widths use a two-row panel.

### Fixed

- List pages show the page status and the rows-per-page control once, inside the results bar. A compact previous / pages / next nav sits under the rows only when that list has more than one page.
- The results pager keeps previous, page numbers, and next on one line at phone width.
- A Trump nickname can also store the namer's own post and other accepted news cites as supporting sources; two official cites are still required.

### Removed

- Fact tag Federal investigation (`federal_investigation`). The site tracks final outcomes (arrests, deaths, resignations), not open investigations. `/tags/federal-investigation` now returns a 301 redirect to `/tags`, a new index of the remaining fact tags. Generic lab ops scripts `scripts/ops/et-retire-tag.mjs --tag <id>` (dry-run by default, lab loopback only) and `scripts/ops/et-retire-tag-undo.mjs` strip and restore a retired tag.

## [1.2.36] - 2026-10-26

### Added

- Every fact-tag page (`/tags/<slug>`) opens with a short general description above the list. Bill tags (One Big Beautiful Bill Act, SAVE Act, Secure the Border Act, Laken Riley Act, SAVE America Act, S. 5271, Transparency Act, Ukraine aid) say what the bill does and list its recorded votes with date and tally, plus two or three source links (congress.gov, clerk.house.gov or senate.gov, and a news outlet). The other tags get a one-line definition of what qualifies a card. All 17 descriptions live in one map, `TAG_DESCRIPTIONS` in `app/lib/tags.mjs`. Every roll is one entry in a single catalog, `ROLLS` in `app/lib/vote-rolls.mjs`; each entry's chamber, number and official URLs are derived from its roll id, and `VOTE_ROLLS` is the recorded-no view of it. Descriptions name rolls by id, so vote lines and roll-page links come from that catalog. Text and URLs are escaped. A source link is kept only when it is https on the default port with no credentials and its host is an exact `.gov` name (after IDN normalization, with no punycode labels) or an official news host; anything else is dropped.
- `/dashboard` has a "Roll calls · by party" panel. For every Congress vote tag (One Big Beautiful Bill Act, SAVE Act, Secure the Border Act, Laken Riley Act, SAVE America Act, S. 5271, Transparency Act, Ukraine aid, Harassment records) each roll call shows the official Yea, Nay, Present (when any) and Not voting counts for Democrats, Republicans and Independents, plus the roll total. Each roll links to its official clerk.house.gov or senate.gov page and is labeled final passage or procedural, as on the event rows. A separate line shows the number of ExitTrace cards on that roll (recorded-no tags) or tag (other vote tags). The panel is a plain table with no party colors and does not follow the dashboard range.
- Every `ROLLS` entry in `app/lib/vote-rolls.mjs` now carries the official party split (`party.D|R|I`, from the House Clerk roll XML `<totals-by-party>` or counted from the senate.gov roll-call page), the summed `totals`, the `source` page, `procedure` and `note`. The dashboard panel reads `ROLLS`: recorded-no rolls show under their own tag, and the untagged House rolls 289 (H.R. 4405), 151 (H.R. 8035) and 83 (H. Res. 1100, motion to refer) show under the tag that cites them. `VOTE_ROLLS` is still the recorded-no view. Card rendering, imports and the companion table are unchanged.
- Tag search under the home search bar. "+ Add tag" opens a filterable list of the 17 Tags-menu fact tags (the menu's short labels), each with the number of people on that tag's `/tags/<slug>` list. Match is All (default, every selected tag) or Any (at least one). Chips are removable, Clear empties them, and an "N people match" line updates as you pick. Tags only lists everyone with those tags; a keyword plus tags runs the keyword within that tag set; a keyword alone works as before. State is in the URL (`/search?tags=a,b&match=all`) and back/forward restores it. Without JS it is a plain GET form with checkboxes. Picking chips makes no request: the counts ship inline with the page, so only a search submit or page load counts against the `/search` limit. Unknown tag ids, and the `menu: false` Red folder tag, are dropped and the list is capped.
- An event can opt out of the card headline with `headline_exclude: true`. The event stays on the card and on its own kind's list, but the card's headline category and date stay pinned to the newest event without the flag, on every save and read. Only a literal `true` counts; without it nothing changes and the newest catalog event still drives the headline.
- `scripts/capture-profile-dir.mjs <case>` prints a private (0700) Chrome or Playwright profile directory outside the repo for dig captures (a fixed host base outside any checkout, or an absolute `ET_CAPTURE_PROFILE_DIR`). It refuses symlinks, any git work tree or git directory, and group or world writable or foreign-owned directories, and fails closed without git. See `docs/X_MENTION_QUEUE.md`.
- A person can hold several events of one kind: `notable` and `red_folder` repeat, keyed by `seq` (person_events primary key `(person_id, kind, seq)`). Every other kind stays one event per kind. The card headline is still the newest catalog event; `red_folder` never takes it. The migration has three steps under one write freeze, each with its own down (`scripts/migrations/2026-10-26-multi-event-{up,down}-{render-a,lab,render-b}.sql`): Render adds `seq` (additive), then lab swaps its key, then Render swaps its key; see `docs/MIGRATION.md`. A second event of a kind is refused until `ET_MULTI_EVENT_WRITES=on` (off by default) and this database has the new key (`multi_event_writes_off` / `multi_notable_needs_phase_b` / `multi_event_needs_migration`).
- Person pages show a Red Folder block for each `red_folder` event: its sentence, office line and media with captions, newest first, labeled "Red Folder" in the block and in the source list. Its media no longer fall into the generic supporting block.

### Changed

- The six recorded-no tag ledes (One Big Beautiful Bill Act, SAVE Act, Secure the Border Act, Laken Riley Act, SAVE America Act, S. 5271) now only say who is listed, for example "People who voted no on H.R. 22, the SAVE Act." The roll numbers, dates and tallies they used to repeat are in the description's "Recorded votes" line. The Harassment records lede and description take roll 83's number, date and tally from the catalog and now also say 9 not voting. Tag lists, slugs, and the menu are unchanged.
- Retire, never unlink: a daily ingest rerun moves the earlier run's report, apply.json, summary, digests, leads, prompt and logs to `retired/<stamp>-<pid>/<name>.<stamp>.rerun` instead of deleting them, through the shared `retire_path` in `scripts/lib/retire.sh` (dirs 0700, a symlinked ancestor is refused), and fails closed if a file cannot be moved. The daily prompt says no rm/shred/unlink. `exittracectl` already retires its pid file into `var/retired/` through the same helper. `retired/` is never pruned automatically: `scripts/et-retired-report.sh [dir]` lists its entries oldest first with age, file count and size and flags those older than `ET_RETIRED_KEEP_DAYS` (default 14); it changes nothing, and the operator moves old run dirs aside by hand.
- `.gitignore` has one `/scratch/` and one `/.worktrees/` rule in place of the per-request `scratch/...` lines. Tracked files under `scratch/` stay tracked; new files there need `git add -f`.

## [1.2.35] - 2026-10-26

### Changed

- Supporting media renders in one masonry everywhere: person-card event media, Notable, Shot, Central Casting clips on a card, and the comms Supporting media section (Dog, Red Folder, Eagle, Ronald, Shot). One helper, `supportingMediaHtml()` in `app/lib/html.mjs`, draws it and one CSS block ("Supporting media masonry") lays it out with CSS columns only, no JavaScript: 2 columns on a phone, 3 from 720px, 4 from 1280px, 1 column for a single image and 2 for two. Each image keeps its own height. Comms supporting entries now share that one masonry instead of one strip per entry; each tile keeps `data-supporting-index` (or `data-supporting-own="post"`). Central Casting clips on a person card use the shared supporting figure with a caption. Alt text, credits, links, lazy loading, the 24 stored / 8 shown caps, and list thumbnails are unchanged.

## [1.2.34] - 2026-10-26

### Fixed

- An event keeps every unique supporting media item it stores, up to a safety cap of 24 (`EVENT_MEDIA_STORE_MAX`). Boot, seed import, unique-people migration and promote/AMEND no longer drop items past the 8th. A card still shows the first 8 (`EVENT_MEDIA_DISPLAY_MAX`); the rest stay stored.

### Changed

- Red Folder, Eagle and Ronald comms use the same list as Dog comms. A post that names a person shows that person's card, other posts stay post rows, grouped by year. A comms page also lists people stored with its person tag once (today only Red folder is a person tag; Eagle and Ronald have none, so they show no tagged cards). `/tags/red-folder` shows the same list. Dog comms and every detail page are unchanged.
- One Red Folder menu entry, under Comms (`/red-folder-comms`). The Tags menu and `/tags` no longer list Red folder, `/tags/red-folder` is a 301 to `/red-folder-comms`, and the Red folder chip on a card links there. The stored `red_folder` tag is unchanged.

## [1.2.33] - 2026-10-26

### Added

- Red folder lists people stored with a red folder and stored red-folder posts. The tag page `/tags/red-folder` and the catalog `/red-folder-comms` show that same list. A post linked to a person shows that person. An unlinked post stays a post.

## [1.2.32] - 2026-10-25

### Fixed

- Numbered cites on person and card pages no longer overlap. In the Sources box and in per-event cite lists, numbers sit right-aligned in a fixed gutter (`4ch` wide, with a gap before the cite text), so 1-, 2- and 3-digit numbers line up and stay inside the box. The numbers come from `counter(list-item)`, so an `<ol start>` still numbers correctly. Long URLs, titles and outlet names wrap inside the box (`overflow-wrap: anywhere`), and a cite date no longer splits across lines. Inline `[n]` source pointers in event rows have fixed-width digits and even spacing. CSS only. The markup, numbering and data are unchanged.

## [1.2.31] - 2026-10-25

### Changed

- Every row in the right-side Tags menu fits on one line at 1280 and 1440 wide, in the 721–1100 rail, and on mobile. Two long names get a display-only short menu label: "One Big Beautiful Bill Act" shows as "Big Beautiful Bill" and "Secure the Border Act" as "Secure the Border", each with the full name as the chip's `title`. Menu labels are at most 18 characters (`TAG_MENU_MAX_LABEL`). Tag chips are `white-space: nowrap`, and in the rail (≥721px) use a slightly smaller font (0.94em). Tag ids, slugs, `nav` names, and the tag pages' own titles are unchanged. Background, header, and keymap keys are unchanged.
- `/api/health` `git_sha` on the lab now reports the checkout's HEAD sha. Public is unchanged: `RENDER_GIT_COMMIT` (then `SOURCE_VERSION`) still wins. When neither is set, the server reads HEAD once at boot from the `.git` files (a branch ref, a detached HEAD, `packed-refs`, or a worktree `.git` file), with no shell and no git binary, and caches it. If the checkout can't be read, `git_sha` is `null` and nothing throws. No new env vars.

## [1.2.30] - 2026-10-24

### Fixed

- Opening a tag page or two no longer returns `429 Too many requests`. A `/tags/...` page loads two thumbnails per person, and each one counted against the 120 requests per minute global limit. GET and HEAD requests for `/favicon.ico` and derived thumbnails (`/media/thumbs/<kind>/<stem>[.2x|.card|.card2x|.hero].jpg|webp`) now skip the rate limiter. The thumbnail match is exact on the raw URL pathname and shares its shape with the thumbnail server (`app/lib/thumb-path.mjs`): lowercase only, a known kind folder (people, agencies, or a comms kind), a name of at most 200 characters, no `%`, no dot segment, no extra slash or `;` parameter, and no other extension. Anything else, including a request with no method, is still counted. A POST, OPTIONS, or other non-read request to those paths is still counted. A thumbnail that could not be served (no source or a failed render) loses the exemption for 60 seconds, so repeat requests for it are counted. `/search` (12/min), `POST /add` (5/min), the global limit (120/min), and every other default are unchanged.

## [1.2.29] - 2026-10-24

### Changed

- A person result card shows the current cited role (`people.role`) as its position when that role and the event the card is about both name a U.S. congressional office, so a sitting Senator whose card event is a House vote reads "U.S. Senator …". A card event with no position also uses the role. Otherwise, and whenever the role is empty, the card keeps the event office as before. `personCardOffice` pairs that position with an organization: U.S. Senate for a current U.S. Senator role, U.S. House of Representatives for a current U.S. Representative role, and the stored event organization for anything else. Each event's own text and office line stay as stored, and the detail header is unchanged.

## [1.2.28] - 2026-10-24

### Added

- Fact tags for recorded no votes. The label is the bill short name. S. 5271 keeps the measure number because that bill has no short title on file. Each roll call is its own event (`roll_call` on `people.events[]`) and does not replace the stored category or date. Former and deceased members stay on the list. Paths: `/tags/one-big-beautiful-bill-act`, `/tags/save-act`, `/tags/secure-the-border-act`, `/tags/laken-riley-act`, `/tags/save-america-act`, `/tags/s-5271`.

## [1.2.27] - 2026-10-21

### Changed

- A failed RSS feed is logged and skipped. The daily ingest fails only when every feed fails.

### Fixed

- A daily run that starts with no outbound network waits about three minutes and retries the seed fetch.

## [1.2.26] - 2026-10-19

### Changed

- A celebrity death can be recorded without a portrait. The card shows the blank portrait. A later approved still fills that blank. Other new people still require a portrait.

## [1.2.25] - 2026-10-19

### Added

- Fact tag Former intel (`/tags/former-intel-agency-personnel`). It records stored former employment at a U.S. intelligence agency. It is not an identity filter.

## [1.2.24] - 2026-10-13

### Changed

- A person card opens with the name, a rectangular portrait, and origin, net worth, and tags. A blank origin stays blank. A missing net worth is an em dash (—). On a narrow screen the portrait stacks above the name.
- Events on a person card are commits on one gold line, oldest first. The date is on the left and the event name is a gold tag on the right. The note sits underneath at the width of the row. Age, position, and organization sit under a gold line. Nicknames, Shot, and undated events are on that line. Notable events, endorsements, harassment records, and Ukraine aid follow the other events.
- Each event points at its source numbers. The full link appears once, in Sources. A stored person screenshot stays in supporting media.
- A cite or net-worth source is a link only when its scheme is http or https.

## [1.2.23] - 2026-10-11

### Added

- Fact tag Ukraine aid (`/tags/ukraine-aid`). It records a stored yea on April 20, 2024, on H.R. 8035, the Ukraine Security Supplemental Appropriations Act, 2024. Roll Call 151 passed 311-112, with 1 present. The previous path `/tags/ukraine-aid-flags` redirects here.

### Changed

- On a person card, a stored H. Res. 1100 vote is titled H. Res. 1100. A stored H.R. 8035 vote is titled H.R. 8035.

## [1.2.22] - 2026-10-10

### Fixed

- A large video is hashed in small chunks, and a still that would expand past the decode budget is skipped.

## [1.2.21] - 2026-10-10

### Changed

- A dog comm linked to a person is that person's card, in the dog list and in search. The post is not its own card.
- A dog post with one image shows the screenshot. Further attachments are shown with it. A video plays inside the screenshot as that one tile.

## [1.2.20] - 2026-10-10

### Changed

- Dog, red folder, eagle, Ronald, and shot lists use the same 17 / 34 / 51 rows control as the other catalogs. Search stays at 10.
- View buttons show an icon with the label. Card size, previous and next page, and the rows control are icons.

## [1.2.19] - 2026-10-09

### Changed

- Fact-tag pages state the recorded fact.

## [1.2.18] - 2026-10-09

### Added

- Fact tag Harassment records (`/tags/harassment-records`). It records a stored yea on the March 4, 2026 motion to refer H. Res. 1100 (House Roll Call 83, 357-65, 1 present). That motion kept the House Ethics Committee from publicly releasing records of its sexual-harassment and clause 18 reviews. The tag is that recorded yea. It is not a finding of misconduct and not an identity filter.

## [1.2.17] - 2026-10-09

### Changed

- Portrait and hero images are smaller. List and detail portraits use cache key 7. The empty portrait file is smaller.
- Person, operation, and comms pages load their independent lookups together. Static images stream.

## [1.2.16] - 2026-10-09

### Added

- Person result cards show that person's position under the name. The line is the position on the event the card is about. When that event has no position, the line is the person's role. A blank position and a blank role omit the line.

### Changed

- Position and role titles use one spelling. Abbreviations are spelled out. U.S., (D), and (R) stay as written.

## [1.2.15] - 2026-10-08

### Added

- Catalog menus group person cards under the year of the event that menu is about. A fact tag uses that fact's date. A category list uses that category's event date. Another event on the same card does not set the year.
- A supporting media tile can show a short context line above its cite.

## [1.2.14] - 2026-10-08

### Added

- A person card with a stored dog comm shows a Dog comms chip. The chip links to the dog comm list. It does not replace the card category or date.

## [1.2.13] - 2026-10-08

### Added

- Fact tag Endorsements (`/tags/endorsements`). It records a stored endorsement from Donald Trump. It is not an identity filter.
- An Endorsement section on a person card shows that stored endorsement. It does not replace the card category or date.

### Changed

- The Shot catalog lists a card for each person a post names, and does not also list the post. When the post records who was named, the speaker is not given a card. Each named person has a Shot section with the summary and the citation. The post detail still shows the clip. Cards do not repeat the post media.

## [1.2.12] - 2026-10-07

### Added

- Fact tag Transparency Act (`/tags/transparency-act`). It records a stored vote against the Epstein Files Transparency Act, H.R. 4405, or against a House Rules Committee motion to consider that bill. The House passed the bill 427-1 on November 18, 2025. It is not a charge and not an identity filter.

## [1.2.11] - 2026-10-07

### Added

- Fact tag Epstein files (`/tags/epstein-files`). It records a stored claim from a Justice Department Epstein file. It is not a charge and not an identity filter.
- A notable event whose cite is a justice.gov Epstein file is titled Epstein Files. Other notable events stay Notable event.
- A nickname taken from the Wikipedia list of nicknames used by Donald Trump can be kept when that list is its only cite. Two official news cites replace the list cite.
- Official-post detail pages (Dog, Red Folder, Eagle, Ronald, Shot) list linked people from `snapshot.person_ids` as person cards between context and supporting media. The post is one shared supporting entry at the bottom. No schema change.
- Comms catalog Shot (`shot_comms`, `/shot-comms`, keymap `s`). Official posts about a shooting or assassination use the same clip catalog as Dog, Eagle, Red Folder, and Ronald: list, detail, stills under `media/shot-comms/`, and gap-upsert. It is not a person KEEP kind. No seed rows.
- Result lists can switch between the standing row list and a card grid (portrait, name, and the same key attributes). Card size is Small, Medium, or Large and applies only in card view. The choice is stored in localStorage (`exittrace-results-view`, `exittrace-card-size`) and restored before paint. Home, detail pages, and dashboard rank tables stay as they are.
- Person KEEP kind `notable` (Notable event). On the person card it is a bottom media block beside supporting media: X screenshot, downloaded post media, factual context, and cites. It is not an event-timeline row, not a catalog list, and not a keymap chip. No new table and no publication change.

### Changed

- The menu groups Dog, Red Folder, Eagle, Ronald, Boot, Corona, and Central Casting under a Comms section, set off the same way as Tags. Their links, routes, and shortcut keys are unchanged, and they no longer appear at the top level.

### Fixed

- Central-casting test fixtures are not written when `DATABASE_URL` is set. A direct run of that test file was loading the lab URL and attaching missing stills to James Comey's detail.
- A notable event on an existing card keeps that card's category. The notable block still sits on the person page.
- Card view packs result cards in a column masonry. Each image fills the card width and keeps its own height, so a seal or a wide still is not cropped. Small, Medium, and Large still set the column width. The row list stays the 40px thumb.

## [1.2.10] - 2026-10-05

### Added

- A person card shows supporting media in a square masonry at the bottom of the detail. Each caption is the cite link and its date. A click opens the file at its own aspect ratio. An unofficial social cite on an event stays the link and the date.

### Changed

- The Masks tag lede states that impersonation is part of what the tag records. The tag remains that stored claim. It is not a finding that a mask was used, and it is not an identity filter.

### Fixed

- Replaced portraits use cache key 6, so a file replaced at the same path is not served from key 5.

## [1.2.9] - 2026-10-05

### Added

- Fact tag Masks (`/tags/masks`). It records a stored mask or body-double claim. It is not a finding that a mask was used, and it is not an identity filter.

## [1.2.8] - 2026-10-03

### Added

- Operation cards show the official seal of the lead law-enforcement agency named on that operation. A department seal is used only when no law-enforcement agency is listed. An operation with no matching seal stays on the empty portrait.

## [1.2.7] - 2026-10-03

### Fixed

- Catalog pages no longer rebuild person events that are already prepared. Repeat loads of the home page, health counts, and the full people list reuse a short in-process snapshot. The counts themselves are unchanged.

## [1.2.6] - 2026-10-02

### Added

- The Tags menu includes Epstein Clients. That list is the people named on the Epstein flight log. The row has no hotkey.
- Gap-upsert sends a wide table in batches under Postgres's parameter limit, so the flight-log copy no longer stops the rest of the sync.

## [1.2.5] - 2026-09-30

### Added

- A stored comm video plays in the same popup as a still. The clip is the local file. The still is only the poster, and it is not shown again as its own image.

## [1.2.4] - 2026-09-30

### Fixed

- A Trump nickname with no other catalog entry uses the earliest day a cite reported it. Those rows no longer sit under Undated. A person who already has another dated entry keeps that date.

## [1.2.3] - 2026-09-30

### Fixed

- Public startup no longer replays the 2026-09-18 logical snapshot over the live catalog. That replay removed fact tags, so Trump nicknames on existing cards disappeared from the tag list. The logical subscription stays enabled.

## [1.2.2] - 2026-09-29

### Changed

- Fact tags sit in a Tags section of the catalog menu. Revoked clearances and Trump nicknames each open the list of people who store that tag. The rows have no hotkey. The home-page pills and the tag-list dropdown are gone.

## [1.2.1] - 2026-09-29

### Added

- Home page fact-tag pills under the search box. Revoked clearances and Trump nicknames each open the existing list of people who store that tag.

## [1.2.0] - 2026-09-23

### Added

- Epstein Flight Log (`epstein_flight_legs`) with person-detail section (hidden when empty). Lab→Render checklist B publication + gap-upsert.
- Corona PersonEventSection attrs: `notable_group`, `title_note`, `status` (`tested_positive` | `died` | `self_quarantine`). Died stays corona-only — no auto death KEEP.

### Changed

- Corona Notable pack under Admiral REVERT: Phase A annotate matches; Phase B USA+Politicians/MSM/Police after second-cite hunt; Phase C HOLD. Cite floor ≥2 restored. Soft-ack stays off.

## [1.1.7] - 2026-09-23

### Fixed

- Wide desktop (≥1400) density for the shared detailShell: kill left-clump and empty mid-gap before the hotkey rail. Detail frost centers as a readable column in the band left of the rail; prose stays ≤90ch. Rail stays right, dense, and fixed-width. Glass frost, gold schematic, and map/wireframe background are unchanged. Soft-ack stays off.

## [1.1.6] - 2026-09-23

### Changed

- X mention dig classifies and can KEEP a person, an operation, a dog comm, a corona comm, a red folder comm, and a central casting comm. Each one uses the existing gate for that surface. The KEEP screenshot is that surface's public detail page: `/people/{slug}` for a person, a corona comm, and central casting; `/operations/{slug}` for an operation; `/dog-comms/{id}` for a dog comm; `/red-folder-comms/{id}` for a red folder comm. A holiday or other non-subject stays fail-closed and silent. Soft-ack stays off.

## [1.1.5] - 2026-09-23

### Changed

- X mention dig classifies a subject as a person, an operation, or a dog comm and can KEEP each one under the existing gates. A holiday or other non-subject stays fail-closed and silent. The KEEP screenshot uses that kind's public detail page. Soft-ack stays off.

## [1.1.4] - 2026-09-23

### Changed

- X mention finals reply once, in plain words, to the first mentioner, and only when the dig status is kept. The reply also attaches a host screenshot of the public KEEP detail page. The text has no URL. Fail-closed, rejected, ambiguous, and dig failures stay silent. Soft-ack stays off.

## [1.1.3] - 2026-09-23

### Fixed

- X mention poller probes the Render queue before the mentions GET. Unreachable, HTML challenge, and 5xx skip that GET and back off. A JSON 401 is config fail-closed and does not call X. since_id advances only after a real enqueue ack, and not past an unenqueued mention. Soft-ack stays off.

## [1.1.2] - 2026-09-23

### Added

- Empty-portrait default placeholder. Used only when a portrait is missing. Does not overwrite a gold portrait.

## [1.1.1] - 2026-09-23

### Fixed

- X mention performance: non-blocking ack and reply, skip empty mentions, claim caps, and a quiet journal.

## [1.1.0] - 2026-09-23

Catch-up minor for user-visible surfaces already on main after the 1.0.0 freeze. Not a breaking release.

### Added

- Central Casting (`/central-casting`) lists unique-person cards. Detail cites and media match red-folder comms.
- Death* (`/deaths/unconfirmed`) records unconfirmed death claims and stays out of confirmed death counts.
- Unsealed sits inside the indictments filter dropdown.
- Cite hyperlinks show the full URL, from one shared helper.
- Person detail lists each tagged event in its own section, including Central Casting and Corona.
- @ExitTrace mentions are queued, dug, ingested as a lab lead, and replied.
- A kept mention can show “Requested via X by …” on the KEEP detail.
- Major-classification result rows share one portrait slot, so names line up with or without a photo.