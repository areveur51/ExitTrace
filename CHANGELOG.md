# Changelog

All notable user-facing changes to ExitTrace are documented in this file. Newest entries come first.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The source of truth is the `version` field in `package.json`. An app tag is `v` plus that version (`vX.Y.Z`). Data releases (`data-*` and `data-latest`) are not app versions.

## [Unreleased]

### Added

- Result lists can switch between the standing row list and a card grid (portrait, name, and the same key attributes). Card size is Small, Medium, or Large and applies only in card view. The choice is stored in localStorage (`exittrace-results-view`, `exittrace-card-size`) and restored before paint. Home, detail pages, and dashboard rank tables stay as they are.
- Person KEEP kind `notable` (Notable event). On the person card it is a bottom media block beside supporting media: X screenshot, downloaded post media, factual context, and cites. It is not an event-timeline row, not a catalog list, and not a keymap chip. No new table and no publication change.

### Changed

- The menu groups Dog, Red Folder, Eagle, Ronald, Boot, Corona, and Central Casting under a Comms section, set off the same way as Tags. Their links, routes, and shortcut keys are unchanged, and they no longer appear at the top level.

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