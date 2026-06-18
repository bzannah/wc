const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createStaticSnapshot,
  createWorldCupSnapshot,
  extractEvents,
  normalizeName
} = require("./data-service.js");

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

test("snapshots default to a 30 minute refresh interval", () => {
  assert.equal(createStaticSnapshot().refreshEvery, 30 * 60);
  assert.equal(createWorldCupSnapshot().refreshEvery, 30 * 60);
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
  assert.equal(snapshot.refreshEvery, 30 * 60);
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
  assert.equal(snapshot.refreshEvery, 30 * 60);
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
