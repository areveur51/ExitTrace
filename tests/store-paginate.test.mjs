import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_SIZE } from "../app/lib/paginate.mjs";
import {
  countDogComms,
  countPeople,
  listDogComms,
  listPeople,
  setMemory,
} from "../app/lib/store.mjs";

function person(i, category = "firings") {
  const day = String((i % 28) + 1).padStart(2, "0");
  const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, "0");
  const year = 2018 + Math.floor(i / 336);
  return {
    id: `p-${category}-${i}`,
    category,
    name: `Person ${String(i).padStart(3, "0")}`,
    role: "Test role",
    event_date: `${year}-${month}-${day}`,
    death_date: null,
    photo: "",
    sources: [],
    summary: "",
    net_worth_usd: null,
  };
}

function dog(i) {
  return {
    id: `d-${i}`,
    posted_at: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
    handle: `@acct${i}`,
    account_name: `Account ${i}`,
    text: `Official stored snapshot text ${i} for pagination.`,
    still: "",
    source_url: `https://x.com/acct${i}/status/${i}`,
    snapshot: { text: `Official stored snapshot text ${i} for pagination.` },
  };
}

test("listPeople windows stay newest-first as the catalog grows", async () => {
  const people = Array.from({ length: 45 }, (_, i) => person(i));
  setMemory({ people, dog_comms: [] });
  assert.equal(await countPeople("firings"), 45);

  const page1 = await listPeople({
    category: "firings",
    limit: PAGE_SIZE,
    offset: 0,
  });
  const page3 = await listPeople({
    category: "firings",
    limit: PAGE_SIZE,
    offset: 20,
  });
  const all = await listPeople("firings");

  assert.equal(page1.length, 10);
  assert.equal(page3.length, 10);
  assert.equal(all.length, 45);
  assert.deepEqual(
    page1.map((r) => r.id),
    all.slice(0, 10).map((r) => r.id),
  );
  assert.deepEqual(
    page3.map((r) => r.id),
    all.slice(20, 30).map((r) => r.id),
  );
  for (let i = 1; i < all.length; i++) {
    assert.ok(
      String(all[i - 1].event_date) >= String(all[i].event_date),
      "people must stay newest event first",
    );
  }
});

test("listDogComms windows stay newest-first as posts grow", async () => {
  const dog_comms = Array.from({ length: 23 }, (_, i) => dog(i));
  setMemory({ people: [], dog_comms });
  assert.equal(await countDogComms(), 23);

  const page1 = await listDogComms({ limit: PAGE_SIZE, offset: 0 });
  const page2 = await listDogComms({ limit: PAGE_SIZE, offset: 10 });
  const all = await listDogComms();

  assert.equal(page1.length, 10);
  assert.equal(page2.length, 10);
  assert.equal(all.length, 23);
  assert.deepEqual(
    page1.map((r) => r.id),
    all.slice(0, 10).map((r) => r.id),
  );
  assert.deepEqual(
    page2.map((r) => r.id),
    all.slice(10, 20).map((r) => r.id),
  );
  for (let i = 1; i < all.length; i++) {
    assert.ok(
      String(all[i - 1].posted_at) >= String(all[i].posted_at),
      "dog comms must stay newest post first",
    );
  }
});

test("countPeople can filter by category without loading every row's page", async () => {
  setMemory({
    people: [
      ...Array.from({ length: 17 }, (_, i) => person(i, "firings")),
      ...Array.from({ length: 4 }, (_, i) => person(i, "resignations")),
    ],
    dog_comms: [dog(1)],
  });
  assert.equal(await countPeople("firings"), 17);
  assert.equal(await countPeople("resignations"), 4);
  assert.equal(await countPeople(), 21);
  assert.equal(await countDogComms(), 1);
});
