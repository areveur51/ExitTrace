# Changelog

All notable user-facing changes to ExitTrace are documented in this file. Newest entries come first.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The source of truth is the `version` field in `package.json`. An app tag is `v` plus that version (`vX.Y.Z`). Data releases (`data-*` and `data-latest`) are not app versions.

## [Unreleased]

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