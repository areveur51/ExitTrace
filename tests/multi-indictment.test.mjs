import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planUnsealedAnnotations, annotateUnsealedPerson } from "../app/lib/event-attrs.mjs";
import { buildUpsertSql } from "../app/lib/gap-upsert.mjs";
import { peopleList, personDetail } from "../app/lib/html.mjs";
import {
  attachPersonEvent,
  eventSeq,
  eventsOfKind,
  projectPerson,
} from "../app/lib/promote.mjs";
import { handle } from "../app/server.mjs";
import {
  appendPersonSources,
  getPerson,
  listPeople,
  savePerson,
  setMemory,
  syncPersonEvents,
} from "../app/lib/store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AP = (slug, date) => ({
  url: `https://apnews.com/article/${slug}`,
  publisher: "AP",
  title: slug,
  date,
});

const EDNC = "Eastern District of North Carolina indictment.";
const DC = "D.C. case 1:26-cr-00229.";

function indictmentPerson() {
  let person = projectPerson({
    id: "multi-indict",
    name: "Multi Indict",
    category: "arrests",
    event_date: "2026-06-01",
    events: [
      {
        kind: "arrests",
        event_date: "2026-06-01",
        comments: "Arrested.",
        sources: [AP("arrest", "2026-06-01")],
      },
    ],
  });
  person = attachPersonEvent(person, {
    kind: "indictment_civilian",
    event_date: "2026-04-28",
    comments: EDNC,
    sources: [AP("ednc", "2026-04-28")],
  }).person;
  person = attachPersonEvent(person, {
    kind: "indictment_civilian",
    event_date: "2026-09-25",
    comments: DC,
    unsealed: true,
    sources: [AP("dc", "2026-09-25")],
  }).person;
  return person;
}

function indictmentArticles(html) {
  return [...html.matchAll(/<article class="event-tag-row" data-kind="(indictment_[^"]+)" data-section="person-event">([\s\S]*?)<\/article>/g)].map((match) => ({
    kind: match[1],
    html: match[0],
  }));
}

function requestPage(pathname) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 0,
      setHeader() {},
      writeHead(status) {
        this.statusCode = status;
      },
      end(body) {
        if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
        resolve({
          status: this.statusCode || 200,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      },
    };
    handle({ method: "GET", url: pathname, headers: { host: "127.0.0.1" } }, res).catch(reject);
  });
}

function fakeClient({ pkHasSeq = true } = {}) {
  const calls = [];
  const keyCols = pkHasSeq ? ["person_id", "kind", "seq"] : ["person_id", "kind"];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (/FROM pg_constraint c .*JOIN pg_attribute/.test(text)) {
        return { rows: keyCols.map((attname) => ({ attname })) };
      }
      if (/person_events_seq_notable_only/.test(text)) return { rows: [] };
      return { rows: [] };
    },
  };
}

async function withWritesOn(fn) {
  const prev = process.env.ET_MULTI_EVENT_WRITES;
  process.env.ET_MULTI_EVENT_WRITES = "on";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ET_MULTI_EVENT_WRITES;
    else process.env.ET_MULTI_EVENT_WRITES = prev;
  }
}

