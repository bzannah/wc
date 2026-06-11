const assert = require("node:assert/strict");
const data = require("./worldcup-data.js");

const teams = data.groups.flatMap((group) => group.teams);
const fixtureIds = new Set(data.allFixtures.map((fixture) => fixture.id));

assert.equal(data.groups.length, 12, "mockup should include 12 groups");
assert.equal(teams.length, 48, "mockup should include 48 teams");
assert.equal(data.groupFixtures.length, 72, "mockup should include 72 group-stage fixtures");
assert.equal(data.knockoutFixtures.length, 32, "mockup should include 32 knockout fixtures");
assert.equal(data.allFixtures.length, 104, "mockup should include 104 total fixtures");
assert.equal(fixtureIds.size, data.allFixtures.length, "fixture ids should be unique");

for (const group of data.groups) {
  assert.equal(group.teams.length, 4, `Group ${group.id} should include 4 teams`);
  assert.equal(
    data.groupFixtures.filter((fixture) => fixture.group === group.id).length,
    6,
    `Group ${group.id} should include 6 fixtures`
  );
}

for (const fixture of data.allFixtures) {
  assert.ok(fixture.kickoff, `${fixture.id} should include a kickoff`);
  assert.ok(fixture.venue, `${fixture.id} should include a venue`);
}

const londonJune11 = data.groupFixtures.filter((fixture) => localDate(fixture.kickoff, "Europe/London") === "2026-06-11");
assert.equal(londonJune11.length, 1, "London/BST view should show exactly one fixture on 11 June 2026");
assert.equal(londonJune11[0].home, "MEX", "Opening fixture home team should be Mexico");
assert.equal(londonJune11[0].away, "RSA", "Opening fixture away team should be South Africa");

const londonJune12 = data.groupFixtures.filter((fixture) => localDate(fixture.kickoff, "Europe/London") === "2026-06-12");
assert.equal(londonJune12.length, 2, "London/BST view should show two fixtures on 12 June 2026");

function localDate(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

console.log("Data smoke test passed: 48 teams, 12 groups, 16 venues, 104 fixtures, corrected opening-day schedule.");
