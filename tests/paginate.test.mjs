import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAGE_SIZE,
  pageHref,
  pageWindow,
  paginate,
  parsePage,
} from "../app/lib/paginate.mjs";

test("PAGE_SIZE is a sensible list window", () => {
  assert.equal(PAGE_SIZE, 10);
});

test("parsePage reads query strings and rejects junk", () => {
  assert.equal(parsePage(new URLSearchParams("page=3")), 3);
  assert.equal(parsePage(new URLSearchParams("")), 1);
  assert.equal(parsePage(new URLSearchParams("page=0")), 1);
  assert.equal(parsePage(new URLSearchParams("page=-4")), 1);
  assert.equal(parsePage(new URLSearchParams("page=nope")), 1);
});

test("paginate clamps to the last page as counts grow", () => {
  const small = paginate({ total: 12, page: 1 });
  assert.equal(small.totalPages, 2);
  assert.equal(small.limit, 10);
  assert.equal(small.offset, 0);
  assert.equal(small.hasNext, true);
  assert.equal(small.hasPrev, false);

  const page2 = paginate({ total: 12, page: 2 });
  assert.equal(page2.offset, 10);
  assert.equal(page2.hasNext, false);
  assert.equal(page2.hasPrev, true);

  const overflow = paginate({ total: 12, page: 99 });
  assert.equal(overflow.page, 2);
  assert.equal(overflow.offset, 10);

  const grown = paginate({ total: 247, page: 8 });
  assert.equal(grown.totalPages, 25);
  assert.equal(grown.offset, 70);
  assert.equal(grown.hasNext, true);
});

test("pageHref omits page=1 so the first page URL stays clean", () => {
  assert.equal(pageHref("/firings", 1), "/firings");
  assert.equal(pageHref("/firings", 2), "/firings?page=2");
  assert.equal(pageHref("/dog-comms", 4), "/dog-comms?page=4");
});

test("pageWindow inserts gaps when there are many pages", () => {
  assert.deepEqual(pageWindow(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(pageWindow(10, 25), [1, 9, 10, 11, 25]);
  assert.deepEqual(pageWindow(1, 25), [1, 2, 3, 4, 5, 25]);
  assert.deepEqual(pageWindow(25, 25), [1, 21, 22, 23, 24, 25]);
});
