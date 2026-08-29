import fs from "fs";
import path from "path";
import { databaseUrl } from "./env.mjs";
import {
  PromoteError,
  buildPersonRow,
  citeRecords,
  findGoldMatch,
  mergeCites,
  validateIdentifiedPersonInput,
  validatePromoteInput,
} from "./promote.mjs";
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

function normalizeAddRequest(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const created =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || "";
  const processed =
    row.processed_at instanceof Date
      ? row.processed_at.toISOString()
      : row.processed_at || "";
  return {
    id: row.id,
    kind: row.kind === "dog" ? "dog" : "person",
    status: row.status || "pending",
    subject: row.subject || "",
    category: row.category || "",
    event_date: asDate(row.event_date) || "",
    hint_url: row.hint_url || "",
    handle: row.handle || "",
    source_url: row.source_url || "",
    posted_at: asDate(row.posted_at) || "",
    cite_urls: Array.isArray(row.cite_urls) ? row.cite_urls : [],
    extra_urls: Array.isArray(row.extra_urls)
      ? row.extra_urls
      : Array.isArray(payload.extra_urls)
        ? payload.extra_urls
        : [],
    account_name: row.account_name || payload.account_name || "",
    text: row.text || payload.text || "",
    still: row.still || payload.still || "",
    still_credit: row.still_credit || payload.still_credit || "",
    summary: row.summary || payload.summary || "",
    role: row.role || payload.role || "",
    photo: row.photo || payload.photo || "",
    photo_credit: row.photo_credit || payload.photo_credit || "",
    error: row.error || "",
    result: row.result && typeof row.result === "object" ? row.result : null,
    created_at: created,
    processed_at: processed,
  };
}

export function loadSeedFile(seedPath) {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  return {
    people: (raw.people || []).map(normalizePerson),
    dog_comms: (raw.dog_comms || []).map(normalizeDog),
    source_posts: (raw.source_posts || []).map(normalizeSourcePost),
    add_requests: (raw.add_requests || []).map(normalizeAddRequest),
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
    add_requests: (raw.add_requests || []).map(normalizeAddRequest),
    meta: raw.meta || {},
  };
}

function emptyMemory() {
  return { people: [], dog_comms: [], source_posts: [], add_requests: [], meta: {} };
}

