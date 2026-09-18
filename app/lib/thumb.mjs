/** Derived local list thumbs. Never fetch X, Wikimedia, or news at view time.
 *  Never writes into media/people or media/dog-comms. Never deletes originals.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { simd } from "wasm-feature-detect";

export const LIST_THUMB_CSS_W = 40;
export const LIST_THUMB_CSS_H = 52;
/** Default list bitmap is 2× the 40×52 CSS box (documented 80×104). */
export const LIST_THUMB_PX_W = 80;
export const LIST_THUMB_PX_H = 104;
/** Denser srcset density (4× CSS). */
export const LIST_THUMB_2X_W = 160;
export const LIST_THUMB_2X_H = 208;
/** ≥2× the 192×250 detail CSS box — never the 80×104 / old 192 list thumb. */
export const HERO_PX_W = 384;
export const HERO_PX_H = 500;
export const PORTRAIT_PX_W = LIST_THUMB_PX_W;
export const PORTRAIT_PX_H = LIST_THUMB_PX_H;
export const DETAIL_PORTRAIT_CSS_W = 192;
export const DETAIL_PORTRAIT_CSS_H = 250;
/** Cache-bust when the derived crop pipeline changes (immutable media URLs). */
export const PORTRAIT_CACHE = "3";
export const LIST_THUMB_QUALITY = 78;
export const LIST_THUMB_WEBP_QUALITY = 78;

export function isDogMediaHref(raw) {
  const text = String(raw || "").trim();
  return text.startsWith("/media/dog-comms/") && !text.includes("..");
}

const PEOPLE = "/media/people/";
const DOGS = "/media/dog-comms/";
const THUMBS = "/media/thumbs/";
const EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const THUMB_REL =
  /^thumbs\/(people|dog-comms)\/([a-z0-9][a-z0-9_-]*)(\.(?:2x|hero))?\.(jpg|webp)$/i;
const VARIANT_SIZE = {
  "": { w: LIST_THUMB_PX_W, h: LIST_THUMB_PX_H },
  ".2x": { w: LIST_THUMB_2X_W, h: LIST_THUMB_2X_H },
  ".hero": { w: HERO_PX_W, h: HERO_PX_H },
};
const TUI_BG = { r: 0x0d, g: 0x0d, b: 0x12 };
const require = createRequire(import.meta.url);

function stemOf(name) {
  return path.parse(path.basename(String(name || ""))).name;
}

export function parseThumbRel(thumbRel) {
  const m = String(thumbRel || "").match(THUMB_REL);
  if (!m) return null;
  const kind = m[1];
  const stem = m[2];
  const variant = (m[3] || "").toLowerCase();
  const ext = m[4].toLowerCase();
  return {
    kind,
    stem,
    variant,
    ext,
    rel: `thumbs/${kind}/${stem}${variant}.${ext}`,
  };
}

