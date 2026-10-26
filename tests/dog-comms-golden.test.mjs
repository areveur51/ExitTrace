import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { handle } from "../app/server.mjs";
import { ASSET_VERSION } from "../app/lib/html.mjs";
import { setMemory } from "../app/lib/store.mjs";
import { DOG_PATHS, DOG_PEOPLE, DOG_POSTS } from "./fixtures/dog-comms-golden/fixture.mjs";

// Golden HTML was captured from de614842 (#238 + the media cap, before the shared
// comms list refactor). Dog comms must render byte-identical after the refactor.
// The one approved delta since then is the shared menu: the Tags-menu Red folder chip
// was removed (Admiral 2026-10-26, one Red Folder menu entry, under Comms). The golden
// files stay as captured; the test removes exactly that chip, once, and compares bytes.
const APPROVED_MENU_DELTA = '<a class="keychip keymap-tag" href="/tags/red-folder">Red folder</a>';
// Second approved delta (v1.2.35, supporting-media masonry): the asset cache-bust token
// `?v=<package version>-<sha1(styles.css, app.js)>` changes with every version bump or CSS
// change. The golden files stay byte-for-byte as captured; the test swaps exactly that
// token (once for styles.css, once for app.js per page) and still compares every byte.
const GOLDEN_ASSET_VERSION = "1.2.34-fecf5192a5";
const GOLDEN = {
  "/dog-comms": new URL("./fixtures/dog-comms-golden/list.html", import.meta.url),
  "/dog-comms/example-k9-2025": new URL("./fixtures/dog-comms-golden/detail.html", import.meta.url),
};

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

for (const path of DOG_PATHS) {
  test(`dog comms ${path} renders byte-identical to the de614842 golden`, async () => {
    setMemory({ people: DOG_PEOPLE, dog_comms: DOG_POSTS });
    const page = await requestPage(path);
    assert.equal(page.status, 200);
    const golden = readFileSync(GOLDEN[path], "utf8");
    assert.equal(golden.split(APPROVED_MENU_DELTA).length - 1, 1);
    assert.equal(golden.split(`?v=${GOLDEN_ASSET_VERSION}"`).length - 1, 2);
    const want = golden
      .replace(APPROVED_MENU_DELTA, "")
      .split(`?v=${GOLDEN_ASSET_VERSION}"`)
      .join(`?v=${ASSET_VERSION}"`);
    assert.equal(page.body, want);
  });
}