export function setMemory(seed) {
  memory = {
    people: (seed.people || []).map(normalizePerson),
    dog_comms: (seed.dog_comms || []).map(normalizeDog),
    source_posts: (seed.source_posts || []).map(normalizeSourcePost),
    add_requests: (seed.add_requests || []).map(normalizeAddRequest),
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

/** Seed wins name/date/category; extra store people and extra cites are kept. */
export function mergeGoldPeople(seedPeople, priorPeople) {
  const priorById = new Map((priorPeople || []).map((row) => [row.id, row]));
  const out = [];
  const seen = new Set();
  for (const gold of seedPeople || []) {
    seen.add(gold.id);
    const prior = priorById.get(gold.id);
    if (!prior) {
      out.push(normalizePerson(gold));
      continue;
    }
    out.push(
      normalizePerson({
        ...gold,
        sources: mergeCites(gold.sources, prior.sources).sources,
      }),
    );
  }
  for (const prior of priorPeople || []) {
    if (!seen.has(prior.id)) out.push(normalizePerson(prior));
  }
  return out;
}

/** Seed dogs win; extra store dogs are kept. Gold rows are not overwritten. */
export function mergeGoldDogs(seedDogs, priorDogs) {
  const goldIds = new Set((seedDogs || []).map((row) => row.id));
  const goldUrls = new Set(
    (seedDogs || []).map((row) => canonicalPublicUrl(row.source_url)).filter(Boolean),
  );
  const extras = (priorDogs || []).filter((row) => {
    if (goldIds.has(row.id)) return false;
    const url = canonicalPublicUrl(row.source_url);
    if (url && goldUrls.has(url)) return false;
    return true;
  });
  return [...(seedDogs || []).map(normalizeDog), ...extras.map(normalizeDog)];
}

export function hydrateFileMemory(dataDir, seed) {
  const prior = loadFileStore(dataDir);
  return setMemory({
    people: mergeGoldPeople(seed.people, prior.people),
    dog_comms: mergeGoldDogs(seed.dog_comms, prior.dog_comms),
    source_posts: prior.source_posts,
    add_requests: prior.add_requests || [],
    meta: seed.meta,
  });
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

export async function findSourcePost({ id, source_url } = {}) {
  const canonical = source_url ? canonicalPublicUrl(source_url) : "";
  if (id) {
    const row = await getSourcePost(id);
    if (!row) {
      throw new PromoteError(`source post not found: ${id}`, "source_not_found");
    }
    if (
      canonical &&
      row.canonical_url !== canonical &&
      canonicalPublicUrl(row.source_url) !== canonical
    ) {
      throw new PromoteError(
        "source id and source_url do not match one post",
        "source_mismatch",
      );
    }
    return row;
  }
  if (!canonical) return null;
  const p = await getPool();
  if (!p) {
    const row = (getMemory().source_posts || []).find(
      (r) => r.canonical_url === canonical || r.source_url === source_url,
    );
    if (!row) {
      throw new PromoteError(
        `source post not found: ${source_url}`,
        "source_not_found",
      );
    }
    return row;
  }
  const q = await p.query(
    "SELECT * FROM source_posts WHERE canonical_url = $1 OR source_url = $2",
    [canonical, source_url],
  );
  if (!q.rows[0]) {
    throw new PromoteError(
      `source post not found: ${source_url}`,
      "source_not_found",
    );
  }
  return normalizeSourcePost(q.rows[0]);
}

export async function lookupSourcePost({ id, source_url } = {}) {
  if (!id && !source_url) return null;
  try {
    return await findSourcePost({ id, source_url });
  } catch (err) {
    if (err instanceof PromoteError && err.code === "source_not_found") return null;
    throw err;
  }
}

function personValues(row) {
  const person = normalizePerson(row);
  return [
    person.id,
    person.category,
    person.name,
    person.role,
    person.event_date,
    person.death_date,
    person.photo,
    person.photo_credit,
    person.net_worth_usd,
    person.net_worth_note,
    person.net_worth_source,
    JSON.stringify(person.sources || []),
    person.summary,
  ];
}

export async function insertPerson(row) {
  const person = normalizePerson(row);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (mem.people.some((r) => r.id === person.id)) {
      throw new PromoteError(`person exists: ${person.id}`, "id_collision");
    }
    mem.people.push(person);
    return person;
  }
  await p.query(
    `INSERT INTO people (
       id, category, name, role, event_date, death_date, photo, photo_credit,
       net_worth_usd, net_worth_note, net_worth_source, sources, summary
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13
     )`,
    personValues(person),
  );
  return person;
}

export async function appendPersonSources(id, incoming) {
  const person = await getPerson(id);
  if (!person) {
    throw new PromoteError(`person not found: ${id}`, "person_not_found");
  }
  const merged = mergeCites(person.sources, incoming);
  if (!merged.added.length) {
    return { person, added: [] };
  }
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const i = mem.people.findIndex((r) => r.id === id);
    mem.people[i] = { ...person, sources: merged.sources };
    return { person: mem.people[i], added: merged.added };
  }
  await p.query("UPDATE people SET sources = $1::jsonb WHERE id = $2", [
    JSON.stringify(merged.sources),
    id,
  ]);
  return { person: { ...person, sources: merged.sources }, added: merged.added };
}

export async function applyIdentifiedPerson(input) {
  const parsed = validateIdentifiedPersonInput(input);
  const people = await listPeople();
  const existing = findGoldMatch(people, parsed);
  const incoming = citeRecords(parsed.cite_urls, parsed.event_date);
  if (existing) {
    const annotated = await appendPersonSources(existing.id, incoming);
    return {
      action: "annotated",
      person: annotated.person,
      added_cites: annotated.added.length,
      people: await countPeople(),
    };
  }
  const person = await insertPerson(buildPersonRow(parsed, people));
  return {
    action: "created",
    person,
    added_cites: person.sources.length,
    people: await countPeople(),
  };
}

export async function promoteSourcePost(input) {
  const parsed = validatePromoteInput(input);
  const sourcePost = await findSourcePost({
    id: parsed.id,
    source_url: parsed.source_url,
  });
  if (!sourcePost) {
    throw new PromoteError("source post not found", "source_not_found");
  }
  const result = await applyIdentifiedPerson(parsed);
  return { ...result, source_post: sourcePost };
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
  const people = await listPeople({
    category: args.category,
    limit: args.limit,
    offset: args.offset,
  });
  return people.map((row) => ({ type: "person", date: row.event_date || "", row }));
}

export async function countCatalog(category) {
  return countPeople(category);
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

export async function findDogMatch({ id, source_url, handle, posted_at } = {}) {
  const canonical = source_url ? canonicalPublicUrl(source_url) : "";
  const handleKey = String(handle || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const date = asDate(posted_at);
  const match = (row) => {
    if (id && row.id === id) return true;
    if (canonical && canonicalPublicUrl(row.source_url) === canonical) return true;
    const rowHandle = String(row.handle || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    if (handleKey && date && rowHandle === handleKey && asDate(row.posted_at) === date) {
      return true;
    }
    return false;
  };
  const p = await getPool();
  if (!p) return (getMemory().dog_comms || []).find(match) || null;
  if (id) {
    const byId = await getDogComm(id);
    if (byId) return byId;
  }
  if (canonical) {
    const q = await p.query(
      "SELECT * FROM dog_comms WHERE source_url = $1",
      [source_url],
    );
    if (q.rows[0]) return normalizeDog(q.rows[0]);
  }
  if (handleKey && date) {
    const q = await p.query(
      "SELECT * FROM dog_comms WHERE lower(regexp_replace(handle, '^@', '')) = $1 AND posted_at = $2",
      [handleKey, date],
    );
    if (q.rows[0]) return normalizeDog(q.rows[0]);
  }
  return null;
}

export async function insertDogComm(row) {
  const dog = normalizeDog(row);
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (mem.dog_comms.some((r) => r.id === dog.id)) {
      throw new PromoteError(`dog comm exists: ${dog.id}`, "id_collision");
    }
    mem.dog_comms.push(dog);
    return dog;
  }
  await p.query(
    `INSERT INTO dog_comms (
       id, posted_at, handle, account_name, text, still, still_credit, source_url, snapshot
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb
     )`,
    [
      dog.id,
      dog.posted_at,
      dog.handle,
      dog.account_name,
      dog.text,
      dog.still,
      dog.still_credit,
      dog.source_url,
      JSON.stringify(dog.snapshot || {}),
    ],
  );
  return dog;
}

export function persistAddRequests(dataDir) {
  if (databaseUrl()) return null;
  const file = path.join(dataDir, "store.json");
  const prior = fs.existsSync(file) ? loadFileStore(dataDir) : emptyMemory();
  return writeFileStore(dataDir, {
    ...prior,
    add_requests: getMemory().add_requests || [],
  });
}

export async function listAddRequests(opts = {}) {
  const p = await getPool();
  if (!p) {
    let rows = getMemory().add_requests || [];
    if (opts.status) rows = rows.filter((r) => r.status === opts.status);
    return rows.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  const params = [];
  let sql = "SELECT * FROM add_requests";
  if (opts.status) {
    params.push(opts.status);
    sql += ` WHERE status = $${params.length}`;
  }
  sql += " ORDER BY created_at ASC";
  const q = await p.query(sql, params);
  return q.rows.map(normalizeAddRequest);
}

export async function getAddRequest(id) {
  if (!id) return null;
  const p = await getPool();
  if (!p) return (getMemory().add_requests || []).find((r) => r.id === id) || null;
  const q = await p.query("SELECT * FROM add_requests WHERE id = $1", [id]);
  return q.rows[0] ? normalizeAddRequest(q.rows[0]) : null;
}

export async function nextPendingAddRequest() {
  const p = await getPool();
  if (!p) {
    return (
      (getMemory().add_requests || [])
        .filter((r) => r.status === "pending")
        .slice()
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null
    );
  }
  const q = await p.query(
    "SELECT * FROM add_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1",
  );
  return q.rows[0] ? normalizeAddRequest(q.rows[0]) : null;
}

function addRequestValues(row) {
  const req = normalizeAddRequest(row);
  return [
    req.id,
    req.kind,
    req.status,
    req.subject || null,
    req.category || null,
    req.event_date || null,
    req.hint_url || null,
    req.handle || null,
    req.source_url || null,
    req.posted_at || null,
    JSON.stringify(req.cite_urls || []),
    JSON.stringify({
      account_name: req.account_name,
      text: req.text,
      still: req.still,
      still_credit: req.still_credit,
      summary: req.summary,
      role: req.role,
      photo: req.photo,
      photo_credit: req.photo_credit,
      extra_urls: req.extra_urls || [],
    }),
    req.error || null,
    req.result ? JSON.stringify(req.result) : null,
    req.created_at || new Date().toISOString(),
    req.processed_at || null,
  ];
}

export async function createAddRequest(input) {
  const now = new Date().toISOString();
  const row = normalizeAddRequest({
    ...input,
    status: input.status || "pending",
    created_at: input.created_at || now,
  });
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    if (!mem.add_requests) mem.add_requests = [];
    const dup = mem.add_requests.find(
      (r) => r.status === "pending" && r.id === row.id,
    );
    if (dup) return dup;
    mem.add_requests.push(row);
    return row;
  }
  await p.query(
    `INSERT INTO add_requests (
       id, kind, status, subject, category, event_date, hint_url, handle, source_url,
       posted_at, cite_urls, payload, error, result, created_at, processed_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15,$16
     )`,
    addRequestValues(row),
  );
  return row;
}

export async function updateAddRequest(id, patch) {
  const prior = await getAddRequest(id);
  if (!prior) {
    throw new PromoteError(`add request not found: ${id}`, "request_not_found");
  }
  const row = normalizeAddRequest({ ...prior, ...patch, id });
  const p = await getPool();
  if (!p) {
    const mem = getMemory();
    const i = (mem.add_requests || []).findIndex((r) => r.id === id);
    if (i < 0) throw new PromoteError(`add request not found: ${id}`, "request_not_found");
    mem.add_requests[i] = row;
    return row;
  }
  await p.query(
    `UPDATE add_requests SET
       kind = $2, status = $3, subject = $4, category = $5, event_date = $6,
       hint_url = $7, handle = $8, source_url = $9, posted_at = $10,
       cite_urls = $11::jsonb, payload = $12::jsonb, error = $13, result = $14::jsonb,
       created_at = $15, processed_at = $16
     WHERE id = $1`,
    addRequestValues(row),
  );
  return row;
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
  return [
    ...people.map((row) => ({ type: "person", date: row.event_date || "", row })),
    ...dogs.map((row) => ({ type: "dog", date: row.posted_at || "", row })),
    ...posts.map((row) => ({ type: "source", date: row.posted_at || "", row })),
  ];
}

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
