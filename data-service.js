const staticData = require("./public/worldcup-data.js");
const {
  canMergeProviderEvent,
  validateTournamentData
} = require("./data-quality.js");
const { applyStoredResults } = require("./result-store.js");

const SOFASCORE_PROVIDER = "Sofascore RapidAPI";
const REFRESH_INTERVAL_SECONDS = 5 * 60;

function refreshIntervalFor(data) {
  return REFRESH_INTERVAL_SECONDS;
}

function createStaticSnapshot(options = {}) {
  const now = options.now || new Date();
  const data = clone(staticData);
  const storedResultCount = applyStoredResults(data, options.storedResults);
  recomputeStandings(data);
  const dataQuality = validateTournamentData(data);
  const warnings = [...(options.warnings || []), ...dataQuality.warnings];

  return {
    version: 1,
    source: storedResultCount ? "stored" : "demo",
    dataMode: storedResultCount ? "stored-results" : "schedule-only",
    provider: storedResultCount ? "stored final results + source-checked fallback schedule" : "source-checked fallback schedule",
    lastUpdated: now.toISOString(),
    refreshEvery: refreshIntervalFor(data),
    warnings,
    dataQuality,
    storedResultCount,
    providerQuota: options.providerQuota || null,
    groups: data.groups,
    venues: data.venues,
    groupFixtures: data.groupFixtures,
    knockoutFixtures: data.knockoutFixtures,
    allFixtures: data.allFixtures
  };
}

function createWorldCupSnapshot(options = {}) {
  const now = options.now || new Date();
  const providerPayloads = Array.isArray(options.providerPayloads) ? options.providerPayloads : [];
  const warnings = [...(options.warnings || [])];
  const data = clone(staticData);
  const storedResultCount = applyStoredResults(data, options.storedResults);
  const events = providerPayloads.flatMap(extractEvents);
  let mergeReport = { merged: 0, rejected: 0, warnings: [] };

  if (events.length > 0) {
    mergeReport = mergeSofascoreEvents(data, events, now);
    warnings.push(...mergeReport.warnings);
  } else if (providerPayloads.length > 0) {
    warnings.push("Provider response did not include recognizable match events; using local tournament model.");
  }

  recomputeStandings(data);
  const dataQuality = validateTournamentData(data);
  warnings.push(...dataQuality.warnings);
  const hasLiveData = mergeReport.merged > 0;

  return {
    version: 1,
    source: hasLiveData ? "live" : storedResultCount ? "stored" : "demo",
    dataMode: hasLiveData ? "live-provider-merged" : storedResultCount ? "stored-results" : "schedule-only",
    provider: hasLiveData ? SOFASCORE_PROVIDER : storedResultCount ? "stored final results + source-checked fallback schedule" : "source-checked fallback schedule",
    lastUpdated: now.toISOString(),
    refreshEvery: refreshIntervalFor(data),
    warnings,
    dataQuality,
    storedResultCount,
    providerMerge: mergeReport,
    providerQuota: options.providerQuota || null,
    groups: data.groups,
    venues: data.venues,
    groupFixtures: data.groupFixtures,
    knockoutFixtures: data.knockoutFixtures,
    allFixtures: data.allFixtures
  };
}

function extractEvents(payload) {
  const events = [];
  const seen = new Set();

  visit(payload, 0);
  return events;

  function visit(value, depth) {
    if (!value || depth > 6) return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    if (typeof value !== "object") return;

    if (looksLikeSofascoreEvent(value)) {
      const id = String(value.id || value.customId || `${teamName(value.homeTeam)}-${teamName(value.awayTeam)}-${value.startTimestamp || ""}`);
      if (!seen.has(id)) {
        seen.add(id);
        events.push(value);
      }
      return;
    }

    for (const key of ["events", "matches", "data", "result", "items"]) {
      if (value[key]) visit(value[key], depth + 1);
    }
  }
}

