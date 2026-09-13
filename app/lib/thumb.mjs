/** Derived local list thumbs. Never fetch X, Wikimedia, or news at view time. */

import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export const LIST_THUMB_CSS_W = 40;
export const LIST_THUMB_CSS_H = 52;
/** One 10:13 cover crop for list thumbs and person detail. CSS only changes size. */
export const PORTRAIT_PX_W = 192;
export const PORTRAIT_PX_H = 250;
export const DETAIL_PORTRAIT_CSS_W = PORTRAIT_PX_W;
export const DETAIL_PORTRAIT_CSS_H = PORTRAIT_PX_H;
/** Cache-bust when the derived crop pipeline changes (immutable media URLs). */
export const PORTRAIT_CACHE = "2";

export function isDogMediaHref(raw) {
  const text = String(raw || "").trim();
  return text.startsWith("/media/dog-comms/") && !text.includes("..");
}
export const LIST_THUMB_PX_W = PORTRAIT_PX_W;
export const LIST_THUMB_PX_H = PORTRAIT_PX_H;
export const LIST_THUMB_QUALITY = 78;

const PEOPLE = "/media/people/";
const DOGS = "/media/dog-comms/";
const THUMBS = "/media/thumbs/";
const EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const THUMB_REL = /^thumbs\/(people|dog-comms)\/[a-z0-9][a-z0-9._-]*\.jpg$/i;
const TUI_BG = { r: 0x0d, g: 0x0d, b: 0x12 };

function stemOf(name) {
  return path.parse(path.basename(String(name || ""))).name;
}

function localLeaf(href, prefix) {
  const text = String(href || "").trim();
  if (!text.startsWith(prefix) || text.includes("..") || text.includes("\\")) {
    return "";
  }
  const leaf = text.slice(prefix.length);
  if (!leaf || leaf.includes("/")) return "";
  return leaf;
}

/** Map a catalog still href to the shared derived portrait href. External URLs are dropped. */
export function listThumbHref(src) {
  const text = String(src || "").trim();
  if (!text) return "";
  if (text.startsWith(THUMBS) && !text.includes("..")) {
    const rel = text.slice("/media/".length);
    return THUMB_REL.test(rel) ? text : "";
  }
  const person = localLeaf(text, PEOPLE);
  if (person) return `${THUMBS}people/${stemOf(person)}.jpg`;
  const dog = localLeaf(text, DOGS);
  if (dog) return `${THUMBS}dog-comms/${stemOf(dog)}.jpg`;
  return "";
}

export function isThumbHref(src) {
  const text = String(src || "").trim();
  return text.startsWith(THUMBS) && THUMB_REL.test(text.slice("/media/".length));
}

export function thumbRelFromHref(href) {
  const text = String(href || "").trim();
  if (!text.startsWith(THUMBS)) return "";
  const rel = text.slice("/media/".length);
  return THUMB_REL.test(rel) ? rel : "";
}

export function sourceRelCandidates(thumbRel) {
  if (!THUMB_REL.test(thumbRel)) return [];
  const parts = thumbRel.split("/");
  const kind = parts[1];
  const stem = stemOf(parts[2]);
  return EXTS.map((ext) => `${kind}/${stem}${ext}`);
}

function decodeStill(buf) {
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
      return jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    } catch {
      return null;
    }
  }
  return null;
}

