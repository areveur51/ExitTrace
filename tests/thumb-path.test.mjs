import assert from "node:assert/strict";
import { test } from "node:test";
import { commsThumbKinds } from "../app/lib/kind-comms.mjs";
import * as thumb from "../app/lib/thumb.mjs";
import {
  THUMB_KIND_DIRS,
  THUMB_STEM_MAX,
  isThumbPathname,
  parseThumbRel,
} from "../app/lib/thumb-path.mjs";

test("THUMB_KIND_DIRS matches people, agencies and every comms media dir", () => {
  assert.deepEqual([...THUMB_KIND_DIRS], ["people", "agencies", ...commsThumbKinds()]);
});

test("thumb.mjs re-exports the shared parseThumbRel", () => {
  assert.equal(thumb.parseThumbRel, parseThumbRel);
  assert.equal(parseThumbRel("thumbs/people/X.HERO.WEBP")?.rel, "thumbs/people/X.hero.webp");
});

test("isThumbPathname: exact lowercase shape only", () => {
  assert.equal(THUMB_STEM_MAX, 200);
  for (const kind of THUMB_KIND_DIRS) {
    assert.equal(isThumbPathname(`/media/thumbs/${kind}/a-1.card2x.jpg`), true, kind);
  }
  assert.equal(isThumbPathname(`/media/thumbs/people/${"a".repeat(200)}.webp`), true);
  for (const p of [
    `/media/thumbs/people/${"a".repeat(201)}.webp`,
    "/media/thumbs/people/A.webp",
    "/media/thumbs/people/a.WEBP",
    "/media/thumbs/zzkind/a.webp",
    "/media/thumbs/people/a.webp;x",
    "/media/thumbs/people/%61.webp",
    "thumbs/people/a.webp",
    "",
    undefined,
    null,
    42,
  ]) {
    assert.equal(isThumbPathname(p), false, String(p).slice(0, 40));
  }
});
