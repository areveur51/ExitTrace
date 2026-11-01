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
  tags: ["official", "no_one_above_the_law"],
  events: [
    {
      kind: "government_stepdowns",
      event_date: "2017-01-20",
      sources: [{ url: "https://apnews.com/example-stepdown", publisher: "Associated Press", date: "2017-01-20" }],
    },
    {
      kind: "no_one_above_the_law",
      event_date: "2019-03-24",
      position: "Former President",
      comments:
        'A graphic titled "NO ONE IS ABOVE THE LAW" and "DEMOCRATS WHO SAID IT" prints this line under Ada Example, labeled Former President, dated March 24, 2019: "No one is above the law."',
      sources: [
        {
          url: "https://x.com/Example/status/1",
          publisher: "Supporting post",
          title: "",
          snippet: "",
          date: "2026-10-31",
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
  assert.ok(ATTRIBUTE_TAG_IDS.includes("no_one_above_the_law"));
  assert.deepEqual(
    normalizeTags(["official", "no_one_above_the_law", "nope"]),
    ["official", "no_one_above_the_law"],
  );
  assert.deepEqual(normalizeTags("No-one-above-the-law"), ["no_one_above_the_law"]);
  assert.deepEqual(
    personTags({ id: "ada-example", tags: ["official", "no_one_above_the_law"] }),
    ["official", "no_one_above_the_law"],
  );
  const def = attributeTagById("no_one_above_the_law");
  assert.equal(def.nav, "No One Is Above The Law");
  assert.equal(def.path, "/tags/no-one-is-above-the-law");
  assert.equal(def.menu, undefined);
  assert.equal(def.keymapKey, undefined);
  assert.equal(def.lede, "People named on a stored graphic under the line that no one is above the law.");
  assert.equal(attributeTagByPath("/tags/no-one-is-above-the-law")?.id, "no_one_above_the_law");
  const item = tagMenuItem(def);
  assert.equal(item.label, "Above the Law");
  assert.equal(item.title, "No One Is Above The Law");
  const html = keymapFooter("/tags/no-one-is-above-the-law");
  assert.match(
    html,
    /class="keychip keymap-tag" href="\/tags\/no-one-is-above-the-law" aria-current="page" title="No One Is Above The Law">Above the Law</,
  );
  assert.doesNotMatch(html, /keymap-comm" href="\/tags\/no-one-is-above-the-law"/);
  assert.match(
    html,
    /class="keychip keymap-comm" href="\/tags\/black-eye" data-key="y"><span class="br">\[<\/span>y<span class="br">\]<\/span> Left Eye</,
  );
  assert.equal(html.split('href="/tags/black-eye"').length - 1, 1);
});

test("the fact event does not replace a stored category or its date", () => {
  const projected = projectPerson(stepdown);
  assert.equal(projected.category, "government_stepdowns");
  assert.equal(projected.event_date, "2017-01-20");
  assert.ok(projected.tags.includes("no_one_above_the_law"));
  assert.ok(projected.tags.includes("official"));
  assert.equal(personMenuDate(stepdown, { tag: "no_one_above_the_law" }), "2019-03-24");
  assert.equal(personMenuDate(other, { tag: "no_one_above_the_law" }), "");
});

test("/tags/no-one-is-above-the-law lists only people who store the tag", async () => {
  setMemory({ people: [stepdown, other] });
  const page = await requestPage("/tags/no-one-is-above-the-law");
  assert.equal(page.status, 200);
  assert.match(page.body, /People named on a stored graphic under the line that no one is above the law\./);
  assert.match(page.body, /href="\/people\/ada-example"/);
  assert.doesNotMatch(page.body, /href="\/people\/sam-sample"/);
  assert.match(
    page.body,
    /class="keychip keymap-tag" href="\/tags\/no-one-is-above-the-law" aria-current="page" title="No One Is Above The Law">Above the Law</,
  );
  const detail = await requestPage("/people/ada-example");
  assert.equal(detail.status, 200);
  assert.match(detail.body, /data-kind="no_one_above_the_law"/);
  assert.match(detail.body, /<h3 class="event-h">No One Is Above The Law<\/h3>/);
  assert.match(detail.body, /Position · Former President/);
  assert.match(detail.body, /class="person-tags"[\s\S]*?<a class="keychip" href="\/tags\/no-one-is-above-the-law">No One Is Above The Law<\/a>/);
  assert.match(detail.body, /datetime="2017-01-20"/);
  assert.match(detail.body, /datetime="2019-03-24"/);
  assert.doesNotMatch(detail.body, /treason|tribunal|EPIC JUSTICE/i);
});
