const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REFRESH_INTERVAL_SECONDS,
  getProviderConfigSummary,
  getProviderPaths,
  providerQuotaWarning,
  readProviderQuota,
  summarizeProviderQuota
} = require("./provider-client.js");

function withEnv(overrides, run) {
  const keys = Object.keys(overrides);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    run();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("getProviderPaths uses the Sofascore live football endpoint by default", () => {
  withEnv({
    SOFASCORE_PATHS: undefined,
    SOFASCORE_SEASON_ID: undefined
  }, () => {
    assert.deepEqual(getProviderPaths(), ["/tournaments/get-live-events?sport=football"]);
    assert.equal(getProviderPaths().includes("/matches/get-live"), false);
  });
});

test("provider summary is ready when API key can use the default live endpoint", () => {
  withEnv({
    RAPIDAPI_KEY: "test-key",
    SOFASCORE_PATHS: undefined,
    SOFASCORE_SEASON_ID: undefined
  }, () => {
    const summary = getProviderConfigSummary();
    assert.equal(summary.liveProviderConfigured, true);
    assert.equal(summary.liveProviderReady, true);
    assert.deepEqual(summary.providerPaths, ["/tournaments/get-live-events?sport=football"]);
  });
});

test("provider refresh interval is fixed at 30 minutes", () => {
  withEnv({
    REFRESH_INTERVAL_SECONDS: "5"
  }, () => {
    const summary = getProviderConfigSummary();
    assert.equal(REFRESH_INTERVAL_SECONDS, 30 * 60);
    assert.equal(summary.refreshEvery, 30 * 60);
  });
});

test("getProviderPaths allows explicit endpoint overrides", () => {
  withEnv({
    SOFASCORE_PATHS: "/custom/a,/custom/b?sport=football",
    SOFASCORE_SEASON_ID: undefined,
    SOFASCORE_UNIQUE_TOURNAMENT_ID: undefined
  }, () => {
    assert.deepEqual(getProviderPaths(), ["/custom/a", "/custom/b?sport=football"]);
  });
});

test("getProviderPaths adds a finished-results endpoint when tournament + season ids are set", () => {
  withEnv({
    SOFASCORE_PATHS: undefined,
    SOFASCORE_UNIQUE_TOURNAMENT_ID: "16",
    SOFASCORE_SEASON_ID: "55557",
    SOFASCORE_RESULTS_PAGES: "1"
  }, () => {
    assert.deepEqual(getProviderPaths(), [
      "/tournaments/get-live-events?sport=football",
      "/tournaments/get-last-matches?tournamentId=16&seasonId=55557&pageIndex=0"
    ]);
  });
});

test("getProviderPaths paginates the finished-results endpoint", () => {
  withEnv({
    SOFASCORE_PATHS: undefined,
    SOFASCORE_UNIQUE_TOURNAMENT_ID: "16",
    SOFASCORE_SEASON_ID: "55557",
    SOFASCORE_RESULTS_PAGES: "3"
  }, () => {
    const paths = getProviderPaths();
    assert.equal(paths.length, 4); // live + 3 pages
    assert.equal(paths[1], "/tournaments/get-last-matches?tournamentId=16&seasonId=55557&pageIndex=0");
    assert.equal(paths[3], "/tournaments/get-last-matches?tournamentId=16&seasonId=55557&pageIndex=2");
  });
});

test("getProviderPaths stays live-only when only one of tournament/season id is set", () => {
  withEnv({
    SOFASCORE_PATHS: undefined,
    SOFASCORE_UNIQUE_TOURNAMENT_ID: "16",
    SOFASCORE_SEASON_ID: undefined
  }, () => {
    assert.deepEqual(getProviderPaths(), ["/tournaments/get-live-events?sport=football"]);
  });
});

test("getProviderPaths honors a custom results path template", () => {
  withEnv({
    SOFASCORE_PATHS: undefined,
    SOFASCORE_UNIQUE_TOURNAMENT_ID: "16",
    SOFASCORE_SEASON_ID: "55557",
    SOFASCORE_RESULTS_PAGES: "1",
    SOFASCORE_RESULTS_PATH: "/seasons/{seasonId}/events/last/{page}"
  }, () => {
    assert.deepEqual(getProviderPaths(), [
      "/tournaments/get-live-events?sport=football",
      "/seasons/55557/events/last/0"
    ]);
  });
});

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