function mergeSofascoreEvents(data, events, now = new Date()) {
  const teamLookup = buildTeamLookup(data.groups);
  const venueLookup = buildVenueLookup(data.venues);
  const fixtureLookup = buildFixtureLookup(data.allFixtures);
  const assignedKnockout = new Set();
  const report = { merged: 0, rejected: 0, warnings: [] };

  for (const event of events) {
    const normalized = normalizeSofascoreEvent(event, teamLookup, venueLookup, data.venues, now);
    if (!normalized.home || !normalized.away) {
      report.rejected += 1;
      continue;
    }

    const match = findFixtureMatch(fixtureLookup, data.allFixtures, normalized, assignedKnockout);
    const mergeCheck = canMergeProviderEvent(match?.fixture, normalized, { matchedByTeams: !match?.assignTeams });
    if (!mergeCheck.ok) {
      report.rejected += 1;
      report.warnings.push(`Rejected provider event ${normalized.providerId || `${normalized.home}-${normalized.away}`}: ${mergeCheck.reasons.join(" ")}`);
      continue;
    }

    const fixture = match.fixture;
    const homeScore = match.reversed ? normalized.awayScore : normalized.homeScore;
    const awayScore = match.reversed ? normalized.homeScore : normalized.awayScore;

    if (shouldSkipMerge(fixture, normalized, homeScore, awayScore)) {
      continue;
    }

    // A knockout fixture holds bracket placeholders ("2A", "W01") until an event
    // names the real teams, so adopt them when we matched the slot by schedule.
    if (match.assignTeams && normalized.home && normalized.away) {
      assignedKnockout.add(fixture.id);
      fixture.home = normalized.home;
      fixture.away = normalized.away;
    }

    Object.assign(fixture, {
      providerId: normalized.providerId,
      stage: fixture.stage,
      group: normalized.group || fixture.group,
      homeScore,
      awayScore,
      status: normalized.status,
      minute: normalized.minute,
      kickoff: normalized.kickoff || fixture.kickoff,
      venue: normalized.venue || fixture.venue,
      sourceUrl: normalized.sourceUrl || fixture.sourceUrl
    });
    report.merged += 1;
  }

  syncFixtureCollections(data);
  return report;
}

// Guards the merge against provider events that would degrade an already
// confirmed fixture. Two rules, checked independently:
//
// 1. A finished result is never downgraded — not to "live", not to "scheduled".
//    Only a finished provider event may touch it (e.g. a corrected score after
//    a VAR review). This covers the narrow case the old guard handled (scoreless
//    events) plus the much more dangerous case it missed: a stale "live" event
//    carrying older scores that would silently rewrite a confirmed final.
//
// 2. Scores are never stripped. A fixture that already has integer scores (live
//    or finished) keeps them when the incoming event carries none. This prevents
//    out-of-order provider delivery ("notstarted" arriving after "inprogress")
//    from erasing live data.
function shouldSkipMerge(fixture, normalized, homeScore, awayScore) {
  const alreadyFinal = fixture.status === "finished" &&
    Number.isInteger(fixture.homeScore) && Number.isInteger(fixture.awayScore);
  if (alreadyFinal && normalized.status !== "finished") {
    return true;
  }

  const fixtureHasScores = Number.isInteger(fixture.homeScore) && Number.isInteger(fixture.awayScore);
  const incomingHasScores = Number.isInteger(homeScore) && Number.isInteger(awayScore);
  if (fixtureHasScores && !incomingHasScores) {
    return true;
  }

  return false;
}