test("two indictments: write, sync, and render as separate dated entries", async () => {
  const person = indictmentPerson();
  const indictments = eventsOfKind(person.events, "indictment_civilian");
  assert.deepEqual(indictments.map((ev) => [ev.event_date, ev.seq, ev.unsealed === true]), [
    ["2026-09-25", 1, true],
    ["2026-04-28", 0, false],
  ]);
  assert.equal(person.category, "indictment_civilian");
  assert.equal(person.event_date, "2026-09-25");
  assert.deepEqual(person.tags.filter((id) => id === "civilian"), ["civilian"]);

  setMemory({ people: [person] });
  await savePerson(person);
  const loaded = await getPerson("multi-indict");
  assert.deepEqual(eventsOfKind(loaded.events, "indictment_civilian").map((ev) => ev.seq), [1, 0]);
  assert.equal(loaded.events.filter((ev) => ev.kind === "arrests").length, 1);

  await withWritesOn(async () => {
    const client = fakeClient();
    await syncPersonEvents(client, loaded);
    assert.match(client.calls.find((call) => /INSERT INTO person_events/.test(call.text)).text, /ON CONFLICT \(person_id, kind, seq\)/);
    const inserts = client.calls.filter((call) => /INSERT INTO person_events/.test(call.text));
    const byKey = Object.fromEntries(inserts.map((call) => [`${call.params[1]}:${call.params[2]}`, call.params]));
    assert.deepEqual(Object.keys(byKey).sort(), ["arrests:0", "indictment_civilian:0", "indictment_civilian:1"]);
    assert.equal(byKey["indictment_civilian:0"][3], "2026-04-28");
    assert.equal(byKey["indictment_civilian:0"][15], null);
    assert.equal(byKey["indictment_civilian:1"][3], "2026-09-25");
    assert.equal(byKey["indictment_civilian:1"][15], true);
    assert.equal(byKey["indictment_civilian:1"][10], DC);
  });

  const html = personDetail(loaded);
  const articles = indictmentArticles(html);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].kind, "indictment_civilian");
  assert.match(articles[0].html, /datetime="2026-04-28"/);
  assert.match(articles[0].html, /Eastern District of North Carolina indictment/);
  assert.doesNotMatch(articles[0].html, /data-unsealed/);
  assert.doesNotMatch(articles[0].html, /1:26-cr-00229/);
  assert.match(articles[1].html, /datetime="2026-09-25"/);
  assert.match(articles[1].html, /1:26-cr-00229/);
  assert.match(articles[1].html, /data-unsealed="true"/);
  assert.match(articles[1].html, />Unsealed</);
  const arrestAt = html.indexOf('data-kind="arrests"');
  assert.ok(html.indexOf(articles[0].html) < arrestAt && arrestAt < html.indexOf(articles[1].html));
  const headings = [...html.matchAll(/<h4 class="source-group-h">([^<]+)<\/h4>/g)].map((match) => match[1]);
  assert.equal(headings.filter((heading) => heading === "Apr 28, 2026 · Indictments — civilians").length, 1);
  assert.equal(headings.filter((heading) => heading === "Sep 25, 2026 · Indictments — civilians").length, 1);

  const listed = await listPeople("indictment_civilian");
  assert.equal(listed.filter((row) => row.id === "multi-indict").length, 1);
  assert.equal(listed.find((row) => row.id === "multi-indict").event_date, "2026-09-25");
  const listHtml = peopleList(listed);
  assert.equal((listHtml.match(/class="tui-title">Multi Indict/g) || []).length, 1);
  assert.match(listHtml, /datetime="2026-09-25"/);

  const page = await requestPage("/people/multi-indict");
  assert.equal(page.status, 200);
  assert.equal(indictmentArticles(page.body).length, 2);
  assert.equal((page.body.match(/data-unsealed="true"/g) || []).length, 1);
  const civilians = await requestPage("/indictments/civilians");
  assert.equal(civilians.status, 200);
  assert.equal((civilians.body.match(/class="tui-title">Multi Indict/g) || []).length, 1);
  assert.match(civilians.body, /datetime="2026-09-25"/);
  const other = await requestPage("/indictments/non-civilians");
  assert.doesNotMatch(other.body, /Multi Indict/);

  const extra = AP("dc-extra", "2026-09-25");
  const appended = await appendPersonSources("multi-indict", [extra], "indictment_civilian");
  const after = appended.person.events.filter((ev) => ev.kind === "indictment_civilian");
  assert.equal(after.length, 2);
  assert.ok(after.find((ev) => ev.seq === 1).sources.some((source) => source.url === extra.url));
  assert.equal(after.find((ev) => ev.seq === 0).sources.some((source) => source.url === extra.url), false);
});

