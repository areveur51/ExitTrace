import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  dogDetail,
  dogListRow,
  operationDetail,
  operationRow,
  personDetail,
  personRow,
} from "../app/lib/html.mjs";
import {
  mergeOperationAnnotate,
  normalizeOperation,
} from "../app/lib/operation.mjs";
import { mergePersonAnnotate } from "../app/lib/promote.mjs";
import {
  isScreenshotHref,
  normalizeScreenshotHref,
} from "../app/lib/screenshot.mjs";
import { handle } from "../app/server.mjs";
import {
  getDogComm,
  getOperation,
  getPerson,
  mergeGoldDogs,
  setMemory,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = path.join(ROOT, "media", "screenshots", "people");
const PROBE = path.join(SHOT_DIR, "_probe-screenshot.png");
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", url: pathname, headers: { host: "127.0.0.1" } };
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      headers: {},
      writeHead(status, hdrs) {
        this.statusCode = status;
        this.headers = hdrs || {};
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

function person(overrides = {}) {
  return {
    id: "james-comey",
    category: "firings",
    name: "James Comey",
    event_date: "2017-05-09",
    photo: "/media/people/james-comey.jpg",
    photo_credit: "Wikimedia Commons",
    ...overrides,
  };
}

function corona(overrides = {}) {
  return person({
    id: "casey-vale",
    category: "corona_comms",
    name: "Casey Vale",
    event_date: "2024-07-20",
    photo: "/media/people/james-comey.jpg",
    ...overrides,
  });
}

function dog(overrides = {}) {
  return {
    id: "dod-k9-2020",
    posted_at: "2020-03-13",
    handle: "@DeptofDefense",
    account_name: "Department of Defense",
    text: "Stored official dog-comm snapshot.",
    still: "/media/dog-comms/dod-k9-2020.jpg",
    still_credit: "U.S. government work",
    source_url: "https://x.com/DeptofDefense/status/1",
    ...overrides,
  };
}

function operation(overrides = {}) {
  return {
    id: "operation-restore-justice",
    name: "Operation Restore Justice",
    event_date: "2024-08-01",
    agencies: ["U.S. Department of Justice"],
    summary: "Federal operation recorded by official public cites.",
    tags: ["missing_kids"],
    sources: [
      { url: "https://www.example.com/news/restore-justice" },
      { url: "https://www.justice.gov/opa/pr/restore-justice" },
    ],
    ...overrides,
  };
}

test("screenshot hrefs are fail-closed and optional", () => {
  assert.equal(isScreenshotHref(""), false);
  assert.equal(normalizeScreenshotHref(""), "");
  assert.equal(normalizeScreenshotHref("/media/people/james-comey.jpg"), "");
  assert.equal(normalizeScreenshotHref("/media/screenshots/people/../secret.jpg"), "");
  assert.equal(normalizeScreenshotHref("/media/screenshots/people/nested/path.jpg"), "");
  assert.equal(
    normalizeScreenshotHref("/media/screenshots/people/james-comey.jpg"),
    "/media/screenshots/people/james-comey.jpg",
  );
  assert.equal(
    normalizeScreenshotHref("/media/screenshots/dog-comms/dod-k9-2020.jpg", "dog-comms"),
    "/media/screenshots/dog-comms/dod-k9-2020.jpg",
  );
  assert.equal(
    normalizeScreenshotHref("/media/screenshots/operations/restore.jpg", "operations"),
    "/media/screenshots/operations/restore.jpg",
  );
  assert.equal(
    normalizeScreenshotHref("/media/screenshots/people/james-comey.jpg", "operations"),
    "",
  );
});

test("store columns stay optional and do not invent or replace gold stills", async () => {
  setMemory({
    people: [person()],
    dog_comms: [dog()],
    operations: [operation()],
  });
  const p = await getPerson("james-comey");
  const d = await getDogComm("dod-k9-2020");
  const op = await getOperation("operation-restore-justice");
  assert.equal(p.screenshot, "");
  assert.equal(p.screenshot_credit, "");
  assert.equal(p.photo, "/media/people/james-comey.jpg");
  assert.equal(d.screenshot, "");
  assert.equal(d.screenshot_credit, "");
  assert.equal(d.still, "/media/dog-comms/dod-k9-2020.jpg");
  assert.equal(op.screenshot, "");
  assert.equal(op.still, undefined);

  setMemory({
    people: [
      person({
        screenshot: "/media/screenshots/people/james-comey.jpg",
        screenshot_credit: "X",
      }),
    ],
    dog_comms: [
      dog({
        screenshot: "/media/screenshots/dog-comms/dod-k9-2020.jpg",
        screenshot_credit: "X",
      }),
    ],
    operations: [operation({ screenshot: "/media/screenshots/operations/restore.jpg" })],
  });
  const withShot = await getPerson("james-comey");
  assert.equal(withShot.photo, "/media/people/james-comey.jpg");
  assert.equal(withShot.screenshot, "/media/screenshots/people/james-comey.jpg");
  assert.equal((await getDogComm("dod-k9-2020")).still, "/media/dog-comms/dod-k9-2020.jpg");
  assert.equal(
    (await getDogComm("dod-k9-2020")).screenshot,
    "/media/screenshots/dog-comms/dod-k9-2020.jpg",
  );
  assert.equal(
    (await getOperation("operation-restore-justice")).screenshot,
    "/media/screenshots/operations/restore.jpg",
  );

  const merged = mergePersonAnnotate(
    person({ screenshot: "/media/screenshots/people/james-comey.jpg" }),
    person({
      photo: "/media/people/imposter.jpg",
      screenshot: "/media/screenshots/people/other.jpg",
    }),
  );
  assert.equal(merged.photo, "/media/people/james-comey.jpg");
  assert.equal(merged.screenshot, "/media/screenshots/people/james-comey.jpg");

  const dogs = mergeGoldDogs(
    [dog({ screenshot: "" })],
    [dog({ screenshot: "/media/screenshots/dog-comms/dod-k9-2020.jpg" })],
  );
  assert.equal(dogs[0].still, "/media/dog-comms/dod-k9-2020.jpg");
  assert.equal(dogs[0].screenshot, "/media/screenshots/dog-comms/dod-k9-2020.jpg");

  const opMerged = mergeOperationAnnotate(
    normalizeOperation(operation({ screenshot: "" })),
    normalizeOperation(operation({ screenshot: "/media/screenshots/operations/restore.jpg" })),
  );
  assert.equal(opMerged.screenshot, "/media/screenshots/operations/restore.jpg");
});

test("detail pages render portrait/still and screenshot; list thumbs stay unchanged", () => {
  const shot = "/media/screenshots/people/james-comey.jpg";
  const html = personDetail(person({ screenshot: shot, screenshot_credit: "X" }));
  assert.match(html, /class="detail-photo portrait"/);
  assert.match(html, /src="\/media\/thumbs\/people\/james-comey\.jpg\?p=2"/);
  assert.match(html, /class="detail-photo screenshot"/);
  assert.match(html, /src="\/media\/screenshots\/people\/james-comey\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/people\/james-comey\.jpg"/);
  assert.match(html, /data-lightbox="\/media\/screenshots\/people\/james-comey\.jpg"/);
  assert.doesNotMatch(html, /<img class="detail-photo portrait"[^>]+src="\/media\/screenshots\//);
  assert.doesNotMatch(html, /class="portrait thumb"/);

  const coronaHtml = personDetail(corona({ screenshot: shot }));
  assert.match(coronaHtml, /src="\/media\/thumbs\/people\/james-comey\.jpg\?p=2"/);
  assert.match(coronaHtml, /src="\/media\/screenshots\/people\/james-comey\.jpg"/);

  const dogHtml = dogDetail(
    dog({
      screenshot: "/media/screenshots/dog-comms/dod-k9-2020.jpg",
      screenshot_credit: "X",
    }),
  );
  assert.match(dogHtml, /src="\/media\/dog-comms\/dod-k9-2020\.jpg"/);
  assert.match(dogHtml, /src="\/media\/screenshots\/dog-comms\/dod-k9-2020\.jpg"/);
  assert.match(dogHtml, /data-lightbox="\/media\/dog-comms\/dod-k9-2020\.jpg"/);

  const opHtml = operationDetail(
    operation({ screenshot: "/media/screenshots/operations/restore.jpg" }),
  );
  assert.match(opHtml, /class="initials detail-photo"/);
  assert.match(opHtml, /src="\/media\/screenshots\/operations\/restore\.jpg"/);
  assert.match(opHtml, /data-lightbox="\/media\/screenshots\/operations\/restore\.jpg"/);
  assert.match(opHtml, /meta-pane--stack/);
  assert.doesNotMatch(opHtml, /sources-pane/);
  assert.match(coronaHtml, /meta-pane--stack/);

  const missing = personDetail(person());
  assert.match(missing, /src="\/media\/thumbs\/people\/james-comey\.jpg\?p=2"/);
  assert.doesNotMatch(missing, /screenshots\/people/);

  const list = personRow(person({ screenshot: shot }));
  assert.match(list, /class="portrait thumb"/);
  assert.match(list, /src="\/media\/thumbs\/people\/james-comey\.jpg\?p=2"/);
  assert.doesNotMatch(list, /screenshots/);
  assert.doesNotMatch(list, /lightbox/);
  assert.doesNotMatch(list, /src="\/media\/people\/james-comey\.jpg"/);

  const dogList = dogListRow(
    dog({ screenshot: "/media/screenshots/dog-comms/dod-k9-2020.jpg" }),
  );
  assert.match(dogList, /class="still thumb"/);
  assert.match(dogList, /src="\/media\/thumbs\/dog-comms\/dod-k9-2020\.jpg\?p=2"/);
  assert.doesNotMatch(dogList, /screenshots/);
  assert.doesNotMatch(dogList, /src="\/media\/dog-comms\/dod-k9-2020\.jpg"/);

  const opList = operationRow(
    operation({ screenshot: "/media/screenshots/operations/restore.jpg" }),
  );
  assert.match(opList, /class="initials thumb"/);
  assert.doesNotMatch(opList, /screenshots/);
});

test("detail pages include lightbox chrome and keep list thumbs off the screenshot", async () => {
  setMemory({
    people: [
      person({
        screenshot: "/media/screenshots/people/james-comey.jpg",
        screenshot_credit: "X",
      }),
      corona({ screenshot: "/media/screenshots/people/james-comey.jpg" }),
    ],
    dog_comms: [
      dog({
        screenshot: "/media/screenshots/dog-comms/dod-k9-2020.jpg",
        screenshot_credit: "X",
      }),
    ],
    operations: [operation({ screenshot: "/media/screenshots/operations/restore.jpg" })],
  });
  const pages = [
    await requestPage("/people/james-comey"),
    await requestPage("/people/casey-vale"),
    await requestPage("/dog-comms/dod-k9-2020"),
    await requestPage("/operations/operation-restore-justice"),
  ];
  for (const page of pages) {
    assert.equal(page.status, 200);
    const html = page.body.toString("utf8");
    assert.match(html, /id="tui-lightbox"/);
    assert.match(html, /class="lightbox-open"/);
    assert.match(html, /data-lightbox="\/media\/screenshots\//);
  }
  const list = await requestPage("/firings");
  assert.equal(list.status, 200);
  const listHtml = list.body.toString("utf8");
  assert.match(listHtml, /src="\/media\/thumbs\/people\/james-comey\.jpg\?p=2"/);
  assert.doesNotMatch(listHtml, /screenshots\/people/);
  assert.doesNotMatch(listHtml, /class="lightbox-open"/);
});

test("GET /media/screenshots/... serves the new tree the same as other media", async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(PROBE, PNG_1X1);
  try {
    const res = await requestPage("/media/screenshots/people/_probe-screenshot.png");
    assert.equal(res.status, 200);
    assert.match(String(res.headers["Content-Type"] || ""), /image\/png/);
    assert.ok(res.body.equals(PNG_1X1));
    const miss = await requestPage("/media/screenshots/people/does-not-exist.png");
    assert.equal(miss.status, 404);
  } finally {
    fs.rmSync(PROBE, { force: true });
  }
});
