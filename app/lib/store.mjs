import fs from "fs";
import path from "path";
import { databaseUrl } from "./env.mjs";
import { canonicalPublicUrl } from "./urls.mjs";

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

function normalizeSourcePost(row) {
  const sourceUrl = row.source_url || "";
  return {
    id: row.id,
    category: row.category,
    source_url: sourceUrl,
    canonical_url: row.canonical_url || canonicalPublicUrl(sourceUrl),
    quoted_url: row.quoted_url || "",
    card_url: row.card_url || "",
    text: row.text || "",
    poster_handle: row.poster_handle || "",
    poster_name: row.poster_name || "",
    posted_at: asDate(row.posted_at),
    media_urls: Array.isArray(row.media_urls) ? row.media_urls : [],
    gold_person_id: row.gold_person_id || null,
  };
}

export function loadSeedFile(seedPath) {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  return {
    people: (raw.people || []).map(normalizePerson),
    dog_comms: (raw.dog_comms || []).map(normalizeDog),
    source_posts: (raw.source_posts || []).map(normalizeSourcePost),
    meta: raw.meta || {},
  };
}

export function loadFileStore(dataDir) {
  const out = path.join(dataDir, "store.json");
  if (!fs.existsSync(out)) return emptyMemory();
  const raw = JSON.parse(fs.readFileSync(out, "utf8"));
  return {
    people: (raw.people || []).map(normalizePerson),
    dog_comms: (raw.dog_comms || []).map(normalizeDog),
    source_posts: (raw.source_posts || []).map(normalizeSourcePost),
    meta: raw.meta || {},
  };
}

function emptyMemory() {
  return { people: [], dog_comms: [], source_posts: [], meta: {} };
}

