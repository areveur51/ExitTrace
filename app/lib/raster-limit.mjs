import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/** Uncompressed RGBA a PNG may expand to. Larger rasters are skipped. */
export const MAX_DECODE_RGBA_BYTES = 64 * 1024 * 1024;

/**
 * jpeg-js keeps coefficient blocks, scanlines, and an RGB copy besides the RGBA output.
 * A 4:4:4 frame accounts for about 5.5 times the RGBA size. 320 MB covers a 48 MB still
 * (about 264 MB accounted) and stays inside a 512 MB dyno.
 */
export const DECODE_MEMORY_MB = 320;
const DECODE_MEMORY_BYTES = DECODE_MEMORY_MB * 1024 * 1024;

function finiteSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  return { w, h };
}

export function rasterExceedsDecodeLimit(width, height) {
  const px = finiteSize(width, height);
  if (!px || px.w > 16000 || px.h > 16000) return true;
  return px.w * px.h * 4 > MAX_DECODE_RGBA_BYTES;
}

/** Worst-case jpeg-js accounting for a 4:4:4 frame. */
export function estimatedJpegDecodeBytes(width, height) {
  const px = finiteSize(width, height);
  if (!px) return Infinity;
  const blocksW = Math.ceil(px.w / 8);
  const blocksH = Math.ceil(px.h / 8);
  const coeffs = 3 * blocksW * blocksH * 256;
  const lines = 3 * (blocksW * 8) * blocksH * 8;
  return coeffs + lines + px.w * px.h * 3 + px.w * px.h * 4;
}

export function jpegExceedsDecodeLimit(width, height) {
  if (rasterExceedsDecodeLimit(width, height)) return true;
  return estimatedJpegDecodeBytes(width, height) > DECODE_MEMORY_BYTES;
}

/** SOF size, or null when the buffer is not a JPEG header we can read. */
export function jpegPixelSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    if (i + 4 > buf.length) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (len < 7) return null;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

export function pngPixelSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function stillKind(buf) {
  const png = pngPixelSize(buf);
  if (png) return { ...png, kind: "png" };
  const jpegSize = jpegPixelSize(buf);
  if (jpegSize) return { ...jpegSize, kind: "jpeg" };
  return null;
}

function kindExceedsDecodeLimit(size) {
  if (!size) return false;
  if (size.kind === "png") return rasterExceedsDecodeLimit(size.width, size.height);
  return jpegExceedsDecodeLimit(size.width, size.height);
}

/** True when a PNG or JPEG header names a raster we will not expand. */
export function stillExceedsDecodeLimit(buf) {
  return kindExceedsDecodeLimit(stillKind(buf));
}

/** One RGBA decode for thumbs and post screenshots. Null when the header is over the cap. */
export function decodeCappedRaster(buf) {
  if (!buf || buf.length < 24) return null;
  const size = stillKind(buf);
  if (!size || kindExceedsDecodeLimit(size)) return null;
  try {
    if (size.kind === "png") {
      const png = PNG.sync.read(buf);
      return { width: png.width, height: png.height, data: png.data };
    }
    return jpeg.decode(buf, {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: DECODE_MEMORY_MB,
    });
  } catch {
    return null;
  }
}
