import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { handle } from "../app/server.mjs";
import { setMemory } from "../app/lib/store.mjs";
import { DOG_PATHS, DOG_PEOPLE, DOG_POSTS } from "./fixtures/dog-comms-golden/fixture.mjs";

// Golden HTML was captured from de614842 (#238 + the media cap, before the shared
// comms list refactor). Dog comms must render byte-identical after the refactor.
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
    assert.equal(page.body, readFileSync(GOLDEN[path], "utf8"));
  });
}
