import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { keymapFooter, tagDescriptionBlock, tagDescriptionHtml } from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";
import { ATTRIBUTE_TAGS, MENU_ATTRIBUTE_TAGS, TAG_DESCRIPTIONS, isTagCiteUrl, tagDescription, tagRollIds } from "../app/lib/tags.mjs";
import { ROLLS, VOTE_NO_KIND_IDS, VOTE_ROLLS, houseClerkVoteUrl, houseClerkXmlUrl, officialRollPageUrl, parseRollId, rollById, senateRollCallUrl } from "../app/lib/vote-rolls.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BILL_TAGS = [...VOTE_NO_KIND_IDS, "epstein_transparency_act", "ukraine_aid_flags"];

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
          body: Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || "")))).toString("utf8"),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

function menuTagPaths() {
  const nav = keymapFooter("/").match(/<nav class="keymap-group keymap-tags"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, "Tags menu renders");
  return [...nav[1].matchAll(/<a class="keychip keymap-tag" href="([^"]+)"/g)].map((m) => m[1]);
}

test("every Tags-menu tag has exactly one description in the shared map", () => {
  const paths = menuTagPaths();
  assert.equal(paths.length, 17);
  assert.deepEqual(paths, MENU_ATTRIBUTE_TAGS.map((t) => t.path));
  assert.deepEqual(Object.keys(TAG_DESCRIPTIONS).sort(), MENU_ATTRIBUTE_TAGS.map((t) => t.id).sort());
  for (const tag of MENU_ATTRIBUTE_TAGS) {
    const d = tagDescription(tag.id);
    assert.ok(d, `${tag.id} has a description`);
    assert.ok(d.text.trim().length >= 40, `${tag.id} text is not empty`);
    assert.ok(`${d.text} ${d.votes}`.length <= 900, `${tag.id} stays concise`);
    assert.doesNotMatch(d.text, /\b(allegedly|disclaimer|controversial|critics|supporters)\b/i, `${tag.id} is record-only`);
  }
  assert.equal(tagDescription("nope"), null);
  assert.equal(tagDescription("__proto__"), null);
});

test("bill tags are bills; every other tag is a plain rule with no cites", () => {
  for (const tag of MENU_ATTRIBUTE_TAGS) {
    const d = tagDescription(tag.id);
    if (BILL_TAGS.includes(tag.id)) assert.equal(d.kind, "bill", tag.id);
    else {
      assert.equal(d.kind, "rule", tag.id);
      assert.match(d.text, /^A card gets this tag /, tag.id);
      assert.equal(d.cites.length, 0, tag.id);
      assert.equal(d.votes, "", tag.id);
    }
  }
  assert.match(tagDescription("former_intel_agency_personnel").text, /only when .*U\.S\. intelligence agency/);
});

test("every bill description has 2-3 allowed cites: congress.gov, a clerk or senate roll page, and an outlet where verified", () => {
  for (const id of BILL_TAGS) {
    const d = tagDescription(id);
    const raw = TAG_DESCRIPTIONS[id].cites;
    assert.equal(d.cites.length, raw.length, `${id}: no cite was dropped by the host allowlist`);
    assert.ok(d.cites.length >= 2 && d.cites.length <= 3, `${id} has 2-3 cites`);
    const hosts = d.cites.map((c) => new URL(c.url).hostname.replace(/^www\./, ""));
    assert.ok(hosts.includes("congress.gov"), `${id} cites congress.gov`);
    assert.ok(hosts.some((h) => h === "clerk.house.gov" || h === "senate.gov"), `${id} cites a roll page`);
    for (const c of d.cites) assert.ok(isTagCiteUrl(c.url), `${id} ${c.url}`);
    assert.equal(new Set(d.cites.map((c) => c.url)).size, d.cites.length, `${id} cites are distinct`);
    assert.match(d.votes, /^Recorded votes: .+\.$/, `${id} lists votes`);
    for (const roll of d.rolls) {
      assert.ok(d.votes.includes(roll.tally), `${id} vote line has ${roll.tally}`);
      assert.match(d.votes, new RegExp(`${roll.chamber} (roll|vote) ${roll.number} \\(`), `${id} names ${roll.chamber} ${roll.number}`);
    }
  }
});

