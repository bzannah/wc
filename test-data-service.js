const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createStaticSnapshot,
  createWorldCupSnapshot,
  extractEvents,
  mergeSofascoreEvents,
  normalizeName,
  normalizeStage
} = require("./data-service.js");
const staticData = require("./public/worldcup-data.js");

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

test("extractEvents finds Sofascore-like events inside provider payloads", () => {
  const payload = {
    data: {
      events: [
        {
          id: 123,
          homeTeam: { name: "Mexico" },
          awayTeam: { name: "South Africa" },
          status: { type: "notstarted" },
          startTimestamp: 1781204400
        }
      ]
    }
  };

  assert.equal(extractEvents(payload).length, 1);
});

test("snapshots default to a 5 minute refresh interval", () => {
  assert.equal(createStaticSnapshot().refreshEvery, 5 * 60);
  assert.equal(createWorldCupSnapshot().refreshEvery, 5 * 60);
});

test("provider event updates fixture and recomputes standings", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-11T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9001,
            tournament: { name: "FIFA World Cup, Group A" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "South Africa" },
            homeScore: { current: 2 },
            awayScore: { current: 1 },
            status: { type: "finished" },
            startTimestamp: 1781204400,
            venue: { name: "Estadio Azteca", city: { name: "Mexico City" }, country: { name: "Mexico" } }
          }
        ]
      }
    ]
  });

  const fixture = snapshot.groupFixtures.find((item) => item.providerId === "9001");
  const groupA = snapshot.groups.find((group) => group.id === "A");

  assert.equal(snapshot.source, "live");
  assert.equal(fixture.homeScore, 2);
  assert.equal(fixture.awayScore, 1);
  assert.equal(fixture.status, "finished");
  assert.equal(groupA.teams[0].id, "MEX");
  assert.equal(groupA.teams[0].points, 3);
  assert.equal(snapshot.dataQuality.level, "verified");
});

test("provider event with reversed teams keeps canonical fixture order", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-11T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9002,
            tournament: { name: "FIFA World Cup, Group A" },
            homeTeam: { name: "South Africa" },
            awayTeam: { name: "Mexico" },
            homeScore: { current: 0 },
            awayScore: { current: 2 },
            status: { type: "finished" },
            startTimestamp: 1781204400
          }
        ]
      }
    ]
  });
  const fixture = snapshot.groupFixtures.find((item) => item.providerId === "9002");

  assert.equal(fixture.home, "MEX");
  assert.equal(fixture.away, "RSA");
  assert.equal(fixture.homeScore, 2);
  assert.equal(fixture.awayScore, 0);
});

test("half-time provider event does not show a runaway live minute", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-11T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9004,
            tournament: { name: "FIFA World Cup, Group A" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "South Africa" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress", description: "Halftime" },
            time: { currentPeriodStartTimestamp: 1781204400 },
            startTimestamp: 1781204400
          }
        ]
      }
    ]
  });
  const fixture = snapshot.groupFixtures.find((item) => item.providerId === "9004");

  assert.equal(snapshot.source, "live");
  assert.equal(snapshot.refreshEvery, 5 * 60);
  assert.equal(fixture.status, "half-time");
  assert.equal(fixture.minute, null);
  assert.equal(fixture.homeScore, 1);
  assert.equal(fixture.awayScore, 0);
  assert.equal(snapshot.dataQuality.level, "verified");
});

test("stored final result is applied after a match leaves the live feed", () => {
  const snapshot = createStaticSnapshot({
    storedResults: {
      fixtures: {
        "GA-1": {
          id: "GA-1",
          status: "finished",
          homeScore: 2,
          awayScore: 0,
          providerId: "15186710",
          sourceUrl: "https://www.sofascore.com/mexico-south-africa"
        }
      }
    }
  });
  const fixture = snapshot.groupFixtures.find((item) => item.id === "GA-1");
  const groupA = snapshot.groups.find((group) => group.id === "A");

  assert.equal(snapshot.source, "stored");
  assert.equal(snapshot.dataMode, "stored-results");
  assert.equal(snapshot.storedResultCount, 1);
  assert.equal(fixture.status, "finished");
  assert.equal(fixture.homeScore, 2);
  assert.equal(fixture.awayScore, 0);
  assert.equal(groupA.teams[0].id, "MEX");
  assert.equal(groupA.teams[0].points, 3);
});

test("a scoreless live-feed event does not downgrade a confirmed final", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-13T20:00:00Z"),
    storedResults: {
      fixtures: {
        "GA-1": { id: "GA-1", status: "finished", homeScore: 2, awayScore: 0 }
      }
    },
    providerPayloads: [
      {
        events: [
          {
            id: 9200,
            tournament: { name: "FIFA World Cup, Group A" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "South Africa" },
            status: { type: "notstarted" },
            startTimestamp: 1781204400
          }
        ]
      }
    ]
  });
  const fixture = snapshot.groupFixtures.find((item) => item.id === "GA-1");

  assert.equal(fixture.status, "finished");
  assert.equal(fixture.homeScore, 2);
  assert.equal(fixture.awayScore, 0);
});

