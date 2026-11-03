/** ET_MULTI_EVENT_WRITES must be exactly "on". No trim and no case folding. */
export function multiEventWritesEnabled(env = process.env) {
  return env.ET_MULTI_EVENT_WRITES === "on";
}