function normalizeSofascoreEvent(event, teamLookup, venueLookup, venues, now) {
  const homeName = teamName(event.homeTeam || event.home || event.homeParticipant);
  const awayName = teamName(event.awayTeam || event.away || event.awayParticipant);
  const home = teamLookup.get(normalizeName(homeName));
  const away = teamLookup.get(normalizeName(awayName));
  const status = normalizeStatus(event.status);
  const kickoff = normalizeKickoff(event);
  const venue = normalizeVenue(event.venue || event.stadium, venueLookup, venues);
  const tournamentName = [event.tournament?.name, event.tournament?.uniqueTournament?.name, event.roundInfo?.name, event.season?.name]
    .filter(Boolean)
    .join(" ");
  const group = normalizeGroup(tournamentName) || normalizeGroup(event.tournament?.category?.name);

  return {
    providerId: event.id ? String(event.id) : null,
    stage: group ? "Group" : normalizeStage(tournamentName),
    group,
    home,
    away,
    homeScore: scoreValue(event.homeScore),
    awayScore: scoreValue(event.awayScore),
    status,
    minute: normalizeMinute(event, status, now),
    kickoff,
    venue,
    sourceUrl: event.slug ? `https://www.sofascore.com/${event.slug}` : undefined
  };
}

function recomputeStandings(data) {
  const fixturesByGroup = groupBy(data.groupFixtures, (fixture) => fixture.group);

  for (const group of data.groups) {
    const teamMap = new Map(group.teams.map((team, index) => [team.id, resetTeam({ ...team, drawPosition: team.drawPosition || index + 1 })]));
    const fixtures = fixturesByGroup.get(group.id) || [];

    for (const fixture of fixtures) {
      if (!shouldCountForTable(fixture)) continue;

      const home = teamMap.get(fixture.home);
      const away = teamMap.get(fixture.away);
      if (!home || !away) continue;

      const homeScore = Number(fixture.homeScore);
      const awayScore = Number(fixture.awayScore);
      applyResult(home, homeScore, awayScore);
      applyResult(away, awayScore, homeScore);
    }

    group.teams = Array.from(teamMap.values()).sort(compareTeams);
  }
}

function resetTeam(team) {
  return {
    ...team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0
  };
}

function applyResult(team, scored, conceded) {
  team.played += 1;
  team.goalsFor += scored;
  team.goalsAgainst += conceded;
  team.goalDifference = team.goalsFor - team.goalsAgainst;

  if (scored > conceded) {
    team.wins += 1;
    team.points += 3;
  } else if (scored === conceded) {
    team.draws += 1;
    team.points += 1;
  } else {
    team.losses += 1;
  }
}

function shouldCountForTable(fixture) {
  return ["live", "half-time", "finished"].includes(fixture.status) && Number.isFinite(fixture.homeScore) && Number.isFinite(fixture.awayScore);
}

function compareTeams(a, b) {
  return b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    (a.drawPosition || 99) - (b.drawPosition || 99) ||
    a.name.localeCompare(b.name);
}

function findFixtureMatch(fixtureLookup, fixtures, event, assignedKnockout = new Set()) {
  const directKey = fixturePairKey(event.home, event.away, event.group);
  const reverseKey = fixturePairKey(event.away, event.home, event.group);
  const direct = fixtureLookup.get(directKey);
  if (direct) return { fixture: direct, reversed: false };

  const reverse = fixtureLookup.get(reverseKey);
  if (reverse) return { fixture: reverse, reversed: true };

  const fallback = fixtures.find((fixture) => {
    if (fixture.stage !== event.stage && fixture.group !== event.group) return false;
    return samePair(fixture, event.home, event.away);
  });

  if (fallback) {
    return {
      fixture: fallback,
      reversed: fallback.home === event.away && fallback.away === event.home
    };
  }

  // Knockout events carry real teams while local knockout fixtures still hold
  // bracket placeholders, so match the scheduled slot by stage + venue + kickoff
  // and adopt the event's teams once found.
  if (isKnockoutStage(event.stage)) {
    const slot = findKnockoutSlot(fixtures, event, assignedKnockout);
    if (slot) return { fixture: slot, reversed: false, assignTeams: true };
  }

  return null;
}

function isKnockoutStage(stage) {
  return Boolean(stage) && stage !== "Group";
}