test("recorded-no bill tags reuse every VOTE_ROLLS roll of that tag, and roll cites reuse its official URL", () => {
  for (const id of VOTE_NO_KIND_IDS) {
    const d = tagDescription(id);
    const want = Object.values(VOTE_ROLLS).filter((r) => r.tag === id).map((r) => r.id).sort();
    assert.deepEqual(d.rolls.map((r) => r.id).sort(), want, `${id} rolls come from VOTE_ROLLS`);
    for (const c of TAG_DESCRIPTIONS[id].cites.filter((x) => x.roll)) {
      assert.ok(d.cites.some((x) => x.url === officialRollPageUrl(c.roll)), `${id} roll cite ${c.roll}`);
    }
  }
  assert.match(tagDescription("save_act").votes, /House roll 102 \(April 10, 2025\), On Passage: Passed, 220-208, 5 not voting\./);
  assert.match(tagDescription("save_america_act").votes, /House roll 69 \(February 11, 2026\), On Passage: Passed, 218-213, 1 not voting; Senate vote 73 \(March 26, 2026\), On the Cloture Motion, S\. Amdt\. 4732 .*: Cloture Motion Rejected \(3\/5 required\), 53-47\./);
  assert.match(tagDescription("save_america_act").text, /proof of U\.S\. citizenship/);
  assert.match(tagDescription("save_america_act").text, /photo ID/);
  assert.match(tagDescription("save_act").text, /proof of U\.S\. citizenship/);
  assert.doesNotMatch(tagDescription("save_act").text, /photo/i);
});

test("ROLLS is the one roll catalog; VOTE_ROLLS is its recorded-no view", () => {
  const ids = ROLLS.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "roll ids are unique");
  for (const r of ROLLS) {
    const p = parseRollId(r.id);
    assert.equal(r.chamber, p.chamber, r.id);
    assert.equal(r.congress, p.congress, r.id);
    assert.equal(r.session, p.session, r.id);
    assert.equal(r.number, p.number, r.id);
    const urls = r.chamber === "House" ? [houseClerkVoteUrl(r.id, r.date), houseClerkXmlUrl(r.id, r.date)] : [senateRollCallUrl(r.id)];
    assert.deepEqual([...r.urls], urls, `${r.id} urls are derived`);
    assert.ok(Object.isFrozen(r), r.id);
    if ("tag" in r) assert.ok(VOTE_NO_KIND_IDS.includes(r.tag), `${r.id} tag is a recorded-no kind`);
  }
  assert.deepEqual(Object.keys(VOTE_ROLLS).sort(), ROLLS.filter((r) => VOTE_NO_KIND_IDS.includes(r.tag)).map((r) => r.id).sort());
  for (const id of ["H-119-1-289", "H-118-2-151", "H-119-2-83"]) {
    assert.ok(rollById(id), id);
    assert.equal("tag" in rollById(id), false, `${id} is untagged`);
    assert.equal(VOTE_ROLLS[id], undefined, `${id} is not a recorded-no roll`);
  }
  assert.equal(officialRollPageUrl("H-119-1-289"), "https://clerk.house.gov/Votes/2025289");
  assert.equal(officialRollPageUrl("H-118-2-151"), "https://clerk.house.gov/Votes/2024151");
  for (const id of Object.keys(TAG_DESCRIPTIONS)) {
    for (const r of TAG_DESCRIPTIONS[id].rolls || []) assert.equal(typeof r, "string", `${id} names rolls by id only`);
    for (const c of TAG_DESCRIPTIONS[id].cites || []) {
      if (/clerk\.house\.gov|senate\.gov/.test(String(c.url || ""))) assert.fail(`${id} hand-types a roll URL: ${c.url}`);
    }
  }
  assert.deepEqual(tagDescription("epstein_transparency_act").rolls.map((r) => r.id), ["H-119-1-289"]);
  assert.deepEqual(tagDescription("ukraine_aid_flags").rolls.map((r) => r.id), ["H-118-2-151"]);
  const harassment = tagDescription("harassment_records").text;
  const r83 = rollById("H-119-2-83");
  assert.equal(harassment, "A card gets this tag when the member voted yea on House roll 83 on March 4, 2026, the motion to refer H. Res. 1100 to the House Committee on Ethics, which passed 357-65, with 1 present and 9 not voting.");
  assert.equal(r83.tally, "357-65, 1 present, 9 not voting");
  assert.match(ATTRIBUTE_TAGS.find((t) => t.id === "harassment_records").lede, /Roll Call 83 passed 357-65, with 1 present and 9 not voting\./);
});

