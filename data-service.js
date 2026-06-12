const staticData = require("./public/worldcup-data.js");
const {
  canMergeProviderEvent,
  validateTournamentData
} = require("./data-quality.js");
const { applyStoredResults } = require("./result-store.js");

const SOFASCORE_PROVIDER = "Sofascore RapidAPI";

function createStaticSnapshot(options = {}) {
  const now = options.now || new Date();
  const data = clone(staticData);
  applyStoredResults(data, options.storedResults);
  recomputeStandings(data);
  const dataQuality = validateTournamentData(data);
  const warnings = [...(options.warnings || []), ...dataQuality.warnings];

  return {
    version: 1,
    source: "demo",
    dataMode: "schedule-only",
    provider: "source-checked fallback schedule",
    lastUpdated: now.toISOString(),
    refreshEvery: Number(options.refreshEvery || 60),
    warnings,
    dataQuality,
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
  const refreshEvery = Number(options.refreshEvery || 60);
  const providerPayloads = Array.isArray(options.providerPayloads) ? options.providerPayloads : [];
  const warnings = [...(options.warnings || [])];
  const data = clone(staticData);
  applyStoredResults(data, options.storedResults);
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
    source: hasLiveData ? "live" : "demo",
    dataMode: hasLiveData ? "live-provider-merged" : "schedule-only",
    provider: hasLiveData ? SOFASCORE_PROVIDER : "source-checked fallback schedule",
    lastUpdated: now.toISOString(),
    refreshEvery,
    warnings,
    dataQuality,
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
  const report = { merged: 0, rejected: 0, warnings: [] };

  for (const event of events) {
    const normalized = normalizeSofascoreEvent(event, teamLookup, venueLookup, data.venues, now);
    if (!normalized.home || !normalized.away) {
      report.rejected += 1;
      continue;
    }

    const match = findFixtureMatch(fixtureLookup, data.allFixtures, normalized);
    const mergeCheck = canMergeProviderEvent(match?.fixture, normalized);
    if (!mergeCheck.ok) {
      report.rejected += 1;
      report.warnings.push(`Rejected provider event ${normalized.providerId || `${normalized.home}-${normalized.away}`}: ${mergeCheck.reasons.join(" ")}`);
      continue;
    }

    const fixture = match.fixture;
    const homeScore = match.reversed ? normalized.awayScore : normalized.homeScore;
    const awayScore = match.reversed ? normalized.homeScore : normalized.awayScore;

    Object.assign(fixture, {
      providerId: normalized.providerId,
      stage: normalized.stage || fixture.stage,
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

function findFixtureMatch(fixtureLookup, fixtures, event) {
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

  if (!fallback) return null;
  return {
    fixture: fallback,
    reversed: fallback.home === event.away && fallback.away === event.home
  };
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
  if (text.includes("round of 32") || text.includes("r32")) return "Round of 32";
  if (text.includes("round of 16") || text.includes("r16")) return "Round of 16";
  if (text.includes("quarter")) return "Quarter-final";
  if (text.includes("semi")) return "Semi-final";
  if (text.includes("third")) return "Third-place play-off";
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
  createStaticSnapshot,
  createWorldCupSnapshot,
  extractEvents,
  mergeSofascoreEvents,
  normalizeName
};
