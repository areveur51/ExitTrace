/**
 * Idempotent published-table gap upsert (lab → Render logical catch-up).
 * Upserts by id: people (including central_casting), dog_comms, operations,
 * optional categories, red_folder_comms, central_casting_comms,
 * plus person_events companion.
 * Never DELETE / TRUNCATE / DROP / --clean. Never invent cite URLs.
 */

export const PUBLISHED_TABLES = Object.freeze([
  "people",
  "dog_comms",
  "operations",
  "categories",
  "red_folder_comms",
  "central_casting_comms",
]);

export const COMPANION_TABLES = Object.freeze(["person_events"]);

export const ALL_UPSERT_TABLES = Object.freeze([...PUBLISHED_TABLES, ...COMPANION_TABLES]);

const FORBIDDEN = /\b(TRUNCATE|DROP\s+|DELETE\s+FROM|--clean|COPY\s+.*FROM\s+PROGRAM)\b/i;

const TABLE_KEYS = Object.freeze({
  people: "id",
  dog_comms: "id",
  red_folder_comms: "id",
  central_casting_comms: "id",
  operations: "id",
  categories: "id",
  person_events: ["person_id", "kind"],
});

const JSONB_COLS = Object.freeze({
  people: ["sources", "events", "tags", "career", "central_casting"],
  dog_comms: ["snapshot"],
  red_folder_comms: ["snapshot"],
  central_casting_comms: ["snapshot"],
  operations: ["agencies", "tags", "sources"],
  categories: [],
  person_events: ["sources"],
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
  "age_at_event",
  "unsealed",
]);

const CATEGORY_COLS = Object.freeze(["id", "kind", "title", "nav", "path", "blurb"]);

const COLS = Object.freeze({
  people: PEOPLE_COLS,
  dog_comms: DOG_COLS,
  red_folder_comms: RED_FOLDER_COLS,
  central_casting_comms: CENTRAL_CASTING_COMMS_COLS,
  operations: OP_COLS,
  person_events: EVENT_COLS,
  categories: CATEGORY_COLS,
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
  if (table === "central_casting_comms" && col === "person_id") {
    if (row?.person_id === undefined || row?.person_id === null) return null;
    const text = String(row.person_id).trim();
    return text || null;
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

export function normalizePayload(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {};
  for (const table of ALL_UPSERT_TABLES) {
    const rows = Array.isArray(src[table]) ? src[table] : [];
    out[table] = rows
      .filter((r) => r && typeof r === "object")
      .map((r) => pickRow(table, r));
  }
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
  for (const table of ALL_UPSERT_TABLES) {
    if (!data[table].length) continue;
    if (!have.has(table)) {
      skipped.push({ table, reason: "table_absent", count: data[table].length });
      continue;
    }
    plans.push(buildUpsertSql(table, data[table]));
  }
  return { plans, skipped, counts_in: Object.fromEntries(ALL_UPSERT_TABLES.map((t) => [t, data[t].length])) };
}

export function countProof(before, after, expectedIn) {
  const tables = ALL_UPSERT_TABLES;
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
  (SELECT count(*)::int FROM operations) AS operations,
  (SELECT count(*)::int FROM person_events) AS person_events,
  (SELECT count(*)::int FROM red_folder_comms) AS red_folder_comms,
  (SELECT count(*)::int FROM central_casting_comms) AS central_casting_comms
`.trim();
