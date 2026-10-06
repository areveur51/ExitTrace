/**
 * Idempotent published-table gap upsert (lab → Render logical catch-up).
 * Upserts by id: people (including central_casting, nicknames, and clearances), dog_comms, operations,
 * optional categories, red_folder_comms, central_casting_comms,
 * request_attributions, source_posts (gold_person_id never nulled), add_requests (terminal
 * status / processed fields never regress), et_meta (LAB_OWNED_META_KEYS only; every other
 * key skipped and reported), plus person_events companion.
 * Never DELETE / TRUNCATE / DROP / --clean. Never invent cite URLs.
 */

import { clearanceJson } from "./clearances.mjs";
import { nicknameJson } from "./nicknames.mjs";

export const PUBLISHED_TABLES = Object.freeze([
  "people",
  "dog_comms",
  "eagle_comms",
  "ronald_comms",
  "boot_comms",
  "operations",
  "categories",
  "red_folder_comms",
  "central_casting_comms",
  "request_attributions",
  "epstein_flight_legs",
  "source_posts",
  "add_requests",
  "et_meta",
]);

export const COMPANION_TABLES = Object.freeze(["person_events"]);

export const ALL_UPSERT_TABLES = Object.freeze([...PUBLISHED_TABLES, ...COMPANION_TABLES]);

/**
 * Tables the count proof reads. `categories` is JS-only (app/lib/categories.mjs);
 * no such table exists on lab or Render, so it is never counted.
 */
export const COUNT_TABLES = Object.freeze(ALL_UPSERT_TABLES.filter((t) => t !== "categories"));

/** Render app DB only. Never publication, gap-upsert, or export. */
export const RENDER_ONLY_TABLES = Object.freeze(["mention_queue"]);

const FORBIDDEN = /\b(TRUNCATE|DROP\s+|DELETE\s+FROM|--clean|COPY\s+.*FROM\s+PROGRAM)\b/i;

const TABLE_KEYS = Object.freeze({
  people: "id",
  dog_comms: "id",
  eagle_comms: "id",
  ronald_comms: "id",
  boot_comms: "id",
  red_folder_comms: "id",
  central_casting_comms: "id",
  request_attributions: "id",
  operations: "id",
  categories: "id",
  person_events: ["person_id", "kind"],
  epstein_flight_legs: ["passenger_name_raw", "flight_date", "dep", "arr", "aircraft"],
  source_posts: "id",
  add_requests: "id",
  et_meta: "k",
});

const JSONB_COLS = Object.freeze({
  people: ["sources", "events", "tags", "career", "central_casting", "nicknames", "clearances"],
  dog_comms: ["snapshot"],
  eagle_comms: ["snapshot"],
  ronald_comms: ["snapshot"],
  boot_comms: ["snapshot"],
  red_folder_comms: ["snapshot"],
  central_casting_comms: ["snapshot"],
  operations: ["agencies", "tags", "sources"],
  categories: [],
  person_events: ["sources"],
  source_posts: ["media_urls"],
  add_requests: ["cite_urls", "payload", "result"],
  et_meta: ["v"],
});

const PEOPLE_COLS = Object.freeze([
  "id",
  "category",
  "name",
  "role",
  "event_date",
  "death_date",
  "birth_date",
  "country_of_origin",
  "photo",
  "photo_credit",
  "screenshot",
  "screenshot_credit",
  "net_worth_usd",
  "net_worth_note",
  "net_worth_source",
  "sources",
  "summary",
  "events",
  "tags",
  "career",
  "central_casting",
  "nicknames",
  "clearances",
]);

const DOG_COLS = Object.freeze([
  "id",
  "posted_at",
  "handle",
  "account_name",
  "text",
  "still",
  "still_credit",
  "screenshot",
  "screenshot_credit",
  "source_url",
  "snapshot",
]);

const RED_FOLDER_COLS = DOG_COLS;

