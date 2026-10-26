import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { byDateDescThenName, commsCatalogItems, commsCatalogList } from "../app/lib/html.mjs";
import { KIND_COMMS, commsKindByPersonTag } from "../app/lib/kind-comms.mjs";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";

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

// Fictional people and posts only.
const ada = { id: "ada-folder", name: "Ada Folder", category: "notable", event_date: "2026-01-02", tags: ["red_folder"], events: [] };
const cy = { id: "cy-linked", name: "Cy Linked", category: "notable", event_date: "2025-05-05", tags: ["official"], events: [] };
const eve = { id: "eve-eagle", name: "Eve Eagle", category: "notable", event_date: "2025-02-02", tags: ["eagle", "ronald"], events: [] };
const post = (id, posted_at, extra = {}) => ({
  id,
  posted_at,
  handle: "@ExampleDesk",
  account_name: "Example Desk",
  text: "Official post.",
  source_url: `https://example.gov/${id}`,
  ...extra,
});

test("each comms spec carries a fixed personTag and showLinkedPeople; tag lookup is that map only", () => {
  const map = Object.fromEntries(Object.values(KIND_COMMS).map((s) => [s.id, s.personTag]));
  assert.deepEqual(map, { dog: null, red_folder: "red_folder", eagle: "eagle", ronald: "ronald", shot: null });
  for (const spec of Object.values(KIND_COMMS)) assert.equal(spec.showLinkedPeople, true);
  assert.equal(commsKindByPersonTag("red_folder").id, "red_folder");
  assert.equal(commsKindByPersonTag("eagle").id, "eagle");
  for (const bad of ["", "dog", "red-folder", "RED_FOLDER", "fraud", "red_folder ", null, undefined]) {
    assert.equal(commsKindByPersonTag(bad), null, String(bad));
  }
});

test("byDateDescThenName: newest first, undated last, then name", () => {
  const items = [
    { date: "", row: { name: "Zed" } },
    { date: "2024-01-01", row: { name: "Bea" } },
    { date: "2025-01-01", row: { handle: "@b" } },
    { date: "2024-01-01", row: { name: "Abe" } },
  ];
  assert.deepEqual(items.sort(byDateDescThenName).map((i) => i.row.name || i.row.handle), ["@b", "Abe", "Bea", "Zed"]);
});

test("commsCatalogItems: linked post becomes the person card, tagged person is not repeated", () => {
  const linkedPost = post("rf-linked", "2026-02-01", { snapshot: { person_ids: ["ada-folder"] } });
  const items = commsCatalogItems([linkedPost, post("rf-bare", "2025-01-01")], [ada], [ada]);
  assert.deepEqual(items.map((i) => [i.type, i.row.id]), [["person", "ada-folder"], ["post", "rf-bare"]]);
});

for (const [path, table] of [["/red-folder-comms", "red_folder_comms"], ["/eagle-comms", "eagle_comms"], ["/ronald-comms", "ronald_comms"]]) {
  test(`${path} shows linked people as cards and unlinked posts as rows, like dog comms`, async () => {
    const id = table.split("_comms")[0].replace("_", "-");
    setMemory({
      people: [ada, cy, eve],
      [table]: [post(`${id}-linked`, "2025-05-05", { snapshot: { person_ids: ["cy-linked"] } }), post(`${id}-bare`, "2024-03-03")],
    });
    const page = await requestPage(path);
    assert.equal(page.status, 200);
    assert.match(page.body, /href="\/people\/cy-linked"/);
    assert.doesNotMatch(page.body, new RegExp(`href="${path}/${id}-linked"`));
    assert.match(page.body, new RegExp(`href="${path}/${id}-bare"`));
    // Only red_folder is a registered person tag; eagle/ronald map but invent no cards.
    assert.equal(/href="\/people\/ada-folder"/.test(page.body), path === "/red-folder-comms");
    assert.doesNotMatch(page.body, /href="\/people\/eve-eagle"/);
  });
}

