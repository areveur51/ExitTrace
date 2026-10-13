/** Git-graph timeline for person events. Every event is a commit on the trunk.
 * Dots stay in a fixed cap so a tall card cannot stretch them. Only the
 * line between commits stretches. */

export const GRAPH_PAD = 12;
export const GRAPH_CAP = 40;
export const GRAPH_NODE_Y = 14;
export const GRAPH_MAIN = "currentColor";

function escAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function eventGraphWidth() {
  return GRAPH_PAD * 2;
}

/** One commit per event, in the given order, all on the trunk. */
export function layoutEventGraph(kinds) {
  const list = Array.isArray(kinds) ? kinds : [];
  const rows = list.map((kind) => ({
    kind: String(kind || "event").trim() || "event",
  }));
  return { rows, laneCount: 1 };
}

function line(y1, y2) {
  if (!(y2 > y1)) return "";
  return `<line x1="${GRAPH_PAD}" y1="${y1}" x2="${GRAPH_PAD}" y2="${y2}" stroke="${GRAPH_MAIN}" stroke-width="2" stroke-linecap="butt" />`;
}

function rowRails(count, index) {
  const last = count - 1;
  const y = GRAPH_NODE_Y;
  const parts = [];
  if (index > 0) parts.push(line(0, y));
  if (index < last) parts.push(line(y, GRAPH_CAP));
  parts.push(
    `<circle cx="${GRAPH_PAD}" cy="${y}" r="4.5" fill="${GRAPH_MAIN}" stroke="#0a1016" stroke-width="1.75" />`,
  );
  const width = eventGraphWidth();
  const cap = `<svg class="graph-cap" viewBox="0 0 ${width} ${GRAPH_CAP}" width="${width}" height="${GRAPH_CAP}" aria-hidden="true">${parts.join("")}</svg>`;
  if (index === last) return cap;
  const stem = `<svg class="graph-stem" viewBox="0 0 ${width} 10" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true"><line x1="${GRAPH_PAD}" y1="0" x2="${GRAPH_PAD}" y2="10" stroke="${GRAPH_MAIN}" stroke-width="2" stroke-linecap="butt" vector-effect="non-scaling-stroke" /></svg>`;
  return `${cap}${stem}`;
}

/** One rail per node, in the given order. HTML is already escaped. */
export function renderEventGraph(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((node) => node && String(node.html || "").trim());
  if (!list.length) return "";
  const layout = layoutEventGraph(list.map((node) => node.kind));
  const width = eventGraphWidth();
  const rows = list
    .map((node, index) => {
      const kind = layout.rows[index].kind;
      return `<div class="event-graph-row" data-kind="${escAttr(kind)}">
      <div class="event-graph-rail">${rowRails(list.length, index)}</div>
      <div class="event-graph-card">${node.html}</div>
    </div>`;
    })
    .join("");
  return `<div class="event-graph" style="--graph-w:${width}px">${rows}</div>`;
}
