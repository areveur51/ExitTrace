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
  const post = "https://x.com/USAO_SDFL/status/2099958115349463197";
  assert.equal(isOfficialCiteUrl(post), true);
  assert.equal(isOfficialGovPostUrl(post), true);
});
