import assert from "node:assert/strict";
import { test } from "node:test";
import { peopleList, personDetail, personHeader } from "../app/lib/html.mjs";
import { nicknameCatalogDate, normalizeNicknames, trumpNicknameReportDate } from "../app/lib/nicknames.mjs";
import { applyIdentifiedPerson, ensurePersonNicknames, getPerson, setMemory } from "../app/lib/store.mjs";
import { LOCK_MEDIA_DIR, LOCK_PORTRAIT, NEW_PERSON_LOCK } from "./new-person-lock.mjs";

const CITES = [
  {
    url: "https://www.reuters.com/world/us/sleepy-joe",
    publisher: "Reuters",
    date: "2019-06-11",
    snippet: "Sleepy Joe",
  },
  {
    url: "https://www.nytimes.com/2019/06/11/us/politics/sleepy-joe.html",
    publisher: "The New York Times",
    date: "2019-06-11",
    snippet: "Same thing is happening with Sleepy Joe.",
  },
];

const NICK = [{ name: "Sleepy Joe", by: "Donald Trump", sources: CITES }];

test("a nickname-only card dates from the earliest Trump-nickname cite", () => {
  assert.equal(trumpNicknameReportDate(NICK), "2019-06-11");
  assert.equal(
    trumpNicknameReportDate([
      {
        name: "Newscum",
        by: "Donald Trump",
        sources: [
          { url: "https://www.reuters.com/world/us/newscum", date: "2026-03-16" },
          { url: "https://apnews.com/article/newscum", date: "2025-06-09" },
        ],
      },
    ]),
    "2025-06-09",
  );
  assert.equal(trumpNicknameReportDate([{ name: "Sleepy Joe", by: "Someone Else", sources: CITES }]), null);
});

test("a nickname without two official cites is dropped", () => {
  assert.deepEqual(normalizeNicknames(undefined), []);
  assert.deepEqual(
    normalizeNicknames([
      { name: "Newscum", by: "Donald Trump", sources: [{ url: "https://www.reuters.com/a" }] },
    ]),
    [],
  );
  assert.deepEqual(
    normalizeNicknames([
      {
        name: "Newscum",
        by: "Donald Trump",
        sources: [
          { url: "https://en.wikipedia.org/wiki/Gavin_Newsom" },
          { url: "https://www.reuters.com/world/us/newscum" },
        ],
      },
    ]),
    [],
  );
  assert.equal(normalizeNicknames([{ name: "Newscum", sources: CITES }]).length, 0);
});

test("detail page shows a cited Trump nickname and hides the line when empty", async () => {
  setMemory({ people: [], operations: [], source_posts: [] });
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: [
      "https://www.example.com/news/casey-vale-held",
      "https://www.example.net/world/casey-vale-arrest",
    ],
    role: "Anchor",
    nicknames: NICK,
  });
  const person = await getPerson("casey-vale");
  assert.equal(person.nicknames[0].name, "Sleepy Joe");
  assert.equal(person.nicknames[0].by, "Donald Trump");
  const header = personHeader(person);
  assert.match(header, /Trump nickname · Sleepy Joe/);
  const html = personDetail(person);
  assert.match(html, /data-kind="nickname"/);
  assert.match(html, /reuters.com\/world\/us\/sleepy-joe/);
  assert.match(html, /Same thing is happening with Sleepy Joe/);
  assert.doesNotMatch(personHeader({ name: "Casey Vale", nicknames: [] }), /Trump nickname/);

  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "resignations",
    cite_urls: [
      "https://www.example.com/news/casey-vale-quit",
      "https://www.example.net/world/casey-vale-resigned",
    ],
  });
  const again = await getPerson("casey-vale");
  assert.equal(again.nicknames[0].name, "Sleepy Joe");
});

test("nickname update leaves the exit card alone and creates a card when the person is missing", async () => {
  setMemory({
    people: [
      {
        id: "joe-biden",
        category: "government_stepdowns",
        name: "Joe Biden",
        role: "President",
        event_date: "2021-01-20",
        death_date: null,
        country_of_origin: "United States",
        photo: "/media/people/joe-biden.jpg",
        events: [{ kind: "government_stepdowns", event_date: "2021-01-20", sources: [] }],
        sources: [],
        tags: ["official"],
        career: [],
        nicknames: [],
      },
    ],
    operations: [],
    source_posts: [],
  });
  const updated = await ensurePersonNicknames({ subject: "Joe Biden", nicknames: NICK });
  assert.equal(updated.action, "updated");
  assert.equal(updated.person.category, "government_stepdowns");
  assert.equal(String(updated.person.event_date).slice(0, 10), "2021-01-20");
  assert.equal(updated.person.photo, "/media/people/joe-biden.jpg");
  assert.equal(updated.person.country_of_origin, "United States");
  assert.equal(updated.person.nicknames[0].name, "Sleepy Joe");

  await assert.rejects(
    () => ensurePersonNicknames({ subject: "Gavin Newsom", nicknames: [{ name: "Newscum", by: "Donald Trump", sources: [] }] }),
    /two official/,
  );
  assert.equal(await getPerson("gavin-newsom"), null);

  const cited = {
    subject: "Gavin Newsom",
    role: "Governor of California",
    nicknames: [
      {
        name: "Newscum",
        by: "Donald Trump",
        sources: [
          { url: "https://www.reuters.com/world/us/newscum", publisher: "Reuters", date: "2026-03-16" },
          { url: "https://apnews.com/article/newscum", publisher: "Associated Press", date: "2025-06-09" },
        ],
      },
    ],
  };
  await assert.rejects(
    () => ensurePersonNicknames({ ...cited, mediaDir: LOCK_MEDIA_DIR }),
    (err) => err.code === "missing_portrait",
  );
  assert.equal(await getPerson("gavin-newsom"), null);

  const created = await ensurePersonNicknames({
    ...cited,
    photo: LOCK_PORTRAIT,
    photo_credit: "Test portrait",
    mediaDir: LOCK_MEDIA_DIR,
  });
  assert.equal(created.action, "created");
  assert.equal(created.person.id, "gavin-newsom");
  assert.equal(created.person.category, "nickname");
  assert.equal(created.person.country_of_origin, "");
  assert.equal(created.person.event_date, null);
  assert.equal(nicknameCatalogDate(created.person), "2025-06-09");
  assert.equal(created.person.photo, "/media/people/gavin-newsom.jpg");
  assert.deepEqual(created.person.events, []);
  const list = peopleList([created.person]);
  assert.match(list, /datetime="2025-06-09"/);
  assert.match(list, />2025</);
  assert.doesNotMatch(list, /Undated/);
  const kept = peopleList([
    { ...updated.person, name: "Joe Biden" },
    created.person,
  ]);
  assert.match(kept, /datetime="2021-01-20"/);
  assert.doesNotMatch(kept, /datetime="2019-06-11"/);
  assert.match(personDetail(created.person), /Trump nickname · Newscum/);
  assert.match(personDetail(created.person), /data-kind="nickname"/);
});
