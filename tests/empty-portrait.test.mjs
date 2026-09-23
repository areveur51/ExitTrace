import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EMPTY_PORTRAIT_HREF,
  commsDetail,
  dogDetail,
  dogListRow,
  kindDetail,
  kindListRow,
  operationDetail,
  operationRow,
  personDetail,
  personRow,
} from "../app/lib/html.mjs";
import { CENTRAL_CASTING_DETAIL } from "../app/lib/kind-comms.mjs";
import { findLocalPortrait, resolvePortrait } from "../app/lib/portrait.mjs";
import { handle } from "../app/server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSET = path.join(ROOT, "app", "public", "empty-portrait.jpg");

function person(overrides = {}) {
  return {
    id: "jordan-hale",
    category: "firings",
    name: "Jordan Hale",
    event_date: "2018-04-02",
    photo: "/media/people/jordan-hale.jpg",
    ...overrides,
  };
}

function corona(overrides = {}) {
  return person({
    id: "casey-vale",
    category: "corona_comms",
    name: "Casey Vale",
    photo: "/media/people/casey-vale.jpg",
    ...overrides,
  });
}

function dog(overrides = {}) {
  return {
    id: "dod-k9-2020",
    posted_at: "2020-03-13",
    handle: "@DeptofDefense",
    still: "/media/dog-comms/dod-k9-2020.jpg",
    ...overrides,
  };
}

function folder(overrides = {}) {
  return {
    id: "flotus-2026",
    posted_at: "2026-09-17",
    handle: "@FLOTUS",
    still: "/media/red-folder-comms/flotus-red-folder-2026.jpg",
    ...overrides,
  };
}

function casting(overrides = {}) {
  return {
    id: "nytimes-2026",
    posted_at: "2026-09-17",
    handle: "@nytimes",
    still: "/media/central-casting-comms/nytimes-2026-09-17.jpg",
    ...overrides,
  };
}

function operation(overrides = {}) {
  return {
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    event_date: "2024-08-01",
    agencies: ["U.S. Department of Justice"],
    tags: ["missing_kids"],
    ...overrides,
  };
}

function imgTags(html) {
  return html.match(/<img\b[^>]*>/g) || [];
}

function classTokens(tag) {
  return ((tag.match(/\sclass="([^"]*)"/) || [])[1] || "").split(/\s+/).filter(Boolean);
}

/** Portrait wells only: list thumbs and detail portraits, not post-media stills. */
function wellImgs(html) {
  return imgTags(html).filter((tag) => {
    const cls = classTokens(tag);
    return cls.includes("portrait") || cls.includes("thumb");
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : "";
}

function wellSrc(html) {
  const wells = wellImgs(html);
  assert.equal(wells.length, 1, html);
  return attr(wells[0], "src");
}

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      req,
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, hdrs) {
        this.statusCode = status;
        this.headers = {};
        for (const [k, v] of Object.entries(hdrs || {})) {
          this.headers[String(k).toLowerCase()] = v;
        }
      },
      end(body) {
        if (body) chunks.push(body);
        resolve({
          status: this.statusCode || 200,
          headers: this.headers,
          body: Buffer.concat(
            chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c || ""))),
          ),
        });
      },
    };
    handle(req, res).catch(reject);
  });
}

test("empty portrait asset is one public file with a stable href", () => {
  assert.equal(fs.existsSync(ASSET), true);
  assert.ok(fs.statSync(ASSET).size > 800);
  assert.match(EMPTY_PORTRAIT_HREF, /^\/empty-portrait\.jpg\?v=[0-9a-f]{10}$/);
  const js = fs.readFileSync(path.join(ROOT, "app", "public", "app.js"), "utf8");
  assert.match(js, /data-portrait-fallback/);
  assert.doesNotMatch(js, /empty-portrait\.jpg/);
});