test("red folder: a tagged person already linked by a post shows once", async () => {
  setMemory({ people: [ada, cy], red_folder_comms: [post("rf-ada", "2026-03-01", { snapshot: { person_ids: ["ada-folder"] } })] });
  for (const path of ["/red-folder-comms"]) {
    const page = await requestPage(path);
    assert.equal(page.status, 200);
    assert.equal(page.body.match(/href="\/people\/ada-folder"/g).length, 1, path);
    assert.doesNotMatch(page.body, /href="\/people\/cy-linked"/);
  }
});

test("N3: near-miss comms and tag slugs 404 without echoing the input", async () => {
  setMemory({ people: [ada], red_folder_comms: [post("rf-1", "2026-01-01")] });
  const paths = [
    "/red-folder-commsx",
    "/Red-Folder-Comms",
    "/red_folder-comms",
    "/eagle-comms/",
    "/ronald-comms/",
    "/tags/red-folderx",
    "/tags/Red-Folder",
    "/tags/red_folder",
    "/tags/eagle",
    "/tags/ronald",
    "/dog-commsx",
  ];
  for (const p of paths) {
    const page = await requestPage(p);
    assert.equal(page.status, 404, p);
    assert.equal(page.body, "Not found\n", p);
  }
});

test("N3: query params cannot carry a tag into a comms page", async () => {
  setMemory({ people: [ada, eve], dog_comms: [post("dog-1", "2026-01-01")], eagle_comms: [post("eagle-1", "2026-01-01")] });
  for (const p of ["/dog-comms?tag=red_folder", "/dog-comms?tags=red_folder&personTag=red_folder", "/eagle-comms?tag=eagle&tags=red_folder"]) {
    const page = await requestPage(p);
    assert.equal(page.status, 200, p);
    assert.doesNotMatch(page.body, /href="\/people\//, p);
    assert.ok(!page.body.includes("personTag"), p);
  }
});

test("N2: hostile name, id and caption render escaped through the shared list", async () => {
  const evilId = `x"><script>alert(1)</script>`;
  const evil = {
    id: evilId,
    name: `<script>alert("n")</script>' javascript:alert(2)`,
    photo: "javascript:alert(3)",
    category: "notable",
    event_date: "2026-01-05",
    tags: ["red_folder"],
    events: [],
  };
  const evilPost = post(`p"><script>alert(4)</script>`, "2026-01-04", {
    handle: `@x"><script>alert(5)</script>`,
    text: `<script>alert(6)</script> javascript:alert(7)`,
    still: "javascript:alert(8)",
  });
  const html = commsCatalogList("red_folder", commsCatalogItems([evilPost], [evil], [evil]));
  assert.ok(!html.includes("<script"), "no raw script tag");
  assert.doesNotMatch(html, /(href|src|srcset|poster)\s*=\s*"?\s*javascript:/i);
  assert.match(html, new RegExp(`href="/people/${encodeURIComponent(evilId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  for (const m of html.matchAll(/<[a-z][^>]*>/gi)) {
    assert.doesNotMatch(m[0], /\s[a-z-]+=(?!")/i, `unquoted attribute in ${m[0]}`);
  }
  setMemory({ people: [evil], red_folder_comms: [evilPost] });
  const page = await requestPage("/red-folder-comms");
  assert.equal(page.status, 200);
  assert.ok(!page.body.includes("<script>alert"), "page escapes hostile input");
  assert.doesNotMatch(page.body, /(href|src)\s*=\s*"?\s*javascript:/i);
});

test("N1: the tagged-people and post reads are parameterized, bounded and parallel", () => {
  const src = readFileSync(new URL("../app/server.mjs", import.meta.url), "utf8");
  assert.match(src, /const COMMS_TAGGED_PEOPLE_CAP = \d+;/);
  assert.match(src, /const COMMS_MIXED_POST_CAP = \d+;/);
  assert.match(src, /await Promise\.all\(\[\s*listKindComms\(spec\.id, \{ limit: COMMS_MIXED_POST_CAP \}\),\s*listPeople\(\{ tags: \[tag\], limit: COMMS_TAGGED_PEOPLE_CAP \}\),/);
  assert.doesNotMatch(src, /id === "red_folder"/);
  assert.doesNotMatch(src, /redFolderMixedHtml|redFolderCatalog/);
});
