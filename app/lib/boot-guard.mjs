/**
 * Boot write guard for a logical-replication SUBSCRIBER database (Worf).
 *
 * Render's database subscribes to the lab publication (exittrace_lab_pub).
 * Rows in published tables must arrive only by the logical stream. If Render's
 * own boot writes those rows too (seed import, unique-person re-save, bootstrap
 * row backfills), the two writers collide and the apply worker crash-loops
 * (3:31pm ET incident: duplicate key on person_events_pkey).
 *
 * Rule: whenever this database has a subscription, every boot writer that
 * touches a replicated table skips itself. Fail closed: if the check errors,
 * the writes are skipped too. No env flag. A publisher (lab, no subscription)
 * keeps its current behavior.
 *
 * Privileges (checked on PG 16 as the non-superuser app role): count(*) on
 * pg_subscription works, because PUBLIC holds SELECT on every column except
 * subconninfo. Only subconninfo is denied. So the check never selects
 * subconninfo or *. If a server still denies pg_subscription (42501), the
 * check falls back to pg_stat_subscription (a system view readable by
 * PUBLIC). Any other failure fails closed.
 */

const LOG = "[exittrace] boot:";
const INSUFFICIENT_PRIVILEGE = "42501";

/** Subscriptions owned by THIS database (pg_subscription is cluster-wide). */
export const SUBSCRIBER_COUNT_SQL = `SELECT count(*)::int AS n
  FROM pg_subscription
 WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;

/** Fallback when pg_subscription is not readable. Cluster-wide, so it can only over-skip. */
export const SUBSCRIBER_STAT_FALLBACK_SQL = `SELECT count(*)::int AS n FROM pg_stat_subscription`;

export const BOOT_DATA_WRITE_BEGIN = "-- @boot-data-write begin";
export const BOOT_DATA_WRITE_END = "-- @boot-data-write end";

/** The one log line each skipped writer prints. */
export function skipLine(writer) {
  return `${LOG} subscriber DB, skipping ${writer}`;
}

/** SQLSTATE or error name only. Never the message (it can carry a host). */
function errLabel(err) {
  const code = err && typeof err.code === "string" ? err.code : "";
  if (/^[0-9A-Z]{5}$/.test(code)) return code;
  if (/^E[A-Z]+$/.test(code)) return code;
  const name = err && typeof err.name === "string" ? err.name : "";
  return /^[A-Za-z]{1,40}$/.test(name) ? name : "error";
}

function countOf(res) {
  const n = Number(res?.rows?.[0]?.n);
  if (!Number.isInteger(n) || n < 0) {
    const err = new Error("subscriber check returned no count");
    err.code = "no_count";
    throw err;
  }
  return n;
}

/**
 * True when this database is a logical-replication subscriber, or when that
 * cannot be proven false (fail closed). False only on a clean count of 0.
 */
export async function isLogicalSubscriberDb(p, { log = console.log } = {}) {
  if (!p || typeof p.query !== "function") {
    log(`${LOG} subscriber check has no pool; failing closed, boot writes to replicated tables skipped`);
    return true;
  }
  let n;
  try {
    n = countOf(await p.query(SUBSCRIBER_COUNT_SQL));
  } catch (err) {
    if (err?.code !== INSUFFICIENT_PRIVILEGE) {
      log(
        `${LOG} subscriber check failed (${errLabel(err)}); failing closed, boot writes to replicated tables skipped`,
      );
      return true;
    }
    log(`${LOG} pg_subscription not readable (${INSUFFICIENT_PRIVILEGE}); checking pg_stat_subscription`);
    try {
      n = countOf(await p.query(SUBSCRIBER_STAT_FALLBACK_SQL));
    } catch (err2) {
      log(
        `${LOG} subscriber check failed (${errLabel(err2)}); failing closed, boot writes to replicated tables skipped`,
      );
      return true;
    }
  }
  if (n > 0) {
    log(`${LOG} subscriber DB (subscriptions=${n}); boot writes to replicated tables skipped`);
    return true;
  }
  log(`${LOG} publisher/standalone DB (no subscription); boot writers run`);
  return false;
}

/**
 * Drop every "-- @boot-data-write begin ... -- @boot-data-write end" section
 * (row backfills on replicated tables) and keep the DDL. Unbalanced markers
 * throw: better a failed boot than an unguarded write on a subscriber.
 */
export function stripBootDataWrites(sql) {
  const text = String(sql || "");
  const begins = text.split(BOOT_DATA_WRITE_BEGIN).length - 1;
  const ends = text.split(BOOT_DATA_WRITE_END).length - 1;
  if (begins !== ends) {
    throw new Error(`bootstrap SQL has unbalanced @boot-data-write markers (begin=${begins} end=${ends})`);
  }
  const re = /^-- @boot-data-write begin[^\n]*\n[\s\S]*?^-- @boot-data-write end[^\n]*(?:\n|$)/gm;
  const out = text.replace(re, "");
  if (out.includes(BOOT_DATA_WRITE_BEGIN) || out.includes(BOOT_DATA_WRITE_END)) {
    throw new Error("bootstrap SQL has a misplaced @boot-data-write marker");
  }
  return out;
}

/**
 * Database part of server boot(). Dependencies are passed in so tests can
 * prove which writers run. On a subscriber: schema DDL still runs (DDL is not
 * replicated), logical_heal still runs (it manages the subscription; its own
 * et_meta stamp is guarded inside it), and every row writer is skipped.
 */
export async function bootDatabase(pool, deps) {
  const {
    bootstrapSql,
    seed,
    ensureSchema,
    healLogicalApply,
    importSeed,
    migrateUniquePeople,
    log = console.log,
    logError = console.error,
  } = deps;
  const subscriber = await isLogicalSubscriberDb(pool, { log });
  if (subscriber) {
    log(skipLine("bootstrap row backfills (@boot-data-write sections)"));
    await ensureSchema(pool, stripBootDataWrites(bootstrapSql));
  } else {
    await ensureSchema(pool, bootstrapSql);
  }
  try {
    const heal = await healLogicalApply();
    log(
      `[exittrace] logical_heal ok=${heal.ok} reason=${heal.reason || ""} altered=${heal.altered} bounced=${heal.bounced} posted_at=${heal.posted_at_type_after} apply_errors_before=${heal.apply_error_count_before} people=${heal.people} dog_comms=${heal.dog_comms}`,
    );
  } catch (err) {
    logError("[exittrace] logical_heal failed", err);
  }
  if (subscriber) {
    log(skipLine("importSeed"));
    log(skipLine("migrateUniquePeople"));
    return { subscriber: true, imported: null, migrated: null };
  }
  const imported = await importSeed(pool, seed);
  const migrated = await migrateUniquePeople();
  log(
    `[exittrace] postgres people=${imported.people} dog_comms=${imported.dog_comms} operations=${imported.operations || 0} unique=${migrated.people}`,
  );
  return { subscriber: false, imported, migrated };
}