export function variantSize(variant) {
  return VARIANT_SIZE[String(variant || "").toLowerCase()] || VARIANT_SIZE[""];
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

function catalogKind(src) {
  const text = String(src || "").trim();
  if (!text) return null;
  if (text.startsWith(THUMBS) && !text.includes("..")) {
    const parsed = parseThumbRel(text.slice("/media/".length));
    return parsed ? { kind: parsed.kind, stem: parsed.stem } : null;
  }
  const person = localLeaf(text, PEOPLE);
  if (person) return { kind: "people", stem: stemOf(person) };
  const dog = localLeaf(text, DOGS);
  if (dog) return { kind: "dog-comms", stem: stemOf(dog) };
  return null;
}

/** Map a catalog still href to a derived thumb href. External URLs are dropped. */
export function thumbHrefFor(src, { variant = "", ext = "jpg" } = {}) {
  const cat = catalogKind(src);
  if (!cat) return "";
  const suffix = String(variant || "").toLowerCase();
  const format = String(ext || "jpg").toLowerCase().replace(/^\./, "");
  if (suffix && suffix !== ".2x" && suffix !== ".hero") return "";
  if (format !== "jpg" && format !== "webp") return "";
  return `${THUMBS}${cat.kind}/${cat.stem}${suffix}.${format}`;
}

/** Default list JPEG (80×104). */
export function listThumbHref(src) {
  return thumbHrefFor(src, { variant: "", ext: "jpg" });
}

export function isThumbHref(src) {
  const text = String(src || "").trim();
  return text.startsWith(THUMBS) && !!parseThumbRel(text.slice("/media/".length));
}

export function thumbRelFromHref(href) {
  const text = String(href || "").trim();
  if (!text.startsWith(THUMBS)) return "";
  const parsed = parseThumbRel(text.slice("/media/".length));
  return parsed ? parsed.rel : "";
}

export function sourceRelCandidates(thumbRel) {
  const parsed = parseThumbRel(thumbRel);
  if (!parsed) return [];
  return EXTS.map((ext) => `${parsed.kind}/${parsed.stem}${ext}`);
}

/** Gold catalog still for people / dog-comms. Empty when the href is not local media. */
export function goldMediaHref(src) {
  const text = String(src || "").trim();
  if (localLeaf(text, PEOPLE) || isDogMediaHref(text)) return text;
  return "";
}

export function detailHeroHref(src, ext = "webp") {
  return thumbHrefFor(src, { variant: ".hero", ext });
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

function bilinearResize(src, dw, dh, crop) {
  const sw = src.width;
  const sh = src.height;
  if (!sw || !sh || !dw || !dh) return null;
  const sx = crop?.sx ?? 0;
  const sy = crop?.sy ?? 0;
  const cw = crop?.cw ?? sw;
  const ch = crop?.ch ?? sh;
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
  return bilinearResize(src, dw, dh, { sx, sy, cw, ch });
}

/** Keep gold composition. Downscale only when a side exceeds maxEdge. */
function heroFrame(src) {
  const maxEdge = 1600;
  const m = Math.max(src.width, src.height);
  if (m <= maxEdge) return src;
  const scale = maxEdge / m;
  return bilinearResize(
    src,
    Math.max(1, Math.round(src.width * scale)),
    Math.max(1, Math.round(src.height * scale)),
  );
}

function frameForVariant(decoded, variant) {
  if (variant === ".hero") return heroFrame(decoded);
  const { w, h } = variantSize(variant);
  return coverResize(decoded, w, h);
}

export function renderPortraitJpeg(buf, variant = "") {
  const decoded = decodeStill(buf);
  if (!decoded) return null;
  const resized = frameForVariant(decoded, variant);
  if (!resized) return null;
  try {
    const encoded = jpeg.encode(resized, LIST_THUMB_QUALITY);
    return encoded?.data && encoded.data.length ? Buffer.from(encoded.data) : null;
  } catch {
    return null;
  }
}

/** Alias of the default list crop. */
export function renderListThumb(buf) {
  return renderPortraitJpeg(buf, "");
}

let webpEncodePromise = null;

async function webpEncoder() {
  if (!webpEncodePromise) {
    webpEncodePromise = (async () => {
      const encodeMod = await import("@jsquash/webp/encode.js");
      const useSimd = await simd();
      const wasmRel = useSimd
        ? "@jsquash/webp/codec/enc/webp_enc_simd.wasm"
        : "@jsquash/webp/codec/enc/webp_enc.wasm";
      const compiled = await WebAssembly.compile(await readFile(require.resolve(wasmRel)));
      await encodeMod.init(compiled);
      return encodeMod.default;
    })();
  }
  return webpEncodePromise;
}

export async function renderPortraitWebp(buf, variant = "") {
  const decoded = decodeStill(buf);
  if (!decoded) return null;
  const resized = frameForVariant(decoded, variant);
  if (!resized) return null;
  try {
    const encode = await webpEncoder();
    const data = resized.data instanceof Uint8ClampedArray
      ? resized.data
      : new Uint8ClampedArray(resized.data);
    const encoded = await encode(
      { data, width: resized.width, height: resized.height },
      { quality: LIST_THUMB_WEBP_QUALITY },
    );
    return encoded && encoded.byteLength ? Buffer.from(encoded) : null;
  } catch {
    return null;
  }
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

function isWebpRiff(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(12);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return n >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  } catch {
    return false;
  }
}

function jpegMatchesSize(file, w, h) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const size = jpegSofSize(buf.subarray(0, n));
    return !!(size && size.width === w && size.height === h);
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

function existingMatches(dest, parsed) {
  const existing = destIfUsable(dest);
  if (!existing) return null;
  if (parsed.ext === "webp") return isWebpRiff(existing) ? existing : null;
  if (parsed.variant === ".hero") return existing;
  const { w, h } = variantSize(parsed.variant);
  return jpegMatchesSize(existing, w, h) ? existing : null;
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

function atomicWrite(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
}

/** Build or reuse a derived thumb on disk. Returns the thumb path, or null.
 *  Request path never rebuilds in parallel and never decodes huge sources (avoids 502/OOM).
 *  Writes only under media/thumbs/. Never touches originals.
 */
export async function ensureThumbFile(mediaDir, thumbRel, { upgrade = false } = {}) {
  const parsed = parseThumbRel(thumbRel);
  if (!parsed) return null;
  const root = path.resolve(mediaDir);
  const dest = path.resolve(root, parsed.rel);
  if (dest === root || !dest.startsWith(root + path.sep)) return null;
  const src = findSourceFile(root, parsed.rel);
  if (!src) return destIfUsable(dest);
  const matching = existingMatches(dest, parsed);
  const srcStat = fs.statSync(src);
  const fresh = matching && fs.statSync(matching).mtimeMs >= srcStat.mtimeMs;
  if (matching && fresh) return matching;
  const existing = destIfUsable(dest);
  if (existing && !upgrade) {
    if (rebuildBusy || srcStat.size > MAX_SRC_BYTES) return existing;
  }
  if (!existing && srcStat.size > MAX_SRC_BYTES) return null;
  if (rebuildBusy && !upgrade) return existing;
  rebuildBusy = true;
  try {
    const raw = fs.readFileSync(src);
    const rendered =
      parsed.ext === "webp"
        ? await renderPortraitWebp(raw, parsed.variant)
        : renderPortraitJpeg(raw, parsed.variant);
    if (!rendered) return existing;
    atomicWrite(dest, rendered);
    return dest;
  } catch {
    return existing;
  } finally {
    rebuildBusy = false;
  }
}

export async function buildAllThumbs(mediaDir) {
  const root = path.resolve(mediaDir);
  const made = [];
  for (const kind of ["people", "dog-comms"]) {
    const dir = path.join(root, kind);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!EXTS.includes(path.extname(name).toLowerCase())) continue;
      const stem = stemOf(name);
      const variants = kind === "people" ? ["", ".2x", ".hero"] : ["", ".2x"];
      for (const variant of variants) {
        for (const ext of ["jpg", "webp"]) {
          if (variant === ".hero" && ext === "jpg") continue;
          const rel = `thumbs/${kind}/${stem}${variant}.${ext}`;
          const dest = await ensureThumbFile(root, rel, { upgrade: true });
          if (dest) made.push(rel);
        }
      }
    }
  }
  return made;
}
