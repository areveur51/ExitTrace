import assert from "node:assert/strict";
import { test } from "node:test";
import zlib from "node:zlib";
import { trendSeries } from "../app/lib/dashboard.mjs";
import { DASH_CHART_MAX_POINTS, downsampleChartSeries, layout } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { loadSeedFile, setMemory } from "../app/lib/store.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function request(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      url: pathname,
      headers: { host: "127.0.0.1", ...headers },
    };
    const chunks = [];
    const res = {
      req,
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, hdrs) {
        this.statusCode = status;
        this.headers = {};
        for (const [k, v] of Object.entries(hdrs || {})) {
          this.headers[String(k).toLowerCase()] = v;
        }
      },
      end(body) {
        if (body) chunks.push(body);
        const raw = Buffer.concat(
          chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
        );
        resolve({
          status: this.statusCode || 200,
          body: raw,
          headers: this.headers,
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("trend total buckets one point per day, not per event", () => {
  const people = [
    {
      id: "a",
      name: "A",
      events: [
        { kind: "firings", event_date: "2024-01-01" },
        { kind: "resignations", event_date: "2024-01-01" },
      ],
    },
    {
      id: "b",
      name: "B",
      events: [{ kind: "arrests", event_date: "2024-01-02" }],
    },
  ];
  const series = trendSeries(people);
  assert.equal(series.events, 3);
  assert.equal(series.total.length, 2);
  assert.equal(series.total[0].key, "2024-01-01");
  assert.equal(series.total[0].count, 2);
  assert.equal(series.total[1].key, "2024-01-02");
  assert.equal(series.total[1].count, 3);
  assert.equal(series.last, 3);
});

test("dashboard chart series downsample keeps first and last", () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({ key: `k${i}`, count: i }));
  const out = downsampleChartSeries(rows, 96);
  assert.ok(out.length <= DASH_CHART_MAX_POINTS);
  assert.ok(out.length < rows.length);
  assert.equal(out[0].key, "k0");
  assert.equal(out[out.length - 1].key, "k399");
});

test("layout versions CSS and JS for long-cache assets", () => {
  const html = layout({ title: "Home", path: "/", heading: "Home", body: "" });
  assert.match(html, /href="\/styles\.css\?v=/);
  assert.match(html, /src="\/app\.js\?v=/);
});

test("styles.css and app.js are cacheable and support gzip plus 304", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const css = await request("/styles.css", { "accept-encoding": "gzip" });
  assert.equal(css.status, 200);
  assert.match(css.headers["cache-control"], /max-age=31536000/);
  assert.match(css.headers["cache-control"], /immutable/);
  assert.equal(css.headers["content-encoding"], "gzip");
  assert.ok(css.headers.etag);
  const unzipped = zlib.gunzipSync(css.body);
  assert.match(unzipped.toString("utf8"), /\.tui-toast/);
  assert.ok(css.body.length < unzipped.length);

  const versioned = await request("/styles.css?v=cache-bust", { "accept-encoding": "gzip" });
  assert.equal(versioned.status, 200);
  assert.equal(versioned.headers.etag, css.headers.etag);

  const again = await request("/styles.css", { "if-none-match": css.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);

  const js = await request("/app.js");
  assert.equal(js.status, 200);
  assert.match(js.headers["cache-control"], /immutable/);
  assert.doesNotMatch(String(js.headers["content-encoding"] || ""), /gzip/);

  const jsGzip = await request("/app.js", { "accept-encoding": "gzip" });
  assert.equal(jsGzip.headers["content-encoding"], "gzip");
  assert.ok(jsGzip.body.length < js.body.length);
});

test("HTML pages gzip when the client accepts it", async () => {
  setMemory(loadSeedFile(path.join(ROOT, "data", "seed.json")));
  const raw = await request("/");
  assert.equal(raw.status, 200);
  assert.doesNotMatch(String(raw.headers["content-encoding"] || ""), /gzip/);
  assert.match(raw.body.toString("utf8"), /ExitTrace/);
  assert.match(raw.body.toString("utf8"), /\/styles\.css\?v=/);

  const gz = await request("/", { "accept-encoding": "gzip" });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.match(String(gz.headers.vary || ""), /Accept-Encoding/);
  const html = zlib.gunzipSync(gz.body).toString("utf8");
  assert.match(html, /ExitTrace/);
  assert.ok(gz.body.length < raw.body.length);
});

test("JPEG portraits are not gzipped", async () => {
  const img = await request("/media/people/james-comey.jpg", {
    "accept-encoding": "gzip",
  });
  assert.equal(img.status, 200);
  assert.match(img.headers["content-type"], /image\/jpeg/);
  assert.match(img.headers["cache-control"], /immutable/);
  assert.doesNotMatch(String(img.headers["content-encoding"] || ""), /gzip/);
  assert.equal(img.body[0], 0xff);
  assert.equal(img.body[1], 0xd8);
  const again = await request("/media/people/james-comey.jpg", {
    "if-none-match": img.headers.etag,
  });
  assert.equal(again.status, 304);
});

test("dashboard total chart downsamples a long day series in HTML", async () => {
  const people = Array.from({ length: 200 }, (_, i) => {
    const day = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    return {
      id: `p${i}`,
      name: `Person ${i}`,
      category: "arrests",
      events: [{ kind: "arrests", event_date: day }],
      sources: ["https://www.example.com/a", "https://www.example.net/b"],
    };
  });
  setMemory({ people, dog_comms: [], operations: [] });
  const page = await request("/dashboard");
  assert.equal(page.status, 200);
  const html = page.body.toString("utf8");
  const pts = html.match(/class="dash-pt"/g) || [];
  assert.equal(pts.length, DASH_CHART_MAX_POINTS);
  assert.match(html, /aria-label="Total events: 96 points from 2020-01-01 to 2020-07-18"/);
});
