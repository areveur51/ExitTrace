import assert from "node:assert/strict";
import { test } from "node:test";
import { personDetail } from "../app/lib/html.mjs";

const REUTERS = "https://www.reuters.com/world/us/sleepy-joe";
const NYT = "https://www.nytimes.com/2019/06/11/us/politics/sleepy-joe.html";
const TRUMP_X = "https://x.com/realDonaldTrump/status/2111516431141540160";
const FOX_LIVE = "https://www.foxnews.com/live-news/sleepy-joe";

const OFFICIAL_CITES = [
  { url: REUTERS, publisher: "Reuters", date: "2019-06-11", snippet: "Sleepy Joe" },
  {
    url: NYT,
    publisher: "The New York Times",
    date: "2019-06-11",
    snippet: "Same thing is happening with Sleepy Joe.",
  },
];

const OFFICIAL_NICKNAME_GROUP =
  '<section class="source-group"><h4 class="source-group-h">Trump nickname</h4><ol class="sources cite-list"><li id="source-1"><blockquote class="event-snippet">Sleepy Joe</blockquote><a class="source-link" href="https://www.reuters.com/world/us/sleepy-joe" title="https://www.reuters.com/world/us/sleepy-joe" target="_blank" rel="noopener noreferrer">https://www.reuters.com/world/us/sleepy-joe</a> <span class="cite-outlet">Reuters</span> <time datetime="2019-06-11">Jun 11, 2019</time></li><li id="source-2"><blockquote class="event-snippet">Same thing is happening with Sleepy Joe.</blockquote><a class="source-link" href="https://www.nytimes.com/2019/06/11/us/politics/sleepy-joe.html" title="https://www.nytimes.com/2019/06/11/us/politics/sleepy-joe.html" target="_blank" rel="noopener noreferrer">https://www.nytimes.com/2019/06/11/us/politics/sleepy-joe.html</a> <span class="cite-outlet">The New York Times</span> <time datetime="2019-06-11">Jun 11, 2019</time></li></ol></section>';

function person(sources) {
  return {
    id: "joe-biden",
    name: "Joe Biden",
    category: "government_stepdowns",
    event_date: "2021-01-20",
    nicknames: [{ name: "Sleepy Joe", by: "Donald Trump", sources }],
    events: [
      {
        kind: "government_stepdowns",
        event_date: "2021-01-20",
        comments: "Left office.",
        sources: [{ url: "https://apnews.com/left", date: "2021-01-20" }],
      },
    ],
  };
}

function nicknameGroup(html) {
  const match = html.match(
    /<section class="source-group"><h4 class="source-group-h">Trump nickname<\/h4>[\s\S]*?<\/section>/,
  );
  return match ? match[0] : "";
}

function nicknameArticle(html) {
  const rows = html.match(/<article class="[^"]*\bevent-tag-row\b[^"]*"[\s\S]*?<\/article>/g) || [];
  return rows.find((row) => row.includes('data-kind="nickname"')) || "";
}

test("a nickname card shows supporting cites and leaves an official-only row unchanged", () => {
  const officialHtml = personDetail(person(OFFICIAL_CITES));
  const officialGroup = nicknameGroup(officialHtml);
  const officialArticle = nicknameArticle(officialHtml);
  assert.equal(officialGroup, OFFICIAL_NICKNAME_GROUP);
  assert.match(
    officialArticle,
    /<time class="event-date" datetime="2019-06-11">Jun 11, 2019<\/time><h3 class="event-h">Trump nickname<\/h3>/,
  );
  assert.match(
    officialArticle,
    /<a class="source-ref" href="#source-1">\[1\]<\/a> <a class="source-ref" href="#source-2">\[2\]<\/a>/,
  );
  assert.doesNotMatch(officialArticle, /source-3|realDonaldTrump|foxnews/);
  assert.doesNotMatch(officialHtml, /realDonaldTrump|foxnews\.com/);

  const supportedHtml = personDetail(
    person([
      ...OFFICIAL_CITES,
      {
        url: TRUMP_X,
        publisher: "Donald Trump",
        date: "2010-01-01",
        snippet: "Sleepy Joe Biden",
      },
      {
        url: FOX_LIVE,
        publisher: "Fox News",
        date: "2024-08-08",
        snippet: "Live coverage",
      },
    ]),
  );
  const group = nicknameGroup(supportedHtml);
  const article = nicknameArticle(supportedHtml);
  assert.match(group, new RegExp(`class="source-link" href="${TRUMP_X.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(group, new RegExp(`class="source-link" href="${FOX_LIVE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(group, /Live coverage/);
  assert.match(group, /<span class="cite-outlet">Fox News<\/span>/);
  assert.match(group, /<span class="cite-outlet">Donald Trump<\/span>/);
  const reutersAt = group.indexOf(REUTERS);
  const nytAt = group.indexOf(NYT);
  const trumpAt = group.indexOf(TRUMP_X);
  const foxAt = group.indexOf(FOX_LIVE);
  assert.ok(reutersAt >= 0 && reutersAt < nytAt && nytAt < trumpAt && trumpAt < foxAt);
  assert.match(group, /id="source-3"/);
  assert.match(group, /id="source-4"/);
  assert.match(article, /<time class="event-date" datetime="2019-06-11">/);
  assert.doesNotMatch(article, /datetime="2010-01-01"|datetime="2024-08-08"/);
  assert.match(article, /href="#source-3">\[3\]<\/a>/);
  assert.match(article, /href="#source-4">\[4\]<\/a>/);
  assert.doesNotMatch(article, /supporting source|Supporting cite|extra cite/i);
  assert.doesNotMatch(group, /supporting source|Supporting cite|extra cite/i);
});