const CENTRAL_CASTING_COMMS_COLS = Object.freeze([...DOG_COLS, "person_id"]);

const OP_COLS = Object.freeze([
  "id",
  "name",
  "event_date",
  "announced_date",
  "agencies",
  "summary",
  "victim_count",
  "arrest_count",
  "tags",
  "sources",
  "screenshot",
]);

const EVENT_COLS = Object.freeze([
  "person_id",
  "kind",
  "event_date",
  "sources",
  "announced_date",
  "position",
  "organization",
  "country",
  "branch",
  "comments",
  "notable_group",
  "title_note",
  "status",
  "age_at_event",
  "unsealed",
]);

const EPSTEIN_LEG_COLS = Object.freeze([
  "passenger_name_raw",
  "passenger_first",
  "passenger_last",
  "passenger_first_last",
  "flight_date",
  "dep_code",
  "arr_code",
  "dep",
  "arr",
  "aircraft_model",
  "aircraft_tail",
  "aircraft_type",
  "aircraft",
  "flight_no",
  "pass_no",
  "unique_key",
  "comment",
  "data_source",
  "source_url",
  "person_id",
]);

/** Parked public posts (scripts/bootstrap-db.sql). Keyed by id; canonical_url is also UNIQUE. */
const SOURCE_POST_COLS = Object.freeze([
  "id",
  "category",
  "source_url",
  "canonical_url",
  "quoted_url",
  "card_url",
  "text",
  "poster_handle",
  "poster_name",
  "posted_at",
  "media_urls",
  "gold_person_id",
]);

/** Add/request queue (scripts/bootstrap-db.sql). Keyed by id (random nonce, so lab and Render never share ids by accident). */
const ADD_REQUEST_COLS = Object.freeze([
  "id",
  "kind",
  "status",
  "subject",
  "category",
  "event_date",
  "hint_url",
  "handle",
  "source_url",
  "posted_at",
  "cite_urls",
  "payload",
  "error",
  "result",
  "created_at",
  "processed_at",
]);

const ET_META_COLS = Object.freeze(["k", "v"]);

/**
 * et_meta keys lab truly owns (stamped on lab by et-stamp-keep-up.sh / the
 * daily jobs, and only replicated to Render). Frozen allowlist: exact keys plus
 * exact dot-terminated prefixes. Lab wins only for these keys.
 *
 * Every other key is SKIPPED and reported, never inserted or updated:
 * - Render-owned: keep_up.dump_restore.* (lab-to-render-sync), keep_up.logical.last_verify
 *   (et-cutover-verify), keep_up.logical.last_heal and logical.heal.* (logical heal on Render),
 *   seed (server boot import also writes it on Render).
 * - Replication proofs: rca_* / cutover_prove_* must arrive only by the logical stream,
 *   or the RCA prove workflows would report a false "landed".
 * - Anything new (mention / dig cursors, since_id, ...) until someone adds it here on purpose.
 */
export const LAB_OWNED_META_KEYS = Object.freeze({
  exact: Object.freeze([
    "keep_up.daily_ingest.last_pass",
    "keep_up.daily_pack.last_pass",
    "keep_up.media_delta.last_success",
    "keep_up.media_delta.last_with_files",
  ]),
  prefixes: Object.freeze(["keep_up.daily_ingest.", "keep_up.daily_pack.", "keep_up.media_delta."]),
});

export function isLabOwnedMetaKey(k) {
  const key = String(k ?? "");
  if (!key) return false;
  if (LAB_OWNED_META_KEYS.exact.includes(key)) return true;
  return LAB_OWNED_META_KEYS.prefixes.some((pre) => key.startsWith(pre) && key.length > pre.length);
}

function metaLiteral(k) {
  if (!/^[a-z0-9_.]+$/.test(k)) throw new Error("refusing non-ident meta key");
  return `'${k}'`;
}

