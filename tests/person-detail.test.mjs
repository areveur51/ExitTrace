import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENT_ATTR_FIELDS, EVENT_ATTR_LABELS } from "../app/lib/event-attrs.mjs";
import {
  careerHistory,
  citeList,
  eventTagRow,
  grokipediaBlock,
  localMediaThumb,
  personDetail,
  personHeader,
} from "../app/lib/html.mjs";
import { handle } from "../app/server.mjs";
import { applyIdentifiedPerson, getPerson, loadSeedFile, setMemory } from "../app/lib/store.mjs";
import { NEW_PERSON_LOCK } from "./new-person-lock.mjs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CITES = [
  "https://www.example.com/news/casey-vale-held",
  "https://www.example.net/world/casey-vale-arrest",
];
const MORE = [
  "https://www.example.com/news/casey-vale-quit",
  "https://www.example.net/world/casey-vale-resigned",
];

function goldSeed() {
  return loadSeedFile(path.join(ROOT, "data", "seed.json"));
}

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

function paneCount(html) {
  const article = html.match(/<article class="detail[\s\S]*?<\/article>/)?.[0] || html;
  return (article.match(/class="box-pane/g) || []).length;
}

test("shared person pieces stay local thumbs, event-attrs rows, and cite lists", () => {
  assert.match(
    localMediaThumb("/media/people/james-comey.jpg", "James Comey"),
    /\/media\/thumbs\/people\/james-comey\.jpg/,
  );
  assert.doesNotMatch(
    localMediaThumb("https://upload.wikimedia.org/wikipedia/commons/x.jpg", "X"),
    /upload\.wikimedia\.org/,
  );
  const cites = citeList([{ publisher: "BBC News", url: "https://www.bbc.com/news/x" }]);
  assert.match(cites, /class="sources cite-list"/);
  assert.match(cites, /class="cite-outlet">BBC News</);
  assert.match(
    cites,
    /<a class="source-link" href="https:\/\/www\.bbc\.com\/news\/x" title="https:\/\/www\.bbc\.com\/news\/x" target="_blank" rel="noopener noreferrer">https:\/\/www\.bbc\.com\/news\/x<\/a>/,
  );
  assert.doesNotMatch(cites, /<a[^>]*>BBC News<\/a>/);
  const row = eventTagRow(
    {
      kind: "firings",
      event_date: "2024-07-02",
      announced_date: "2024-06-15",
      position: "Anchor, CNN",
      organization: "Example Desk",
      country: "USA",
      branch: "News",
      comments: "lead note",
      notable_group: "MSM",
      title_note: "Anchor",
      status: "tested_positive",
      age_at_event: 39,
      sources: [{ publisher: "One", url: CITES[0] }, { publisher: "Two", url: CITES[1] }],
    },
    { birthDate: "1985-03-12" },
  );
  assert.match(row, /class="event-tag-row"/);
  assert.match(row, /Firings/);
  assert.match(row, /datetime="2024-07-02"/);
  assert.match(row, /Announced/);
  assert.match(row, /datetime="2024-06-15"/);
  assert.match(row, /Age at event · 39/);
  for (const field of EVENT_ATTR_FIELDS) {
    const label = EVENT_ATTR_LABELS[field] || field;
    assert.match(row, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(row, /Notable group · MSM/);
  assert.match(row, /Title note · Anchor/);
  assert.match(row, /Status · Tested positive/);
  assert.match(row, /lead note/);
  assert.match(row, /cite-list/);
  assert.doesNotMatch(row, /Casey Vale/);
  assert.doesNotMatch(row, /Birth date|Origin ·|country_of_origin/);
  const sameDay = eventTagRow({
    kind: "arrests",
    event_date: "2024-06-15",
    announced_date: "2024-06-15",
    sources: [],
  });
  assert.doesNotMatch(sameDay, /Announced/);
  assert.doesNotMatch(sameDay, /Age at event/);
  assert.equal(eventTagRow({ kind: "dog_comms", event_date: "2024-06-15" }), "");
});

test("person detail is one card with identity once and a KEEP tag timeline", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    announced_date: "2024-06-01",
    category: "arrests",
    cite_urls: CITES,
    position: "Anchor, CNN",
    organization: "Example Desk",
    country: "USA",
    branch: "News",
    comments: "lead note",
  });
  await applyIdentifiedPerson({
    subject: "Casey Vale",
    event_date: "2024-08-01",
    category: "indictment_civilian",
    cite_urls: MORE,
  });
  const person = await getPerson("casey-vale");
  const header = personHeader(person);
  assert.match(header, /class="person-header"/);
  assert.match(header, /Casey Vale/);
  assert.match(header, /Birth date/);
  assert.match(header, /datetime="1985-03-12"/);
  assert.match(header, /Origin · United States/);
  assert.doesNotMatch(header, /Anchor, CNN|Example Desk|USA|News|lead note/);
  assert.doesNotMatch(header, /Role ·/);
  assert.doesNotMatch(header, /Trump nickname|data-kind="nickname"/);

  const html = personDetail(person);
  assert.equal(paneCount(html), 1);
  assert.match(html, /class="person-header"/);
  assert.match(html, /meta-pane--stack/);
  assert.doesNotMatch(html, /class="grokipedia-text"|Open Grokipedia/);
  assert.match(html, /class="event-timeline"/);
  assert.equal((html.match(/class="event-tag-row"/g) || []).length, 2);
  assert.match(html, /Arrests/);
  assert.match(html, /Indictments — civilians/);
  assert.match(html, /Age at event · 39/);
  assert.match(html, /Announced/);
  assert.match(html, /datetime="2024-06-01"/);
  assert.match(html, /Position · Anchor, Cable News Network/);
  assert.match(html, /Organization · Example Desk/);
  assert.match(html, /Country · USA/);
  assert.match(html, /Branch · News/);
  assert.match(html, /Comments · lead note/);
  assert.match(html, /casey-vale-held/);
  assert.match(html, /casey-vale-quit/);
  assert.doesNotMatch(html, /dog-comm|dog_comms/);
  assert.doesNotMatch(html, /Synopsis|Role ·/);
  assert.doesNotMatch(html, /data-kind="nickname"/);
  assert.match(html, /\/media\/people\/casey-vale\.jpg/);
  assert.doesNotMatch(html, /class="detail-photo portrait empty-portrait"/);
  assert.doesNotMatch(html, /class="initials detail-photo portrait"/);
  assert.doesNotMatch(html, /class="portrait thumb"/);
  assert.doesNotMatch(html, /upload\.wikimedia\.org/);
  const tags = html.match(/<article class="event-tag-row"[\s\S]*?<\/article>/g) || [];
  assert.equal(tags.length, 2);
  for (const tag of tags) {
    assert.doesNotMatch(tag, /Casey Vale/);
    assert.doesNotMatch(tag, /Birth date|Origin ·|United States|1985-03-12/);
  }

  const page = await requestPage("/people/casey-vale");
  assert.equal(page.status, 200);
  assert.match(page.body, /class="crumbs"|aria-label="Breadcrumb"/);
  assert.match(page.body, /Casey Vale/);
  assert.equal(paneCount(page.body), 1);
});

test("gold person pages stay one card and do not invent birth or event attrs", async () => {
  setMemory(goldSeed());
  const page = await requestPage("/people/james-comey");
  assert.equal(page.status, 200);
  assert.match(page.body, /James Comey/);
  assert.match(page.body, /class="person-header"/);
  assert.match(page.body, /grokipedia-cite/);
  assert.match(page.body, /Grokipedia/);
  assert.match(page.body, /grokipedia\.com\/page\/James_Comey/);
  assert.doesNotMatch(page.body, /Removed as FBI director/);
  assert.doesNotMatch(page.body, /class="grokipedia-text"|Open Grokipedia/);
  assert.match(page.body, /class="event-tag-row"/);
  assert.match(page.body, /Firings/);
  assert.match(page.body, /The New York Times/);
  assert.match(page.body, /src="\/media\/people\/james-comey\.jpg\?p=7"/);
  assert.match(page.body, /james-comey\.hero\.webp\?p=7/);
  assert.doesNotMatch(page.body, /<img[^>]+src="\/media\/thumbs\/people\/james-comey\.jpg/);
  assert.doesNotMatch(page.body, /Birth date|Age at event|Announced/);
  assert.doesNotMatch(page.body, /Director, Federal Bureau of Investigation/);
  assert.doesNotMatch(page.body, /Synopsis/);
  assert.doesNotMatch(page.body, /Career \/ Service|career-history|1953–1954|U\.S\. Army/);
  assert.equal(paneCount(page.body), 1);
  assert.match(grokipediaBlock({ name: "Casey Vale", summary: "Stored encyclopedia note." }), /grokipedia-cite/);
  assert.doesNotMatch(grokipediaBlock({ name: "Casey Vale", summary: "Stored encyclopedia note." }), /Stored encyclopedia note/);
  assert.equal(grokipediaBlock({}), "");
});

test("person detail renders career/service years when stored and does not copy event-tag fields", async () => {
  setMemory(goldSeed());
  await applyIdentifiedPerson({
    ...NEW_PERSON_LOCK,
    subject: "Casey Vale",
    event_date: "2024-06-15",
    category: "arrests",
    cite_urls: CITES,
    position: "Anchor, CNN",
    organization: "Example Desk",
    country: "USA",
    branch: "News",
    comments: "lead note",
    career: [
      { title: "U.S. Army", organization: "U.S. Army", start_year: 1953, end_year: 1954 },
      { position: "Anchor, CNN", organization: "Example Desk", start_year: 2010, end_year: 2024 },
    ],
  });
  const person = await getPerson("casey-vale");
  const section = careerHistory(person);
  assert.match(section, /class="career-history"/);
  assert.match(section, /Career \/ Service/);
  assert.match(section, /U\.S\. Army · 1953–1954/);
  assert.doesNotMatch(section, /2010–2024/);
  assert.doesNotMatch(section, /Anchor, CNN · Example Desk · 2010/);
  assert.doesNotMatch(section, /Position ·|Organization ·|Country ·|Comments ·|Age at event|cite-list|Announced/);
  assert.doesNotMatch(section, /USA|lead note/);
  assert.doesNotMatch(section, /Casey Vale|Birth date|Origin ·/);

  const html = personDetail(person);
  assert.equal(paneCount(html), 1);
  assert.match(html, /class="person-header"/);
  assert.match(html, /class="career-history"/);
  assert.match(html, /class="event-timeline"/);
  assert.match(html, /Position · Anchor, Cable News Network/);
  const tags = html.match(/<article class="event-tag-row"[\s\S]*?<\/article>/g) || [];
  assert.equal(tags.length, 1);
  assert.doesNotMatch(tags[0], /1953–1954|2010–2024|Career \/ Service/);

  const page = await requestPage("/people/casey-vale");
  assert.equal(page.status, 200);
  assert.match(page.body, /U\.S\. Army · 1953–1954/);
  assert.equal(paneCount(page.body), 1);

  assert.equal(careerHistory({ name: "Empty", role: "Actor" }), "");
  assert.equal(careerHistory({ career: [{ title: "U.S. Army" }] }), "");
});

test("identity panel leaves null origin blank, sources are numbered, notables stay at the bottom", () => {
  const early = "https://www.example.com/news/casey-vale-fired";
  const later = "https://www.example.net/world/casey-vale-quit";
  const notableUrl = "https://www.example.com/news/casey-vale-notable";
  const headerShot = "/media/screenshots/people/casey-vale.jpg";
  const notableShot = "/media/screenshots/people/casey-vale-notable.jpg";
  const clip = "/media/people/casey-vale/support/rally.jpg";
  const hearing = "/media/people/casey-vale/support/hearing.jpg";
  const html = personDetail({
    id: "casey-vale",
    name: "Casey Vale",
    category: "resignations",
    event_date: "2021-01-20",
    birth_date: null,
    country_of_origin: null,
    photo: "/media/people/james-comey.jpg",
    screenshot: headerShot,
    net_worth_usd: null,
    tags: ["official"],
    events: [
      {
        kind: "resignations",
        event_date: "2021-01-20",
        position: "Director",
        sources: [{ url: later, publisher: "Reuters", date: "2021-01-20" }],
      },
      {
        kind: "firings",
        event_date: "2017-05-09",
        sources: [{ url: early, publisher: "The New York Times", date: "2017-05-09" }],
        media: [{ src: hearing, url: early, alt: "Hearing still" }],
      },
      {
        kind: "notable",
        event_date: "2019-06-01",
        comments: "Named in a published poll of public figures.",
        screenshot: notableShot,
        sources: [{ url: notableUrl, date: "2019-06-01", snippet: "Named in the poll lead" }],
        media: [{ src: clip, url: notableUrl, alt: "Downloaded post still" }],
      },
    ],
  });

  const timelineAt = html.indexOf('class="event-timeline"');
  const header = html.slice(0, timelineAt);
  assert.match(header, /class="person-header"/);
  assert.match(header, /class="row-media"/);
  assert.match(header, /class="detail-photo portrait"/);
  assert.match(header, /Casey Vale/);
  assert.doesNotMatch(header, /Origin ·/);
  assert.doesNotMatch(header, /United States|Germany|\bUSA\b/);
  assert.doesNotMatch(header, />\s*null\s*</i);
  assert.match(header, /<span class="nw">—<\/span>/);
  assert.match(header, /class="person-tags"/);
  assert.match(header, />Officials</);
  assert.doesNotMatch(header, /detail-tile--screenshot|detail-notable|detail-tile--support/);
  assert.doesNotMatch(header, /screenshots\/people/);

  const firingAt = html.indexOf('data-kind="firings"');
  const resignationAt = html.indexOf('data-kind="resignations"');
  assert.ok(firingAt > timelineAt && resignationAt > firingAt);

  const sourcesAt = html.indexOf('aria-label="Sources"');
  const notableAt = html.indexOf('class="detail-notable detail-supporting"');
  const supportAt = html.indexOf('aria-label="Supporting media"');
  assert.ok(sourcesAt > resignationAt && notableAt > sourcesAt && supportAt > notableAt);
  const sources = html.slice(sourcesAt, notableAt);
  assert.match(sources, /<ol class="sources cite-list">/);
  const link = (url) =>
    new RegExp(
      `<a class="source-link" href="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" title="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" target="_blank" rel="noopener noreferrer">${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</a>`,
    );
  assert.match(sources, link(early));
  assert.match(sources, link(later));
  assert.match(sources, link(notableUrl));
  const earlyAt = sources.indexOf(`>${early}<`);
  const notableLinkAt = sources.indexOf(`>${notableUrl}<`);
  const laterAt = sources.indexOf(`>${later}<`);
  assert.ok(earlyAt >= 0 && notableLinkAt > earlyAt && laterAt > notableLinkAt);
  assert.equal((sources.match(/<li>/g) || []).length, 3);

  assert.match(html.slice(notableAt, supportAt), /<h3 class="event-h">Notable event<\/h3>/);
  assert.match(html.slice(notableAt, supportAt), /rally\.jpg/);
  assert.match(html.slice(supportAt), /hearing\.jpg/);
  assert.doesNotMatch(html.slice(0, notableAt), /detail-tile--support/);
  assert.doesNotMatch(html.slice(0, notableAt), /casey-vale-notable\.jpg/);
});
