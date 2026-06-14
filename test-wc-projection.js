const test = require("node:test");
const assert = require("node:assert/strict");
const { createStaticSnapshot } = require("./data-service.js");
const {
  rankThirdPlaceTeams,
  projectBracket,
  computeQualification
} = require("./public/wc-projection.js");

function team(id, points = 0, goalDifference = 0, played = 3) {
  return {
    id,
    name: id,
    shortName: id,
    flag: "",
    played,
    points,
    goalDifference,
    goalsFor: Math.max(0, goalDifference),
    goalsAgainst: Math.max(0, -goalDifference)
  };
}

test("rankThirdPlaceTeams orders by points then goal difference", () => {
  const groups = [
    { id: "A", teams: [null, null, { id: "A3", points: 3, goalDifference: 1, goalsFor: 2 }] },
    { id: "B", teams: [null, null, { id: "B3", points: 6, goalDifference: 0, goalsFor: 1 }] },
    { id: "C", teams: [null, null, { id: "C3", points: 3, goalDifference: 4, goalsFor: 5 }] }
  ];

  assert.deepEqual(rankThirdPlaceTeams(groups).map((entry) => entry.id), ["B3", "C3", "A3"]);
});

test("projectBracket fills group slots and flags projected vs confirmed", () => {
  const data = {
    groups: [
      { id: "A", teams: [team("AW", 9), team("AR", 6), team("A3", 3), team("A4", 0)] },
      { id: "B", teams: [team("BW", 9), team("BR", 6), team("B3", 3), team("B4", 0)] }
    ],
    // Group A is complete, Group B is still in progress.
    groupFixtures: [{ group: "A", status: "finished" }, { group: "B", status: "scheduled" }],
    knockoutFixtures: [
      { id: "K01", stage: "Round of 32", home: "1A", away: "2B", homeScore: null, awayScore: null, status: "scheduled" }
    ]
  };

  const projection = projectBracket(data);
  const k01 = projection.resolved.K01;

  assert.equal(k01.home.teamId, "AW");
  assert.equal(k01.home.projected, false, "completed group winner is confirmed");
  assert.equal(k01.away.teamId, "BR");
  assert.equal(k01.away.projected, true, "in-progress group runner-up is a projection");
});

test("projectBracket propagates a finished match winner to the next round", () => {
  const data = {
    groups: [
      { id: "A", teams: [team("AW", 9), team("AR", 6), team("A3", 3), team("A4", 0)] },
      { id: "B", teams: [team("BW", 9), team("BR", 6), team("B3", 3), team("B4", 0)] }
    ],
    groupFixtures: [{ group: "A", status: "finished" }, { group: "B", status: "finished" }],
    knockoutFixtures: [
      { id: "K01", stage: "Round of 32", home: "1A", away: "1B", homeScore: 2, awayScore: 1, status: "finished" },
      { id: "K17", stage: "Round of 16", home: "W01", away: "W02", homeScore: null, awayScore: null, status: "scheduled" }
    ]
  };

  const projection = projectBracket(data);

  assert.equal(projection.matchOutcome[1].winner, "AW");
  assert.equal(projection.matchOutcome[1].loser, "BW");
  assert.equal(projection.resolved.K17.home.teamId, "AW", "W01 resolves to the winner of match 1");
  assert.equal(projection.resolved.K17.home.projected, false);
  assert.equal(projection.resolved.K17.away.teamId, null, "winner of an unplayed match stays open");
});

test("projectBracket assigns the eight best thirds to distinct, eligible slots", () => {
  const snapshot = createStaticSnapshot();
  const projection = projectBracket(snapshot);
  const thirdGroupOf = new Map(snapshot.groups.map((group) => [group.teams[2].id, group.id]));

  const slots = [];
  for (const fixture of snapshot.knockoutFixtures) {
    for (const side of ["home", "away"]) {
      if (/^3[A-L](?:\/[A-L])+$/.test(fixture[side])) {
        slots.push({ fixtureId: fixture.id, side, slot: fixture[side] });
      }
    }
  }

  assert.equal(slots.length, 8, "tournament has eight best-third slots");

  const assigned = new Set();
  for (const slot of slots) {
    const info = projection.resolved[slot.fixtureId][slot.side];
    assert.ok(info.teamId, `slot ${slot.slot} resolved to a team`);
    assert.equal(assigned.has(info.teamId), false, "each third is used at most once");
    assigned.add(info.teamId);

    const eligible = slot.slot.slice(1).split("/");
    assert.ok(
      eligible.includes(thirdGroupOf.get(info.teamId)),
      `${info.teamId} (group ${thirdGroupOf.get(info.teamId)}) is eligible for ${slot.slot}`
    );
  }
});

test("computeQualification clinches, eliminates, and flags third-place hopefuls", () => {
  const data = {
    groups: [{
      id: "A",
      teams: [team("W", 9, 9), team("X", 6, 3), team("Y", 4, 0), team("Z", 0, -9)]
    }],
    // No fixtures supplied -> group treated as in progress (live reasoning).
    groupFixtures: []
  };

  const statuses = computeQualification(data);

  assert.equal(statuses.W.key, "through");
  assert.equal(statuses.X.key, "through");
  assert.equal(statuses.Y.key, "third-watch");
  assert.equal(statuses.Z.key, "out");
});

test("computeQualification resolves a completed group from final positions", () => {
  const data = {
    groups: [{
      id: "A",
      teams: [team("P1", 9, 9), team("P2", 6, 3), team("P3", 3, 0), team("P4", 0, -9)]
    }],
    groupFixtures: [{ group: "A", status: "finished" }]
  };

  const statuses = computeQualification(data);

  assert.equal(statuses.P1.key, "through");
  assert.equal(statuses.P2.key, "through");
  assert.equal(statuses.P3.key, "through", "best-third in a settled stage is through");
  assert.equal(statuses.P4.key, "out");
});