/**
 * Defense in depth: even if a non-allowlisted row reached the SQL, the update
 * keeps Render's value (insert-if-missing at most). Prefix match uses left(),
 * not LIKE, so "_" is never a wildcard.
 */
function etMetaValueSql() {
  const exact = LAB_OWNED_META_KEYS.exact.map(metaLiteral).join(", ");
  const prefixes = LAB_OWNED_META_KEYS.prefixes
    .map((pre) => `left(et_meta.k, ${pre.length}) = ${metaLiteral(pre)}`)
    .join(" OR ");
  return `v = CASE WHEN et_meta.k IN (${exact}) OR ${prefixes} THEN EXCLUDED.v ELSE et_meta.v END`;
}

const CATEGORY_COLS = Object.freeze(["id", "kind", "title", "nav", "path", "blurb"]);

const ATTRIBUTION_COLS = Object.freeze([
  "id",
  "target_kind",
  "target_id",
  "channel",
  "submitter_display_name",
  "submitter_handle",
  "submitter_author_id",
  "submitted_at",
  "subject_status_id",
  "mention_status_id",
  "mention_url",
  "created_at",
]);

const COLS = Object.freeze({
  people: PEOPLE_COLS,
  dog_comms: DOG_COLS,
  eagle_comms: DOG_COLS,
  ronald_comms: DOG_COLS,
  boot_comms: DOG_COLS,
  red_folder_comms: RED_FOLDER_COLS,
  central_casting_comms: CENTRAL_CASTING_COMMS_COLS,
  request_attributions: ATTRIBUTION_COLS,
  operations: OP_COLS,
  person_events: EVENT_COLS,
  categories: CATEGORY_COLS,
  epstein_flight_legs: EPSTEIN_LEG_COLS,
  source_posts: SOURCE_POST_COLS,
  add_requests: ADD_REQUEST_COLS,
  et_meta: ET_META_COLS,
});

export function isPublishedTable(name) {
  return ALL_UPSERT_TABLES.includes(String(name || ""));
}

export function assertSafeSql(sql) {
  const text = String(sql || "");
  if (FORBIDDEN.test(text)) {
    throw new Error("gap upsert refuses destructive SQL");
  }
  return text;
}

function quoteIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error("refusing non-ident table/column");
  }
  return name;
}

function conflictTarget(table) {
  const key = TABLE_KEYS[table];
  if (Array.isArray(key)) return key.map(quoteIdent).join(", ");
  return quoteIdent(key);
}

function updateSet(table, cols) {
  const key = TABLE_KEYS[table];
  const keys = new Set(Array.isArray(key) ? key : [key]);
  return cols
    .filter((c) => !keys.has(c))
    .map((c) => {
      if (table === "et_meta" && c === "v") return etMetaValueSql();
      if (table === "add_requests") {
        if (c === "status") {
          // A terminal status on Render never regresses to pending.
          return `status = CASE WHEN EXCLUDED.status = 'pending' AND add_requests.status IN ('applied', 'rejected') THEN add_requests.status ELSE EXCLUDED.status END`;
        }
        if (c === "error" || c === "result" || c === "processed_at") {
          return `${quoteIdent(c)} = COALESCE(EXCLUDED.${quoteIdent(c)}, add_requests.${quoteIdent(c)})`;
        }
        if (c === "created_at") {
          return "created_at = LEAST(add_requests.created_at, EXCLUDED.created_at)";
        }
      }
      if (table === "source_posts" && c === "gold_person_id") {
        // Never erase an existing gold link with a null (matches store.mjs upsert).
        return `${quoteIdent(c)} = COALESCE(EXCLUDED.${quoteIdent(c)}, ${quoteIdent(table)}.${quoteIdent(c)})`;
      }
      if (table === "person_events" && c === "unsealed") {
        return `${quoteIdent(c)} = CASE WHEN ${quoteIdent(table)}.${quoteIdent(c)} IS TRUE THEN TRUE ELSE EXCLUDED.${quoteIdent(c)} END`;
      }
      return `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`;
    })
    .join(",\n  ");
}