test("global live feed ignores unrelated football events without user-facing warnings", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-11T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9100,
            tournament: { name: "Club Friendly" },
            homeTeam: { name: "Arsenal" },
            awayTeam: { name: "Chelsea" },
            homeScore: { current: 1 },
            awayScore: { current: 1 },
            status: { type: "inprogress" },
            startTimestamp: 1781204400
          },
          {
            id: 9101,
            tournament: { name: "FIFA World Cup, Group A" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "South Africa" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress" },
            startTimestamp: 1781204400
          }
        ]
      }
    ]
  });

  assert.equal(snapshot.source, "live");
  assert.equal(snapshot.refreshEvery, 5 * 60);
  assert.equal(snapshot.providerMerge.merged, 1);
  assert.equal(snapshot.providerMerge.rejected, 1);
  assert.doesNotMatch(snapshot.warnings.join(" "), /teams could not be matched/);
});

test("provider event without group id is rejected instead of merged", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-11T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9003,
            tournament: { name: "FIFA World Cup" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "South Africa" },
            homeScore: { current: 1 },
            awayScore: { current: 1 },
            status: { type: "finished" },
            startTimestamp: 1781204400
          }
        ]
      }
    ]
  });

  assert.equal(snapshot.source, "demo");
  assert.equal(snapshot.providerMerge.merged, 0);
  assert.equal(snapshot.providerMerge.rejected, 1);
  assert.match(snapshot.warnings.join(" "), /missing a group id/);
});

test("a live knockout event matches its bracket slot by stage, venue and kickoff", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-07-04T18:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9300,
            tournament: { name: "FIFA World Cup, Round of 16" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "Germany" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress" },
            startTimestamp: Math.floor(new Date("2026-07-04T17:00:00Z").getTime() / 1000),
            venue: { name: "NRG Stadium", city: { name: "Houston" } }
          }
        ]
      }
    ]
  });

  const k17 = snapshot.knockoutFixtures.find((fixture) => fixture.id === "K17");

  assert.equal(snapshot.providerMerge.merged, 1);
  assert.equal(k17.home, "MEX", "the slot adopts the event's real home team");
  assert.equal(k17.away, "GER");
  assert.equal(k17.homeScore, 1);
  assert.equal(k17.awayScore, 0);
  assert.equal(k17.status, "live");
  assert.equal(k17.providerId, "9300");
  assert.equal(snapshot.dataQuality.level, "verified");
});

test("an unidentifiable knockout event is rejected rather than grabbing a slot", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-07-04T18:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9301,
            tournament: { name: "FIFA World Cup, Round of 16" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "Germany" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress" },
            // No venue and a kickoff far outside any scheduled slot's window.
            startTimestamp: Math.floor(new Date("2026-06-01T00:00:00Z").getTime() / 1000)
          }
        ]
      }
    ]
  });

  assert.equal(snapshot.providerMerge.merged, 0);
  assert.equal(snapshot.providerMerge.rejected, 1);
});

test("blank standings preserve draw order before results arrive", () => {
  const snapshot = createStaticSnapshot();
  const groupA = snapshot.groups.find((group) => group.id === "A");

  assert.equal(snapshot.dataQuality.level, "verified");
  assert.deepEqual(
    groupA.teams.map((team) => team.id),
    ["MEX", "RSA", "KOR", "CZE"]
  );
});

test("name normalization handles accents and punctuation", () => {
  assert.equal(normalizeName("Curaçao"), "curacao");
  assert.equal(normalizeName("Bosnia & Herzegovina"), "bosniaandherzegovina");
});

// ---------------------------------------------------------------------------
// Knockout-stage resilience
//
// The group stage assumes every provider event carries a Group X label and
// that fixtures are addressable by team pair. The knockout stage breaks both
// assumptions: events carry round names ("Round of 32", "1/16 Finals") and
// fixtures hold bracket placeholders ("2A", "W01") until a live event names
// the real teams. The tests below ensure the merge pipeline survives that
// transition without losing or corrupting data.
// ---------------------------------------------------------------------------

