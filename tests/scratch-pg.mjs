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
 *  - after connect, inet_server_addr() must be NULL or loopback,
 *    inet_server_port() (or current_setting('port') on a socket) must be the
 *    URL's port, and current_database() must be the database asked for.
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
  // Credential only, in-process; never logged. Unset means trust auth or PGPASSFILE.
  if (env.PGPASSWORD !== undefined && env.PGPASSWORD !== "") config.password = env.PGPASSWORD;
  return config;
}

const isLoopbackAddr = (addr) => addr === "::1" || /^127\./.test(addr) || /^::ffff:127\./i.test(addr);

/** After connect: the server is the loopback cluster on target.port, on the database asked for. */
export async function assertScratchIdentity(client, target, database = target.database) {
  const r = await client.query(
    "SELECT host(inet_server_addr()) AS addr, inet_server_port() AS port, current_setting('port')::int AS setting_port, current_database() AS db",
  );
  const row = r.rows[0] || {};
  if (row.addr != null && !isLoopbackAddr(row.addr)) refuse(`connected server address ${row.addr} is not loopback`);
  const port = row.addr == null ? row.setting_port : row.port;
  if (Number(port) !== target.port) refuse(`connected server port ${port} is not ${target.port}`);
  if (row.db !== database) refuse(`connected database ${row.db} is not ${database}`);
  if (/exittrace/i.test(String(row.db))) refuse("connected to an exittrace database");
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
