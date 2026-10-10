/** Local catalog files under MEDIA_DIR. Href checks and the on-disk stat live here once. */

import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function mediaRoot() {
  return path.resolve(process.env.MEDIA_DIR || path.join(ROOT_DIR, "media"));
}

/** Local /media href with the query stripped. Empty when it is not a catalog file. */
export function mediaHrefPath(href) {
  const text = String(href || "").trim().split(/[?#]/)[0];
  if (!text.startsWith("/media/") || text.includes("..") || text.includes("\\")) return "";
  return text;
}

export function localMediaFile(href) {
  const rel = mediaHrefPath(href);
  if (!rel) return "";
  const root = mediaRoot();
  const file = path.resolve(root, rel.slice("/media/".length));
  if (file !== root && !file.startsWith(root + path.sep)) return "";
  return file;
}

function nonEmptyFileStat(file) {
  if (!file) return null;
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size <= 0) return null;
    return st;
  } catch {
    return null;
  }
}

/** True when a resolved local media file exists and is a non-empty regular file. */
export function localMediaFileReady(file) {
  return Boolean(nonEmptyFileStat(file));
}

/** Stat plus the path+mtime+size cache key. Null when the file is missing or empty. */
export function localMediaRecord(href) {
  const file = localMediaFile(href);
  const st = nonEmptyFileStat(file);
  if (!st) return null;
  return {
    file,
    size: st.size,
    mtimeMs: st.mtimeMs,
    key: `${file}\0${st.mtimeMs}\0${st.size}`,
  };
}
