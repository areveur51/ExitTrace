import {
  classifyApplyHealth,
  isLogicalSubscriber,
  publicApplyErrorCount,
  publicHealthApplyState,
} from "./logical-heal.mjs";
import { getEtMeta, readLogicalApplySnapshot } from "./store.mjs";

/** Public keep-up stamps. Stored in et_meta; health never invents a second store. */

export const KEEP_UP_TIMEZONE = "America/New_York";

export const DUMP_RESTORE_MODES = Object.freeze(["cold_fallback", "disabled"]);

/** Field-level et_meta keys. Independent upserts; last write wins per key. */
export const KEEP_UP_META_KEYS = Object.freeze({
  logicalStreamStarted: "keep_up.logical.stream_started",
  logicalLastVerify: "keep_up.logical.last_verify",
  logicalLagSeconds: "keep_up.logical.lag_seconds",
  mediaDeltaLastSuccess: "keep_up.media_delta.last_success",
  mediaDeltaLastWithFiles: "keep_up.media_delta.last_with_files",
  dailyIngestLastPass: "keep_up.daily_ingest.last_pass",
  dailyPackLastPass: "keep_up.daily_pack.last_pass",
  dumpRestoreLastSuccess: "keep_up.dump_restore.last_success",
  dumpRestoreMode: "keep_up.dump_restore.mode",
});

export const KEEP_UP_META_KEY_LIST = Object.freeze(Object.values(KEEP_UP_META_KEYS));

const UNSAFE_VALUE =
  /:\/\/|@|\bdpg-|\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b|::[0-9a-f:]*|[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){5,}/i;

export function emptyKeepUp() {
  return {
    timezone: KEEP_UP_TIMEZONE,
    logical: {
      stream_started: null,
      last_verify: null,
      lag_seconds: null,
      apply_state: null,
      apply_error_count: null,
    },
    media_delta: {
      last_success: null,
      last_with_files: null,
    },
    daily_ingest: {
      last_pass: null,
    },
    daily_pack: {
      last_pass: null,
    },
    dump_restore: {
      last_success: null,
      mode: null,
    },
  };
}

export function isKeepUpMetaKey(k) {
  return KEEP_UP_META_KEY_LIST.includes(String(k || ""));
}

export function isDumpRestoreMode(v) {
  return DUMP_RESTORE_MODES.includes(String(v || ""));
}

function looksUnsafe(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number" && Number.isFinite(value)) return false;
  if (typeof value === "boolean") return true;
  const s = String(value);
  if (!s) return false;
  return UNSAFE_VALUE.test(s);
}

function pickStampField(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    for (const key of ["at", "iso", "ts", "last_pass", "last_success", "pass"]) {
      if (v[key] !== undefined && v[key] !== null) return v[key];
    }
  }
  return null;
}

function parseDate(input) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === "number" && Number.isFinite(input)) {
    const ms = input < 1e12 ? input * 1000 : input;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || looksUnsafe(raw)) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeOffset(raw) {
  const s = String(raw || "")
    .replace(/^GMT/i, "")
    .replace(/^UTC/i, "");
  if (/^[+-]\d{2}:\d{2}$/.test(s)) return s;
  const m = s.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  return `${m[1]}${pad2(m[2])}:${pad2(m[3] || "00")}`;
}

/** ISO-8601 local time in America/New_York, including numeric offset. */
export function formatNyTimestamp(input) {
  const date = parseDate(input);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KEEP_UP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const g = (type) => parts.find((p) => p.type === type)?.value;
  const offset = normalizeOffset(g("timeZoneName"));
  if (!offset || !g("year")) return null;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}${offset}`;
}

export function publicTimestamp(value) {
  if (looksUnsafe(value)) return null;
  const picked = pickStampField(value);
  if (picked === null || looksUnsafe(picked)) return null;
  return formatNyTimestamp(picked);
}

export function publicLagSeconds(value) {
  if (value === null || value === undefined) return null;
  let n = value;
  if (typeof value === "object" && value !== null) {
    n = value.lag_seconds ?? value.seconds ?? value.v ?? value.n;
  }
  if (typeof n === "string" && n.trim() && !looksUnsafe(n)) n = Number(n);
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

export function publicDumpRestoreMode(value) {
  if (value === null || value === undefined) return null;
  let mode = value;
  if (typeof value === "object") mode = value.mode ?? value.v;
  if (looksUnsafe(mode)) return null;
  const s = String(mode || "").trim();
  return isDumpRestoreMode(s) ? s : null;
}

export function buildKeepUp(
  metaByKey = {},
  { lagSeconds = null, applyState = null, applyErrorCount = null } = {},
) {
  const meta = metaByKey && typeof metaByKey === "object" ? metaByKey : {};
  const k = KEEP_UP_META_KEYS;
  const liveLag = publicLagSeconds(lagSeconds);
  const storedLag = publicLagSeconds(meta[k.logicalLagSeconds]);
  return {
    timezone: KEEP_UP_TIMEZONE,
    logical: {
      stream_started: publicTimestamp(meta[k.logicalStreamStarted]),
      last_verify: publicTimestamp(meta[k.logicalLastVerify]),
      lag_seconds: liveLag !== null ? liveLag : storedLag,
      apply_state: publicHealthApplyState(applyState),
      apply_error_count: publicApplyErrorCount(applyErrorCount),
    },
    media_delta: {
      last_success: publicTimestamp(meta[k.mediaDeltaLastSuccess]),
      last_with_files: publicTimestamp(meta[k.mediaDeltaLastWithFiles]),
    },
    daily_ingest: {
      last_pass: publicTimestamp(meta[k.dailyIngestLastPass]),
    },
    daily_pack: {
      last_pass: publicTimestamp(meta[k.dailyPackLastPass]),
    },
    dump_restore: {
      last_success: publicTimestamp(meta[k.dumpRestoreLastSuccess]),
      mode: publicDumpRestoreMode(meta[k.dumpRestoreMode]),
    },
  };
}

export async function readKeepUp() {
  try {
    const [meta, snap] = await Promise.all([
      getEtMeta(KEEP_UP_META_KEY_LIST),
      readLogicalApplySnapshot(),
    ]);
    if (!snap || !isLogicalSubscriber(snap)) {
      return buildKeepUp(meta);
    }
    const health = classifyApplyHealth(snap);
    return buildKeepUp(meta, {
      lagSeconds: health.lag_seconds,
      applyState: health.state,
      applyErrorCount: health.apply_error_count,
    });
  } catch {
    return emptyKeepUp();
  }
}

export function stampPayload(key, { at = new Date(), mode } = {}) {
  const k = String(key || "");
  if (!isKeepUpMetaKey(k)) {
    throw new Error("unknown keep_up et_meta key");
  }
  if (k === KEEP_UP_META_KEYS.dumpRestoreMode) {
    if (!isDumpRestoreMode(mode)) {
      throw new Error("dump_restore mode must be cold_fallback or disabled");
    }
    return { mode };
  }
  if (k === KEEP_UP_META_KEYS.logicalLagSeconds) {
    const n = publicLagSeconds(at);
    if (n === null) throw new Error("lag_seconds must be a finite number");
    return { lag_seconds: n };
  }
  const labeled = formatNyTimestamp(at);
  if (!labeled) throw new Error("keep_up stamp needs a valid time");
  return { at: new Date(at).toISOString() };
}
