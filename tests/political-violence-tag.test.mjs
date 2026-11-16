import assert from "node:assert/strict";
import { test } from "node:test";
import { keymapFooter, tagMenuItem } from "../app/lib/html.mjs";
import { personMenuDate } from "../app/lib/menu-date.mjs";
import { projectPerson } from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";
import {
  ATTRIBUTE_TAG_IDS,
  attributeTagById,
  attributeTagByPath,
  normalizeTags,
  personTags,
} from "../app/lib/tags.mjs";

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

const stepdown = {
  id: "ada-example",
  name: "Ada Example",
  category: "government_stepdowns",
  event_date: "2017-01-20",
  role: "44th President of the United States",
  tags: ["official", "political_violence"],
  events: [
    {
      kind: "government_stepdowns",
      event_date: "2017-01-20",
      sources: [{ url: "https://apnews.com/example-stepdown", publisher: "Associated Press", date: "2017-01-20" }],
    },
    {
      kind: "political_violence",
      event_date: "2024-07-08",
      position: "Former President",
      comments:
        'A stored graphic names Ada Example, labeled Former President, dated July 8, 2024: "We\'re done talking about the debate."',
      sources: [
        {
          url: "https://x.com/Example/status/1",
          publisher: "Supporting post",
          title: "",
          snippet: "",
          date: "2026-11-13",
        },
      ],
    },
  ],
};

const other = {
  id: "sam-sample",
  name: "Sam Sample",
  category: "firings",
  event_date: "2017-11-21",
  tags: ["official"],
  events: [{ kind: "firings", event_date: "2017-11-21", sources: [] }],
};

test("the tag is a Tags-menu fact, with the full name on the card", () => {
  assert.ok(ATTRIBUTE_TAG_IDS.includes("political_violence"));
  assert.deepEqual(
    normalizeTags(["official", "political_violence", "nope"]),
    ["official", "political_violence"],
  );
  assert.deepEqual(normalizeTags("Political-violence"), ["political_violence"]);
  assert.deepEqual(
    personTags({ id: "ada-example", tags: ["official", "political_violence"] }),
    ["official", "political_violence"],
  );
  const def = attributeTagById("political_violence");
  assert.equal(def.nav, "Political violence");
  assert.equal(def.path, "/tags/political-violence");
  assert.equal(def.menu, undefined);
  assert.equal(def.keymapKey, undefined);
  assert.equal(def.lede, "People named on a stored graphic as having called for political violence.");
  assert.equal(attributeTagByPath("/tags/political-violence")?.id, "political_violence");
  const item = tagMenuItem(def);
  assert.equal(item.label, "Pol. violence");
  assert.equal(item.title, "Political violence");
  const html = keymapFooter("/tags/political-violence");
  assert.match(
    html,
    /class="keychip keymap-tag" href="\/tags\/political-violence" aria-current="page" title="Political violence">Pol. violence</,
  );
  assert.doesNotMatch(html, /keymap-comm" href="\/tags\/political-violence"/);
});

test("the fact event does not replace a stored category or its date", () => {
  const projected = projectPerson(stepdown);
  assert.equal(projected.category, "government_stepdowns");
  assert.equal(projected.event_date, "2017-01-20");
  assert.ok(projected.tags.includes("political_violence"));
  assert.ok(projected.tags.includes("official"));
  assert.equal(personMenuDate(stepdown, { tag: "political_violence" }), "2024-07-08");
  assert.equal(personMenuDate(other, { tag: "political_violence" }), "");
});

test("/tags/political-violence lists only people who store the tag", async () => {
  setMemory({ people: [stepdown, other] });
  const page = await requestPage("/tags/political-violence");
  assert.equal(page.status, 200);
  assert.match(page.body, /People named on a stored graphic as having called for political violence\./);
  assert.match(page.body, /href="\/people\/ada-example"/);
  assert.doesNotMatch(page.body, /href="\/people\/sam-sample"/);
  assert.match(
    page.body,
    /class="keychip keymap-tag" href="\/tags\/political-violence" aria-current="page" title="Political violence">Pol. violence</,
  );
  const detail = await requestPage("/people/ada-example");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /data-kind="political_violence"/);
  assert.match(detail.body, /<h3 class="event-h">Political violence<\/h3>/);
  assert.match(detail.body, /Position · Former President/);
  assert.match(detail.body, /class="person-tags"[\s\S]*?<a class="keychip" href="\/tags\/political-violence">Political violence<\/a>/);
  assert.match(detail.body, /datetime="2017-01-20"/);
  assert.match(detail.body, /datetime="2024-07-08"/);
});
