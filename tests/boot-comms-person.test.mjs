/** Boot AMEND: unique-person cards (corona/CC DRY), not KIND_COMMS clip list. */
import assert from "node:assert/strict";
import test from "node:test";
import { categoryByPath, PROMOTE_CATEGORY_IDS, PERSON_CATEGORIES } from "../app/lib/categories.mjs";
import {
  KIND_COMMS,
  BOOT_COMMS_PATH,
  BOOT_COMMS_KEYMAP,
  BOOT_COMMS_CATEGORY_ID,
} from "../app/lib/kind-comms.mjs";
import { listPathForPerson } from "../app/lib/display-check.mjs";
import { personEventSection, eventTagRow } from "../app/lib/html.mjs";

test("boot_comms is a person category, not a KIND_COMMS clip catalog", () => {
  assert.equal(KIND_COMMS.boot, undefined);
  assert.equal(BOOT_COMMS_PATH, "/boot-comms");
  assert.equal(BOOT_COMMS_KEYMAP, "k");
  assert.equal(BOOT_COMMS_CATEGORY_ID, "boot_comms");
  const cat = categoryByPath("/boot-comms");
  assert.equal(cat.kind, "person");
  assert.equal(cat.id, "boot_comms");
  assert.equal(cat.nav, "Boot");
  assert.match(cat.blurb, /One card per person/);
  assert.doesNotMatch(cat.blurb, /Catalog cards, not person KEEP/);
  assert.equal(PROMOTE_CATEGORY_IDS.includes("boot_comms"), true);
  assert.ok(PERSON_CATEGORIES.some((c) => c.id === "boot_comms"));
  assert.equal(listPathForPerson("boot_comms"), "/boot-comms");
});

test("Boot PersonEventSection pairs snippet before cite", () => {
  const html = eventTagRow({
    kind: "boot_comms",
    event_date: "2020-12-01",
    sources: [
      {
        url: "https://www.nytimes.com/2020/12/01/us/politics/biden-boot-foot.html",
        snippet: "Joe Biden in a medical walking boot",
        date: "2020-12-01",
      },
    ],
  });
  assert.match(html, /data-kind="boot_comms"/);
  assert.match(html, /data-section="person-event"/);
  assert.match(html, /Joe Biden in a medical walking boot/);
  assert.match(html, /nytimes\.com/);
  // snippet appears before the cite link in the list item
  const snippetAt = html.indexOf("Joe Biden in a medical walking boot");
  const citeAt = html.indexOf("nytimes.com");
  assert.ok(snippetAt >= 0 && citeAt > snippetAt);
});
