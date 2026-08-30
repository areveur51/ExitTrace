/** Derived local list thumbs. Never fetch X, Wikimedia, or news at view time. */

import fs from "fs";
import path from "path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export const LIST_THUMB_CSS_W = 40;
export const LIST_THUMB_CSS_H = 52;
export const LIST_THUMB_PX_W = 80;
export const LIST_THUMB_PX_H = 104;
export const LIST_THUMB_QUALITY = 72;

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

/** Map a catalog still href to a local thumb href. External URLs are dropped. */
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
    sy = Math.max(0, Math.round((sh - ch) / 2));
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

export function renderListThumb(buf) {
  const decoded = decodeStill(buf);
  if (!decoded) return null;
  const resized = coverResize(decoded, LIST_THUMB_PX_W, LIST_THUMB_PX_H);
  if (!resized) return null;
  try {
    const encoded = jpeg.encode(resized, LIST_THUMB_QUALITY);
    return encoded?.data && encoded.data.length ? Buffer.from(encoded.data) : null;
  } catch {
    return null;
  }
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

/** Build or reuse a derived thumb on disk. Returns the thumb path, or null. */
export function ensureThumbFile(mediaDir, thumbRel) {
  if (!THUMB_REL.test(thumbRel)) return null;
  const root = path.resolve(mediaDir);
  const dest = path.resolve(root, thumbRel);
  if (dest === root || !dest.startsWith(root + path.sep)) return null;
  const src = findSourceFile(root, thumbRel);
  if (!src) return null;
  if (fs.existsSync(dest) && fs.statSync(dest).isFile()) {
    const dstStat = fs.statSync(dest);
    if (dstStat.size > 0 && dstStat.mtimeMs >= fs.statSync(src).mtimeMs) {
      return dest;
    }
  }
  const rendered = renderListThumb(fs.readFileSync(src));
  if (!rendered) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, rendered);
  fs.renameSync(tmp, dest);
  return dest;
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
      const dest = ensureThumbFile(root, rel);
      if (dest) made.push(rel);
    }
  }
  return made;
}