test("a stale live event with older scores does not downgrade a confirmed final", () => {
  // Stored result: K17 finished 2-1 (MEX vs GER).
  // Provider lag: a stale "inprogress" event arrives with an older 1-0 score.
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-07-04T18:00:00Z"),
    storedResults: {
      fixtures: {
        K17: { id: "K17", status: "finished", homeScore: 2, awayScore: 1, home: "MEX", away: "GER" }
      }
    },
    providerPayloads: [
      {
        events: [
          {
            id: 9500,
            tournament: { name: "FIFA World Cup, Round of 16" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "Germany" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress" },
            startTimestamp: Math.floor(new Date("2026-07-04T17:00:00Z").getTime() / 1000),
            venue: { name: "NRG Stadium", city: { name: "Houston" } }
          }
        ]
      }
    ]
  });

  const k17 = snapshot.knockoutFixtures.find((fixture) => fixture.id === "K17");

  assert.equal(k17.status, "finished", "finished status is preserved");
  assert.equal(k17.homeScore, 2, "original home score is preserved");
  assert.equal(k17.awayScore, 1, "original away score is preserved");
});

test("a scoreless event does not strip scores from a live fixture", () => {
  // First snapshot: match goes live with a 1-0 score.
  // Second event (same batch, provider hiccup): "notstarted" with no scores.
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-28T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9600,
            tournament: { name: "FIFA World Cup, Round of 32" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "Bosnia and Herzegovina" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress" },
            startTimestamp: Math.floor(new Date("2026-06-28T19:00:00Z").getTime() / 1000),
            venue: { name: "SoFi Stadium", city: { name: "Los Angeles" } }
          },
          {
            id: 9601,
            tournament: { name: "FIFA World Cup, Round of 32" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "Bosnia and Herzegovina" },
            status: { type: "notstarted" },
            startTimestamp: Math.floor(new Date("2026-06-28T19:00:00Z").getTime() / 1000),
            venue: { name: "SoFi Stadium", city: { name: "Los Angeles" } }
          }
        ]
      }
    ]
  });

  const k01 = snapshot.knockoutFixtures.find((fixture) => fixture.id === "K01");

  assert.equal(k01.homeScore, 1, "live score is not stripped by the scoreless event");
  assert.equal(k01.awayScore, 0);
  assert.equal(k01.status, "live");
});

test("a knockout event with an alternative round name still matches its slot", () => {
  // Some providers label the Round of 32 as "1/16 Finals" instead of
  // "Round of 32". The pipeline must still recognize the stage.
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-28T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9700,
            tournament: { name: "FIFA World Cup 2026" },
            roundInfo: { name: "1/16-finals" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "Bosnia and Herzegovina" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress" },
            startTimestamp: Math.floor(new Date("2026-06-28T19:00:00Z").getTime() / 1000),
            venue: { name: "SoFi Stadium", city: { name: "Los Angeles" } }
          }
        ]
      }
    ]
  });

  const k01 = snapshot.knockoutFixtures.find((fixture) => fixture.id === "K01");

  assert.equal(snapshot.providerMerge.merged, 1);
  assert.equal(k01.home, "MEX");
  assert.equal(k01.away, "BIH");
  assert.equal(k01.homeScore, 1);
});

test("a team-matched knockout fixture accepts an event whose stage label differs", () => {
  // K01 already has real teams (from a stored result). A subsequent live
  // event arrives with an unrecognized stage name ("Knockout Phase"). The
  // team-pair match is authoritative, so the merge must succeed.
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-28T20:00:00Z"),
    storedResults: {
      fixtures: {
        K01: { id: "K01", status: "finished", homeScore: 2, awayScore: 1, home: "MEX", away: "BIH" }
      }
    },
    providerPayloads: [
      {
        events: [
          {
            id: 9800,
            tournament: { name: "FIFA World Cup, Knockout Phase" },
            homeTeam: { name: "Mexico" },
            awayTeam: { name: "Bosnia and Herzegovina" },
            homeScore: { current: 2 },
            awayScore: { current: 1 },
            status: { type: "finished" },
            startTimestamp: Math.floor(new Date("2026-06-28T19:00:00Z").getTime() / 1000),
            venue: { name: "SoFi Stadium", city: { name: "Los Angeles" } }
          }
        ]
      }
    ]
  });

  const k01 = snapshot.knockoutFixtures.find((fixture) => fixture.id === "K01");

  assert.equal(snapshot.providerMerge.merged, 1, "team-pair match overrides stage-name mismatch");
  assert.equal(k01.homeScore, 2);
  assert.equal(k01.awayScore, 1);
  assert.equal(k01.stage, "Round of 32", "fixture stage is not corrupted by the provider label");
});

test("a finished knockout result survives after the match leaves the live feed", () => {
  // Simulate: the match was finished and persisted, but the provider no
  // longer returns it (it left the live feed). The stored result alone must
  // keep the fixture in its finished state.
  const snapshot = createStaticSnapshot({
    storedResults: {
      fixtures: {
        K01: { id: "K01", status: "finished", homeScore: 3, awayScore: 2, home: "MEX", away: "BIH" }
      }
    }
  });

  const k01 = snapshot.knockoutFixtures.find((fixture) => fixture.id === "K01");

  assert.equal(k01.status, "finished");
  assert.equal(k01.home, "MEX");
  assert.equal(k01.away, "BIH");
  assert.equal(k01.homeScore, 3);
  assert.equal(k01.awayScore, 2);
});

