import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";
import { buildDashboard, voteTallyStanding } from "../app/lib/dashboard.mjs";
import { dashboardBody } from "../app/lib/html.mjs";
import { attributeTagById } from "../app/lib/tags.mjs";
import {
  VOTE_NO_KIND_IDS,
  VOTE_PARTIES,
  VOTE_POSITIONS,
  VOTE_ROLLS,
  houseClerkXmlUrl,
  officialRollPageUrl,
  senateRollCallUrl,
  voteStageLabel,
} from "../app/lib/vote-rolls.mjs";

const ROLLS = Object.values(VOTE_ROLLS);

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader() {},
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || "")))).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

/** "215-214, 1 present, 2 not voting" -> { yea, nay, present, not_voting }. */
function parseTally(text) {
  const m = /^(\d+)-(\d+)/.exec(text);
  const present = /(\d+) present/.exec(text);
  const nv = /(\d+) not voting/.exec(text);
  return {
    yea: Number(m[1]),
    nay: Number(m[2]),
    present: present ? Number(present[1]) : 0,
    not_voting: nv ? Number(nv[1]) : 0,
  };
}

test("every roll has D, R and I counts that sum to the roll totals and the stated tally", () => {
  assert.equal(ROLLS.length, 13);
  for (const roll of ROLLS) {
    for (const pos of VOTE_POSITIONS) {
      const sum = VOTE_PARTIES.reduce((n, p) => n + roll.party[p.id][pos], 0);
      assert.equal(sum, roll.totals[pos], `${roll.id} ${pos}`);
      for (const p of VOTE_PARTIES) {
        assert.ok(Number.isInteger(roll.party[p.id][pos]) && roll.party[p.id][pos] >= 0, `${roll.id} ${p.id} ${pos}`);
      }
    }
    assert.deepEqual({ ...roll.totals }, parseTally(roll.tally), roll.id);
  }
});

test("member totals match the chamber size for each roll", () => {
  for (const roll of ROLLS) {
    const members = VOTE_POSITIONS.reduce((n, pos) => n + roll.totals[pos], 0);
    if (roll.chamber === "Senate") assert.ok(members === 100 || members === 99, `${roll.id} ${members}`);
    else assert.ok(members >= 428 && members <= 435, `${roll.id} ${members}`);
  }
  // Senate vote 7 had 99 sitting senators; vote 372 tied 50-50 and the Vice President voted yea.
  assert.equal(VOTE_POSITIONS.reduce((n, pos) => n + VOTE_ROLLS["S-119-1-7"].totals[pos], 0), 99);
  assert.match(VOTE_ROLLS["S-119-1-372"].note, /Vice President voted yea/);
});

test("spot-check party splits against the official roll calls", () => {
  assert.deepEqual({ ...VOTE_ROLLS["H-119-1-145"].party.R }, { yea: 215, nay: 2, present: 1, not_voting: 2 });
  assert.deepEqual({ ...VOTE_ROLLS["H-119-1-145"].party.D }, { yea: 0, nay: 212, present: 0, not_voting: 0 });
  assert.deepEqual({ ...VOTE_ROLLS["S-119-1-372"].party.R }, { yea: 50, nay: 3, present: 0, not_voting: 0 });
  assert.deepEqual({ ...VOTE_ROLLS["S-119-2-73"].party.I }, { yea: 0, nay: 2, present: 0, not_voting: 0 });
  assert.deepEqual({ ...VOTE_ROLLS["S-119-2-231"].party.D }, { yea: 0, nay: 44, present: 0, not_voting: 1 });
  assert.deepEqual({ ...VOTE_ROLLS["S-119-2-231"].party.R }, { yea: 52, nay: 0, present: 0, not_voting: 1 });
  assert.deepEqual({ ...VOTE_ROLLS["H-118-2-151"].party.R }, { yea: 101, nay: 112, present: 1, not_voting: 4 });
});

