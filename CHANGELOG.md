# Changelog

All notable user-facing changes to ExitTrace are documented in this file. Newest entries come first.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The source of truth is the `version` field in `package.json`. An app tag is `v` plus that version (`vX.Y.Z`). Data releases (`data-*` and `data-latest`) are not app versions.

## [Unreleased]

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