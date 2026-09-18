#!/usr/bin/env node
/**
 * Derive list thumbs from stored stills. Writes only under media/thumbs/.
 * Never deletes or overwrites originals in media/people or media/dog-comms.
 *
 * Default list JPEG/WebP is 80×104 (2× of the 40×52 CSS box). A denser
 * 160×208 pair is also written for srcset. People get a ≥2× hero WebP
 * (and JPEG) for detail <picture> fallback. Dog detail keeps the gold still.
 *
 * The running app also builds a missing file on first request.
 * Does not fetch remote images. Run: npm run thumbs
 */
import path from "path";
import { fileURLToPath } from "url";
import { resolveRoot } from "../app/lib/env.mjs";
import { buildAllThumbs } from "../app/lib/thumb.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { mediaDir } = resolveRoot(ROOT);
const made = await buildAllThumbs(mediaDir);
console.log(`thumbs ${made.length} under ${path.join(mediaDir, "thumbs")}`);