test("empty src uses the placeholder and a real src stays the stored still", () => {
  const cases = [
    ["person list", personRow(person({ photo: "" })), personRow(person())],
    ["person detail", personDetail(person({ photo: "" })), personDetail(person())],
    ["corona list", personRow(corona({ photo: "" })), personRow(corona())],
    ["corona detail", personDetail(corona({ photo: null })), personDetail(corona())],
    ["dog list", dogListRow(dog({ still: "" })), dogListRow(dog())],
    ["dog detail", dogDetail(dog({ still: "" })), dogDetail(dog())],
    ["red folder list", kindListRow("red_folder", folder({ still: "" })), kindListRow("red_folder", folder())],
    ["red folder detail", kindDetail("red_folder", folder({ still: " " })), kindDetail("red_folder", folder())],
    [
      "central casting detail",
      commsDetail(CENTRAL_CASTING_DETAIL, casting({ still: "" })),
      commsDetail(CENTRAL_CASTING_DETAIL, casting()),
    ],
    ["operation list", operationRow(operation()), operationRow(operation({ photo: "/media/people/jordan-hale.jpg" }))],
    [
      "operation detail",
      operationDetail(operation()),
      operationDetail(operation({ photo: "/media/people/jordan-hale.jpg" })),
    ],
  ];

  for (const [label, emptyHtml, filledHtml] of cases) {
    assert.equal(wellSrc(emptyHtml), EMPTY_PORTRAIT_HREF, label);
    assert.match(wellImgs(emptyHtml)[0], /empty-portrait/, label);
    const filled = wellSrc(filledHtml);
    assert.notEqual(filled, EMPTY_PORTRAIT_HREF, label);
    assert.match(filled, /^\/media\//, label);
    assert.equal(attr(wellImgs(filledHtml)[0], "data-portrait-fallback"), EMPTY_PORTRAIT_HREF, label);
    assert.doesNotMatch(filledHtml, /upload\.wikimedia\.org/, label);
  }

  const external = personRow(person({ photo: "https://upload.wikimedia.org/wikipedia/commons/x.jpg" }));
  assert.equal(wellSrc(external), EMPTY_PORTRAIT_HREF);
  assert.doesNotMatch(external, /upload\.wikimedia\.org/);

  const shotAsPhoto = operationRow(
    operation({ photo: "/media/screenshots/operations/restore.jpg" }),
  );
  assert.equal(wellSrc(shotAsPhoto), EMPTY_PORTRAIT_HREF);
  assert.doesNotMatch(shotAsPhoto, /screenshots/);
});

test("placeholder is UI-only and does not fill or overwrite a gold still", async () => {
  const media = fs.mkdtempSync(path.join(os.tmpdir(), "et-empty-portrait-"));
  const people = path.join(media, "people");
  fs.mkdirSync(people, { recursive: true });
  fs.writeFileSync(path.join(people, "jordan-hale.jpg"), "gold-still-bytes");

  const gold = await resolvePortrait({ mediaDir: media, personId: "jordan-hale" });
  assert.equal(gold.href, "/media/people/jordan-hale.jpg");
  assert.equal(fs.readFileSync(path.join(people, "jordan-hale.jpg"), "utf8"), "gold-still-bytes");

  const row = person({ photo: "" });
  const html = personRow(row);
  assert.equal(row.photo, "");
  assert.equal(wellSrc(html), EMPTY_PORTRAIT_HREF);
  assert.equal(
    await resolvePortrait({ mediaDir: media, personId: "riley-chen" }),
    null,
  );
  assert.equal(findLocalPortrait(media, "riley-chen"), null);
  assert.deepEqual(fs.readdirSync(people), ["jordan-hale.jpg"]);
});

test("lab static route serves the committed placeholder bytes", async () => {
  const file = fs.readFileSync(ASSET);
  const res = await request(EMPTY_PORTRAIT_HREF);
  assert.equal(res.status, 200);
  assert.match(String(res.headers["content-type"] || ""), /image\/jpeg/);
  assert.ok(res.body.equals(file));
});
