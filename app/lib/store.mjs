import fs from "fs";
import path from "path";
import { databaseUrl } from "./env.mjs";

let pool = null;
let memory = null;

export function backendName() {
  return databaseUrl() ? "postgres" : "file";
}

export async function getPool() {
  const url = databaseUrl();
  if (!url) return null;
  if (pool) return pool;
  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "DATABASE_URL is set but the 'pg' package is missing. Run: npm install pg",
    );
  }
  pool = new pg.default.Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 4),
    idleTimeoutMillis: 10_000,
  });
  return pool;
}

export async function ensureSchema(p, bootstrapSql) {
  await p.query(bootstrapSql);
}

function asDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function normalizePerson(row) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    role: row.role || "",
    event_date: asDate(row.event_date),
    death_date: asDate(row.death_date),
    photo: row.photo || "",
    photo_credit: row.photo_credit || "",
    net_worth_usd:
      row.net_worth_usd === null || row.net_worth_usd === undefined
        ? null
        : Number(row.net_worth_usd),
    net_worth_note: row.net_worth_note || "",
    net_worth_source: row.net_worth_source || "",
    sources: Array.isArray(row.sources) ? row.sources : row.sources || [],
    summary: row.summary || "",
  };
}

function normalizeDog(row) {
  return {
    id: row.id,
    posted_at: asDate(row.posted_at),
    handle: row.handle,
    account_name: row.account_name || "",
    text: row.text,
    still: row.still || "",
    still_credit: row.still_credit || "",
    source_url: row.source_url,
    snapshot: row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {},
  };
}

export function loadSeedFile(seedPath) {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  return {
    people: (raw.people || []).map(normalizePerson),
    dog_comms: (raw.dog_comms || []).map(normalizeDog),
    meta: raw.meta || {},
  };
}

function emptyMemory() {
  return { people: [], dog_comms: [], meta: {} };
}

export function setMemory(seed) {
  memory = {
    people: (seed.people || []).map(normalizePerson),
    dog_comms: (seed.dog_comms || []).map(normalizeDog),
    meta: seed.meta || {},
  };
  return memory;
}

export function getMemory() {
  if (!memory) memory = emptyMemory();
  return memory;
}

export function writeFileStore(dataDir, seed) {
  fs.mkdirSync(dataDir, { recursive: true });
  const out = path.join(dataDir, "store.json");
  fs.writeFileSync(out, JSON.stringify(seed, null, 2) + "\n");
  return out;
}

