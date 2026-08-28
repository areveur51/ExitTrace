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

export function resolveRoot(root) {
  const mediaDir = path.resolve(
    process.env.MEDIA_DIR || path.join(root, "media"),
  );
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
  return { mediaDir, dataDir };
}
