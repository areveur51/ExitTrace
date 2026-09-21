import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isOfficialCiteUrl,
  isOfficialGovHandle,
  isOfficialGovPostUrl,
} from "../app/lib/official.mjs";

test("USAO Southern District of Florida is an official gov cite handle", () => {
  assert.equal(isOfficialGovHandle("USAO_SDFL"), true);
  assert.equal(isOfficialGovHandle("@usao_sdfl"), true);
  assert.equal(isOfficialGovHandle("USMarshalsHQ"), true);
  assert.equal(isOfficialGovHandle("@usmarshalshq"), true);
  assert.equal(isOfficialGovHandle("BarackObama"), true);
  assert.equal(isOfficialGovHandle("@barackobama"), true);
  assert.equal(
    isOfficialGovPostUrl("https://x.com/barackobama/status/2100193157522620711"),
    true,
  );
  assert.equal(isOfficialGovHandle("NYPost"), true);
  assert.equal(isOfficialGovHandle("@nypost"), true);
  assert.equal(
    isOfficialGovPostUrl("https://x.com/nypost/status/2100207803428147240"),
    true,
  );
  assert.equal(isOfficialGovHandle("FBIDirectorKash"), true);
  assert.equal(isOfficialGovHandle("@fbidirectorkash"), true);
  assert.equal(
    isOfficialGovPostUrl("https://x.com/FBIDirectorKash/status/2100210000000000001"),
    true,
  );
  assert.equal(
    isOfficialCiteUrl("https://x.com/FBIDirectorKash/status/2100210000000000001"),
    true,
  );
  const post = "https://x.com/USAO_SDFL/status/2099958115349463197";
  assert.equal(isOfficialCiteUrl(post), true);
  assert.equal(isOfficialGovPostUrl(post), true);
});