function centralCastingJson(row) {
  const v = row?.central_casting;
  if (v === undefined || v === null) return "[]";
  if (typeof v === "string") {
    const text = v.trim();
    if (!text) return "[]";
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? JSON.stringify(parsed) : "[]";
    } catch {
      return "[]";
    }
  }
  return Array.isArray(v) ? JSON.stringify(v) : "[]";
}

function rowValue(table, col, row) {
  if (table === "person_events" && col === "unsealed") {
    return row?.unsealed === true ? true : null;
  }
  if (table === "people" && col === "central_casting") {
    return centralCastingJson(row);
  }
  if (table === "people" && col === "nicknames") {
    return nicknameJson(row?.nicknames);
  }
  if (table === "people" && col === "clearances") {
    return clearanceJson(row?.clearances);
  }
  if (table === "add_requests") {
    if (col === "cite_urls" || col === "payload") {
      const v = row?.[col];
      const empty = col === "cite_urls" ? "[]" : "{}";
      if (v === undefined || v === null || v === "") return empty;
      return typeof v === "string" ? v : JSON.stringify(v);
    }
    if (col === "status") {
      const text = String(row?.status ?? "").trim();
      return text || "pending";
    }
  }
  if (table === "source_posts" && col === "media_urls") {
    const v = row?.media_urls;
    if (v === undefined || v === null || v === "") return "[]";
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  if (table === "source_posts" && col === "gold_person_id") {
    if (row?.gold_person_id === undefined || row?.gold_person_id === null) return null;
    const text = String(row.gold_person_id).trim();
    return text || null;
  }
  if (table === "central_casting_comms" && col === "person_id") {
    if (row?.person_id === undefined || row?.person_id === null) return null;
    const text = String(row.person_id).trim();
    return text || null;
  }
  if (table === "request_attributions") {
    if (col === "channel") {
      const channel = String(row?.channel || "x_mention").trim();
      return channel || "x_mention";
    }
    if (
      col === "submitter_author_id" ||
      col === "subject_status_id" ||
      col === "mention_status_id" ||
      col === "mention_url"
    ) {
      if (row?.[col] == null) return null;
      const text = String(row[col]).trim();
      return text || null;
    }
  }
  const v = row?.[col];
  if (v === undefined || v === null) return null;
  if (JSONB_COLS[table]?.includes(col)) {
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  }
  return v;
}

export function pickRow(table, row) {
  if (!isPublishedTable(table)) throw new Error("unknown published table");
  const cols = COLS[table];
  const out = {};
  for (const col of cols) out[col] = rowValue(table, col, row);
  return out;
}

/**
 * NOT NULL columns with no safe value to invent: et_meta needs k and v,
 * add_requests needs id, kind and created_at. Such rows are dropped, never sent as null.
 */
function keepRow(table, row) {
  const present = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  if (table === "et_meta") {
    return present(row?.k) && row?.v !== undefined && row?.v !== null;
  }
  if (table === "add_requests") {
    return present(row?.id) && present(row?.kind) && present(row?.created_at);
  }
  return true;
}

export function normalizePayload(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const table of ALL_UPSERT_TABLES) {
    const rows = Array.isArray(src[table]) ? src[table] : [];
    out[table] = rows
      .filter((r) => r && typeof r === "object")
      .filter((r) => keepRow(table, r))
      .map((r) => pickRow(table, r));
  }
  return out;
}

/** Stay under Postgres's 65,535-parameter bind limit. */
export const UPSERT_PARAM_BUDGET = 60000;

export function upsertChunkSize(table) {
  if (!isPublishedTable(table)) throw new Error("unknown published table");
  const width = COLS[table].length || 1;
  return Math.max(1, Math.floor(UPSERT_PARAM_BUDGET / width));
}