export function setMemory(seed) {
  memory = {
    people: (seed.people || []).map(normalizePerson),
    dog_comms: (seed.dog_comms || []).map(normalizeDog),
    source_posts: (seed.source_posts || []).map(normalizeSourcePost),
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
    const existing = getMemory().source_posts || [];
    const incoming = seed.source_posts || [];
    setMemory({
      people: seed.people,
      dog_comms: seed.dog_comms,
      source_posts: incoming.length ? incoming : existing,
      meta: seed.meta,
    });
    return {
      people: seed.people.length,
      dog_comms: seed.dog_comms.length,
      source_posts: getMemory().source_posts.length,
    };
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

function compareSources(a, b) {
  const d = String(b.posted_at || "").localeCompare(String(a.posted_at || ""));
  if (d !== 0) return d;
  return String(a.poster_handle || a.source_url || "").localeCompare(
    String(b.poster_handle || b.source_url || ""),
  );
}

function catalogLabel(item) {
  if (item.type === "person") return item.row.name;
  if (item.type === "dog") return item.row.handle;
  return item.row.poster_handle || item.row.source_url || "";
}

function compareCatalog(a, b) {
  const d = String(b.date || "").localeCompare(String(a.date || ""));
  if (d !== 0) return d;
  return String(catalogLabel(a)).localeCompare(String(catalogLabel(b)));
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

function sourcePostWhere(opts = {}) {
  const params = [];
  const clauses = [];
  if (opts.category) {
    params.push(opts.category);
    clauses.push(`category = $${params.length}`);
  }
  if (opts.standalone) {
    clauses.push("gold_person_id IS NULL");
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return { params, where };
}

export async function listSourcePosts(opts = {}) {
  const limit = finiteInt(opts.limit, null);
  const offset = finiteInt(opts.offset, 0);
  const p = await getPool();
  if (!p) {
    let rows = getMemory().source_posts || [];
    if (opts.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts.standalone) rows = rows.filter((r) => !r.gold_person_id);
    return applyWindow(rows.slice().sort(compareSources), limit, offset);
  }
  const { params, where } = sourcePostWhere(opts);
  let sql = `SELECT * FROM source_posts${where} ORDER BY posted_at DESC NULLS LAST, poster_handle ASC`;
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
  return q.rows.map(normalizeSourcePost);
}

export async function countSourcePosts(opts = {}) {
  const p = await getPool();
  if (!p) {
    let rows = getMemory().source_posts || [];
    if (opts.category) rows = rows.filter((r) => r.category === opts.category);
    if (opts.standalone) rows = rows.filter((r) => !r.gold_person_id);
    return rows.length;
  }
  const { params, where } = sourcePostWhere(opts);
  const q = await p.query(`SELECT COUNT(*)::int AS n FROM source_posts${where}`, params);
  return q.rows[0].n;
}

export async function getSourcePost(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return (getMemory().source_posts || []).find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM source_posts WHERE id = $1", [id]);
  return q.rows[0] ? normalizeSourcePost(q.rows[0]) : null;
}

export async function upsertSourcePosts(rows) {
  const incoming = (rows || []).map(normalizeSourcePost).filter((r) => r.id && r.canonical_url);
  let inserted = 0;
  let updated = 0;
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (!mem.source_posts) mem.source_posts = [];
    for (const row of incoming) {
      const i = mem.source_posts.findIndex(
        (r) => r.canonical_url === row.canonical_url || r.id === row.id,
      );
      if (i >= 0) {
        const prev = mem.source_posts[i];
        mem.source_posts[i] = {
          ...prev,
          ...row,
          gold_person_id: row.gold_person_id || prev.gold_person_id || null,
        };
        updated += 1;
      } else {
        mem.source_posts.push(row);
        inserted += 1;
      }
    }
    return { inserted, updated, source_posts: mem.source_posts.length };
  }
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    for (const row of incoming) {
      const existing = await client.query(
        "SELECT id, gold_person_id FROM source_posts WHERE canonical_url = $1 OR id = $2",
        [row.canonical_url, row.id],
      );
      const goldId = row.gold_person_id || existing.rows[0]?.gold_person_id || null;
      await client.query(
        `INSERT INTO source_posts (
           id, category, source_url, canonical_url, quoted_url, card_url, text,
           poster_handle, poster_name, posted_at, media_urls, gold_person_id
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12
         )
         ON CONFLICT (canonical_url) DO UPDATE SET
           category = EXCLUDED.category,
           source_url = EXCLUDED.source_url,
           quoted_url = EXCLUDED.quoted_url,
           card_url = EXCLUDED.card_url,
           text = EXCLUDED.text,
           poster_handle = EXCLUDED.poster_handle,
           poster_name = EXCLUDED.poster_name,
           posted_at = EXCLUDED.posted_at,
           media_urls = EXCLUDED.media_urls,
           gold_person_id = COALESCE(EXCLUDED.gold_person_id, source_posts.gold_person_id)`,
        [
          row.id,
          row.category,
          row.source_url,
          row.canonical_url,
          row.quoted_url,
          row.card_url,
          row.text,
          row.poster_handle,
          row.poster_name,
          row.posted_at,
          JSON.stringify(row.media_urls || []),
          goldId,
        ],
      );
      if (existing.rows.length) updated += 1;
      else inserted += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { inserted, updated, source_posts: await countSourcePosts() };
}

export async function listCatalog(categoryOrOpts, maybeOpts) {
  const args = parseListArgs(categoryOrOpts, maybeOpts);
  const limit = finiteInt(args.limit, null);
  const offset = finiteInt(args.offset, 0);
  const [people, posts] = await Promise.all([
    listPeople(args.category),
    listSourcePosts({ category: args.category, standalone: true }),
  ]);
  const items = [
    ...people.map((row) => ({ type: "person", date: row.event_date || "", row })),
    ...posts.map((row) => ({ type: "source", date: row.posted_at || "", row })),
  ];
  items.sort(compareCatalog);
  return applyWindow(items, limit, offset);
}

export async function countCatalog(category) {
  const [people, posts] = await Promise.all([
    countPeople(category),
    countSourcePosts({ category, standalone: true }),
  ]);
  return people + posts;
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
      source_posts: (getMemory().source_posts || []).length,
      byCategory,
    };
  }
  const [peopleCount, dogCount, postCount, grouped] = await Promise.all([
    p.query("SELECT COUNT(*)::int AS n FROM people"),
    p.query("SELECT COUNT(*)::int AS n FROM dog_comms"),
    p.query("SELECT COUNT(*)::int AS n FROM source_posts"),
    p.query("SELECT category, COUNT(*)::int AS n FROM people GROUP BY category"),
  ]);
  const byCategory = {};
  for (const row of grouped.rows) byCategory[row.category] = row.n;
  byCategory.dog_comms = dogCount.rows[0].n;
  return {
    people: peopleCount.rows[0].n,
    dog_comms: dogCount.rows[0].n,
    source_posts: postCount.rows[0].n,
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

function matchesSource(row, needle) {
  return [
    row.poster_handle,
    row.poster_name,
    row.text,
    row.source_url,
    row.quoted_url,
    row.card_url,
  ]
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

export async function searchSourcePosts(q) {
  const raw = String(q || "").trim();
  if (!raw) return [];
  const p = await getPool();
  if (!p) {
    const needle = raw.toLowerCase();
    return (getMemory().source_posts || [])
      .filter((r) => !r.gold_person_id && matchesSource(r, needle))
      .slice()
      .sort(compareSources);
  }
  const res = await p.query(
    `SELECT * FROM source_posts
     WHERE gold_person_id IS NULL
       AND (
         poster_handle ILIKE $1 ESCAPE '\\'
         OR poster_name ILIKE $1 ESCAPE '\\'
         OR text ILIKE $1 ESCAPE '\\'
         OR source_url ILIKE $1 ESCAPE '\\'
       )
     ORDER BY posted_at DESC NULLS LAST, poster_handle ASC`,
    [likeNeedle(raw)],
  );
  return res.rows.map(normalizeSourcePost);
}

export async function searchCatalog(q) {
  const [people, dogs, posts] = await Promise.all([
    searchPeople(q),
    searchDogComms(q),
    searchSourcePosts(q),
  ]);
  const items = [
    ...people.map((row) => ({ type: "person", date: row.event_date || "", row })),
    ...dogs.map((row) => ({ type: "dog", date: row.posted_at || "", row })),
    ...posts.map((row) => ({ type: "source", date: row.posted_at || "", row })),
  ];
  items.sort(compareCatalog);
  return items;
}

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
