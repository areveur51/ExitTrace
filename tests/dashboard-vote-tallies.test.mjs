import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";
import { buildDashboard, voteCardCounts, voteTallyGroups, voteTallyStanding } from "../app/lib/dashboard.mjs";
import { personEvents } from "../app/lib/promote.mjs";
import { dashboardBody } from "../app/lib/html.mjs";
import { attributeTagById } from "../app/lib/tags.mjs";
import {
  ROLLS,
  VOTE_NO_KIND_IDS,
  VOTE_PARTIES,
  VOTE_POSITIONS,
  VOTE_ROLLS,
  houseClerkXmlUrl,
  officialRollPageUrl,
  rollById,
  senateRollCallUrl,
  voteStageLabel,
} from "../app/lib/vote-rolls.mjs";

/**
 * Official party tallies as published in TALLIES.md for PR #236 (head 49899b5), checked
 * against the House Clerk roll XML and senate.gov on 2026-10-25.
 * [roll, D, R, I, total (each yea/nay/present/not voting), numbers source, stage label, "question; result[; note]").
 */
const TALLIES_MD = [
  ["H-119-1-145", "0/212/0/0", "215/2/1/2", "0/0/0/0", "215/214/1/2", "https://clerk.house.gov/evs/2025/roll145.xml", "Final passage", "On Passage; Passed"],
  ["S-119-1-372", "0/45/0/0", "50/3/0/0", "0/2/0/0", "50/50/0/0", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00372.htm", "Final passage", "On Passage of the Bill, as amended; Passed; Vice President voted yea"],
  ["H-119-1-190", "0/212/0/0", "218/2/0/0", "0/0/0/0", "218/214/0/0", "https://clerk.house.gov/evs/2025/roll190.xml", "Final passage", "On Motion to Concur in the Senate Amendment; Passed"],
  ["H-119-1-102", "4/208/0/1", "216/0/0/4", "0/0/0/0", "220/208/0/5", "https://clerk.house.gov/evs/2025/roll102.xml", "Final passage", "On Passage; Passed"],
  ["H-118-1-209", "0/211/0/2", "219/2/0/1", "0/0/0/0", "219/213/0/3", "https://clerk.house.gov/evs/2023/roll209.xml", "Final passage", "On Passage; Passed"],
  ["H-119-1-23", "46/156/0/13", "217/0/0/1", "0/0/0/0", "263/156/0/14", "https://clerk.house.gov/evs/2025/roll023.xml", "Final passage", "On Passage; Passed"],
  ["S-119-1-7", "12/33/0/0", "52/0/0/0", "0/2/0/0", "64/35/0/0", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00007.htm", "Final passage", "On Passage of the Bill; Passed"],
  ["H-119-2-69", "1/213/0/0", "217/0/0/1", "0/0/0/0", "218/213/0/1", "https://clerk.house.gov/evs/2026/roll069.xml", "Final passage", "On Passage; Passed"],
  ["S-119-2-73", "0/45/0/0", "53/0/0/0", "0/2/0/0", "53/47/0/0", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00073.htm", "Procedural (cloture)", "On the Cloture Motion; Cloture Motion Rejected (3/5 required)"],
  ["S-119-2-231", "0/44/0/1", "52/0/0/1", "0/2/0/0", "52/46/0/2", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00231.htm", "Procedural (cloture)", "On Cloture on the Motion to Proceed; Cloture on the Motion to Proceed Rejected (3/5 required)"],
  ["H-118-2-151", "210/0/0/3", "101/112/1/4", "0/0/0/0", "311/112/1/7", "https://clerk.house.gov/evs/2024/roll151.xml", "Final passage", "On Passage; Passed"],
  ["H-119-1-289", "211/0/0/3", "216/1/0/2", "0/0/0/0", "427/1/0/5", "https://clerk.house.gov/evs/2025/roll289.xml", "Final passage", "On Motion to Suspend the Rules and Pass; Passed"],
  ["H-119-2-83", "182/27/0/5", "175/38/1/4", "0/0/0/0", "357/65/1/9", "https://clerk.house.gov/evs/2026/roll083.xml", "Procedural (motion to refer)", "On Motion to Refer; Passed"],
];

const ynpn = (c) => VOTE_POSITIONS.map((pos) => c[pos]).join("/");

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

test("every ROLLS tally value is identical to TALLIES.md", () => {
  assert.equal(ROLLS.length, TALLIES_MD.length);
  assert.deepEqual(ROLLS.map((r) => r.id).sort(), TALLIES_MD.map((t) => t[0]).sort());
  for (const [id, d, r, i, total, source, stage, line] of TALLIES_MD) {
    const roll = rollById(id);
    assert.ok(roll, id);
    assert.equal(ynpn(roll.party.D), d, `${id} D`);
    assert.equal(ynpn(roll.party.R), r, `${id} R`);
    assert.equal(ynpn(roll.party.I), i, `${id} I`);
    assert.equal(ynpn(roll.totals), total, `${id} total`);
    assert.equal(roll.source, source, `${id} source`);
    assert.equal(voteStageLabel(roll.stage, roll.procedure), stage, `${id} stage`);
    assert.equal(`${roll.question}; ${roll.result}${roll.note ? `; ${roll.note}` : ""}`, line, `${id} question/result/note`);
  }
});

test("party counts live on the one ROLLS catalog; VOTE_ROLLS is its recorded-no view", () => {
  assert.equal(ROLLS.length, 13);
  assert.equal(new Set(ROLLS.map((r) => r.id)).size, ROLLS.length);
  assert.equal(Object.keys(VOTE_ROLLS).length, 10);
  for (const roll of Object.values(VOTE_ROLLS)) assert.equal(roll, rollById(roll.id), roll.id);
  for (const id of ["H-119-1-289", "H-118-2-151", "H-119-2-83"]) {
    assert.equal(rollById(id).tag, undefined, `${id} stays untagged`);
    assert.equal(VOTE_ROLLS[id], undefined, id);
    assert.ok(rollById(id).party && rollById(id).totals, id);
  }
});

test("every roll has D, R and I counts that sum to the roll totals and the stated tally", () => {
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
  assert.equal(VOTE_POSITIONS.reduce((n, pos) => n + rollById("S-119-1-7").totals[pos], 0), 99);
  assert.match(rollById("S-119-1-372").note, /Vice President voted yea/);
});

test("spot-check party splits against the official roll calls", () => {
  assert.deepEqual({ ...rollById("H-119-1-145").party.R }, { yea: 215, nay: 2, present: 1, not_voting: 2 });
  assert.deepEqual({ ...rollById("H-119-1-145").party.D }, { yea: 0, nay: 212, present: 0, not_voting: 0 });
  assert.deepEqual({ ...rollById("S-119-1-372").party.R }, { yea: 50, nay: 3, present: 0, not_voting: 0 });
  assert.deepEqual({ ...rollById("S-119-2-73").party.I }, { yea: 0, nay: 2, present: 0, not_voting: 0 });
  assert.deepEqual({ ...rollById("S-119-2-231").party.D }, { yea: 0, nay: 44, present: 0, not_voting: 1 });
  assert.deepEqual({ ...rollById("S-119-2-231").party.R }, { yea: 52, nay: 0, present: 0, not_voting: 1 });
  assert.deepEqual({ ...rollById("H-118-2-151").party.R }, { yea: 101, nay: 112, present: 1, not_voting: 4 });
});

test("every roll has an official source URL and roll number", () => {
  for (const roll of ROLLS) {
    assert.ok(Number.isInteger(roll.number) && roll.number > 0, roll.id);
    assert.match(roll.source, /^https:\/\/(clerk\.house\.gov|www\.senate\.gov)\//, roll.id);
    const expected = roll.chamber === "House" ? houseClerkXmlUrl(roll.id, roll.date) : senateRollCallUrl(roll.id);
    assert.equal(roll.source, expected, roll.id);
    assert.ok(roll.source.includes(String(roll.number).padStart(3, "0")), roll.id);
    assert.ok(officialRollPageUrl(roll.id), roll.id);
  }
  // Every roll shows under a Tags-menu tag on the dashboard.
  for (const group of voteTallyStanding([])) assert.ok(attributeTagById(group.tag), group.tag);
  assert.equal(voteTallyStanding([]).reduce((n, g) => n + g.rolls.length, 0), ROLLS.length);
});

test("procedural rolls are labeled procedural; the event-row label is unchanged", () => {
  assert.equal(voteStageLabel("procedural"), "Procedural (cloture)");
  assert.equal(voteStageLabel(rollById("S-119-2-73").stage, rollById("S-119-2-73").procedure), "Procedural (cloture)");
  assert.equal(voteStageLabel(rollById("H-119-2-83").stage, rollById("H-119-2-83").procedure), "Procedural (motion to refer)");
  assert.equal(voteStageLabel(rollById("H-119-1-145").stage, rollById("H-119-1-145").procedure), "Final passage");
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

test("card counts come from a single pass over people", () => {
  const reads = { iter: 0, tags: 0, events: 0 };
  const fake = (base) => {
    const row = { ...base };
    const { tags, events } = row;
    delete row.tags;
    delete row.events;
    Object.defineProperty(row, "tags", { enumerable: true, get() { reads.tags += 1; return tags; } });
    Object.defineProperty(row, "events", { enumerable: true, get() { reads.events += 1; return events; } });
    return row;
  };
  const base = [
    { id: "a", name: "A", category: "notable", tags: ["ukraine_aid_flags"], events: [{ kind: "save_america_act", event_date: "2026-03-26", roll_call: "S-119-2-73", sources: [] }] },
    { id: "b", name: "B", category: "notable", tags: [], events: [{ kind: "harassment_records", event_date: "2026-03-04", sources: [] }] },
    { id: "c", name: "C", category: "notable", tags: ["epstein_transparency_act"], events: [{ kind: "big_beautiful_bill_act", event_date: "2025-05-22", roll_call: "H-119-1-145", sources: [] }] },
  ];
  // Event reads for ONE personEvents() call per person, measured on a separate fake set.
  for (const row of base.map(fake)) personEvents(row);
  const perCall = reads.events;
  reads.tags = 0;
  reads.events = 0;
  const rows = base.map(fake);
  const people = { [Symbol.iterator]() { reads.iter += 1; return rows[Symbol.iterator](); } };
  const standing = voteTallyStanding(people);
  assert.equal(reads.iter, 1, "people is iterated once");
  assert.equal(reads.tags, rows.length, "each card's tags are read once");
  assert.equal(reads.events, perCall, "personEvents() runs once per card, not once per roll");
  const cards = Object.fromEntries(standing.flatMap((g) => g.rolls.map((r) => [r.roll.id, r.cards])));
  assert.equal(cards["S-119-2-73"], 1);
  assert.equal(cards["H-119-2-69"], 0);
  assert.equal(cards["H-119-1-145"], 1);
  assert.equal(cards["S-119-1-372"], 0);
  assert.equal(cards["H-118-2-151"], 1);
  assert.equal(cards["H-119-2-83"], 1);
  assert.equal(cards["H-119-1-289"], 1);
  assert.equal(voteCardCounts(base).get("save_america_act|S-119-2-73"), 1);
  assert.equal(voteTallyGroups(), voteTallyGroups(), "groups are built once");
  assert.ok(Object.isFrozen(voteTallyGroups()));
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
