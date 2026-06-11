const test = require("node:test");
const assert = require("node:assert/strict");
const {
  providerQuotaWarning,
  readProviderQuota,
  summarizeProviderQuota
} = require("./provider-client.js");

test("readProviderQuota detects healthy RapidAPI quota", () => {
  const quota = readProviderQuota(new Headers({
    "x-ratelimit-requests-limit": "1000",
    "x-ratelimit-requests-remaining": "600"
  }), "/matches", 200, new Date("2026-06-11T12:00:00Z"));

  assert.equal(quota.status, "ok");
  assert.equal(quota.limit, 1000);
  assert.equal(quota.remaining, 600);
  assert.equal(providerQuotaWarning(quota), "");
});

test("readProviderQuota detects low API quota", () => {
  const quota = readProviderQuota(new Headers({
    "x-ratelimit-requests-limit": "100",
    "x-ratelimit-requests-remaining": "8"
  }), "/matches", 200, new Date("2026-06-11T12:00:00Z"));

  assert.equal(quota.status, "near_limit");
  assert.match(providerQuotaWarning(quota), /RapidAPI usage is low/);
});

test("readProviderQuota treats 429 as limit reached", () => {
  const quota = readProviderQuota(new Headers({
    "x-ratelimit-requests-limit": "100",
    "x-ratelimit-requests-remaining": "0",
    "x-ratelimit-requests-reset": "60"
  }), "/matches", 429, new Date("2026-06-11T12:00:00Z"));

  assert.equal(quota.status, "limit_reached");
  assert.equal(quota.resetAt, "2026-06-11T12:01:00.000Z");
  assert.match(providerQuotaWarning(quota), /usage limit reached/);
});

test("summarizeProviderQuota reports the lowest remaining endpoint", () => {
  const summary = summarizeProviderQuota([
    readProviderQuota(new Headers({
      "x-ratelimit-requests-limit": "100",
      "x-ratelimit-requests-remaining": "50"
    }), "/a", 200),
    readProviderQuota(new Headers({
      "x-ratelimit-requests-limit": "100",
      "x-ratelimit-requests-remaining": "5"
    }), "/b", 200)
  ], new Date("2026-06-11T12:00:00Z"));

  assert.equal(summary.status, "near_limit");
  assert.equal(summary.remaining, 5);
  assert.equal(summary.endpoints.length, 2);
});