test("multiple knockout events in one batch match distinct slots without cross-assignment", () => {
  const snapshot = createWorldCupSnapshot({
    now: new Date("2026-06-29T20:00:00Z"),
    providerPayloads: [
      {
        events: [
          {
            id: 9901,
            tournament: { name: "FIFA World Cup, Round of 32" },
            homeTeam: { name: "Brazil" },
            awayTeam: { name: "Morocco" },
            homeScore: { current: 1 },
            awayScore: { current: 0 },
            status: { type: "inprogress" },
            startTimestamp: Math.floor(new Date("2026-06-29T17:00:00Z").getTime() / 1000),
            venue: { name: "Mercedes-Benz Stadium", city: { name: "Atlanta" } }
          },
          {
            id: 9902,
            tournament: { name: "FIFA World Cup, Round of 32" },
            homeTeam: { name: "United States" },
            awayTeam: { name: "Paraguay" },
            homeScore: { current: 2 },
            awayScore: { current: 1 },
            status: { type: "inprogress" },
            startTimestamp: Math.floor(new Date("2026-06-29T17:00:00Z").getTime() / 1000),
            venue: { name: "NRG Stadium", city: { name: "Houston" } }
          }
        ]
      }
    ]
  });

  const fixtures = snapshot.knockoutFixtures;
  const merged = fixtures.filter((fixture) => fixture.providerId);

  assert.equal(snapshot.providerMerge.merged, 2);
  assert.equal(merged.length, 2);
  assert.equal(merged.every((fixture) => fixture.home !== fixture.away), true);
  for (const fixture of merged) {
    const other = merged.find((item) => item !== fixture);
    assert.ok(other, "each merged fixture is distinct");
  }
});

test("normalizeStage maps common provider round-name variants", () => {
  const cases = [
    { label: "FIFA World Cup, Round of 32", expected: "Round of 32" },
    { label: "FIFA World Cup 2026, 1/16 Finals", expected: "Round of 32" },
    { label: "FIFA World Cup, 1/16-finals", expected: "Round of 32" },
    { label: "FIFA World Cup, Last 32", expected: "Round of 32" },
    { label: "FIFA World Cup, Round of 16", expected: "Round of 16" },
    { label: "FIFA World Cup, 1/8 Finals", expected: "Round of 16" },
    { label: "FIFA World Cup, Quarter-finals", expected: "Quarter-final" },
    { label: "FIFA World Cup, 1/4 Finals", expected: "Quarter-final" },
    { label: "FIFA World Cup, Semifinals", expected: "Semi-final" },
    { label: "FIFA World Cup, 1/2 Finals", expected: "Semi-final" },
    { label: "FIFA World Cup, Third-place play-off", expected: "Third-place play-off" },
    { label: "FIFA World Cup, 3rd-place", expected: "Third-place play-off" },
    { label: "FIFA World Cup, Final", expected: "Final" }
  ];

  for (const { label, expected } of cases) {
    assert.equal(normalizeStage(label), expected, `normalizeStage("${label}")`);
  }
});

test("a stale notstarted event does not corrupt a live knockout fixture", () => {
  // Two events for the same fixture in the same batch:
  // 1. Live with a 1-0 score (the authoritative current state)
  // 2. "notstarted" with no score (provider lag / out-of-order delivery)
  const data = cloneData(staticData);
  mergeSofascoreEvents(data, [
    {
      id: 10100,
      tournament: { name: "FIFA World Cup, Round of 32" },
      homeTeam: { name: "Mexico" },
      awayTeam: { name: "Bosnia and Herzegovina" },
      homeScore: { current: 1 },
      awayScore: { current: 0 },
      status: { type: "inprogress" },
      startTimestamp: Math.floor(new Date("2026-06-28T19:00:00Z").getTime() / 1000),
      venue: { name: "SoFi Stadium", city: { name: "Los Angeles" } }
    },
    {
      id: 10101,
      tournament: { name: "FIFA World Cup, Round of 32" },
      homeTeam: { name: "Mexico" },
      awayTeam: { name: "Bosnia and Herzegovina" },
      status: { type: "notstarted" },
      startTimestamp: Math.floor(new Date("2026-06-28T19:00:00Z").getTime() / 1000),
      venue: { name: "SoFi Stadium", city: { name: "Los Angeles" } }
    }
  ], new Date("2026-06-28T20:00:00Z"));

  const k01 = data.knockoutFixtures.find((fixture) => fixture.id === "K01");

  assert.equal(k01.homeScore, 1, "the stale notstarted event does not erase the live score");
  assert.equal(k01.awayScore, 0);
  assert.notEqual(k01.status, "scheduled", "the stale notstarted event does not revert the status");
});
