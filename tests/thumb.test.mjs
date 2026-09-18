import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import jpeg from "jpeg-js";
import {
  HERO_PX_H,
  HERO_PX_W,
  LIST_THUMB_2X_H,
  LIST_THUMB_2X_W,
  LIST_THUMB_PX_H,
  LIST_THUMB_PX_W,
  PORTRAIT_CACHE,
  PORTRAIT_PX_H,
  PORTRAIT_PX_W,
  detailHeroHref,
  ensureThumbFile,
  goldMediaHref,
  isDogMediaHref,
  isThumbHref,
  listThumbHref,
  parseThumbRel,
  renderListThumb,
  renderPortraitJpeg,
  renderPortraitWebp,
  sourceRelCandidates,
  thumbHrefFor,
} from "../app/lib/thumb.mjs";

function solidJpeg({ width = 200, height = 260, r = 40, g = 80, b = 120 } = {}) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 80).data);
}

test("listThumbHref maps local stills and drops remote URLs", () => {
  assert.equal(
    listThumbHref("/media/people/james-comey.jpg"),
    "/media/thumbs/people/james-comey.jpg",
  );
  assert.equal(
    thumbHrefFor("/media/people/james-comey.jpg", { variant: ".2x", ext: "webp" }),
    "/media/thumbs/people/james-comey.2x.webp",
  );
  assert.equal(
    detailHeroHref("/media/people/james-comey.jpg"),
    "/media/thumbs/people/james-comey.hero.webp",
  );
  assert.equal(goldMediaHref("/media/people/james-comey.jpg"), "/media/people/james-comey.jpg");
  assert.equal(goldMediaHref("/media/thumbs/people/james-comey.jpg"), "");
  assert.equal(
    listThumbHref("/media/dog-comms/dod-k9-2020.jpg"),
    "/media/thumbs/dog-comms/dod-k9-2020.jpg",
  );
  assert.equal(
    listThumbHref("/media/thumbs/people/james-comey.jpg"),
    "/media/thumbs/people/james-comey.jpg",
  );
  assert.equal(listThumbHref(""), "");
  assert.equal(listThumbHref("https://upload.wikimedia.org/wikipedia/commons/x.jpg"), "");
  assert.equal(listThumbHref("https://x.com/foo/photo.jpg"), "");
  assert.equal(listThumbHref("/media/people/../secret.jpg"), "");
  assert.equal(listThumbHref("/media/people/nested/path.jpg"), "");
  assert.equal(isThumbHref("/media/thumbs/people/james-comey.jpg"), true);
  assert.equal(isThumbHref("/media/thumbs/people/james-comey.2x.webp"), true);
  assert.equal(isThumbHref("/media/thumbs/people/james-comey.hero.webp"), true);
  assert.equal(isThumbHref("/media/people/james-comey.jpg"), false);
  assert.equal(isDogMediaHref("/media/dog-comms/dod-k9-2020.jpg"), true);
  assert.equal(isDogMediaHref("/media/people/james-comey.jpg"), false);
  assert.equal(isDogMediaHref("/media/dog-comms/../people/x.jpg"), false);
  assert.deepEqual(sourceRelCandidates("thumbs/people/james-comey.jpg"), [
    "people/james-comey.jpg",
    "people/james-comey.jpeg",
    "people/james-comey.png",
    "people/james-comey.webp",
  ]);
  assert.deepEqual(sourceRelCandidates("thumbs/people/james-comey.2x.webp"), [
    "people/james-comey.jpg",
    "people/james-comey.jpeg",
    "people/james-comey.png",
    "people/james-comey.webp",
  ]);
  assert.equal(parseThumbRel("thumbs/people/james-comey.2x.jpg")?.stem, "james-comey");
  assert.equal(PORTRAIT_CACHE, "3");
});

