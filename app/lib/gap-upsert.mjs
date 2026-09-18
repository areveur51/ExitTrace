/**
 * Idempotent published-table gap upsert (lab → Render).
 * Upserts by id (people, dog_comms, operations, optional categories)
 * plus person_events companion. Never DELETE / TRUNCATE / DROP / --clean.
 */

export const PUBLISHED_TABLES = Object.freeze([
  "people",
  "dog_comms",
  "operations",
  "categories",
]);

export const COMPANION_TABLES = Object.freeze(["person_events"]);

export const ALL_UPSERT_TABLES = Object.freeze([...PUBLISHED_TABLES, ...COMPANION_TABLES]);

const FORBIDDEN = /\b(TRUNCATE|DROP\s+|DELETE\s+FROM|--clean|COPY\s+.*FROM\s+PROGRAM)\b/i;

const TABLE_KEYS = Object.freeze({
  people: "id",
  dog_comms: "id",
  operations: "id",
  categories: "id",
  person_events: ["person_id", "kind"],
});

const JSONB_COLS = Object.freeze({
  people: ["sources", "events", "tags", "career"],
  dog_comms: ["snapshot"],
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
]);

const CATEGORY_COLS = Object.freeze(["id", "kind", "title", "nav", "path", "blurb"]);

const COLS = Object.freeze({
  people: PEOPLE_COLS,
  dog_comms: DOG_COLS,
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
    .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
    .join(",\n  ");
}

function rowValue(table, col, row) {
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

export const COUNT_SQL = `
SELECT
  (SELECT count(*)::int FROM people) AS people,
  (SELECT count(*)::int FROM dog_comms) AS dog_comms,
  (SELECT count(*)::int FROM operations) AS operations,
  (SELECT count(*)::int FROM person_events) AS person_events
`.trim();