test("harassment_records names its roll once, as basisRolls on its rule entry", () => {
  assert.deepEqual([...TAG_DESCRIPTIONS.harassment_records.basisRolls], ["H-119-2-83"]);
  assert.equal(TAG_DESCRIPTIONS.harassment_records.rolls, undefined);
  assert.equal(tagDescription("harassment_records").votes, "");
  assert.deepEqual([...tagRollIds("harassment_records")], ["H-119-2-83"]);
  assert.deepEqual([...tagRollIds("ukraine_aid_flags")], ["H-118-2-151"]);
  for (const id of Object.keys(TAG_DESCRIPTIONS)) {
    for (const r of TAG_DESCRIPTIONS[id].basisRolls || []) assert.ok(rollById(r), `${id} basis roll ${r} is in ROLLS`);
  }
});

test("the cite host allowlist takes https .gov and official news hosts only", () => {
  assert.equal(isTagCiteUrl("https://www.congress.gov/bill/119th-congress/house-bill/22"), true);
  assert.equal(isTagCiteUrl("https://clerk.house.gov/Votes/2025102"), true);
  assert.equal(isTagCiteUrl("https://www.npr.org/x"), true);
  assert.equal(isTagCiteUrl("http://www.congress.gov/x"), false);
  assert.equal(isTagCiteUrl("https://www.factcheck.org/x"), false);
  assert.equal(isTagCiteUrl("https://congress.gov.evil.example/x"), false);
  assert.equal(isTagCiteUrl("https://user:pw@www.congress.gov/x"), false);
  assert.equal(isTagCiteUrl("javascript:alert(1)"), false);
  assert.equal(isTagCiteUrl(""), false);
});

test("the description renderer escapes text, labels, and URLs and drops a disallowed link", () => {
  const html = tagDescriptionHtml({
    text: `Bill <script>alert("x")</script> & "q"`,
    votes: "Recorded votes: a <b>.",
    cites: [
      { label: `<img src=x onerror=1>`, url: `https://www.congress.gov/a?b=1&c="d"` },
      { label: "bad", url: "javascript:alert(1)" },
      { label: "off-list", url: "https://example.com/x" },
    ],
  });
  assert.doesNotMatch(html, /<script|<img|<b>/);
  assert.match(html, /Bill &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;q&quot; Recorded votes: a &lt;b&gt;\./);
  assert.match(html, /href="https:\/\/www\.congress\.gov\/a\?b=1&amp;c=&quot;d&quot;"/);
  assert.doesNotMatch(html, /javascript:|example\.com/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.equal(tagDescriptionHtml(null), "");
  assert.equal(tagDescriptionBlock("nope"), "");
});

test("every tag page renders its description above the lede and the list", async () => {
  process.env.DATABASE_URL = "";
  setMemory({ people: [] });
  for (const tag of MENU_ATTRIBUTE_TAGS) {
    const page = await requestPage(tag.path);
    assert.equal(page.status, 200, tag.path);
    const block = tagDescriptionBlock(tag.id);
    assert.ok(block, tag.id);
    const at = page.body.indexOf(block);
    assert.ok(at > 0, `${tag.path} renders its description`);
    assert.equal(page.body.split('class="tag-desc"').length - 1, 1, `${tag.path} renders one description`);
    const lede = page.body.indexOf('<p class="lede">');
    assert.ok(lede > at, `${tag.path} description is above the lede`);
    const d = tagDescription(tag.id);
    for (const c of d.cites) assert.ok(page.body.includes(`href="${c.url.replace(/&/g, "&amp;")}"`), `${tag.path} links ${c.url}`);
  }
  const save = await requestPage("/tags/save-act");
  assert.match(save.body, /<section class="tag-desc" aria-label="About this tag"><p class="tag-desc-text">H\.R\. 22, the SAVE Act, would require documentary proof of U\.S\. citizenship/);
  assert.match(save.body, /href="https:\/\/clerk\.house\.gov\/Votes\/2025102"/);
  const index = await requestPage("/tags");
  assert.doesNotMatch(index.body, /class="tag-desc"/);
});

test("the description wraps at any width and keeps cite links in a wrapping row", () => {
  const css = fs.readFileSync(path.join(ROOT, "app/public/styles.css"), "utf8");
  const block = css.match(/\n\.tag-desc \{([^}]*)\}/);
  assert.ok(block, ".tag-desc rule");
  assert.match(block[1], /overflow-wrap: anywhere;/);
  assert.match(block[1], /max-width: 72ch;/);
  const cites = css.match(/\n\.tag-desc-cites \{([^}]*)\}/);
  assert.ok(cites, ".tag-desc-cites rule");
  assert.match(cites[1], /flex-wrap: wrap;/);
});
