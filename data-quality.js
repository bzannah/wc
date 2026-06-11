const EXPECTED_GROUPS = 12;
const EXPECTED_TEAMS = 48;
const EXPECTED_GROUP_FIXTURES = 72;
const EXPECTED_KNOCKOUT_FIXTURES = 32;
const EXPECTED_TOTAL_FIXTURES = 104;
const SOURCE_NOTES = [
  "Static schedule is source-checked against Sofascore and FOX Sports pages captured on 2026-06-11.",
  "Live scores are provider-supplied and merged only when team, group/stage, and kickoff checks pass."
];

function validateTournamentData(data) {
  const errors = [];
  const warnings = [];
  const teamIds = new Set((data.groups || []).flatMap((group) => group.teams.map((team) => team.id)));
  const venueIds = new Set((data.venues || []).map((venue) => venue.id));
  const fixtureIds = new Set();

  assertEqual(errors, data.groups?.length, EXPECTED_GROUPS, "Expected 12 groups.");
  assertEqual(errors, teamIds.size, EXPECTED_TEAMS, "Expected 48 unique teams.");
  assertEqual(errors, data.groupFixtures?.length, EXPECTED_GROUP_FIXTURES, "Expected 72 group-stage fixtures.");
  assertEqual(errors, data.knockoutFixtures?.length, EXPECTED_KNOCKOUT_FIXTURES, "Expected 32 knockout fixtures.");
  assertEqual(errors, data.allFixtures?.length, EXPECTED_TOTAL_FIXTURES, "Expected 104 total fixtures.");

  for (const group of data.groups || []) {
    assertEqual(errors, group.teams.length, 4, `Group ${group.id} must contain 4 teams.`);
    assertEqual(
      errors,
      (data.groupFixtures || []).filter((fixture) => fixture.group === group.id).length,
      6,
      `Group ${group.id} must contain 6 fixtures.`
    );
  }

  for (const fixture of data.allFixtures || []) {
    if (fixtureIds.has(fixture.id)) errors.push(`Duplicate fixture id: ${fixture.id}.`);
    fixtureIds.add(fixture.id);

    if (!fixture.kickoff || Number.isNaN(new Date(fixture.kickoff).getTime())) {
      errors.push(`${fixture.id} has an invalid kickoff.`);
    }

    if (!venueIds.has(fixture.venue)) {
      warnings.push(`${fixture.id} references unknown venue ${fixture.venue}.`);
    }

    if (!["scheduled", "live", "finished", "postponed"].includes(fixture.status)) {
      errors.push(`${fixture.id} has invalid status ${fixture.status}.`);
    }

    if (fixture.status === "scheduled" && (fixture.homeScore !== null || fixture.awayScore !== null)) {
      warnings.push(`${fixture.id} is scheduled but includes a score.`);
    }

    if (["live", "finished"].includes(fixture.status) && (!isScore(fixture.homeScore) || !isScore(fixture.awayScore))) {
      errors.push(`${fixture.id} is ${fixture.status} but does not include both scores.`);
    }

    if (fixture.stage === "Group") {
      validateGroupFixture(errors, fixture, teamIds, data.groups || []);
    }
  }

  validateOpeningDays(errors, data.groupFixtures || []);

  return {
    checkedAt: new Date().toISOString(),
    level: errors.length ? "error" : warnings.length ? "warning" : "verified",
    errors,
    warnings,
    sourceNotes: SOURCE_NOTES
  };
}

function canMergeProviderEvent(fixture, event) {
  const reasons = [];

  if (!fixture) {
    reasons.push("No matching local fixture.");
    return { ok: false, reasons };
  }

  if (fixture.stage === "Group" && !event.group) {
    reasons.push("Provider group-stage event is missing a group id.");
  }

  if (fixture.stage === "Group" && event.group && fixture.group !== event.group) {
    reasons.push(`Group mismatch: local ${fixture.group}, provider ${event.group}.`);
  }

  if (event.stage && fixture.stage !== event.stage) {
    reasons.push(`Stage mismatch: local ${fixture.stage}, provider ${event.stage}.`);
  }

  if (event.kickoff) {
    const diff = Math.abs(new Date(fixture.kickoff).getTime() - new Date(event.kickoff).getTime());
    if (diff > 36 * 60 * 60 * 1000) {
      reasons.push("Kickoff differs by more than 36 hours.");
    }
  }

  if (["live", "finished"].includes(event.status) && (!isScore(event.homeScore) || !isScore(event.awayScore))) {
    reasons.push("Live/finished provider event is missing a complete score.");
  }

  return { ok: reasons.length === 0, reasons };
}

function validateGroupFixture(errors, fixture, teamIds, groups) {
  if (!fixture.group) {
    errors.push(`${fixture.id} is a group fixture without a group id.`);
    return;
  }

  const group = groups.find((item) => item.id === fixture.group);
  if (!group) {
    errors.push(`${fixture.id} references unknown group ${fixture.group}.`);
    return;
  }

  const groupTeamIds = new Set(group.teams.map((team) => team.id));
  for (const side of ["home", "away"]) {
    const teamId = fixture[side];
    if (!teamIds.has(teamId)) {
      errors.push(`${fixture.id} references unknown ${side} team ${teamId}.`);
    } else if (!groupTeamIds.has(teamId)) {
      errors.push(`${fixture.id} ${side} team ${teamId} is not in Group ${fixture.group}.`);
    }
  }
}

function validateOpeningDays(errors, groupFixtures) {
  const londonJune11 = groupFixtures.filter((fixture) => localDate(fixture.kickoff, "Europe/London") === "2026-06-11");
  const londonJune12 = groupFixtures.filter((fixture) => localDate(fixture.kickoff, "Europe/London") === "2026-06-12");

  if (londonJune11.length !== 1) {
    errors.push(`London/BST 2026-06-11 must contain exactly 1 fixture; found ${londonJune11.length}.`);
  } else if (londonJune11[0].home !== "MEX" || londonJune11[0].away !== "RSA") {
    errors.push("London/BST opening fixture must be Mexico vs South Africa.");
  }

  if (londonJune12.length !== 2) {
    errors.push(`London/BST 2026-06-12 must contain exactly 2 fixtures; found ${londonJune12.length}.`);
  }
}

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

function isScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 50;
}

function assertEqual(errors, actual, expected, message) {
  if (actual !== expected) errors.push(`${message} Found ${actual}.`);
}

module.exports = {
  EXPECTED_GROUPS,
  EXPECTED_GROUP_FIXTURES,
  EXPECTED_KNOCKOUT_FIXTURES,
  EXPECTED_TEAMS,
  EXPECTED_TOTAL_FIXTURES,
  canMergeProviderEvent,
  validateTournamentData
};
