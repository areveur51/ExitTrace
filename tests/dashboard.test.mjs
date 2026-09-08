import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "url";
import path from "path";
import { THEME_IDS } from "../app/lib/themes.mjs";
import fs from "fs";
import {
  DASH_DIMENSIONS,
  DASH_RANGE_STORAGE_KEY,
  buildDashboard,
  dashRangeHref,
  dashRankEvents,
  eventInDashRange,
  explicitAttr,
  filterPeopleToRange,
  occupationAtEvent,
  parseDashRangeSearch,
  rankDimension,
  resolveDashRange,
  serializeDashRange,
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
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";

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
  assert.equal(THEME_IDS.length, 1);
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
    ...NEW_PERSON_LOCK,
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

test("death ranks use death-event occupation only — career history is not counted", () => {
  const people = [
    {
      id: "vale-death",
      name: "Casey Vale",
      role: "U.S. Army veteran and later anchor",
      career: [
        { title: "U.S. Army", organization: "U.S. Army", branch: "Army", start_year: 1953, end_year: 1954 },
        { title: "Reporter", organization: "Other Desk", start_year: 1980, end_year: 1990 },
      ],
      events: [
        {
          kind: "death_celebrity",
          event_date: "2024-06-15",
          position: "Anchor, CNN",
          organization: "Example Desk",
          country: "USA",
          branch: "News",
        },
      ],
    },
    {
      id: "desk-fire",
      name: "Riley Fire",
      career: [{ title: "U.S. Army", organization: "U.S. Army", branch: "Army", start_year: 1953, end_year: 1954 }],
      events: [
        {
          kind: "firings",
          event_date: "2024-07-01",
          position: "Editor",
          organization: "Desk A",
          country: "UK",
          branch: "Print",
        },
      ],
    },
  ];
  assert.equal(dashRankEvents(people[0]).length, 1);
  assert.equal(dashRankEvents(people[0])[0].kind, "death_celebrity");
  assert.equal(occupationAtEvent(people[0].events[0], "organization"), "Example Desk");
  assert.equal(occupationAtEvent(people[0].career[0], "organization"), "");
  const org = rankDimension(people, "organization");
  assert.deepEqual(
    org.map((r) => r.label),
    ["Desk A", "Example Desk"],
  );
  assert.ok(!org.some((r) => /Army|Other Desk/.test(r.label)));
  const branch = rankDimension(people, "branch");
  assert.deepEqual(
    branch.map((r) => r.label),
    ["News", "Print"],
  );
  assert.ok(!branch.some((r) => r.label === "Army"));
  const position = rankDimension(people, "position");
  assert.ok(position.some((r) => r.label === "Anchor, CNN"));
  assert.ok(!position.some((r) => r.label === "Reporter"));
  const country = rankDimension(people, "country");
  assert.ok(country.some((r) => r.label === "USA"));
  const reason = rankDimension(people, "reason");
  assert.ok(reason.some((r) => r.key === "death_celebrity" && r.count === 1));
  assert.ok(reason.some((r) => r.key === "firings" && r.count === 1));
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
  assert.match(dash.body, /data-theme="glass"/);
  assert.doesNotMatch(dash.body, /class="theme-switch"/);
  assert.doesNotMatch(dash.body, /data-theme-set=/);
  assert.doesNotMatch(dash.body, />Cyberdeck</);
  assert.doesNotMatch(dash.body, />Resigned</);
  assert.doesNotMatch(dash.body, /data-theme-set="[^"]+"[^>]*>\s*Dashboard/);
  assert.match(dash.body, /class="dash-range"/);
  assert.match(dash.body, /data-dash-range-set="all"/);
  assert.match(dash.body, /data-dash-range-set="30d"/);
  assert.match(dash.body, /data-dash-range-set="ytd"/);
  assert.match(dash.body, /data-dash-range-set="since-2017"/);
  assert.match(dash.body, /data-dash-range-set="custom"/);
  assert.match(dash.body, /data-dash-range="all"/);
  assert.match(dash.body, /data-date=/);
  assert.match(dash.body, /data-count=/);
  assert.match(dash.body, /class="dash-pt"|class="dash-bar"/);
  assert.match(dash.body, /class="dash-tip"/);
  assert.doesNotMatch(dash.body, /webgl|WebGL|three\.js|dash-3d|preserveDrawingBuffer/i);
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

test("date range filters ranks and trends from the same event_date series", () => {
  const now = new Date("2024-12-31T00:00:00Z");
  const people = [
    {
      id: "old-exit",
      name: "Old Exit",
      events: [{ kind: "firings", event_date: "2018-06-01", organization: "Desk A" }],
    },
    {
      id: "new-exit",
      name: "New Exit",
      events: [
        { kind: "resignations", event_date: "2024-12-10", organization: "Desk B" },
        { kind: "arrests", event_date: "2019-03-01", organization: "Desk C" },
      ],
    },
  ];
  const ytd = resolveDashRange({ id: "ytd" }, { now });
  assert.equal(ytd.from, "2024-01-01");
  assert.equal(ytd.to, "2024-12-31");
  assert.equal(eventInDashRange("2024-12-10", ytd), true);
  assert.equal(eventInDashRange("2018-06-01", ytd), false);
  const sliced = filterPeopleToRange(people, ytd);
  assert.equal(sliced.length, 1);
  assert.equal(sliced[0].id, "new-exit");
  assert.equal(sliced[0].events.length, 1);
  assert.equal(sliced[0].events[0].kind, "resignations");
  const model = buildDashboard(people, ytd);
  assert.equal(model.people, 1);
  assert.equal(model.trends.events, 1);
  const org = rankDimension(people, "organization", ytd);
  assert.deepEqual(
    org.map((r) => r.label),
    ["Desk B"],
  );
  const thirty = resolveDashRange({ id: "30d" }, { now });
  assert.equal(thirty.from, "2024-12-01");
  const since = resolveDashRange({ id: "since-2017" }, { now });
  assert.equal(since.from, "2017-01-01");
  assert.equal(filterPeopleToRange(people, since).length, 2);
  const custom = resolveDashRange({ id: "custom", from: "2018-01-01", to: "2018-12-31" });
  assert.equal(filterPeopleToRange(people, custom).length, 1);
  assert.equal(serializeDashRange(custom), "custom:2018-01-01:2018-12-31");
  assert.equal(parseDashRangeSearch("range=ytd", { now }).id, "ytd");
  assert.equal(
    parseDashRangeSearch("", { cookie: `${DASH_RANGE_STORAGE_KEY}=30d`, now }).id,
    "30d",
  );
  assert.match(dashRangeHref("/dashboard/reason", ytd), /range=ytd/);
});

test("GET /dashboard honors the same range on slices and trend points", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
    organization: "Example Desk",
  });
  const custom = await requestPage("/dashboard?range=custom&from=2024-01-01&to=2024-12-31");
  assert.equal(custom.status, 200);
  assert.match(custom.body, /data-dash-range="custom:2024-01-01:2024-12-31"/);
  assert.match(custom.body, /data-date="2024-06-15"/);
  assert.match(custom.body, /Example Desk/);
  assert.doesNotMatch(custom.body, /webgl|WebGL|three\.js|dash-3d/i);
  const child = await requestPage("/dashboard/organization?range=custom&from=2024-01-01&to=2024-12-31");
  assert.match(child.body, /Example Desk/);
  assert.match(child.body, /data-dash-range-set="30d"/);
  const empty = await requestPage("/dashboard?range=custom&from=2030-01-01&to=2030-12-31");
  assert.match(empty.body, /0 people|0<\/span>/);
  assert.doesNotMatch(empty.body, /Example Desk/);
});

test("app.js persists dash range and paints hover tooltips without a fetch", () => {
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  assert.match(js, /exittrace-dash-range/);
  assert.match(js, /data-dash-range-set/);
  assert.match(js, /bindDashTips|dash-tip/);
  assert.match(js, /data-date/);
  assert.match(js, /data-count/);
  assert.doesNotMatch(js, /fetch\(/);
  assert.doesNotMatch(js, /webgl|WebGL|THREE|getContext\(\s*["']webgl/i);
});