// Score every still-open knockout fixture in the event's stage and return the
// best match. A venue match is decisive; otherwise kickoff proximity (inside the
// 36h validation window) decides. Returns null if nothing is identifiable, so an
// ambiguous event can never grab an arbitrary slot.
function findKnockoutSlot(fixtures, event, assignedKnockout = new Set()) {
  const candidates = fixtures.filter(
    (fixture) => isKnockoutStage(fixture.stage) && fixture.stage === event.stage && !assignedKnockout.has(fixture.id)
  );
  if (candidates.length === 0) return null;

  const eventTime = event.kickoff ? new Date(event.kickoff).getTime() : null;
  let best = null;
  let bestScore = 0;

  for (const fixture of candidates) {
    let score = 0;
    if (event.venue && fixture.venue && event.venue === fixture.venue) score += 100;
    if (eventTime && fixture.kickoff) {
      const diffHours = Math.abs(new Date(fixture.kickoff).getTime() - eventTime) / 3_600_000;
      score += diffHours <= 36 ? 36 - diffHours : -1000;
    }
    if (score > bestScore) {
      bestScore = score;
      best = fixture;
    }
  }

  return best;
}

function syncFixtureCollections(data) {
  const byId = new Map(data.allFixtures.map((fixture) => [fixture.id, fixture]));
  data.groupFixtures = data.groupFixtures.map((fixture) => byId.get(fixture.id) || fixture);
  data.knockoutFixtures = data.knockoutFixtures.map((fixture) => byId.get(fixture.id) || fixture);
}

function buildFixtureLookup(fixtures) {
  const map = new Map();
  for (const fixture of fixtures) {
    map.set(fixturePairKey(fixture.home, fixture.away, fixture.group), fixture);
  }
  return map;
}

function buildTeamLookup(groups) {
  const map = new Map();
  const aliases = {
    bih: "BIH",
    bosniaherzegovina: "BIH",
    bosniaandherzegovina: "BIH",
    bosnia: "BIH",
    congodr: "COD",
    drcongo: "COD",
    democraticrepublicofcongo: "COD",
    cotedivoire: "CIV",
    ivorycoast: "CIV",
    curacao: "CUW",
    curaçao: "CUW",
    korearepublic: "KOR",
    southkorea: "KOR",
    republicofkorea: "KOR",
    turkiye: "TUR",
    turkey: "TUR",
    unitedstates: "USA",
    unitedstatesofamerica: "USA",
    usa: "USA",
    capeverde: "CPV",
    czechrepublic: "CZE",
    czechia: "CZE",
    netherlands: "NED",
    holland: "NED"
  };

  for (const group of groups) {
    for (const team of group.teams) {
      map.set(normalizeName(team.name), team.id);
      map.set(normalizeName(team.country), team.id);
      map.set(normalizeName(team.shortName), team.id);
    }
  }

  for (const [alias, teamId] of Object.entries(aliases)) {
    map.set(normalizeName(alias), teamId);
  }

  return map;
}

function buildVenueLookup(venues) {
  const map = new Map();
  for (const venue of venues) {
    map.set(normalizeName(venue.name), venue.id);
    map.set(normalizeName(venue.city), venue.id);
    for (const alias of venue.aliases || []) {
      map.set(normalizeName(alias), venue.id);
    }
  }
  return map;
}

function normalizeVenue(venue, venueLookup, venues) {
  if (!venue) return null;

  const rawName = venue.name || venue.stadiumName || venue.venueName;
  const rawCity = venue.city?.name || venue.cityName || venue.city;
  const key = normalizeName(rawName || rawCity);
  if (venueLookup.has(key)) return venueLookup.get(key);

  const cityKey = normalizeName(rawCity);
  if (venueLookup.has(cityKey)) return venueLookup.get(cityKey);

  if (!rawName && !rawCity) return null;

  const id = slugify(rawName || rawCity);
  venues.push({
    id,
    name: rawName || rawCity,
    city: rawCity || rawName,
    country: venue.country?.name || "",
    tz: "UTC"
  });
  venueLookup.set(key, id);
  if (cityKey) venueLookup.set(cityKey, id);
  return id;
}