export async function importSeed(p, seed) {
  if (!p) {
    setMemory(seed);
    return { people: seed.people.length, dog_comms: seed.dog_comms.length };
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    for (const row of seed.people) {
      await client.query(
        `INSERT INTO people (
           id, category, name, role, event_date, death_date, photo, photo_credit,
           net_worth_usd, net_worth_note, net_worth_source, sources, summary
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13
         )
         ON CONFLICT (id) DO UPDATE SET
           category = EXCLUDED.category,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           event_date = EXCLUDED.event_date,
           death_date = EXCLUDED.death_date,
           photo = EXCLUDED.photo,
           photo_credit = EXCLUDED.photo_credit,
           net_worth_usd = EXCLUDED.net_worth_usd,
           net_worth_note = EXCLUDED.net_worth_note,
           net_worth_source = EXCLUDED.net_worth_source,
           sources = EXCLUDED.sources,
           summary = EXCLUDED.summary`,
        [
          row.id,
          row.category,
          row.name,
          row.role,
          row.event_date,
          row.death_date,
          row.photo,
          row.photo_credit,
          row.net_worth_usd,
          row.net_worth_note,
          row.net_worth_source,
          JSON.stringify(row.sources || []),
          row.summary,
        ],
      );
    }
    for (const row of seed.dog_comms) {
      await client.query(
        `INSERT INTO dog_comms (
           id, posted_at, handle, account_name, text, still, still_credit, source_url, snapshot
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb
         )
         ON CONFLICT (id) DO UPDATE SET
           posted_at = EXCLUDED.posted_at,
           handle = EXCLUDED.handle,
           account_name = EXCLUDED.account_name,
           text = EXCLUDED.text,
           still = EXCLUDED.still,
           still_credit = EXCLUDED.still_credit,
           source_url = EXCLUDED.source_url,
           snapshot = EXCLUDED.snapshot`,
        [
          row.id,
          row.posted_at,
          row.handle,
          row.account_name,
          row.text,
          row.still,
          row.still_credit,
          row.source_url,
          JSON.stringify(row.snapshot || {}),
        ],
      );
    }
    await client.query(
      `INSERT INTO et_meta (k, v) VALUES ('seed', $1::jsonb)
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
      [JSON.stringify({ imported_at: new Date().toISOString(), ...(seed.meta || {}) })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { people: seed.people.length, dog_comms: seed.dog_comms.length };
}

function parseListArgs(categoryOrOpts, maybeOpts) {
  if (categoryOrOpts && typeof categoryOrOpts === "object") {
    return {
      category: categoryOrOpts.category || undefined,
      limit: categoryOrOpts.limit,
      offset: categoryOrOpts.offset ?? 0,
    };
  }
  return {
    category: categoryOrOpts || undefined,
    limit: maybeOpts?.limit,
    offset: maybeOpts?.offset ?? 0,
  };
}

function finiteInt(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function comparePeople(a, b) {
  const d = String(b.event_date).localeCompare(String(a.event_date));
  if (d !== 0) return d;
  return String(a.name).localeCompare(String(b.name));
}

function compareDogs(a, b) {
  const d = String(b.posted_at).localeCompare(String(a.posted_at));
  if (d !== 0) return d;
  return String(a.handle).localeCompare(String(b.handle));
}

function applyWindow(rows, limit, offset) {
  if (limit != null) return rows.slice(offset, offset + limit);
  return offset ? rows.slice(offset) : rows;
}

export async function listPeople(categoryOrOpts, maybeOpts) {
  const args = parseListArgs(categoryOrOpts, maybeOpts);
  const limit = finiteInt(args.limit, null);
  const offset = finiteInt(args.offset, 0);
  const category = args.category;
  const p = await getPool();
  if (!p) {
    let rows = getMemory().people;
    if (category) rows = rows.filter((r) => r.category === category);
    return applyWindow(rows.slice().sort(comparePeople), limit, offset);
  }
  const params = [];
  let sql = "SELECT * FROM people";
  if (category) {
    params.push(category);
    sql += ` WHERE category = $${params.length}`;
  }
  sql += " ORDER BY event_date DESC, name ASC";
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  } else if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const q = await p.query(sql, params);
  return q.rows.map(normalizePerson);
}

export async function listDogComms(opts = {}) {
  const limit = finiteInt(opts.limit, null);
  const offset = finiteInt(opts.offset, 0);
  const p = await getPool();
  if (!p) {
    return applyWindow(
      getMemory().dog_comms.slice().sort(compareDogs),
      limit,
      offset,
    );
  }
  const params = [];
  let sql = "SELECT * FROM dog_comms ORDER BY posted_at DESC, handle ASC";
  if (limit != null) {
    params.push(limit);
    sql += ` LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  } else if (offset) {
    params.push(offset);
    sql += ` OFFSET $${params.length}`;
  }
  const q = await p.query(sql, params);
  return q.rows.map(normalizeDog);
}

export async function countPeople(category) {
  const p = await getPool();
  if (!p) {
    const rows = getMemory().people;
    return category ? rows.filter((r) => r.category === category).length : rows.length;
  }
  const q = category
    ? await p.query("SELECT COUNT(*)::int AS n FROM people WHERE category = $1", [
        category,
      ])
    : await p.query("SELECT COUNT(*)::int AS n FROM people");
  return q.rows[0].n;
}

export async function countDogComms() {
  const p = await getPool();
  if (!p) return getMemory().dog_comms.length;
  const q = await p.query("SELECT COUNT(*)::int AS n FROM dog_comms");
  return q.rows[0].n;
}

export async function counts() {
  const p = await getPool();
  if (!p) {
    const people = getMemory().people;
    const dogs = getMemory().dog_comms;
    const byCategory = {};
    for (const row of people) {
      byCategory[row.category] = (byCategory[row.category] || 0) + 1;
    }
    byCategory.dog_comms = dogs.length;
    return {
      people: people.length,
      dog_comms: dogs.length,
      byCategory,
    };
  }
  const [peopleCount, dogCount, grouped] = await Promise.all([
    p.query("SELECT COUNT(*)::int AS n FROM people"),
    p.query("SELECT COUNT(*)::int AS n FROM dog_comms"),
    p.query("SELECT category, COUNT(*)::int AS n FROM people GROUP BY category"),
  ]);
  const byCategory = {};
  for (const row of grouped.rows) byCategory[row.category] = row.n;
  byCategory.dog_comms = dogCount.rows[0].n;
  return {
    people: peopleCount.rows[0].n,
    dog_comms: dogCount.rows[0].n,
    byCategory,
  };
}

export async function getPerson(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return getMemory().people.find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM people WHERE id = $1", [id]);
  return q.rows[0] ? normalizePerson(q.rows[0]) : null;
}

export async function getDogComm(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return getMemory().dog_comms.find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM dog_comms WHERE id = $1", [id]);
  return q.rows[0] ? normalizeDog(q.rows[0]) : null;
}

function likeNeedle(q) {
  return `%${String(q).replace(/[%_\\]/g, "\\$&")}%`;
}

function matchesPerson(row, needle) {
  return [row.name, row.role, row.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function matchesDog(row, needle) {
  return [row.handle, row.account_name, row.text]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export async function searchPeople(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const p = await getPool();
  if (!p) {
    const needle = raw.toLowerCase();
    return getMemory()
      .people.filter((r) => matchesPerson(r, needle))
      .slice()
      .sort(comparePeople);
  }
  const res = await p.query(
    `SELECT * FROM people
     WHERE name ILIKE $1 ESCAPE '\\'
        OR role ILIKE $1 ESCAPE '\\'
        OR summary ILIKE $1 ESCAPE '\\'
     ORDER BY event_date DESC, name ASC`,
    [likeNeedle(raw)],
  );
  return res.rows.map(normalizePerson);
}

export async function searchDogComms(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const p = await getPool();
  if (!p) {
    const needle = raw.toLowerCase();
    return getMemory()
      .dog_comms.filter((r) => matchesDog(r, needle))
      .slice()
      .sort(compareDogs);
  }
  const res = await p.query(
    `SELECT * FROM dog_comms
     WHERE handle ILIKE $1 ESCAPE '\\'
        OR account_name ILIKE $1 ESCAPE '\\'
        OR text ILIKE $1 ESCAPE '\\'
     ORDER BY posted_at DESC, handle ASC`,
    [likeNeedle(raw)],
  );
  return res.rows.map(normalizeDog);
}

export async function searchCatalog(q) {
  const [people, dogs] = await Promise.all([searchPeople(q), searchDogComms(q)]);
  const items = [
    ...people.map((row) => ({ type: "person", date: row.event_date, row })),
    ...dogs.map((row) => ({ type: "dog", date: row.posted_at, row })),
  ];
  items.sort((a, b) => {
    const d = String(b.date).localeCompare(String(a.date));
    if (d !== 0) return d;
    const an = a.type === "person" ? a.row.name : a.row.handle;
    const bn = b.type === "person" ? b.row.name : b.row.handle;
    return String(an).localeCompare(String(bn));
  });
  return items;
}

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