test("renderPortraitJpeg writes a cover-cropped 80x104 list JPEG, not a 192 masonry hero", () => {
  const src = solidJpeg({ width: 240, height: 180 });
  const out = renderPortraitJpeg(src);
  assert.ok(out && out.length > 0);
  const decoded = jpeg.decode(out, { useTArray: true });
  assert.equal(decoded.width, PORTRAIT_PX_W);
  assert.equal(decoded.height, PORTRAIT_PX_H);
  assert.equal(decoded.width, LIST_THUMB_PX_W);
  assert.equal(decoded.height, LIST_THUMB_PX_H);
  assert.equal(decoded.width / decoded.height, 80 / 104);
  const alias = renderListThumb(src);
  assert.deepEqual(alias, out);
  const dense = renderPortraitJpeg(src, ".2x");
  const denseDecoded = jpeg.decode(dense, { useTArray: true });
  assert.equal(denseDecoded.width, LIST_THUMB_2X_W);
  assert.equal(denseDecoded.height, LIST_THUMB_2X_H);
});

test("renderPortraitWebp writes a RIFF WebP for list and hero variants", async () => {
  const src = solidJpeg({ width: 240, height: 300 });
  const webp = await renderPortraitWebp(src, "");
  assert.ok(webp && webp.length > 12);
  assert.equal(webp.toString("ascii", 0, 4), "RIFF");
  assert.equal(webp.toString("ascii", 8, 12), "WEBP");
  const hero = await renderPortraitWebp(src, ".hero");
  assert.ok(hero && hero.length > 12);
  assert.equal(hero.toString("ascii", 0, 4), "RIFF");
});

test("ensureThumbFile derives list, 2x, and hero files and refuses traversal", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exittrace-thumbs-"));
  try {
    fs.mkdirSync(path.join(dir, "people"));
    const src = path.join(dir, "people", "casey-vale.jpg");
    fs.writeFileSync(src, solidJpeg({ width: 500, height: 625 }));
    const dest = await ensureThumbFile(dir, "thumbs/people/casey-vale.jpg");
    assert.ok(dest);
    assert.ok(fs.existsSync(dest));
    const decoded = jpeg.decode(fs.readFileSync(dest), { useTArray: true });
    assert.equal(decoded.width, LIST_THUMB_PX_W);
    assert.equal(decoded.height, LIST_THUMB_PX_H);
    const dense = await ensureThumbFile(dir, "thumbs/people/casey-vale.2x.jpg");
    const denseDecoded = jpeg.decode(fs.readFileSync(dense), { useTArray: true });
    assert.equal(denseDecoded.width, LIST_THUMB_2X_W);
    assert.equal(denseDecoded.height, LIST_THUMB_2X_H);
    const hero = await ensureThumbFile(dir, "thumbs/people/casey-vale.hero.webp");
    assert.ok(hero);
    const heroBuf = fs.readFileSync(hero);
    assert.equal(heroBuf.toString("ascii", 0, 4), "RIFF");
    assert.equal(await ensureThumbFile(dir, "thumbs/people/../people/casey-vale.jpg"), null);
    assert.equal(await ensureThumbFile(dir, "thumbs/people/missing.jpg"), null);
    assert.ok(HERO_PX_W >= 2 * 192);
    assert.ok(HERO_PX_H >= 2 * 250);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("request-path reuse keeps an existing thumb instead of crashing on a huge source", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exittrace-thumbs-reuse-"));
  try {
    fs.mkdirSync(path.join(dir, "people"));
    fs.mkdirSync(path.join(dir, "thumbs", "people"), { recursive: true });
    const src = path.join(dir, "people", "casey-vale.jpg");
    const dest = path.join(dir, "thumbs", "people", "casey-vale.jpg");
    const small = solidJpeg({ width: 80, height: 104 });
    fs.writeFileSync(dest, small);
    const huge = Buffer.alloc(4 * 1024 * 1024 + 100);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    fs.writeFileSync(src, huge);
    const reused = await ensureThumbFile(dir, "thumbs/people/casey-vale.jpg");
    assert.equal(reused, dest);
    assert.equal(fs.readFileSync(dest).length, small.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