function normalizeStatus(status = {}) {
  const fields = statusFields(status);
  const type = fields.join("");
  if (isHalfTimeStatus(fields, status)) return "half-time";
  if (["inprogress", "live"].includes(type) || type.includes("period") || type.includes("half")) return "live";
  if (["finished", "afterpenalties", "afterextratime"].includes(type) || type.includes("finished")) return "finished";
  if (type.includes("postponed") || type.includes("cancelled") || type.includes("canceled")) return "postponed";
  return "scheduled";
}

function normalizeKickoff(event) {
  if (Number.isFinite(event.startTimestamp)) {
    return new Date(event.startTimestamp * 1000).toISOString();
  }

  const value = event.startTime || event.kickoff || event.date;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMinute(event, status, now) {
  if (status === "half-time") return null;
  if (status !== "live") return null;
  if (Number.isFinite(event.minute)) return event.minute;
  if (Number.isFinite(event.time?.currentPeriodStartTimestamp)) {
    const elapsed = Math.max(1, Math.floor((now.getTime() / 1000 - event.time.currentPeriodStartTimestamp) / 60));
    return Math.max(1, Math.min(130, isSecondHalfStatus(statusFields(event.status), event.status) ? 45 + elapsed : elapsed));
  }
  return null;
}

function statusFields(status = {}) {
  return [
    status.type,
    status.description,
    status.code,
    status.name,
    status.short,
    status.long
  ].filter((value) => value !== undefined && value !== null).map(normalizeName);
}

function isHalfTimeStatus(fields, status = {}) {
  return fields.some((field) => ["ht", "halftime"].includes(field) || field.includes("halftime"));
}

function isSecondHalfStatus(fields, status = {}) {
  return fields.some((field) => field.includes("2ndhalf") || field.includes("secondhalf"));
}

function scoreValue(score) {
  if (!score) return null;
  const value = score.current ?? score.display ?? score.normaltime ?? score.period1 ?? score.score;
  return Number.isFinite(value) ? Number(value) : null;
}

function normalizeGroup(value = "") {
  const match = String(value).match(/group\s+([A-L])/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizeStage(value = "") {
  const text = String(value).toLowerCase();
  // Each round is checked in increasing specificity so that compound names like
  // "1/16 Finals" or "Quarter-finals" — both of which contain the substring
  // "final" — are mapped to the correct round, not to "Final".
  if (text.includes("round of 32") || text.includes("r32") || text.includes("1/16") || text.includes("last 32")) return "Round of 32";
  if (text.includes("round of 16") || text.includes("r16") || text.includes("1/8") || text.includes("last 16")) return "Round of 16";
  if (text.includes("quarter") || text.includes("1/4 final")) return "Quarter-final";
  if (text.includes("semi") || text.includes("1/2 final")) return "Semi-final";
  if (text.includes("third") || text.includes("3rd place") || text.includes("3rd-place")) return "Third-place play-off";
  if (text.includes("final")) return "Final";
  return "Group";
}

function looksLikeSofascoreEvent(value) {
  return Boolean(
    (value.homeTeam || value.home || value.homeParticipant) &&
    (value.awayTeam || value.away || value.awayParticipant) &&
    (value.status || value.startTimestamp || value.tournament)
  );
}

function teamName(team) {
  if (!team) return "";
  return team.name || team.shortName || team.fullName || team.slug || "";
}

function fixturePairKey(home, away, group) {
  return `${group || ""}:${home}:${away}`;
}

function samePair(fixture, home, away) {
  return (fixture.home === home && fixture.away === away) || (fixture.home === away && fixture.away === home);
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function slugify(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "venue";
}

function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  SOFASCORE_PROVIDER,
  REFRESH_INTERVAL_SECONDS,
  createStaticSnapshot,
  createWorldCupSnapshot,
  extractEvents,
  mergeSofascoreEvents,
  normalizeName,
  normalizeStage,
  refreshIntervalFor
};
