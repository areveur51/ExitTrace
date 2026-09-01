import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "url";
import path from "path";
import { THEME_IDS } from "../app/lib/themes.mjs";
import {
  DASH_DIMENSIONS,
  buildDashboard,
  explicitAttr,
  rankDimension,
  topN,
  weekKey,
} from "../app/lib/dashboard.mjs";
import { eventFromLead } from "../app/lib/event-attrs.mjs";
import { breadcrumbItems } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import {
  applyIdentifiedPerson,
  countPeople,
  loadSeedFile,
  setMemory,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];
const MORE = [
  "https://www.example.com/news/casey-vale-quit",
  "https://www.example.net/world/casey-vale-resigned",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("dashboard dimensions stay ExitTrace kinds and event columns, not invented labels", () => {
  assert.deepEqual(
    DASH_DIMENSIONS.map((d) => d.id),
    ["organization", "country", "reason", "branch", "position"],
  );
  assert.equal(THEME_IDS.length, 5);
  assert.ok(!THEME_IDS.includes("dashboard"));
  assert.ok(THEME_IDS.includes("glass"));
  const seed = goldSeed();
  const model = buildDashboard(seed.people);
  assert.equal(model.people, 72);
  assert.ok(model.trends.events >= 72);
  const reason = model.dimensions.find((d) => d.id === "reason");
  const labels = reason.ranked.map((r) => r.label);
  assert.ok(labels.includes("Firings"));
  assert.ok(labels.includes("Resignations"));
  assert.ok(labels.some((l) => String(l).startsWith("Deaths")));
  assert.ok(!labels.includes("Resigned"));
  assert.ok(!labels.includes("Retired"));
  assert.ok(!labels.includes("Fired"));
  assert.ok(!labels.includes("Dead"));
  assert.ok(!labels.includes("Corona Comms"));
  const org = model.dimensions.find((d) => d.id === "organization");
  const country = model.dimensions.find((d) => d.id === "country");
  const branch = model.dimensions.find((d) => d.id === "branch");
  const position = model.dimensions.find((d) => d.id === "position");
  assert.equal(org.ranked.length, 0);
  assert.equal(country.ranked.length, 0);
  assert.equal(branch.ranked.length, 0);
  assert.equal(position.ranked.length, 0);
  assert.equal(DASH_DIMENSIONS.find((d) => d.id === "position").field, "position");
});

test("empty org and country stay empty — role text is not guessed", () => {
  const row = {
    id: "casey-vale",
    name: "Casey Vale",
    role: "Prime Minister of the United Kingdom",
    category: "resignations",
    event_date: "2024-07-01",
    sources: [{ url: CITES[0] }, { url: CITES[1] }],
  };
  assert.equal(explicitAttr(row, "organization"), "");
  assert.equal(explicitAttr(row, "country"), "");
  assert.equal(rankDimension([row], "organization").length, 0);
  assert.equal(rankDimension([row], "country").length, 0);
  assert.equal(rankDimension([row], "branch").length, 0);
  assert.equal(rankDimension([row], "position").length, 0);
});

test("unique-person corona tag raises reason count without a second card", async () => {
  setMemory(goldSeed());
  const before = buildDashboard(goldSeed().people);
  const created = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
    position: "Anchor, CNN",
    organization: "Example Desk",
    country: "USA",
    branch: "News",
    comments: "lead note",
  });
  assert.equal(created.action, "created");
  const tagged = await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-07-20",
    category: "corona_comms",
    cite_urls: MORE,
  });
  assert.equal(tagged.action, "annotated");
  assert.equal(await countPeople(), 73);

  const { listPeople } = await import("../app/lib/store.mjs");
  const people = await listPeople();
  assert.equal(people.filter((r) => r.id === "casey-vale").length, 1);
  const model = buildDashboard(people);
  assert.equal(model.people, 73);
  const reason = model.dimensions.find((d) => d.id === "reason");
  assert.ok(reason.ranked.some((r) => r.key === "arrests" && r.count === 1));
  assert.ok(reason.ranked.some((r) => r.key === "corona_comms" && r.count === 1));
  const vale = people.find((r) => r.id === "casey-vale");
  assert.equal(vale.organization, undefined);
  const arrest = vale.events.find((ev) => ev.kind === "arrests");
  assert.equal(arrest.organization, "Example Desk");
  assert.equal(arrest.position, "Anchor, CNN");
  assert.equal(arrest.comments, "lead note");
  const org = rankDimension(people, "organization");
  assert.deepEqual(org, [
    { key: "Example Desk", label: "Example Desk", href: "/dashboard/organization", count: 1 },
  ]);
  const country = rankDimension(people, "country");
  assert.equal(country[0].label, "USA");
  const branch = rankDimension(people, "branch");
  assert.equal(branch[0].label, "News");
  const position = rankDimension(people, "position");
  assert.equal(position[0].label, "Anchor, CNN");
  assert.equal(position[0].count, 1);
  assert.ok(model.trends.events > before.trends.events);
  assert.equal(eventFromLead({ last_day: "2024-06-15", reason: "Fired", Organization: "Example Desk" }).organization, "Example Desk");
});

