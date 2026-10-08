import assert from "node:assert/strict";
import { test } from "node:test";
import { breadcrumbItems, epsteinFlightLogSection, identityFilterNav, keymapFooter, personDetail, personRow } from "../app/lib/html.mjs";
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
    normalizeTags(["official", "clearance_revoked", "trump_nickname", "epstein_clients", "epstein_files", "masks", "epstein_transparency_act", "nope"]),
    ["official", "clearance_revoked", "trump_nickname", "epstein_clients", "epstein_files", "masks", "epstein_transparency_act"],
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
  assert.match(firings.body, /href="\/tags\/masks"/);
  assert.match(firings.body, /href="\/tags\/transparency-act"/);

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
  assert.match(files.body, /not a charge/);
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