test("one indictment still renders as one entry at seq 0", async () => {
  const stored = {
    id: "one-indict",
    name: "One Indict",
    category: "indictment_civilian",
    event_date: "2026-04-28",
    events: [
      {
        kind: "indictment_civilian",
        event_date: "2026-04-28",
        comments: EDNC,
        unsealed: true,
        sources: [AP("ednc", "2026-04-28")],
      },
    ],
  };
  const plain = projectPerson(stored);
  const explicit = projectPerson({
    ...stored,
    events: [{ ...stored.events[0], seq: 0 }],
  });
  assert.equal(personDetail(plain), personDetail(explicit));
  assert.equal(eventsOfKind(plain.events, "indictment_civilian")[0].seq, 0);
  assert.equal(plain.event_date, "2026-04-28");
  const html = personDetail(plain);
  const articles = indictmentArticles(html);
  assert.equal(articles.length, 1);
  assert.match(articles[0].html, /datetime="2026-04-28"/);
  assert.match(articles[0].html, /data-unsealed="true"/);
  assert.equal((html.match(/<h4 class="source-group-h">Apr 28, 2026 · Indictments — civilians<\/h4>/g) || []).length, 1);

  setMemory({ people: [plain] });
  await savePerson(plain);
  const loaded = await getPerson("one-indict");
  assert.equal(loaded.events.filter((ev) => ev.kind === "indictment_civilian").length, 1);
  const list = peopleList(await listPeople("indictment_civilian"));
  assert.equal((list.match(/class="tui-title">One Indict/g) || []).length, 1);
  assert.match(list, /datetime="2026-04-28"/);
  assert.doesNotMatch(list, /data-unsealed/);

  await withWritesOn(async () => {
    const client = fakeClient();
    await syncPersonEvents(client, loaded);
    const inserts = client.calls.filter((call) => /INSERT INTO person_events/.test(call.text));
    assert.deepEqual(inserts.map((call) => `${call.params[1]}:${call.params[2]}`), ["indictment_civilian:0"]);
    assert.equal(inserts[0].params[15], true);
  });
});

test("a non-repeatable kind is still one event, and the same indictment folds", () => {
  const firing = projectPerson({
    id: "one-firing",
    name: "One Firing",
    category: "firings",
    event_date: "2017-05-09",
    events: [{ kind: "firings", event_date: "2017-05-09", sources: [AP("fired", "2017-05-09")] }],
  });
  const again = attachPersonEvent(firing, {
    kind: "firings",
    event_date: "2018-01-01",
    seq: 4,
    sources: [AP("fired-2", "2018-01-01")],
  });
  assert.equal(again.existed, true);
  const firings = again.person.events.filter((ev) => ev.kind === "firings");
  assert.equal(firings.length, 1);
  assert.equal(firings[0].event_date, "2017-05-09");
  assert.equal("seq" in firings[0], false);
  assert.equal(eventSeq({ kind: "firings", seq: 4 }), 0);
  assert.equal(indictmentArticles(personDetail(again.person)).length, 0);

  let kept = projectPerson({
    id: "same-indict",
    name: "Same Indict",
    category: "indictment_civilian",
    event_date: "2026-04-28",
    events: [
      {
        kind: "indictment_civilian",
        event_date: "2026-04-28",
        comments: EDNC,
        sources: [AP("ednc", "2026-04-28")],
      },
    ],
  });
  const folded = attachPersonEvent(kept, {
    kind: "indictment_non_civilian",
    event_date: "2026-04-28",
    comments: EDNC,
    sources: [AP("ednc", "2026-04-28"), AP("ednc-2", "2026-04-29")],
  });
  assert.equal(folded.existed, true);
  assert.equal(folded.person.events.filter((ev) => String(ev.kind).startsWith("indictment_")).length, 1);
  assert.equal(folded.person.events[0].kind, "indictment_civilian");
  assert.equal(folded.person.events[0].seq, 0);
  assert.equal(indictmentArticles(personDetail(folded.person)).length, 1);

  const separate = attachPersonEvent(kept, {
    kind: "indictment_non_civilian",
    event_date: "2026-09-25",
    comments: DC,
    sources: [AP("dc", "2026-09-25")],
  });
  assert.equal(separate.existed, false);
  assert.equal(separate.person.events.some((ev) => ev.kind === "indictment_non_civilian"), false);
  assert.equal(eventsOfKind(separate.person.events, "indictment_civilian").length, 2);
});

test("two indictments on one day stay separate, in seq order, with their own Unsealed flag", () => {
  const person = projectPerson({
    id: "same-day",
    name: "Same Day",
    category: "indictment_non_civilian",
    event_date: "2026-04-28",
    events: [
      {
        kind: "indictment_non_civilian",
        seq: 0,
        event_date: "2026-04-28",
        comments: EDNC,
        sources: [AP("ednc", "2026-04-28")],
      },
      {
        kind: "indictment_non_civilian",
        seq: 1,
        event_date: "2026-04-28",
        comments: DC,
        unsealed: true,
        sources: [AP("dc", "2026-04-28")],
      },
    ],
  });
  const html = personDetail(person);
  const articles = indictmentArticles(html);
  assert.deepEqual(articles.map((article) => article.kind), ["indictment_non_civilian", "indictment_non_civilian"]);
  assert.match(articles[0].html, /Eastern District of North Carolina indictment/);
  assert.doesNotMatch(articles[0].html, /data-unsealed/);
  assert.match(articles[1].html, /1:26-cr-00229/);
  assert.match(articles[1].html, /data-unsealed="true"/);
  const headings = [...html.matchAll(/<h4 class="source-group-h">([^<]+)<\/h4>/g)].map((match) => match[1]);
  assert.equal(headings.filter((heading) => heading === "Apr 28, 2026 · Indictments — non-civilians").length, 2);
  const list = peopleList([person]);
  assert.equal((list.match(/class="tui-title">Same Day/g) || []).length, 1);
});