test("GET /dashboard and child ranks render HUD chrome and stay fail-closed", async () => {
  setMemory(goldSeed());
  const dash = await requestPage("/dashboard");
  assert.equal(dash.status, 200);
  assert.match(dash.body, /aria-current="page">Dashboard/);
  assert.match(dash.body, /href="\/dashboard"/);
  assert.match(dash.body, /data-key="b"/);
  assert.match(dash.body, /Top 5 by Reason|Top \d+ by Reason/);
  assert.match(dash.body, /All by Organization/);
  assert.match(dash.body, /All by Country/);
  assert.match(dash.body, /All by Reason/);
  assert.match(dash.body, /All by Branch/);
  assert.match(dash.body, /All by Position/);
  assert.match(dash.body, /Trends · total/);
  assert.match(dash.body, /Trends · per month/);
  assert.match(dash.body, /Trends · per week/);
  assert.match(dash.body, /class="dash-svg"/);
  assert.match(dash.body, /data-count=/);
  assert.match(dash.body, /Firings/);
  assert.match(dash.body, /data-theme-set="glass"/);
  assert.match(dash.body, />Glass</);
  assert.doesNotMatch(dash.body, />Resigned</);
  assert.doesNotMatch(dash.body, /data-theme-set="[^"]+"[^>]*>\s*Dashboard/);
  const orgBlock = dash.body.split("Organization")[1] || "";
  assert.match(orgBlock, /No rows on this page/);

  const reason = await requestPage("/dashboard/reason");
  assert.equal(reason.status, 200);
  assert.match(reason.body, /All by Reason/);
  assert.match(reason.body, /href="\/dashboard"/);
  assert.match(reason.body, /aria-current="page">Reason/);
  assert.match(reason.body, /data-page-size="17"/);
  assert.match(reason.body, /data-page-size-set="17"/);
  assert.match(reason.body, /data-page-size-set="34"/);
  assert.match(reason.body, /data-page-size-set="51"/);
  assert.match(reason.body, /href="\/firings"/);
  assert.doesNotMatch(reason.body, /person-card/);

  const org = await requestPage("/dashboard/organization");
  assert.equal(org.status, 200);
  assert.match(org.body, /No rows on this page/);

  const missing = await requestPage("/dashboard/unknown");
  assert.equal(missing.status, 404);
});

test("dashboard breadcrumbs nest children under Dashboard", () => {
  assert.deepEqual(breadcrumbItems({ path: "/dashboard" }), [
    { href: "/", label: "Home" },
    { href: "/dashboard", label: "Dashboard" },
  ]);
  assert.deepEqual(breadcrumbItems({ path: "/dashboard/position" }), [
    { href: "/", label: "Home" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/position", label: "Position" },
  ]);
});

test("topN and week keys stay fail-closed", () => {
  assert.deepEqual(topN([{ count: 3 }, { count: 2 }, { count: 1 }], 2).map((r) => r.count), [3, 2]);
  assert.equal(weekKey("2024-01-04"), "2024-W01");
  assert.equal(weekKey(""), "");
  assert.equal(weekKey("not-a-date"), "");
});
