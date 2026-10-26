/**
 * The one guard for ET_SCRATCH_PG_URL, shared by every real-Postgres test
 * (bootstrap-stripped-pg, multi-event-pg). Worf r4 MED-1: checking only
 * `new URL(...).hostname` let `?host=`, `?hostaddr=`, `?port=`, `?service=`
 * (node-postgres honours them over the URL host) and PG* env send the
 * test's CREATE DATABASE / DDL somewhere else. So:
 *
 *  - the URL is exactly postgres[ql]://<loopback>[:port]/<database>: no
 *    query string, no fragment, no user or password, a loopback host
 *    (localhost, 127.0.0.1, [::1]) and a plain database name that is not
 *    exittrace (lab's database);
 *  - no PG* environment variable may be set, except the two credential-only
 *    ones PGPASSWORD and PGPASSFILE (they cannot change where pg connects);
 *  - the pg config is built from explicit fields, never connectionString;
 *    the user is ET_SCRATCH_PG_USER (default postgres);
 *  - after connect, inet_server_addr() must be loopback (NULL, a socket, is
 *    refused: the config is always TCP), inet_server_port() must be the URL's
 *    port, and current_database() must be the database asked for;
 *  - after connect, the cluster must look like a throwaway (Worf r5 LOW-2): no
 *    database whose name contains exittrace, and no publication, subscription
 *    or replication slot. A loopback-local lab cluster fails here even when
 *    its address and port match.
 *
 * Any violation throws before (or right after) connecting; the caller's test
 * fails, it never skips. Never lab, never Render.
 */
import pg from "pg";

const LOOPBACK_HOSTS = new Map([
  ["localhost", "localhost"],
  ["127.0.0.1", "127.0.0.1"],
  ["[::1]", "::1"],
]);
// Worf r5 ruling: PGPASSWORD and PGPASSFILE stay allowed because they cannot
// change where pg connects, for SCRATCH credentials only. Never set them to a
// lab or Render credential, and never point PGPASSFILE at an operator pgpass
// with lab or Render entries. Prefer PGPASSFILE (mode 0600, path-only);
// PGPASSWORD is for CI and throwaway clusters only (it is visible in
// /proc/<pid>/environ and inherited by children). This helper never logs
// either one. node-pg also falls back to ~/.pgpass when no password is set, so
// the cluster fingerprint check in assertScratchIdentity is what keeps a
// loopback lab cluster out.
const CREDENTIAL_ONLY_PG_ENV = new Set(["PGPASSWORD", "PGPASSFILE"]);
const DB_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const USER_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export class ScratchPgRefused extends Error {}

const refuse = (why) => {
  throw new ScratchPgRefused(`ET_SCRATCH_PG_URL refused: ${why} (scratch Postgres must be a local throwaway cluster, never lab or Render)`);
};

/** PG* variables that are set (non-empty), other than PGPASSWORD / PGPASSFILE. */
export function routingPgEnv(env = process.env) {
  return Object.keys(env)
    .filter((k) => /^PG/.test(k) && !CREDENTIAL_ONLY_PG_ENV.has(k) && env[k] !== undefined && env[k] !== "")
    .sort();
}

function checkDatabaseName(name, what) {
  if (!DB_NAME.test(name)) refuse(`${what} must be a plain name ([A-Za-z_][A-Za-z0-9_]*)`);
  if (/exittrace/i.test(name)) refuse(`${what} must not be an exittrace database`);
  return name;
}

/**
 * Parse and check ET_SCRATCH_PG_URL. Returns { host, port, database, user }
 * (explicit fields only; no password, no connection string). Throws
 * ScratchPgRefused on anything else.
 */
