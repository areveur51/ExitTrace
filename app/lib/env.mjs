import fs from "fs";
import path from "path";

export function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\n/)) {
    const line = raw.replace(/\r/g, "").trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function databaseUrl() {
  let u = (process.env.DATABASE_URL || "").trim();
  if (
    (u.startsWith('"') && u.endsWith('"')) ||
    (u.startsWith("'") && u.endsWith("'"))
  ) {
    u = u.slice(1, -1);
  }
  return u;
}

const WEAK_SSLMODES = new Set(["disable", "allow", "prefer"]);

/**
 * Render Postgres requires TLS. Upgrade missing/weak sslmode to require
 * (mirrors scripts/ci-ensure-database-url-ssl.sh / et-gap-upsert).
 * Mutates process.env.DATABASE_URL and PGSSLMODE. Does not log the URL.
 * TODO: prefer verify-full when a Render CA pin is available.
 */
export function ensureDatabaseUrlSsl() {
  const raw = databaseUrl();
  if (!raw) return "";
  let u = raw;
  const modeMatch = u.match(/[?&]sslmode=([^&]*)/i);
  const mode = modeMatch ? decodeURIComponent(modeMatch[1]).toLowerCase() : "";
  if (!mode) {
    u = u.includes("?") ? `${u}&sslmode=require` : `${u}?sslmode=require`;
  } else if (WEAK_SSLMODES.has(mode)) {
    u = u.replace(/([?&]sslmode=)[^&]*/i, "$1require");
  }
  // verify-full / verify-ca / require stay as-is
  process.env.DATABASE_URL = u;
  const pg = String(process.env.PGSSLMODE || "").toLowerCase();
  if (!pg || WEAK_SSLMODES.has(pg)) process.env.PGSSLMODE = "require";
  return u;
}


export function resolveRoot(root) {
  const mediaDir = path.resolve(
    process.env.MEDIA_DIR || path.join(root, "media"),
  );
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
  return { mediaDir, dataDir };
}