export function chunkUpsertRows(table, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const size = upsertChunkSize(table);
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function buildUpsertSql(table, rows) {
  if (!isPublishedTable(table)) throw new Error("unknown published table");
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const cols = COLS[table];
  const colSql = cols.map(quoteIdent).join(", ");
  const params = [];
  const tuples = list.map((row) => {
    const picked = pickRow(table, row);
    const slots = cols.map((col) => {
      params.push(picked[col]);
      const n = params.length;
      return JSONB_COLS[table]?.includes(col) ? `$${n}::jsonb` : `$${n}`;
    });
    return `(${slots.join(", ")})`;
  });
  const sql = assertSafeSql(
    `INSERT INTO ${quoteIdent(table)} (${colSql})
VALUES
  ${tuples.join(",\n  ")}
ON CONFLICT (${conflictTarget(table)}) DO UPDATE SET
  ${updateSet(table, cols)}`,
  );
  return { sql, params, table, count: list.length };
}

export function planGapUpsert(payload, { existingTables = PUBLISHED_TABLES.concat(COMPANION_TABLES) } = {}) {
  const data = normalizePayload(payload);
  const have = new Set(existingTables);
  const plans = [];
  const skipped = [];
  if (data.et_meta.length) {
    const notOwned = data.et_meta.filter((r) => !isLabOwnedMetaKey(r.k));
    if (notOwned.length) {
      skipped.push({
        table: "et_meta",
        reason: "not_lab_owned",
        count: notOwned.length,
        keys: notOwned.map((r) => r.k).sort(),
      });
      data.et_meta = data.et_meta.filter((r) => isLabOwnedMetaKey(r.k));
    }
  }
  for (const table of ALL_UPSERT_TABLES) {
    if (!data[table].length) continue;
    if (!have.has(table)) {
      skipped.push({ table, reason: "table_absent", count: data[table].length });
      continue;
    }
    for (const part of chunkUpsertRows(table, data[table])) {
      plans.push(buildUpsertSql(table, part));
    }
  }
  return { plans, skipped, counts_in: Object.fromEntries(ALL_UPSERT_TABLES.map((t) => [t, data[t].length])) };
}

export function countProof(before, after, expectedIn) {
  const tables = COUNT_TABLES;
  const out = {};
  for (const t of tables) {
    const b = Number(before?.[t] ?? 0);
    const a = Number(after?.[t] ?? 0);
    const n = Number(expectedIn?.[t] ?? 0);
    out[t] = {
      before: b,
      after: a,
      source_rows: n,
      delta: a - b,
      ok: a >= b && (n === 0 || a >= b),
    };
  }
  return out;
}

export function countTableSql(table) {
  if (!isPublishedTable(table)) throw new Error("unknown published table");
  return assertSafeSql(`SELECT count(*)::int AS n FROM ${quoteIdent(table)}`);
}

export const COUNT_SQL = `
SELECT
  (SELECT count(*)::int FROM people) AS people,
  (SELECT count(*)::int FROM dog_comms) AS dog_comms,
  (SELECT count(*)::int FROM eagle_comms) AS eagle_comms,
  (SELECT count(*)::int FROM ronald_comms) AS ronald_comms,
  (SELECT count(*)::int FROM boot_comms) AS boot_comms,
  (SELECT count(*)::int FROM operations) AS operations,
  (SELECT count(*)::int FROM person_events) AS person_events,
  (SELECT count(*)::int FROM red_folder_comms) AS red_folder_comms,
  (SELECT count(*)::int FROM central_casting_comms) AS central_casting_comms,
  (SELECT count(*)::int FROM request_attributions) AS request_attributions,
  (SELECT count(*)::int FROM epstein_flight_legs) AS epstein_flight_legs,
  (SELECT count(*)::int FROM source_posts) AS source_posts,
  (SELECT count(*)::int FROM add_requests) AS add_requests,
  (SELECT count(*)::int FROM et_meta) AS et_meta
`.trim();
