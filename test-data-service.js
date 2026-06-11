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
