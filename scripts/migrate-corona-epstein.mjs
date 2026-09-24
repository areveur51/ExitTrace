import fs from "fs";
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const sql = fs.readFileSync("scripts/bootstrap-corona-epstein-fragment.sql", "utf8");
await c.query(sql);
const cols = await c.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name = 'person_events'
      AND column_name = ANY($1)
    ORDER BY 1`,
  [["notable_group", "title_note", "status"]],
);
console.log("cols", cols.rows.map((r) => r.column_name));
const reg = await c.query(`SELECT to_regclass('public.epstein_flight_legs') AS t`);
console.log("table", reg.rows[0].t);
const pubSql = fs.readFileSync("scripts/add-epstein-flight-legs-publication.sql", "utf8");
try {
  const pub = await c.query(pubSql);
  console.log("pub", pub.rows || pub);
} catch (e) {
  console.log("pub_err", e.message);
}
const pubCheck = await c.query(
  `SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'exittrace_lab_pub' AND tablename = 'epstein_flight_legs'`,
);
console.log("published", pubCheck.rows);
await c.end();
