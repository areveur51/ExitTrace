import assert from "node:assert/strict";
import { test } from "node:test";
import { attributeTagNav, identityFilterNav, personDetail } from "../app/lib/html.mjs";
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
    normalizeTags(["official", "clearance_revoked", "trump_nickname", "nope"]),
    ["official", "clearance_revoked", "trump_nickname"],
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
  const facts = attributeTagNav("/tags/trump-nicknames");
  assert.match(facts, /aria-label="Fact tags"/);
  assert.match(facts, /Trump nicknames/);
  assert.match(facts, /Revoked clearances/);
  assert.doesNotMatch(facts, /Civilians/);
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
});

test("fact-tag lists include only people who already have that tag", async () => {
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
    ],
  });

  const nicknames = await requestPage("/tags/trump-nicknames");
  assert.equal(nicknames.status, 200);
  assert.match(nicknames.body, /href="\/people\/gavin-newsom"/);
  assert.doesNotMatch(nicknames.body, /href="\/people\/james-clapper"/);
  assert.doesNotMatch(nicknames.body, /href="\/people\/other-person"/);
  assert.match(nicknames.body, /aria-label="Fact tags"/);
  assert.doesNotMatch(nicknames.body, /aria-label="Identity filters"/);

  const clearances = await requestPage("/tags/clearance-revoked");
  assert.equal(clearances.status, 200);
  assert.match(clearances.body, /href="\/people\/james-clapper"/);
  assert.doesNotMatch(clearances.body, /href="\/people\/gavin-newsom"/);
  assert.doesNotMatch(clearances.body, /href="\/people\/other-person"/);

  const firings = await requestPage("/firings");
  assert.match(firings.body, /href="\/people\/other-person"/);
  assert.doesNotMatch(firings.body, /Revoked clearances/);
  assert.doesNotMatch(firings.body, /Trump nicknames/);
});
