import assert from "node:assert/strict";
import { test } from "node:test";
import jpeg from "jpeg-js";
import {
  PORTRAIT_MAX_BYTES,
  PORTRAIT_MAX_EDGE,
  compressPortraitBuffer,
} from "../app/lib/thumb.mjs";

function solidJpeg(width, height) {
  const data = Buffer.alloc(width * height * 4, 255);
  return Buffer.from(jpeg.encode({ data, width, height }, 90).data);
}

function noisyJpeg(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 17) % 256;
    data[i + 1] = (i * 31) % 256;
    data[i + 2] = (i * 13) % 256;
    data[i + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 100).data);
}

test("a small portrait is left unchanged", () => {
  const buf = solidJpeg(80, 100);
  assert.ok(buf.length < PORTRAIT_MAX_BYTES);
  assert.equal(compressPortraitBuffer(buf), null);
});

test("a portrait over the byte cap is stored as a smaller jpeg", () => {
  const buf = noisyJpeg(640, 800);
  assert.ok(buf.length > PORTRAIT_MAX_BYTES);
  const out = compressPortraitBuffer(buf);
  assert.ok(out);
  assert.ok(out.length < buf.length);
  assert.ok(out.length <= PORTRAIT_MAX_BYTES || out[0] === 0xff);
  const decoded = jpeg.decode(out, { useTArray: true });
  assert.ok(Math.max(decoded.width, decoded.height) <= PORTRAIT_MAX_EDGE);
});

test("a portrait wider than 1600px is scaled down", () => {
  const buf = solidJpeg(2000, 40);
  const out = compressPortraitBuffer(buf);
  assert.ok(out);
  const decoded = jpeg.decode(out, { useTArray: true });
  assert.ok(decoded.width <= PORTRAIT_MAX_EDGE);
  assert.ok(decoded.width < 2000);
});