/** Cover-crop to 10:13. Head-biased: extra height is taken from the bottom so faces stay. */
function coverResize(src, dw, dh) {
  const sw = src.width;
  const sh = src.height;
  if (!sw || !sh) return null;
  const srcAspect = sw / sh;
  const dstAspect = dw / dh;
  let cw;
  let ch;
  let sx;
  let sy;
  if (srcAspect > dstAspect) {
    ch = sh;
    cw = Math.max(1, Math.round(sh * dstAspect));
    sx = Math.max(0, Math.round((sw - cw) / 2));
    sy = 0;
  } else {
    cw = sw;
    ch = Math.max(1, Math.round(sw / dstAspect));
    sx = 0;
    const extraH = Math.max(0, sh - ch);
    sy = Math.max(0, Math.round(extraH * 0.18));
  }
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = sy + ((y + 0.5) * ch) / dh - 0.5;
    const y0 = Math.max(sy, Math.min(sy + ch - 1, Math.floor(fy)));
    const y1 = Math.max(sy, Math.min(sy + ch - 1, y0 + 1));
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = sx + ((x + 0.5) * cw) / dw - 0.5;
      const x0 = Math.max(sx, Math.min(sx + cw - 1, Math.floor(fx)));
      const x1 = Math.max(sx, Math.min(sx + cw - 1, x0 + 1));
      const wx = fx - x0;
      const i = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * sw + x0) * 4 + c];
        const p10 = src.data[(y0 * sw + x1) * 4 + c];
        const p01 = src.data[(y1 * sw + x0) * 4 + c];
        const p11 = src.data[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p10 - p00) * wx;
        const bot = p01 + (p11 - p01) * wx;
        out[i + c] = Math.max(0, Math.min(255, Math.round(top + (bot - top) * wy)));
      }
      const a = out[i + 3];
      if (a < 255) {
        const t = a / 255;
        out[i] = Math.round(out[i] * t + TUI_BG.r * (1 - t));
        out[i + 1] = Math.round(out[i + 1] * t + TUI_BG.g * (1 - t));
        out[i + 2] = Math.round(out[i + 2] * t + TUI_BG.b * (1 - t));
        out[i + 3] = 255;
      }
    }
  }
  return { width: dw, height: dh, data: out };
}

export function renderPortraitJpeg(buf) {
  const decoded = decodeStill(buf);
  if (!decoded) return null;
  const resized = coverResize(decoded, PORTRAIT_PX_W, PORTRAIT_PX_H);
  if (!resized) return null;
  try {
    const encoded = jpeg.encode(resized, LIST_THUMB_QUALITY);
    return encoded?.data && encoded.data.length ? Buffer.from(encoded.data) : null;
  } catch {
    return null;
  }
}

/** Alias of renderPortraitJpeg so list and detail stay on one crop. */
export function renderListThumb(buf) {
  return renderPortraitJpeg(buf);
}

const MAX_SRC_BYTES = 4 * 1024 * 1024;
let rebuildBusy = false;

function jpegSofSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function jpegMatchesPortraitSize(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const size = jpegSofSize(buf.subarray(0, n));
    return !!(size && size.width === PORTRAIT_PX_W && size.height === PORTRAIT_PX_H);
  } catch {
    return false;
  }
}

function destIfUsable(dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).isFile() && fs.statSync(dest).size > 0) {
    return dest;
  }
  return null;
}

function findSourceFile(mediaDir, thumbRel) {
  const root = path.resolve(mediaDir);
  for (const rel of sourceRelCandidates(thumbRel)) {
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0) {
      return file;
    }
  }
  return null;
}

/** Build or reuse a derived thumb on disk. Returns the thumb path, or null.
 *  Request path never rebuilds in parallel and never decodes huge sources (avoids 502/OOM).
 */
export function ensureThumbFile(mediaDir, thumbRel, { upgrade = false } = {}) {
  if (!THUMB_REL.test(thumbRel)) return null;
  const root = path.resolve(mediaDir);
  const dest = path.resolve(root, thumbRel);
  if (dest === root || !dest.startsWith(root + path.sep)) return null;
  const src = findSourceFile(root, thumbRel);
  if (!src) return destIfUsable(dest);
  const existing = destIfUsable(dest);
  const srcStat = fs.statSync(src);
  const fresh = existing && fs.statSync(existing).mtimeMs >= srcStat.mtimeMs;
  if (existing && fresh && jpegMatchesPortraitSize(existing)) return existing;
  if (existing && !upgrade) {
    if (rebuildBusy || srcStat.size > MAX_SRC_BYTES) return existing;
  }
  if (!existing && srcStat.size > MAX_SRC_BYTES) return null;
  if (rebuildBusy && !upgrade) return existing;
  rebuildBusy = true;
  try {
    const rendered = renderPortraitJpeg(fs.readFileSync(src));
    if (!rendered) return existing;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, rendered);
    fs.renameSync(tmp, dest);
    return dest;
  } catch {
    return existing;
  } finally {
    rebuildBusy = false;
  }
}

export function buildAllThumbs(mediaDir) {
  const root = path.resolve(mediaDir);
  const made = [];
  for (const kind of ["people", "dog-comms"]) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!EXTS.includes(path.extname(name).toLowerCase())) continue;
      const rel = `thumbs/${kind}/${stemOf(name)}.jpg`;
      const dest = ensureThumbFile(root, rel, { upgrade: true });
      if (dest) made.push(rel);
    }
  }
  return made;
}
