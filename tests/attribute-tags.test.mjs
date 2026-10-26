import assert from "node:assert/strict";
import { test } from "node:test";
import { breadcrumbItems, epsteinFlightLogSection, identityFilterNav, keymapFooter, personDetail, personRow } from "../app/lib/html.mjs";
import { personMenuDate } from "../app/lib/menu-date.mjs";
import { projectPerson } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";
import { normalizeTags, personTags } from "../app/lib/tags.mjs";

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

test("fact tags stay on the person and are not identity filters", () => {
  assert.deepEqual(
    normalizeTags(["official", "clearance_revoked", "trump_nickname", "epstein_clients", "epstein_files", "masks", "epstein_transparency_act", "endorsements", "harassment_records", "ukraine_aid_flags", "big_beautiful_bill_act", "save_act", "secure_the_border_act", "laken_riley_act", "save_america_act", "s_5271_photo_id", "former_intel_agency_personnel", "fraud", "red_folder", "nope"]),
    ["official", "clearance_revoked", "trump_nickname", "epstein_clients", "epstein_files", "masks", "epstein_transparency_act", "endorsements", "harassment_records", "ukraine_aid_flags", "big_beautiful_bill_act", "save_act", "secure_the_border_act", "laken_riley_act", "save_america_act", "s_5271_photo_id", "former_intel_agency_personnel", "fraud", "red_folder"],
  );
  assert.deepEqual(
    personTags({
      category: "government_stepdowns",
      tags: [],
      events: [{ kind: "government_stepdowns", event_date: "2024-07-21", sources: [] }],
    }),
    ["official"],
  );
  assert.deepEqual(
    personTags({
      category: "clearance",
      tags: [],
      events: [{ kind: "clearance", event_date: "2025-01-20", sources: [] }],
    }),
    [],
  );
  const firings = identityFilterNav("/firings");
  assert.match(firings, /Civilians/);
  assert.doesNotMatch(firings, /Revoked clearances/);
  assert.doesNotMatch(firings, /Trump nicknames/);
  const facts = keymapFooter("/tags/trump-nicknames");
  assert.match(facts, /aria-label="Fact tags"/);
  assert.match(facts, /class="keymap-section">Tags</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/trump-nicknames" aria-current="page"/);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/clearance-revoked"/);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/epstein-clients"/);
  assert.match(facts, />Epstein Clients</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/epstein-files"/);
  assert.match(facts, />Epstein files</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/masks"/);
  assert.match(facts, />Masks</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/transparency-act"/);
  assert.match(facts, />Transparency Act</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/endorsements"/);
  assert.match(facts, />Endorsements</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/harassment-records"/);
  assert.match(facts, />Harassment records</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/ukraine-aid"/);
  assert.match(facts, />Ukraine aid</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/one-big-beautiful-bill-act"/);
  assert.match(facts, /title="One Big Beautiful Bill Act">Big Beautiful Bill</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/save-act"/);
  assert.match(facts, />SAVE Act</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/secure-the-border-act"/);
  assert.match(facts, /title="Secure the Border Act">Secure the Border</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/laken-riley-act"/);
  assert.match(facts, />Laken Riley Act</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/save-america-act"/);
  assert.match(facts, />SAVE America Act</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/s-5271"/);
  assert.match(facts, />S\. 5271</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/former-intel-agency-personnel"/);
  assert.match(facts, />Former intel</);
  assert.doesNotMatch(facts, />Federal investigation</);
  assert.match(facts, /class="keychip keymap-tag" href="\/tags\/fraud"/);
  assert.match(facts, />Fraud</);
  // Red folder is in the Comms menu only (one Red Folder entry).
  assert.doesNotMatch(facts, /class="keychip keymap-tag" href="\/tags\/red-folder"/);
  assert.doesNotMatch(facts, /keymap-tag[^>]*data-key=/);
  assert.doesNotMatch(facts, /Civilians/);
  assert.deepEqual(
    personTags({ category: "epstein_clients", tags: [], events: [] }),
    [],
  );
  assert.deepEqual(
    personTags({ category: "epstein_clients", tags: ["epstein_clients"], events: [] }),
    ["epstein_clients"],
  );
});

test("a stored fact tag is a chip to that list, not a kind", () => {
  const nick = personDetail({
    id: "joe-biden",
    name: "Joe Biden",
    category: "government_stepdowns",
    event_date: "2024-07-21",
    tags: ["official", "trump_nickname"],
    events: [{ kind: "government_stepdowns", event_date: "2024-07-21", sources: [] }],
  });
  assert.match(nick, /href="\/tags\/trump-nicknames"/);
  assert.match(nick, />Trump nicknames</);
  assert.match(nick, />Officials</);
  assert.doesNotMatch(nick, /Revoked clearances/);

  const clearance = personDetail({
    id: "john-brennan",
    name: "John Brennan",
    category: "corona_comms",
    event_date: "2020-04-08",
    country_of_origin: "USA",
    tags: ["clearance_revoked"],
    events: [{ kind: "corona_comms", event_date: "2020-04-08", sources: [] }],
  });
  assert.match(clearance, /href="\/tags\/clearance-revoked"/);
  assert.match(clearance, />Revoked clearances</);
  assert.doesNotMatch(clearance, /Trump nicknames/);
  assert.doesNotMatch(clearance, /lied/);

  const logged = personDetail({
    id: "adam-perrylang",
    name: "Adam Perrylang",
    category: "epstein_clients",
    event_date: "2002-03-01",
    tags: ["epstein_clients"],
    events: [],
  });
  assert.match(logged, /href="\/tags\/epstein-clients"/);
  assert.match(logged, />Epstein Clients</);
  assert.doesNotMatch(logged, /Revoked clearances/);

  const masked = personDetail({
    id: "benjamin-netanyahu",
    name: "Benjamin Netanyahu",
    category: "death_unconfirmed",
    tags: ["official", "masks"],
    events: [{ kind: "death_unconfirmed", event_date: null, sources: [] }],
  });
  assert.match(masked, /href="\/tags\/masks"/);
  assert.match(masked, />Masks</);
  assert.match(masked, />Officials</);

  const act = personDetail({
    id: "clay-higgins",
    name: "Clay Higgins",
    category: "notable",
    event_date: "2025-11-18",
    tags: ["epstein_transparency_act"],
    events: [{ kind: "notable", event_date: "2025-11-18", comments: "", sources: [] }],
  });
  assert.match(act, /href="\/tags\/transparency-act"/);
  assert.match(act, />Transparency Act</);
  assert.doesNotMatch(act, /href="\/tags\/epstein-files"/);

  const endorsed = personDetail({
    id: "mike-rogers-michigan",
    name: "Mike Rogers",
    category: "notable",
    event_date: "2024-03-11",
    tags: ["endorsements"],
    events: [{ kind: "notable", event_date: "2024-03-11", comments: "Endorsed for Senate.", sources: [] }],
  });
  assert.match(endorsed, /href="\/tags\/endorsements"/);
  assert.match(endorsed, />Endorsements</);
  assert.doesNotMatch(endorsed, /href="\/tags\/trump-nicknames"/);

  const vote = projectPerson({
    id: "alma-adams",
    name: "Alma Adams",
    category: "notable",
    event_date: "2019-01-03",
    tags: ["harassment_records"],
    events: [
      { kind: "notable", event_date: "2019-01-03", comments: "Earlier record.", sources: [] },
      {
        kind: "harassment_records",
        event_date: "2026-03-04",
        comments:
          "On March 4, 2026, voted yea to refer H. Res. 1100 to the Committee on Ethics (House Roll Call 83).",
        sources: [
          {
            url: "https://clerk.house.gov/evs/2026/roll083.xml",
            publisher: "Office of the Clerk, U.S. House of Representatives",
            date: "2026-03-04",
          },
        ],
      },
    ],
  });
  assert.equal(vote.category, "notable");
  assert.equal(vote.event_date, "2019-01-03");
  assert.equal(personMenuDate(vote, { tag: "harassment_records" }), "2026-03-04");
  const voteHtml = personDetail(vote);
  assert.match(voteHtml, /href="\/tags\/harassment-records"/);
  assert.match(voteHtml, />Harassment records</);
  assert.match(voteHtml, /data-kind="harassment_records"/);
  assert.match(voteHtml, />H\. Res\. 1100</);
  assert.match(voteHtml, /H\. Res\. 1100/);
  assert.doesNotMatch(voteHtml, /href="\/tags\/epstein-files"/);

  const flags = projectPerson({
    id: "greg-stanton",
    name: "Greg Stanton",
    category: "notable",
    event_date: "2026-03-04",
    tags: ["harassment_records", "ukraine_aid_flags"],
    events: [
      {
        kind: "notable",
        event_date: "2026-03-04",
        comments: "On March 4, 2026, voted yea to refer H. Res. 1100.",
        sources: [],
      },
      {
        kind: "ukraine_aid_flags",
        event_date: "2024-04-20",
        comments:
          "On April 20, 2024, the House passed H.R. 8035, the Ukraine Security Supplemental Appropriations Act, 2024. Rep. Greg Stanton voted yea and waved a Ukrainian flag on the House floor.",
        sources: [
          {
            url: "https://clerk.house.gov/evs/2024/roll151.xml",
            publisher: "Office of the Clerk, U.S. House of Representatives",
            date: "2024-04-20",
          },
        ],
      },
    ],
  });
  assert.equal(flags.category, "notable");
  assert.equal(flags.event_date, "2026-03-04");
  assert.equal(personMenuDate(flags, { tag: "ukraine_aid_flags" }), "2024-04-20");
  const flagsHtml = personDetail(flags);
  assert.match(flagsHtml, /href="\/tags\/ukraine-aid"/);
  assert.match(flagsHtml, />Ukraine aid</);
  assert.match(flagsHtml, /data-kind="ukraine_aid_flags"/);
  assert.match(flagsHtml, />H\. Res\. 1100</);
  assert.match(flagsHtml, />H\.R\. 8035</);
  assert.doesNotMatch(flagsHtml, /not a finding/);
});

test("a dog comms event is a Dog comms chip and supporting media", () => {
  const post = "https://x.com/GovTimWalz/status/2003307743932002380";
  const still = "/media/people/tim-walz/support/govtimwalz-christmas-2025.jpg";
  const row = {
    id: "tim-walz",
    name: "Tim Walz",
    category: "notable",
    event_date: "2025-03-19",
    tags: ["trump_nickname"],
    events: [
      {
        kind: "notable",
        event_date: "2025-03-19",
        comments: "On March 19, 2025, a Minneapolis federal jury convicted Feeding Our Future founder Aimee Bock.",
        sources: [{ url: "https://www.justice.gov/opa/pr/example", date: "2025-03-19", publisher: "Department of Justice" }],
        media: [{ src: "/media/people/tim-walz/support/HT98q7GacAA2jNm.jpg", alt: "Notable still" }],
      },
      {
        kind: "dog_comms",
        event_date: "2025-12-22",
        comments: 'On December 22, 2025, Governor Tim Walz posted a photograph of himself with a dog. He wrote, "Getting ready for Christmas."',
        sources: [{ url: post, date: "2025-12-22", title: "Governor Tim Walz", publisher: "Supporting post", snippet: "" }],
        media: [{ src: still, alt: "Governor Tim Walz with a dog", url: post }],
      },
    ],
  };
  const html = personDetail(row);
  assert.match(html, /href="\/tags\/trump-nicknames"/);
  assert.match(html, /href="\/dog-comms">Dog comms</);
  assert.match(html, /aria-label="Supporting media"/);
  assert.match(html, /govtimwalz-christmas-2025\.jpg/);
  assert.match(html, /datetime="2025-12-22"/);
  assert.match(html, /2003307743932002380/);
  const projected = projectPerson(row);
  assert.equal(projected.category, "notable");
  assert.equal(String(projected.event_date).slice(0, 10), "2025-03-19");
  assert.equal(projected.events.find((ev) => ev.kind === "notable").media[0].src, "/media/people/tim-walz/support/HT98q7GacAA2jNm.jpg");

  const only = personDetail({
    id: "tim-walz",
    name: "Tim Walz",
    category: "notable",
    tags: [],
    events: [{ kind: "dog_comms", event_date: "2025-12-22", sources: [], media: [{ src: still }] }],
  });
  assert.match(only, /href="\/dog-comms">Dog comms</);
});

test("fact-tag lists include only people who already have that tag", async () => {
  // List pages read Postgres when DATABASE_URL is set. Keep this fixture in memory.
  process.env.DATABASE_URL = "";
  setMemory({
    people: [
      {
        id: "gavin-newsom",
        name: "Gavin Newsom",
        category: "nickname",
        tags: ["trump_nickname"],
      },
      {
        id: "james-clapper",
        name: "James Clapper",
        category: "clearance",
        event_date: "2025-01-20",
        tags: ["clearance_revoked"],
      },
      {
        id: "other-person",
        name: "Other Person",
        category: "firings",
        event_date: "2020-01-01",
        tags: ["official"],
        events: [{ kind: "firings", event_date: "2020-01-01", sources: [] }],
      },
      {
        id: "adam-perrylang",
        name: "Adam Perrylang",
        category: "epstein_clients",
        event_date: "2002-03-01",
        tags: ["epstein_clients"],
        events: [],
      },
      {
        id: "marco-rubio",
        name: "Marco Rubio",
        category: "nickname",
        event_date: "2017-10-26",
        tags: ["trump_nickname", "epstein_files"],
        events: [],
      },
      {
        id: "clay-higgins",
        name: "Clay Higgins",
        category: "notable",
        event_date: "2025-11-18",
        tags: ["epstein_transparency_act"],
        events: [],
      },
      {
        id: "mike-rogers-michigan",
        name: "Mike Rogers",
        category: "notable",
        event_date: "2024-03-11",
        tags: ["endorsements"],
        events: [],
      },
      {
        id: "alma-adams",
        name: "Alma Adams",
        category: "notable",
        event_date: "2019-01-03",
        tags: ["harassment_records"],
        events: [
          {
            kind: "harassment_records",
            event_date: "2026-03-04",
            comments: "Voted yea to refer H. Res. 1100.",
            sources: [],
          },
        ],
      },
      {
        id: "gina-haspel",
        name: "Gina Haspel",
        category: "notable",
        event_date: "2018-05-21",
        tags: ["former_intel_agency_personnel"],
        events: [],
      },
    ],
  });

  const nicknames = await requestPage("/tags/trump-nicknames");
  assert.equal(nicknames.status, 200);
  assert.match(nicknames.body, /href="\/people\/gavin-newsom"/);
  assert.doesNotMatch(nicknames.body, /href="\/people\/james-clapper"/);
  assert.doesNotMatch(nicknames.body, /href="\/people\/other-person"/);
  assert.match(nicknames.body, /aria-label="Fact tags"/);
  assert.match(nicknames.body, /href="\/tags\/trump-nicknames" aria-current="page"/);
  assert.doesNotMatch(nicknames.body, /id="fact-tag-filter"/);
  assert.doesNotMatch(nicknames.body, /aria-label="Identity filters"/);

  const clearances = await requestPage("/tags/clearance-revoked");
  assert.equal(clearances.status, 200);
  assert.match(clearances.body, /href="\/people\/james-clapper"/);
  assert.doesNotMatch(clearances.body, /href="\/people\/gavin-newsom"/);
  assert.doesNotMatch(clearances.body, /href="\/people\/other-person"/);

  const firings = await requestPage("/firings");
  assert.match(firings.body, /href="\/people\/other-person"/);
  assert.match(firings.body, /class="keymap-group keymap-tags"/);
  assert.match(firings.body, /href="\/tags\/clearance-revoked"/);
  assert.match(firings.body, /href="\/tags\/trump-nicknames"/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Revoked clearances<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Trump nicknames<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Epstein Clients<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Epstein files<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Masks<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Transparency Act<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Endorsements<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Harassment records<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Ukraine aid<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>One Big Beautiful Bill Act<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>SAVE Act<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Secure the Border Act<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Laken Riley Act<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>SAVE America Act<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>S\. 5271<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Former intel<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Federal investigation<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Fraud<\/option>/);
  assert.doesNotMatch(firings.body, /<option[^>]*>Red folder<\/option>/);
  assert.match(firings.body, /href="\/tags\/masks"/);
  assert.match(firings.body, /href="\/tags\/transparency-act"/);
  assert.match(firings.body, /href="\/tags\/endorsements"/);
  assert.match(firings.body, /href="\/tags\/harassment-records"/);
  assert.match(firings.body, /href="\/tags\/ukraine-aid"/);
  assert.match(firings.body, /href="\/tags\/one-big-beautiful-bill-act"/);
  assert.match(firings.body, /href="\/tags\/save-act"/);
  assert.match(firings.body, /href="\/tags\/secure-the-border-act"/);
  assert.match(firings.body, /href="\/tags\/laken-riley-act"/);
  assert.match(firings.body, /href="\/tags\/save-america-act"/);
  assert.match(firings.body, /href="\/tags\/s-5271"/);
  assert.match(firings.body, /href="\/tags\/former-intel-agency-personnel"/);
  assert.match(firings.body, /href="\/tags\/fraud"/);
  assert.doesNotMatch(firings.body, /href="\/tags\/red-folder"/);

  const clients = await requestPage("/tags/epstein-clients");
  assert.equal(clients.status, 200);
  assert.match(clients.body, /href="\/people\/adam-perrylang"/);
  assert.match(clients.body, /Flight log/);
  assert.doesNotMatch(clients.body, /epstein_clients/);
  assert.doesNotMatch(clients.body, /href="\/people\/gavin-newsom"/);
  assert.doesNotMatch(clients.body, /href="\/people\/james-clapper"/);
  assert.doesNotMatch(clients.body, /href="\/people\/other-person"/);
  assert.match(clients.body, /href="\/tags\/epstein-clients" aria-current="page"/);
  assert.doesNotMatch(clients.body, /id="fact-tag-filter"/);

  const files = await requestPage("/tags/epstein-files");
  assert.equal(files.status, 200);
  assert.match(files.body, /href="\/people\/marco-rubio"/);
  assert.match(files.body, /named in a stored Epstein-files document/);
  assert.doesNotMatch(files.body, /not a charge/);
  assert.doesNotMatch(files.body, /identity filter/);
  assert.doesNotMatch(files.body, /href="\/people\/adam-perrylang"/);
  assert.doesNotMatch(files.body, /href="\/people\/gavin-newsom"/);
  assert.match(files.body, /href="\/tags\/epstein-files" aria-current="page"/);
  assert.doesNotMatch(files.body, /href="\/people\/clay-higgins"/);

  const act = await requestPage("/tags/transparency-act");
  assert.equal(act.status, 200);
  assert.match(act.body, /href="\/people\/clay-higgins"/);
  assert.match(act.body, /427-1/);
  assert.match(act.body, /H\.R\. 4405/);
  assert.doesNotMatch(act.body, /href="\/people\/marco-rubio"/);
  assert.match(act.body, /href="\/tags\/transparency-act" aria-current="page"/);

  const endorsements = await requestPage("/tags/endorsements");
  assert.equal(endorsements.status, 200);
  assert.match(endorsements.body, /href="\/people\/mike-rogers-michigan"/);
  assert.match(endorsements.body, /stored endorsement from Donald Trump/);
  assert.doesNotMatch(endorsements.body, /href="\/people\/clay-higgins"/);
  assert.doesNotMatch(endorsements.body, /href="\/people\/gavin-newsom"/);
  assert.match(endorsements.body, /href="\/tags\/endorsements" aria-current="page"/);
  assert.doesNotMatch(endorsements.body, /href="\/people\/alma-adams"/);

  const records = await requestPage("/tags/harassment-records");
  assert.equal(records.status, 200);
  assert.match(records.body, /href="\/people\/alma-adams"/);
  assert.match(records.body, /357-65/);
  assert.match(records.body, /H\. Res\. 1100/);
  assert.doesNotMatch(records.body, /not a finding/);
  assert.doesNotMatch(records.body, /identity filter/);
  assert.doesNotMatch(records.body, /href="\/people\/clay-higgins"/);
  assert.doesNotMatch(records.body, /href="\/people\/mike-rogers-michigan"/);
  assert.match(records.body, /href="\/tags\/harassment-records" aria-current="page"/);

  const flagsPage = await requestPage("/tags/ukraine-aid");
  assert.equal(flagsPage.status, 200);
  assert.match(flagsPage.body, /voted yea on April 20, 2024/);
  assert.match(flagsPage.body, /H\.R\. 8035/);
  assert.match(flagsPage.body, /311-112/);
  assert.doesNotMatch(flagsPage.body, /waved a Ukrainian flag on the House floor/);
  assert.doesNotMatch(flagsPage.body, /not a finding/);
  assert.doesNotMatch(flagsPage.body, /identity filter/);
  assert.match(flagsPage.body, /href="\/tags\/ukraine-aid" aria-current="page"/);
  const oldFlags = await requestPage("/tags/ukraine-aid-flags");
  assert.equal(oldFlags.status, 302);

  const formerIntel = await requestPage("/tags/former-intel-agency-personnel");
  assert.equal(formerIntel.status, 200);
  assert.match(formerIntel.body, /href="\/people\/gina-haspel"/);
  assert.match(formerIntel.body, /stored former employment at a U\.S\. intelligence agency/);
  assert.doesNotMatch(formerIntel.body, /identity filter/);
  assert.doesNotMatch(formerIntel.body, /href="\/people\/gavin-newsom"/);
  assert.doesNotMatch(formerIntel.body, /href="\/people\/james-clapper"/);
  assert.doesNotMatch(formerIntel.body, /href="\/people\/alma-adams"/);
  assert.match(formerIntel.body, /href="\/tags\/former-intel-agency-personnel" aria-current="page"/);
  assert.match(formerIntel.body, /class="keychip keymap-tag" href="\/tags\/former-intel-agency-personnel"/);
  assert.doesNotMatch(formerIntel.body, /id="fact-tag-filter"/);

  const row = personRow({
    id: "adam-perrylang",
    name: "Adam Perrylang",
    category: "epstein_clients",
    event_date: "2002-03-01",
  });
  assert.match(row, /Flight log/);
  assert.doesNotMatch(row, /epstein_clients/);
  assert.deepEqual(
    breadcrumbItems({
      path: "/people/adam-perrylang",
      label: "Adam Perrylang",
      categoryId: "epstein_clients",
    }),
    [
      { href: "/", label: "Home" },
      { href: "/tags/epstein-clients", label: "Epstein Clients" },
      { href: "/people/adam-perrylang", label: "Adam Perrylang" },
    ],
  );
  const leg = epsteinFlightLogSection([
    {
      flight_date: "1997-12-14",
      dep: "West Palm Beach, FL, United States",
      arr: "Teterboro, NJ, United States",
      aircraft_tail: "N908JE",
      comment: "(Pilot)",
    },
  ]);
  assert.match(leg, /Dec 14, 1997/);
  assert.match(leg, /West Palm Beach, FL, United States → Teterboro, NJ, United States/);
  assert.match(leg, /N908JE/);
  assert.match(leg, /\(Pilot\)/);
  const noted = epsteinFlightLogSection(
    [
      {
        flight_date: "2002-02-09",
        dep: "Miami, FL, United States",
        arr: "Westchester County, NY, United States",
        aircraft_tail: "N908JE",
      },
    ],
    { note: "This is not a charge." },
  );
  assert.match(noted, /This is not a charge/);
  assert.match(noted, /Feb 9, 2002/);
});