test("every roll has an official source URL and roll number", () => {
  for (const roll of ROLLS) {
    assert.ok(Number.isInteger(roll.number) && roll.number > 0, roll.id);
    assert.match(roll.source, /^https:\/\/(clerk\.house\.gov|www\.senate\.gov)\//, roll.id);
    const expected = roll.chamber === "House" ? houseClerkXmlUrl(roll.id, roll.date) : senateRollCallUrl(roll.id);
    assert.equal(roll.source, expected, roll.id);
    assert.ok(roll.source.includes(String(roll.number).padStart(3, "0")), roll.id);
    assert.ok(officialRollPageUrl(roll.id), roll.id);
    assert.ok(attributeTagById(roll.tag), roll.tag);
  }
});

test("procedural rolls are labeled procedural; the event-row label is unchanged", () => {
  assert.equal(voteStageLabel("procedural"), "Procedural (cloture)");
  assert.equal(voteStageLabel(VOTE_ROLLS["S-119-2-73"].stage, VOTE_ROLLS["S-119-2-73"].procedure), "Procedural (cloture)");
  assert.equal(voteStageLabel(VOTE_ROLLS["H-119-2-83"].stage, VOTE_ROLLS["H-119-2-83"].procedure), "Procedural (motion to refer)");
  assert.equal(voteStageLabel(VOTE_ROLLS["H-119-1-145"].stage, VOTE_ROLLS["H-119-1-145"].procedure), "Final passage");
});

test("card counts are separate from tallies and count per roll for recorded-no tags", () => {
  const people = [
    { id: "a", name: "A", category: "notable", events: [{ kind: "save_america_act", event_date: "2026-03-26", roll_call: "S-119-2-73", sources: [] }] },
    { id: "b", name: "B", category: "notable", events: [{ kind: "save_america_act", event_date: "2026-02-11", roll_call: "H-119-2-69", sources: [] }] },
    { id: "c", name: "C", category: "notable", events: [{ kind: "ukraine_aid_flags", event_date: "2024-04-20", sources: [] }] },
    { id: "d", name: "D", category: "notable", tags: ["ukraine_aid_flags", "epstein_transparency_act"], events: [{ kind: "notable", event_date: "2020-01-01", sources: [] }] },
    { id: "e", name: "E", category: "notable", tags: ["save_america_act"], events: [{ kind: "notable", event_date: "2020-01-01", sources: [] }] },
  ];
  const groups = voteTallyStanding(people);
  const tags = groups.map((g) => g.tag);
  for (const id of VOTE_NO_KIND_IDS) assert.ok(tags.includes(id), id);
  for (const id of ["ukraine_aid_flags", "epstein_transparency_act", "harassment_records"]) assert.ok(tags.includes(id), id);
  const save = groups.find((g) => g.tag === "save_america_act");
  assert.deepEqual(save.rolls.map((r) => [r.roll.id, r.cards]), [["H-119-2-69", 1], ["S-119-2-73", 1]]);
  // Vote-fact tags store no roll id: a card counts by tag membership or an event of that kind.
  assert.equal(groups.find((g) => g.tag === "ukraine_aid_flags").rolls[0].cards, 2);
  assert.equal(groups.find((g) => g.tag === "epstein_transparency_act").rolls[0].cards, 1);
  assert.equal(groups.find((g) => g.tag === "harassment_records").rolls[0].cards, 0);
  assert.equal(groups.find((g) => g.tag === "laken_riley_act").rolls.every((r) => r.cards === 0), true);
  // Tallies are the official numbers no matter how many cards exist.
  assert.equal(save.rolls[1].roll.totals.nay, 47);
});

test("dashboardBody renders one panel per roll with party rows and official links", () => {
  const model = buildDashboard([], { id: "all" }, []);
  const html = dashboardBody(model, { path: "/dashboard" });
  assert.match(html, /data-dash-dim="votes"/);
  const panels = html.match(/<article class="dash-vote" data-roll="[^"]+"/g) || [];
  assert.equal(panels.length, ROLLS.length);
  for (const roll of ROLLS) {
    const start = html.indexOf(`data-roll="${roll.id}"`);
    assert.ok(start > 0, roll.id);
    const panel = html.slice(start, html.indexOf("</article>", start));
    assert.ok(panel.includes(`href="${officialRollPageUrl(roll.id)}"`), roll.id);
    for (const p of VOTE_PARTIES) assert.ok(panel.includes(`data-party="${p.id}"`), `${roll.id} ${p.id}`);
    assert.match(panel, /ExitTrace cards on this (roll|tag): 0/);
    assert.equal(panel.includes("Pres</abbr>"), roll.totals.present > 0, roll.id);
    if (roll.stage === "procedural") assert.match(panel, /Procedural \(/, roll.id);
    else assert.match(panel, /Final passage/, roll.id);
    const all = panel.slice(panel.indexOf('data-party="all"'));
    assert.ok(all.includes(`<td class="num">${roll.totals.yea}</td><td class="num">${roll.totals.nay}</td>`), roll.id);
  }
  assert.doesNotMatch(html, /dash-vote[^"]*" style=/);
});

test("GET /dashboard serves the roll-call party panel", async () => {
  setMemory({ people: [] });
  const page = await requestPage("/dashboard");
  assert.equal(page.status, 200);
  assert.match(page.body, /Roll calls · by party/);
  assert.match(page.body, /data-roll="S-119-2-231"/);
  assert.match(page.body, /https:\/\/www\.senate\.gov\/legislative\/LIS\/roll_call_votes\/vote1192\/vote_119_2_00231\.htm/);
  assert.match(page.body, /https:\/\/clerk\.house\.gov\/Votes\/2025145/);
});
