# Media

Portraits, dog-comm stills, and red-folder-comm stills stored on disk and served at `/media/`.

- Person photos come from Wikimedia Commons or official `.gov` works. Host process (`add-process` / `promote`) stores eligible stills under `media/people/`. The app does not invent a photo or overwrite an existing gold photo. A missing eligible still stays blank.
- Optional X-post screenshots live under `media/screenshots/{people|dog-comms|red-folder-comms|operations}/`. They are additive: a missing screenshot stays blank, and a stored portrait or still is never replaced. Corona comms use `people.screenshot`. Supporting shots for kind-comms use `media/screenshots/{dog-comms|red-folder-comms}/{id}/support/{n}/` when present; an empty field omits that tile.
- Dog-comm stills are used only when the image is freely licensed (typically a U.S. government work).
- Red-folder-comm stills live under `media/red-folder-comms/`. List thumbs are derived under `/media/thumbs/red-folder-comms/` the same way as dog comms. Detail keeps the gold still.
- List pages use derived stills under `/media/thumbs/people/`, `/media/thumbs/dog-comms/`, and `/media/thumbs/red-folder-comms/` (80×104 JPEG + WebP, plus a denser 160×208 srcset, painted at 40×52, `loading="lazy"`). Person detail, masonry, and lightbox use the gold `/media/people/` file (WebP source + JPEG fallback — never the list thumb). Dog and red-folder detail keep the full `/media/dog-comms/` or `/media/red-folder-comms/` still. Thumbs are built from the stored still; they are not a second catalog and are not fetched from X or news at view time. `npm run thumbs` rebuilds derived files under `media/thumbs/` only; it never deletes or overwrites originals in `media/people`, `media/dog-comms`, or `media/red-folder-comms`. A missing thumb is derived on first request.
- The running app does not fetch Wikimedia, X, or news sites. These files are local.

Attribution for each file is on the corresponding row in `data/seed.json`.
