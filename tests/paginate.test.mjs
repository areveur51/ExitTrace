import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOG_PAGE_SIZE,
  PAGE_SIZE,
  PAGE_SIZES,
  PAGE_SIZE_STORAGE_KEY,
  applyPageSize,
  pageHref,
  pageWindow,
  paginate,
  parseCookiePageSize,
  parsePage,
  normalizePageSize,
} from "../app/lib/paginate.mjs";

test("PAGE_SIZE is the person-list default; dog comms stay at 10", () => {
  assert.equal(PAGE_SIZE, 17);
  assert.deepEqual(PAGE_SIZES, [17, 34, 51]);
  assert.equal(DOG_PAGE_SIZE, 10);
  assert.equal(PAGE_SIZE_STORAGE_KEY, "exittrace-page-size");
});

test("normalizePageSize keeps 17/34/51 and rejects junk", () => {
  assert.equal(normalizePageSize(17), 17);
  assert.equal(normalizePageSize("34"), 34);
  assert.equal(normalizePageSize(51), 51);
  assert.equal(normalizePageSize(10), 17);
  assert.equal(normalizePageSize("nope"), 17);
  assert.equal(normalizePageSize(null), 17);
});

test("parseCookiePageSize reads the persisted person-list size", () => {
  assert.equal(parseCookiePageSize(""), 17);
  assert.equal(parseCookiePageSize("exittrace-page-size=34"), 34);
  assert.equal(parseCookiePageSize("exittrace-theme=stencil; exittrace-page-size=51"), 51);
  assert.equal(parseCookiePageSize("exittrace-page-size=10"), 17);
  assert.equal(parseCookiePageSize("other=34"), 17);
});

test("applyPageSize writes localStorage and marks the pressed size", () => {
  const store = {};
  const cookieJar = {};
  const pressed = {};
  const buttons = PAGE_SIZES.map((n) => ({
    getAttribute(name) {
      if (name === "data-page-size-set") return String(n);
      if (name === "aria-pressed") return pressed[n];
      return null;
    },
    setAttribute(name, value) {
      if (name === "aria-pressed") pressed[n] = value;
    },
  }));
  assert.equal(applyPageSize(34, { storage: { setItem(k, v) { store[k] = v; } }, cookieJar, buttons }), 34);
  assert.equal(store[PAGE_SIZE_STORAGE_KEY], "34");
  assert.equal(cookieJar[PAGE_SIZE_STORAGE_KEY], "34");
  assert.equal(pressed[34], "true");
  assert.equal(pressed[17], "false");
});

test("parsePage reads query strings and rejects junk", () => {
  assert.equal(parsePage(new URLSearchParams("page=3")), 3);
  assert.equal(parsePage(new URLSearchParams("")), 1);
  assert.equal(parsePage(new URLSearchParams("page=0")), 1);
  assert.equal(parsePage(new URLSearchParams("page=-4")), 1);
  assert.equal(parsePage(new URLSearchParams("page=nope")), 1);
});

test("paginate clamps to the last page as counts grow", () => {
  const small = paginate({ total: 20, page: 1 });
  assert.equal(small.totalPages, 2);
  assert.equal(small.limit, 17);
  assert.equal(small.offset, 0);
  assert.equal(small.hasNext, true);
  assert.equal(small.hasPrev, false);

  const page2 = paginate({ total: 20, page: 2 });
  assert.equal(page2.offset, 17);
  assert.equal(page2.hasNext, false);
  assert.equal(page2.hasPrev, true);

  const overflow = paginate({ total: 20, page: 99 });
  assert.equal(overflow.page, 2);
  assert.equal(overflow.offset, 17);

  const grown = paginate({ total: 247, page: 8 });
  assert.equal(grown.totalPages, 15);
  assert.equal(grown.offset, 119);
  assert.equal(grown.hasNext, true);

  const sized = paginate({ total: 40, page: 1, pageSize: 34 });
  assert.equal(sized.limit, 34);
  assert.equal(sized.totalPages, 2);
});

test("pageHref omits page=1 so the first page URL stays clean", () => {
  assert.equal(pageHref("/firings", 1), "/firings");
  assert.equal(pageHref("/firings", 2), "/firings?page=2");
  assert.equal(pageHref("/dog-comms", 4), "/dog-comms?page=4");
  assert.equal(pageHref("/search?q=comey", 2), "/search?q=comey&page=2");
  assert.equal(pageHref("/search?q=comey", 1), "/search?q=comey");
  assert.equal(pageHref("/deaths?min_age=40", 1), "/deaths?min_age=40");
  assert.equal(pageHref("/deaths?min_age=40", 2), "/deaths?min_age=40&page=2");
});

test("pageWindow inserts gaps when there are many pages", () => {
  assert.deepEqual(pageWindow(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(pageWindow(10, 25), [1, 9, 10, 11, 25]);
  assert.deepEqual(pageWindow(1, 25), [1, 2, 3, 4, 5, 25]);
  assert.deepEqual(pageWindow(25, 25), [1, 21, 22, 23, 24, 25]);
});
