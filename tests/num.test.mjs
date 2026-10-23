import assert from "node:assert/strict";
import { test } from "node:test";
import { nonNegativeInt, positiveInt } from "../app/lib/num.mjs";

test("positiveInt keeps positive integers and falls back otherwise", () => {
  assert.equal(positiveInt("8", 4), 8);
  assert.equal(positiveInt("8.9", 4), 8);
  assert.equal(positiveInt(3, 4), 3);
  assert.equal(positiveInt("0", 4), 4);
  assert.equal(positiveInt("-3", 4), 4);
  assert.equal(positiveInt("nope", 4), 4);
  assert.equal(positiveInt("", 4), 4);
  assert.equal(positiveInt(undefined, 4), 4);
  assert.equal(positiveInt(null, 4), 4);
  assert.equal(positiveInt(Number.NaN, 4), 4);
  assert.equal(positiveInt(Number.POSITIVE_INFINITY, 4), 4);
});

test("nonNegativeInt allows zero", () => {
  assert.equal(nonNegativeInt("0", 5), 0);
  assert.equal(nonNegativeInt("2.2", 5), 2);
  assert.equal(nonNegativeInt(0, 5), 0);
  assert.equal(nonNegativeInt("-1", 5), 5);
  assert.equal(nonNegativeInt("nope", 5), 5);
  assert.equal(nonNegativeInt(undefined, 5), 5);
});
