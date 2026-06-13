const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyStoredResults,
  emptyStore,
  mergeResultSources,
  readSeedResults
} = require("./result-store.js");
const staticData = require("./public/worldcup-data.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finished(id, homeScore, awayScore) {
  return { id, status: "finished", homeScore, awayScore };
}

test("mergeResultSources unions fixtures and lets later sources win on conflict", () => {
  const seed = { fixtures: { "GD-1": finished("GD-1", 1, 0), "GB-1": finished("GB-1", 2, 2) } };
  const stored = { fixtures: { "GD-1": finished("GD-1", 3, 3) } };

  const merged = mergeResultSources(seed, stored);

  assert.equal(merged.fixtures["GB-1"].homeScore, 2);
  // Durable blob result overrides the seed for the same fixture.
  assert.equal(merged.fixtures["GD-1"].homeScore, 3);
  assert.equal(merged.fixtures["GD-1"].awayScore, 3);
});

test("mergeResultSources keeps the most recent updatedAt", () => {
  const a = { updatedAt: "2026-06-12T00:00:00.000Z", fixtures: {} };
  const b = { updatedAt: "2026-06-13T00:00:00.000Z", fixtures: {} };
  assert.equal(mergeResultSources(a, b).updatedAt, "2026-06-13T00:00:00.000Z");
});

test("readSeedResults reads an inline RESULT_SEED_JSON override", () => {
  const previous = process.env.RESULT_SEED_JSON;
  process.env.RESULT_SEED_JSON = JSON.stringify({ fixtures: { "GD-1": finished("GD-1", 2, 1) } });
  try {
    const seed = readSeedResults();
    assert.equal(seed.warning, "");
    assert.equal(seed.results.fixtures["GD-1"].homeScore, 2);
  } finally {
    if (previous === undefined) delete process.env.RESULT_SEED_JSON;
    else process.env.RESULT_SEED_JSON = previous;
  }
});

test("readSeedResults reports a warning for malformed inline JSON", () => {
  const previous = process.env.RESULT_SEED_JSON;
  process.env.RESULT_SEED_JSON = "{not json";
  try {
    const seed = readSeedResults();
    assert.match(seed.warning, /Seed results unavailable/);
    assert.deepEqual(seed.results, emptyStore());
  } finally {
    if (previous === undefined) delete process.env.RESULT_SEED_JSON;
    else process.env.RESULT_SEED_JSON = previous;
  }
});

test("the committed seed file ships empty so default behavior is unchanged", () => {
  const previous = process.env.RESULT_SEED_JSON;
  delete process.env.RESULT_SEED_JSON;
  try {
    const seed = readSeedResults();
    assert.equal(seed.warning, "");
    assert.deepEqual(seed.results.fixtures, {});
  } finally {
    if (previous !== undefined) process.env.RESULT_SEED_JSON = previous;
  }
});

test("a merged seed baseline marks the fixture finished via applyStoredResults", () => {
  const data = clone(staticData);
  const baseline = mergeResultSources(
    { fixtures: { "GB-1": finished("GB-1", 1, 0) } },
    emptyStore()
  );

  const applied = applyStoredResults(data, baseline);
  const fixture = data.allFixtures.find((item) => item.id === "GB-1");

  assert.equal(applied, 1);
  assert.equal(fixture.status, "finished");
  assert.equal(fixture.homeScore, 1);
  assert.equal(fixture.awayScore, 0);
});
