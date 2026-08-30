import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { test } from "node:test";
import jpeg from "jpeg-js";
import {
  ensureThumbFile,
  isThumbHref,
  listThumbHref,
  renderListThumb,
  sourceRelCandidates,
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
  assert.equal(isThumbHref("/media/people/james-comey.jpg"), false);
  assert.deepEqual(sourceRelCandidates("thumbs/people/james-comey.jpg"), [
    "people/james-comey.jpg",
    "people/james-comey.jpeg",
    "people/james-comey.png",
    "people/james-comey.webp",
  ]);
});

test("renderListThumb writes a cover-cropped 80x104 JPEG", () => {
  const src = solidJpeg({ width: 240, height: 180 });
  const out = renderListThumb(src);
  assert.ok(out && out.length > 0);
  assert.ok(out.length < src.length);
  const decoded = jpeg.decode(out, { useTArray: true });
  assert.equal(decoded.width, 80);
  assert.equal(decoded.height, 104);
});

test("ensureThumbFile derives from a stored still and refuses traversal", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exittrace-thumbs-"));
  try {
    fs.mkdirSync(path.join(dir, "people"));
    const src = path.join(dir, "people", "casey-vale.jpg");
    fs.writeFileSync(src, solidJpeg({ width: 320, height: 400 }));
    const dest = ensureThumbFile(dir, "thumbs/people/casey-vale.jpg");
    assert.ok(dest);
    assert.ok(fs.existsSync(dest));
    assert.ok(fs.statSync(dest).size < fs.statSync(src).size);
    assert.equal(ensureThumbFile(dir, "thumbs/people/../people/casey-vale.jpg"), null);
    assert.equal(ensureThumbFile(dir, "thumbs/people/missing.jpg"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
