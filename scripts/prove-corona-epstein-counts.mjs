import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = await c.query(`SELECT
  (SELECT count(*)::int FROM epstein_flight_legs) AS legs,
  (SELECT count(*)::int FROM epstein_flight_legs WHERE person_id = $1) AS maxwell_legs,
  (SELECT count(*)::int FROM person_events WHERE kind = 'corona_comms') AS corona_tags,
  (SELECT count(*)::int FROM people) AS people`, ["ghislaine-maxwell"]);
console.log(JSON.stringify(q.rows[0]));
await c.end();
