import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import jpeg from "jpeg-js";
import { hashFileBytes } from "../app/lib/html.mjs";
import {
  DECODE_MEMORY_MB,
  decodeCappedRaster,
  estimatedJpegDecodeBytes,
  jpegExceedsDecodeLimit,
  jpegPixelSize,
  rasterExceedsDecodeLimit,
  stillExceedsDecodeLimit,
} from "../app/lib/raster-limit.mjs";
import { ensureThumbFile } from "../app/lib/thumb.mjs";

function sofJpeg(width, height) {
  const buf = Buffer.alloc(20);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

test("a multi-thousand-pixel still stays under the decode cap", () => {
  assert.equal(rasterExceedsDecodeLimit(2800, 2200), false);
  assert.equal(rasterExceedsDecodeLimit(3072, 4096), false);
  assert.equal(rasterExceedsDecodeLimit(4883, 5474), true);
  const budget = DECODE_MEMORY_MB * 1024 * 1024;
  assert.ok(estimatedJpegDecodeBytes(2800, 2200) <= budget);
  assert.ok(estimatedJpegDecodeBytes(3072, 4096) <= budget);
  assert.equal(jpegExceedsDecodeLimit(2800, 2200), false);
  assert.equal(jpegExceedsDecodeLimit(3072, 4096), false);
  assert.equal(jpegExceedsDecodeLimit(4883, 5474), true);
  assert.equal(jpegExceedsDecodeLimit(5590, 4472), true);
  assert.equal(stillExceedsDecodeLimit(sofJpeg(3072, 4096)), false);
  assert.equal(stillExceedsDecodeLimit(sofJpeg(4883, 5474)), true);
});

test("thumbs and post screenshots share one capped decode", () => {
  const data = Buffer.alloc(8 * 8 * 4, 255);
  const buf = Buffer.from(jpeg.encode({ data, width: 8, height: 8 }, 80).data);
  const decoded = decodeCappedRaster(buf);
  assert.equal(decoded.width, 8);
  assert.equal(decoded.height, 8);
  assert.equal(decodeCappedRaster(sofJpeg(8000, 8000)), null);
});

test("a JPEG header that would expand past the cap is not decoded into a thumb", async () => {
  const size = jpegPixelSize(sofJpeg(8000, 8000));
  assert.equal(size.width, 8000);
  assert.equal(size.height, 8000);
  assert.equal(stillExceedsDecodeLimit(sofJpeg(8000, 8000)), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exittrace-raster-"));
  try {
    fs.mkdirSync(path.join(dir, "people"));
    fs.writeFileSync(path.join(dir, "people", "wide.jpg"), sofJpeg(8000, 8000));
    assert.equal(await ensureThumbFile(dir, "thumbs/people/wide.jpg"), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("chunked file hash matches one-shot sha256", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exittrace-hash-"));
  const file = path.join(dir, "blob.bin");
  const body = Buffer.alloc(200_000);
  for (let i = 0; i < body.length; i += 1) body[i] = i % 251;
  fs.writeFileSync(file, body);
  try {
    assert.equal(hashFileBytes(file), createHash("sha256").update(body).digest("hex"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