test("unsealed annotate and gap-upsert keep each indictment seq", () => {
  const person = projectPerson({
    id: "unseal-one",
    name: "Unseal One",
    category: "indictment_civilian",
    event_date: "2026-04-28",
    events: [
      {
        kind: "indictment_civilian",
        event_date: "2026-04-28",
        comments: EDNC,
        unsealed: true,
        sources: [AP("ednc", "2026-04-28")],
      },
      {
        kind: "indictment_civilian",
        event_date: "2026-09-25",
        comments: "The indictment was unsealed. D.C. case 1:26-cr-00229.",
        sources: [AP("dc", "2026-09-25")],
      },
    ],
  });
  const annotated = annotateUnsealedPerson(person);
  assert.equal(annotated.changed, true);
  assert.equal(annotated.person.events.find((ev) => ev.seq === 0).unsealed, true);
  assert.equal(annotated.person.events.find((ev) => ev.seq === 1).unsealed, true);
  assert.equal(annotated.person.events.find((ev) => ev.seq === 0).comments, EDNC);
  assert.deepEqual(planUnsealedAnnotations([person]), [
    { id: "unseal-one", kind: "indictment_civilian", seq: 1 },
  ]);

  const sealed = projectPerson({
    ...person,
    events: person.events.map((ev) => (ev.seq === 1 ? { ...ev, comments: DC, unsealed: null } : ev)),
  });
  assert.equal(annotateUnsealedPerson(sealed).changed, false);
  assert.equal(planUnsealedAnnotations([sealed]).length, 0);

  const upsert = buildUpsertSql("person_events", [
    {
      person_id: "unseal-one",
      kind: "indictment_civilian",
      seq: 0,
      event_date: "2026-04-28",
      sources: [],
      unsealed: null,
    },
    {
      person_id: "unseal-one",
      kind: "indictment_civilian",
      seq: 1,
      event_date: "2026-09-25",
      sources: [],
      unsealed: true,
    },
  ]);
  assert.equal(upsert.count, 2);
  assert.match(upsert.sql, /ON CONFLICT \(person_id, kind, seq\)/);
  const cols = [...upsert.sql.match(/INSERT INTO person_events \(([^)]+)\)/)[1].split(",")].map((col) =>
    col.trim().replaceAll('"', ""),
  );
  const width = cols.length;
  assert.equal(upsert.params[cols.indexOf("seq")], 0);
  assert.equal(upsert.params[cols.indexOf("seq") + width], 1);
  assert.equal(upsert.params[cols.indexOf("unsealed")], null);
  assert.equal(upsert.params[cols.indexOf("unsealed") + width], true);

  const script = fs.readFileSync(path.join(ROOT, "scripts", "annotate-unsealed-indictments.mjs"), "utf8");
  assert.match(script, /AND seq = \$3/);
  assert.match(script, /plan\.seq/);
});

test("catalog list orders people by the newest indictment and does not duplicate a card", async () => {
  const early = projectPerson({
    id: "early-indict",
    name: "Early Indict",
    category: "indictment_civilian",
    event_date: "2026-04-28",
    events: [
      {
        kind: "indictment_civilian",
        event_date: "2026-04-28",
        comments: EDNC,
        sources: [AP("ednc", "2026-04-28")],
      },
    ],
  });
  const both = indictmentPerson();
  setMemory({ people: [early, both] });
  const rows = await listPeople("indictment_civilian");
  assert.deepEqual(rows.map((row) => row.id), ["multi-indict", "early-indict"]);
  assert.equal(rows.find((row) => row.id === "early-indict").event_date, "2026-04-28");
  const html = peopleList(rows);
  assert.ok(html.indexOf("Multi Indict") < html.indexOf("Early Indict"));
  assert.equal((html.match(/class="tui-title">/g) || []).length, 2);
  const opened = await listPeople({ category: "indictment_civilian", unsealed: true });
  assert.deepEqual(opened.map((row) => row.id), ["multi-indict"]);
});
