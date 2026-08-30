# Media

Portraits and dog-comm stills stored on disk and served at `/media/`.

- Person photos come from Wikimedia Commons or official `.gov` works. Host process (`add-process` / `promote`) stores eligible stills under `media/people/`. The app does not invent a photo or overwrite an existing gold photo. A missing eligible still stays blank.
- Dog-comm stills are used only when the image is freely licensed (typically a U.S. government work).
- List pages use derived stills under `/media/thumbs/people/` and `/media/thumbs/dog-comms/` (80×104 JPEG, painted at 40×52). Detail pages keep the full local file. Thumbs are built from the stored still; they are not a second catalog and are not fetched from X or news at view time. `npm run thumbs` rebuilds them; a missing thumb is derived on first request.
- The running app does not fetch Wikimedia, X, or news sites. These files are local.

Attribution for each file is on the corresponding row in `data/seed.json`.
