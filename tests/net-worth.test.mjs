import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MISSING_NET_WORTH_NOTE,
  hasRecordedNetWorth,
  isEligibleNetWorthUrl,
  parseNetWorthUsd,
  resolveNetWorth,
} from "../app/lib/net-worth.mjs";

test("only Forbes and Bloomberg URLs are eligible net-worth sources", () => {
  assert.equal(isEligibleNetWorthUrl("https://www.forbes.com/profile/travis-kalanick/"), true);
  assert.equal(
    isEligibleNetWorthUrl(
      "https://www.forbes.com/sites/kurtbadenhausen/2020/01/26/kobe-bryants-600-million-fortune-how-he-got-so-rich/",
    ),
    true,
  );
  assert.equal(
    isEligibleNetWorthUrl("https://www.bloomberg.com/billionaires/profiles/dietrich-mateschitz/"),
    true,
  );
  assert.equal(isEligibleNetWorthUrl("https://example.com/wealth/casey"), false);
  assert.equal(isEligibleNetWorthUrl("https://x.com/RandomCat/status/1"), false);
  assert.equal(isEligibleNetWorthUrl("https://www.nytimes.com/2017/05/09/wealth.html"), false);
});

test("parseNetWorthUsd accepts a non-negative integer only", () => {
  assert.equal(parseNetWorthUsd("2500000000"), 2500000000);
  assert.equal(parseNetWorthUsd("$2,500,000,000"), 2500000000);
  assert.equal(parseNetWorthUsd(0), 0);
  assert.equal(parseNetWorthUsd(""), null);
  assert.equal(parseNetWorthUsd("2.5 billion"), null);
  assert.equal(parseNetWorthUsd("-1"), null);
  assert.equal(parseNetWorthUsd("abc"), null);
});

test("resolveNetWorth fills a published pair and fail-closes otherwise", () => {
  const filled = resolveNetWorth({
    net_worth_usd: "2500000000",
    net_worth_source: "https://www.forbes.com/profile/travis-kalanick/",
  });
  assert.equal(filled.net_worth_usd, 2500000000);
  assert.equal(filled.net_worth_source, "https://www.forbes.com/profile/travis-kalanick/");
  assert.match(filled.net_worth_note, /Forbes/);

  const bloomberg = resolveNetWorth({
    usd: 27500000000,
    source: "https://www.bloomberg.com/billionaires/profiles/dietrich-mateschitz/",
    note: "Bloomberg Billionaires estimate near the time of his death.",
  });
  assert.equal(bloomberg.net_worth_usd, 27500000000);
  assert.equal(bloomberg.net_worth_note, "Bloomberg Billionaires estimate near the time of his death.");

  const missing = resolveNetWorth({});
  assert.equal(missing.net_worth_usd, null);
  assert.equal(missing.net_worth_note, MISSING_NET_WORTH_NOTE);
  assert.equal(missing.net_worth_source, "");

  const invented = resolveNetWorth({
    net_worth_usd: "999",
    net_worth_source: "https://example.com/selfie-wealth",
  });
  assert.deepEqual(invented, missing);

  const numberOnly = resolveNetWorth({ net_worth_usd: "2500000000" });
  assert.deepEqual(numberOnly, missing);

  assert.equal(hasRecordedNetWorth({ net_worth_usd: null, net_worth_note: "", net_worth_source: "" }), false);
  assert.equal(
    hasRecordedNetWorth({
      net_worth_usd: null,
      net_worth_note: MISSING_NET_WORTH_NOTE,
      net_worth_source: "",
    }),
    true,
  );
  assert.equal(hasRecordedNetWorth({ net_worth_usd: 2500000000, net_worth_note: "", net_worth_source: "" }), true);
});
