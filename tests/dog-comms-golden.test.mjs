import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { handle } from "../app/server.mjs";
import { ASSET_VERSION } from "../app/lib/html.mjs";
import { setMemory } from "../app/lib/store.mjs";
import { DOG_PATHS, DOG_PEOPLE, DOG_POSTS } from "./fixtures/dog-comms-golden/fixture.mjs";

// Golden HTML re-captured at v1.2.35 (PR #240, supporting-media masonry) on top of the
// #238 merge 94e78bf4. Dog comms must render byte-identical except for the asset cache-bust
// token on /styles.css and /app.js: `?v=<package version>-<sha1(styles.css, app.js)[0:10]>`,
// which changes with every version bump or CSS/JS edit. One bounded normalizer (fixed
// paths, bounded digit/hex classes, no greedy match) maps exactly that token to `?v=X"` on
// BOTH sides, and its replacement count is asserted (exactly 2 per page). Every other byte,
// including the /empty-portrait.jpg?v=<hash> tokens, is compared as is.
const ASSET_TOKEN_RE = /(\/(?:styles\.css|app\.js))\?v=\d{1,3}\.\d{1,3}\.\d{1,3}-[0-9a-f]{10}"/g;
const ASSET_TOKENS_PER_PAGE = 2;
function normalizeAssetToken(html) {
  let count = 0;
  const out = String(html).replace(ASSET_TOKEN_RE, (_m, file) => {
    count += 1;
    return `${file}?v=X"`;
  });
  return { html: out, count };
}
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
  test(`dog comms ${path} renders byte-identical to the v1.2.35 golden (asset token normalized)`, async () => {
    setMemory({ people: DOG_PEOPLE, dog_comms: DOG_POSTS });
    const page = await requestPage(path);
    assert.equal(page.status, 200);
    const golden = normalizeAssetToken(readFileSync(GOLDEN[path], "utf8"));
    const live = normalizeAssetToken(page.body);
    assert.equal(golden.count, ASSET_TOKENS_PER_PAGE);
    assert.equal(live.count, ASSET_TOKENS_PER_PAGE);
    // The live token is the app's own ASSET_VERSION, in the expected shape, exactly twice.
    assert.match(ASSET_VERSION, /^\d+\.\d+\.\d+-[0-9a-f]{10}$/);
    assert.equal(page.body.split(`?v=${ASSET_VERSION}"`).length - 1, ASSET_TOKENS_PER_PAGE);
    assert.equal(live.html, golden.html);
  });
}

test("golden normalizer: token-only changes pass, any real markup change still fails", () => {
  const raw = readFileSync(GOLDEN["/dog-comms/example-k9-2025"], "utf8");
  const base = normalizeAssetToken(raw);
  assert.equal(base.count, ASSET_TOKENS_PER_PAGE);
  // 1. A different version / hash is absorbed (that is the only thing it may absorb).
  const bumped = raw.replace(ASSET_TOKEN_RE, (_m, file) => `${file}?v=9.9.99-0123456789"`);
  assert.equal(normalizeAssetToken(bumped).html, base.html);
  // 2. Real markup mutations are still caught.
  const mutations = [
    ["class name", raw.replace('class="detail-official-post"', 'class="detail-official-posts"')],
    ["one byte of text", raw.replace("</title>", "!</title>")],
    ["attr after token", raw.replace(/(\/styles\.css\?v=[A-Za-z0-9._-]{1,64}")/, '$1 data-x="1"')],
    ["path before token", raw.replace("/styles.css?v=", "/style.css?v=")],
    ["dropped tile", raw.replace(/<figure class="detail-tile[\s\S]*?<\/figure>/, "")],
  ];
  for (const [label, mutated] of mutations) {
    assert.notEqual(mutated, raw, `${label}: mutation applied`);
    assert.notEqual(normalizeAssetToken(mutated).html, base.html, label);
  }
  // 3. Bounded: a malformed asset token is not normalized, so the exact count check fails.
  for (const bad of ['?v=1.2.35 x"', `?v=1.2.35-${"a".repeat(11)}"`, '?v=1.2.35-ABCDEF0123"', '?v=1234.2.35-0123456789"']) {
    const swapped = raw.replace(/\/styles\.css\?v=[^"]{1,64}"/, `/styles.css${bad}`);
    assert.notEqual(swapped, raw, bad);
    assert.equal(normalizeAssetToken(swapped).count, ASSET_TOKENS_PER_PAGE - 1, bad);
  }
  // 4. The empty-portrait ?v= tokens are NOT normalized: changing one is a real diff.
  assert.ok(raw.includes("/empty-portrait.jpg?v="));
  const portrait = raw.replace(/(\/empty-portrait\.jpg\?v=)[0-9a-f]{10}/, (_m, head) => `${head}0000000000`);
  assert.notEqual(portrait, raw);
  assert.notEqual(normalizeAssetToken(portrait).html, base.html);
});
