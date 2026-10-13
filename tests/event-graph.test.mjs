/** Git-graph rail beside person events. Every event is a commit on the trunk. */
import assert from "node:assert/strict";
import test from "node:test";
import { layoutEventGraph, renderEventGraph } from "../app/lib/event-graph.mjs";
import { personDetail } from "../app/lib/html.mjs";

function rowHtml(graph, index) {
  const rows = graph.match(/<div class="event-graph-row"[\s\S]*?<\/div>\s*<\/div>/g) || [];
  return rows[index] || "";
}

test("one event is a single commit and does not draw a line", () => {
  const layout = layoutEventGraph(["arrests"]);
  assert.equal(layout.laneCount, 1);
  assert.equal(layout.rows[0].kind, "arrests");
  const graph = renderEventGraph([{ kind: "arrests", html: "<article>Held</article>" }]);
  assert.match(graph, /class="event-graph"/);
  assert.match(graph, /--graph-w:24px/);
  assert.equal((graph.match(/<circle /g) || []).length, 1);
  assert.doesNotMatch(graph, /<path |<line /);
  assert.doesNotMatch(graph, /graph-stem/);
  assert.match(graph, /data-kind="arrests"/);
});

test("every event is a commit on the same line, with no merge", () => {
  const layout = layoutEventGraph(["arrests", "arrests", "firings"]);
  assert.equal(layout.laneCount, 1);
  assert.deepEqual(
    layout.rows.map((row) => row.kind),
    ["arrests", "arrests", "firings"],
  );
  const graph = renderEventGraph([
    { kind: "arrests", html: "<p>a</p>" },
    { kind: "arrests", html: "<p>b</p>" },
    { kind: "firings", html: "<p>c</p>" },
  ]);
  assert.match(graph, /--graph-w:24px/);
  assert.equal((graph.match(/<circle /g) || []).length, 3);
  assert.doesNotMatch(graph, /<path /);
  assert.equal((graph.match(/class="graph-stem"/g) || []).length, 2);
  const first = rowHtml(graph, 0);
  const middle = rowHtml(graph, 1);
  const last = rowHtml(graph, 2);
  assert.match(first, /<line x1="12" y1="14" x2="12" y2="40"/);
  assert.match(first, /graph-stem/);
  assert.match(middle, /<line x1="12" y1="0" x2="12" y2="14"/);
  assert.match(middle, /<line x1="12" y1="14" x2="12" y2="40"/);
  assert.match(middle, /graph-stem/);
  assert.match(last, /<line x1="12" y1="0" x2="12" y2="14"/);
  assert.doesNotMatch(last, /graph-stem/);
  assert.match(last, /data-kind="firings"/);
});

test("a quote in the kind is escaped on the row", () => {
  const graph = renderEventGraph([{ kind: `a"b<c`, html: "<p>x</p>" }]);
  assert.match(graph, /data-kind="a&quot;b&lt;c"/);
});

test("person detail draws the rail beside timeline events and keeps notable off the event row", () => {
  const html = personDetail({
    id: "casey-vale",
    name: "Casey Vale",
    category: "arrests",
    event_date: "2024-06-15",
    photo: "/media/people/casey-vale.jpg",
    events: [
      {
        kind: "arrests",
        event_date: "2024-06-15",
        comments: "Held after contemporaneous reports.",
        sources: [{ url: "https://www.example.com/news/casey-vale-held", publisher: "Desk" }],
      },
      {
        kind: "notable",
        event_date: "2024-08-01",
        comments: "Named in a published poll of public figures.",
        sources: [{ url: "https://www.example.com/news/casey-vale-notable", publisher: "Desk" }],
      },
    ],
  });
  const timelineAt = html.indexOf('class="event-timeline"');
  const graphAt = html.indexOf('class="event-graph"');
  const notableAt = html.indexOf('class="detail-notable detail-supporting"');
  assert.ok(timelineAt >= 0 && graphAt > timelineAt && notableAt > graphAt);
  assert.match(html, /<article class="event-tag-row"/);
  assert.doesNotMatch(
    html,
    /data-kind="notable"[^>]*class="event-tag-row"|class="event-tag-row"[^>]*data-kind="notable"/,
  );
  assert.equal((html.match(/<circle /g) || []).length, 2);
  assert.doesNotMatch(html, /<path /);
  assert.match(html, /data-kind="arrests"/);
  assert.match(html, /data-kind="notable"/);
  const arrestsAt = html.indexOf('data-kind="arrests"');
  const notableKindAt = html.indexOf('data-kind="notable"');
  assert.ok(arrestsAt >= 0 && notableKindAt > arrestsAt);
});