export function scratchPgTarget(raw = process.env.ET_SCRATCH_PG_URL, env = process.env) {
  if (!raw) refuse("unset");
  const pgEnv = routingPgEnv(env);
  if (pgEnv.length) refuse(`PG* environment is set (${pgEnv.join(", ")}); unset it`);
  let u;
  try {
    u = new URL(raw);
  } catch {
    refuse("not a URL");
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") refuse("scheme must be postgres: or postgresql:");
  if (raw.includes("?") || u.search) refuse("no query string allowed (?host=, ?hostaddr=, ?port=, ?service= ... override the URL host)");
  if (raw.includes("#") || u.hash) refuse("no fragment allowed");
  if (raw.slice(u.protocol.length + 2).split("/")[0].includes("@") || u.username || u.password) {
    refuse("no user or password in the URL (user: ET_SCRATCH_PG_USER; password: PGPASSWORD or PGPASSFILE)");
  }
  const host = LOOPBACK_HOSTS.get(u.hostname);
  if (!host) refuse("host must be localhost, 127.0.0.1 or [::1]");
  if (u.port !== "" && !/^[1-9][0-9]{0,4}$/.test(u.port)) refuse("port must be decimal");
  const port = u.port === "" ? 5432 : Number(u.port);
  if (port > 65535) refuse("port out of range");
  const segs = u.pathname.split("/");
  if (segs.length !== 2 || segs[0] !== "") refuse("path must be exactly /<database>");
  const database = checkDatabaseName(segs[1], "database");
  const user = env.ET_SCRATCH_PG_USER === undefined || env.ET_SCRATCH_PG_USER === "" ? "postgres" : env.ET_SCRATCH_PG_USER;
  if (!USER_NAME.test(user)) refuse("ET_SCRATCH_PG_USER must be a plain role name");
  return Object.freeze({ host, port, database, user });
}

/** Explicit pg.Client config for target, optionally on another database of the same cluster. */
export function scratchPgConfig(target, database = target.database, env = process.env) {
  const config = {
    host: target.host,
    port: target.port,
    database: checkDatabaseName(database, "database"),
    user: target.user,
    ssl: false,
  };
  // Scratch credential only (see CREDENTIAL_ONLY_PG_ENV), in-process; never logged.
  // Unset means trust auth or PGPASSFILE.
  if (env.PGPASSWORD !== undefined && env.PGPASSWORD !== "") config.password = env.PGPASSWORD;
  return config;
}

const isLoopbackAddr = (addr) => addr === "::1" || /^127\./.test(addr) || /^::ffff:127\./i.test(addr);

export const SCRATCH_IDENTITY_SQL = `SELECT host(inet_server_addr()) AS addr, inet_server_port() AS port, current_database() AS db,
  (SELECT count(*)::int FROM pg_database WHERE datname ILIKE '%exittrace%') AS exittrace_dbs,
  (SELECT count(*)::int FROM pg_publication) AS publications,
  (SELECT count(*)::int FROM pg_subscription) AS subscriptions,
  (SELECT count(*)::int FROM pg_replication_slots) AS slots`;

/**
 * After connect: the server is a throwaway loopback cluster on target.port, on
 * the database asked for. Any failure refuses (the caller ends the client).
 */
export async function assertScratchIdentity(client, target, database = target.database) {
  const r = await client.query(SCRATCH_IDENTITY_SQL);
  const row = (r && r.rows && r.rows[0]) || {};
  if (row.addr == null || row.addr === "") refuse("connected server address is empty (a socket or unknown); scratch must be TCP loopback");
  if (!isLoopbackAddr(String(row.addr))) refuse(`connected server address ${row.addr} is not loopback`);
  if (Number(row.port) !== target.port) refuse(`connected server port ${row.port} is not ${target.port}`);
  if (row.db !== database) refuse(`connected database ${row.db} is not ${database}`);
  if (/exittrace/i.test(String(row.db))) refuse("connected to an exittrace database");
  const fingerprint = [
    ["exittrace_dbs", "a database named like exittrace exists on this cluster"],
    ["publications", "this database has a publication"],
    ["subscriptions", "this cluster has a subscription"],
    ["slots", "this cluster has a replication slot"],
  ];
  for (const [key, why] of fingerprint) {
    if (!(Number.isInteger(row[key]) && row[key] === 0)) refuse(`${why} (not a throwaway cluster)`);
  }
}

/** Connect to target (or another database of it) and check identity; ends the client on refusal. */
export async function connectScratch(target, database = target.database, env = process.env) {
  const client = new pg.Client(scratchPgConfig(target, database, env));
  await client.connect();
  try {
    await assertScratchIdentity(client, target, database);
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
  return client;
}
