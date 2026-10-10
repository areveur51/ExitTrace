/** Where the picture sits inside a stored post screenshot. Fractions of the file. */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const boxCache = new Map();

function mediaRoot() {
  return path.resolve(process.env.MEDIA_DIR || path.join(ROOT_DIR, "media"));
}

function localMediaFile(href) {
  const text = String(href || "").trim().split(/[?#]/)[0];
  if (!text.startsWith("/media/") || text.includes("..") || text.includes("\\")) return "";
  const root = mediaRoot();
  const file = path.resolve(root, text.slice("/media/".length));
  if (file !== root && !file.startsWith(root + path.sep)) return "";
  return file;
}

function decodeMedia(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    try {
      const png = PNG.sync.read(buf);
      return { width: png.width, height: png.height, data: png.data };
    } catch {
      return null;
    }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    try {
      return jpeg.decode(buf, {
        useTArray: true,
        formatAsRGBA: true,
        maxMemoryUsageInMB: 512,
      });
    } catch {
      return null;
    }
  }
  return null;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * Largest bright block in a dark post screenshot.
 * Text rows stay out: a picture row is mostly non-black across the card.
 * Returns null when no block is tall enough to be the post media.
 */
export function mediaBoxFromRgba({ width, height, data }) {
  if (!width || !height || !data || data.length < width * height * 4) return null;
  const step = Math.max(1, Math.round(width / 300));
  const x0 = Math.floor(width * 0.08);
  const x1 = Math.max(x0 + 1, Math.ceil(width * 0.92));
  const rowCount = Math.ceil(height / step);
  const media = new Uint8Array(rowCount);
  for (let ry = 0; ry < rowCount; ry += 1) {
    const y = Math.min(height - 1, ry * step);
    let n = 0;
    let bright = 0;
    for (let x = x0; x < x1; x += step) {
      const i = (y * width + x) * 4;
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      n += 1;
      if (max > 28) bright += 1;
    }
    media[ry] = n > 0 && bright / n >= 0.5 ? 1 : 0;
  }
  const maxGap = Math.max(1, Math.round((height * 0.015) / step));
  let bestStart = -1;
  let bestEnd = -1;
  let i = 0;
  while (i < rowCount) {
    if (!media[i]) {
      i += 1;
      continue;
    }
    let end = i;
    let gap = 0;
    for (let j = i + 1; j < rowCount; j += 1) {
      if (media[j]) {
        end = j;
        gap = 0;
        continue;
      }
      gap += 1;
      if (gap > maxGap) break;
    }
    if (bestStart < 0 || end - i > bestEnd - bestStart) {
      bestStart = i;
      bestEnd = end;
    }
    i = end + 1;
  }
  const minSpan = Math.max(3, Math.round((height * 0.12) / step));
  if (bestStart < 0 || bestEnd - bestStart + 1 < minSpan) return null;
  const yTop = bestStart * step;
  const yBot = Math.min(height, (bestEnd + 1) * step);
  const yA = yTop + Math.floor((yBot - yTop) * 0.2);
  const yB = Math.max(yA + 1, yTop + Math.floor((yBot - yTop) * 0.8));
  let left = width;
  let right = 0;
  let samples = 0;
  for (let y = yA; y < yB; y += step) {
    let best = 0;
    let bestL = 0;
    let bestR = 0;
    let run = 0;
    let start = 0;
    for (let x = 0; x <= width; x += step) {
      const on = x < width && Math.max(data[(y * width + x) * 4], data[(y * width + x) * 4 + 1], data[(y * width + x) * 4 + 2]) > 28;
      if (on) {
        if (!run) start = x;
        run += step;
      } else if (run) {
        if (run > best) {
          best = run;
          bestL = start;
          bestR = x - step;
        }
        run = 0;
      }
    }
    // The long run is the picture. A hairline crop border is a separate short run.
    if (best >= width * 0.5) {
      if (bestL < left) left = bestL;
      if (bestR > right) right = bestR;
      samples += 1;
    }
  }
  if (!samples || right <= left) return null;
  const pad = step;
  const x = Math.max(0, (left - pad) / width);
  const y = Math.max(0, yTop / height);
  const w = Math.min(1 - x, (right + pad - (left - pad)) / width);
  const h = Math.min(1 - y, (yBot - yTop) / height);
  if (w < 0.4 || h < 0.12) return null;
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

/** Cached box for a local /media screenshot. Null when the file or the block is missing. */
export function findPostMediaBox(href) {
  const file = localMediaFile(href);
  if (!file) return null;
  let st;
  try {
    st = statSync(file);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size <= 0) return null;
  const key = `${file}\0${st.mtimeMs}\0${st.size}`;
  if (boxCache.has(key)) return boxCache.get(key);
  let box = null;
  try {
    const img = decodeMedia(readFileSync(file));
    if (img) box = mediaBoxFromRgba(img);
  } catch {
    box = null;
  }
  boxCache.set(key, box);
  return box;
}
