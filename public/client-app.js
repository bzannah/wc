let appData = cloneData(WC_DATA);
let teamById = new Map();
let venueById = new Map();

const REFRESH_INTERVAL_SECONDS = 5 * 60;
const REFRESH_INTERVAL_LABEL = "5 min";
const REFRESH_DETAIL_TEXT = "Refresh every 5 minutes.";

const STORAGE_KEYS = { favorites: "wc:favorites", timezone: "wc:timezone" };
const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";

const appState = {
  timezone: loadTimezone() || detectedTimezone,
  search: "",
  lastSync: new Date(),
  isLoading: false,
  dataSource: "Local model",
  dataMode: "schedule-only",
  dataQuality: { level: "warning", errors: [], warnings: [] },
  providerQuota: null,
  warnings: [],
  favorites: loadFavorites(),
  qualification: {},
  projection: { resolved: {}, matchOutcome: {} }
};

document.addEventListener("DOMContentLoaded", () => {
  rebuildIndexes();
  renderApp();
  bindControls();
  loadSnapshot();
  startRefreshLoop();
});

function loadFavorites() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.favorites) || "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch (error) {
    return new Set();
  }
}

function saveFavorites() {
  try {
    window.localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...appState.favorites]));
  } catch (error) {
    /* storage may be unavailable (private mode); favourites stay in-memory */
  }
}

function loadTimezone() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.timezone) || "";
  } catch (error) {
    return "";
  }
}

function saveTimezone(value) {
  try {
    window.localStorage.setItem(STORAGE_KEYS.timezone, value);
  } catch (error) {
    /* ignore storage failures */
  }
}

function isFavorite(teamId) {
  return Boolean(teamId) && appState.favorites.has(teamId);
}

function toggleFavorite(teamId) {
  if (!teamId) return;
  if (appState.favorites.has(teamId)) {
    appState.favorites.delete(teamId);
  } else {
    appState.favorites.add(teamId);
  }
  saveFavorites();
  renderMyTeams();
  renderGroups();
  renderStatusBar();
  renderBracket();
  renderTodayPanel();
}

function bindControls() {
  const search = document.querySelector("#search");
  const timezone = document.querySelector("#timezone");
  const clearFollows = document.querySelector("#clearFollows");
  const viewButtons = document.querySelectorAll("[data-view]");

  // Make sure the visitor's own zone is selectable even if it is not one of the
  // presets, then reflect the active (possibly persisted) zone in the control.
  if (![...timezone.options].some((option) => option.value === appState.timezone)) {
    const option = document.createElement("option");
    option.value = appState.timezone;
    option.textContent = `${shortTimezoneLabel(appState.timezone)} (local)`;
    timezone.prepend(option);
  }
  timezone.value = appState.timezone;

  search.addEventListener("input", (event) => {
    appState.search = event.target.value.trim().toLowerCase();
    renderGroups();
    renderFixtures();
  });

  timezone.addEventListener("change", (event) => {
    appState.timezone = event.target.value;
    saveTimezone(appState.timezone);
    renderApp();
  });

  // Star buttons are re-rendered constantly, so listen once via delegation.
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-fav-toggle]");
    if (!toggle) return;
    event.preventDefault();
    toggleFavorite(toggle.dataset.favToggle);
  });

  if (clearFollows) {
    clearFollows.addEventListener("click", () => {
      if (!appState.favorites.size) return;
      appState.favorites.clear();
      saveFavorites();
      renderApp();
    });
  }

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      viewButtons.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      document.querySelector(`#${button.dataset.view}`).scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function loadSnapshot() {
  if (appState.isLoading) return;
  appState.isLoading = true;
  updateSyncText("Updating...");

  try {
    const response = await fetch("/api/worldcup", { cache: "no-store" });
    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const snapshot = await response.json();
    appData = normalizeSnapshot(snapshot);
    appState.lastSync = new Date(snapshot.lastUpdated || Date.now());
    appState.dataSource = snapshot.provider || snapshot.source || "Live data";
    appState.dataMode = snapshot.dataMode || snapshot.source || "unknown";
    appState.dataQuality = snapshot.dataQuality || { level: "warning", errors: [], warnings: [] };
    appState.providerQuota = snapshot.providerQuota || null;
    appState.warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    rebuildIndexes();
    renderApp();
  } catch (error) {
    appState.warnings = [`Live update failed: ${error.message}`];
    appState.dataSource = "Local fallback";
    appState.dataMode = "schedule-only";
    appState.dataQuality = { level: "warning", errors: [], warnings: appState.warnings };
    appState.providerQuota = null;
    renderApp();
  } finally {
    appState.isLoading = false;
    updateSyncText();
  }
}

function startRefreshLoop() {
  window.setInterval(loadSnapshot, REFRESH_INTERVAL_SECONDS * 1000);
}

function renderApp() {
  recomputeDerivedData();
  renderMyTeams();
  renderTodayPanel();
  renderStatusBar();
  renderGroups();
  renderBracket();
  renderFixtures();
  updateSyncText();
}

// Bracket projection and qualification status are derived from the current
// standings, so they only need refreshing when the underlying data changes.
function recomputeDerivedData() {
  appState.qualification = WCProjection.computeQualification(appData);
  appState.projection = WCProjection.projectBracket(appData);
}

function renderStatusBar() {
  const fixtures = appData.allFixtures || [];
  const live = fixtures.filter(isLiveFixture);
  const next = fixtures
    .filter((fixture) => fixture.status === "scheduled")
    .slice()
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .slice(0, live.length ? 4 : 5);
  const finished = fixtures.filter((fixture) => fixture.status === "finished");
  const teams = (appData.groups || []).reduce((sum, group) => sum + group.teams.length, 0);

  document.querySelector("#liveStrip").innerHTML = [
    ...live.map((fixture) => statusCard(fixture, true)),
    ...next.map((fixture) => statusCard(fixture, false))
  ].join("");

  document.querySelector("#metricTeams").textContent = teams;
  document.querySelector("#metricFixtures").textContent = fixtures.length;
  document.querySelector("#metricVenues").textContent = (appData.venues || []).length;
  document.querySelector("#metricLive").textContent = live.length;
  document.querySelector("#metricFinished").textContent = finished.length;
}

function renderMyTeams() {
  const section = document.querySelector("#myTeams");
  const grid = document.querySelector("#myTeamsGrid");
  if (!section || !grid) return;

  const favorites = [...appState.favorites].filter((id) => teamById.has(id));

  if (!favorites.length) {
    section.classList.add("is-empty");
    grid.innerHTML = emptyState("Tap the ☆ next to a team in any group table to pin its next match and latest result here.");
    return;
  }

  section.classList.remove("is-empty");
  favorites.sort((a, b) => teamById.get(a).name.localeCompare(teamById.get(b).name));
  grid.innerHTML = favorites.map(myTeamCard).join("");
}

function myTeamCard(teamId) {
  const team = teamById.get(teamId);
  const group = groupForTeam(teamId);
  const status = appState.qualification[teamId];
  const fixtures = (appData.allFixtures || [])
    .filter((fixture) => involvesTeam(fixture, teamId))
    .slice()
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const upcoming = fixtures.find(isLiveFixture) || fixtures.find((fixture) => fixture.status === "scheduled");
  const last = [...fixtures].reverse().find((fixture) => fixture.status === "finished");

  return `
    <article class="my-team-card ${status ? `q-${status.tone}` : ""}">
      <header class="my-team-head">
        <span class="my-team-flag">${team.flag || ""}</span>
        <div class="my-team-name">
          <strong>${escapeHtml(team.name)}</strong>
          <span>${group ? `Group ${escapeHtml(group.id)}` : "Knockout"}${status && status.glyph ? ` · ${escapeHtml(status.label)}` : ""}</span>
        </div>
        ${qualBadge(status)}
        <button class="fav-star is-on" type="button" data-fav-toggle="${escapeHtml(teamId)}" aria-pressed="true" aria-label="Unfollow ${escapeHtml(team.name)}" title="Unfollow">★</button>
      </header>
      <div class="my-team-fixtures">
        ${myTeamFixtureLine("Next", upcoming, teamId)}
        ${myTeamFixtureLine("Last", last, teamId)}
      </div>
    </article>
  `;
}

function myTeamFixtureLine(label, fixture, teamId) {
  if (!fixture) {
    return `<div class="my-team-line is-empty"><b>${escapeHtml(label)}</b><span>No match ${label === "Next" ? "scheduled" : "played"} yet</span></div>`;
  }

  const opponent = opponentLabel(fixture, teamId);
  const venue = venueById.get(fixture.venue) || {};
  const when = isLiveFixture(fixture)
    ? fixtureStatusLabel(fixture)
    : `${formatShortDate(fixture.kickoff)} · ${formatTime(fixture.kickoff)}`;

  return `
    <div class="my-team-line ${statusTone(fixture)}">
      <b>${escapeHtml(label)}</b>
      <span class="my-team-opp">${escapeHtml(teamSideText(fixture, teamId))} ${flag(opponent)}${escapeHtml(opponent.name)}</span>
      <span class="my-team-when">${escapeHtml(when)} · ${escapeHtml(venueName(venue))}</span>
    </div>
  `;
}

// "vs" with our score shown first when a result exists, otherwise just the matchup.
function teamSideText(fixture, teamId) {
  const resolved = appState.projection.resolved[fixture.id];
  const homeId = fixture.home === teamId ? teamId : resolved?.home?.teamId;
  const isHome = homeId === teamId || fixture.home === teamId;
  const score = scoreText(fixture);
  if (score === "v") return "vs";
  return isHome ? `${score} vs` : `${reverseScore(score)} vs`;
}

function reverseScore(score) {
  const parts = String(score).split("-");
  return parts.length === 2 ? `${parts[1]}-${parts[0]}` : score;
}

function opponentLabel(fixture, teamId) {
  const resolved = appState.projection.resolved[fixture.id];
  let opponentId = null;
  if (fixture.home === teamId) opponentId = fixture.away;
  else if (fixture.away === teamId) opponentId = fixture.home;
  else if (resolved) {
    opponentId = resolved.home.teamId === teamId ? resolved.away.teamId : resolved.home.teamId;
  }
  return labelFor(opponentId);
}

function involvesTeam(fixture, teamId) {
  if (fixture.home === teamId || fixture.away === teamId) return true;
  const resolved = appState.projection.resolved[fixture.id];
  return Boolean(resolved && (resolved.home.teamId === teamId || resolved.away.teamId === teamId));
}

function fixtureHasFavorite(fixture) {
  if (isFavorite(fixture.home) || isFavorite(fixture.away)) return true;
  const resolved = appState.projection.resolved[fixture.id];
  return Boolean(resolved && (isFavorite(resolved.home.teamId) || isFavorite(resolved.away.teamId)));
}

function favClass(fixture) {
  return fixtureHasFavorite(fixture) ? "has-fav" : "";
}

function groupForTeam(teamId) {
  return (appData.groups || []).find((group) => group.teams.some((team) => team.id === teamId));
}

function favStar(teamId) {
  if (!teamId) return "";
  const on = isFavorite(teamId);
  return `<button class="fav-star ${on ? "is-on" : ""}" type="button" data-fav-toggle="${escapeHtml(teamId)}" aria-pressed="${on}" aria-label="${on ? "Unfollow" : "Follow"} team ${escapeHtml(teamId)}" title="${on ? "Following" : "Follow"}">${on ? "★" : "☆"}</button>`;
}

function qualBadge(status) {
  if (!status || !status.glyph) return "";
  return `<span class="q-badge q-${status.tone}" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">${escapeHtml(status.glyph)}</span>`;
}

function shortTimezoneLabel(timeZone) {
  const tail = String(timeZone).split("/").pop() || timeZone;
  return tail.replace(/_/g, " ");
}

function renderTodayPanel() {
  const container = document.querySelector("#todayPanel");
  const confidence = document.querySelector("#dataConfidence");
  if (!container || !confidence) return;

  const todaySet = getTodaySet();
  container.innerHTML = todaySet.featured
    ? todayMatchCard(todaySet.featured, todaySet.fixtures, todaySet.mode)
    : emptyState("No fixtures are available yet.");
  confidence.innerHTML = dataConfidenceCard();
}

function getTodaySet() {
  const fixtures = (appData.allFixtures || [])
    .slice()
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const now = new Date();
  const todayKey = localDateKey(now, appState.timezone);
  const todaysFixtures = fixtures.filter((fixture) => localDateKey(fixture.kickoff, appState.timezone) === todayKey);
  const featuredToday =
    todaysFixtures.find(isLiveFixture) ||
    todaysFixtures.find((fixture) => fixture.status === "scheduled") ||
    todaysFixtures[todaysFixtures.length - 1];

  if (featuredToday) {
    return { featured: featuredToday, fixtures: todaysFixtures, mode: "today" };
  }

  const nextFixture =
    fixtures.find(isLiveFixture) ||
    fixtures.find((fixture) => fixture.status === "scheduled" && new Date(fixture.kickoff) >= now) ||
    fixtures.find((fixture) => fixture.status === "scheduled") ||
    fixtures[fixtures.length - 1];

  return { featured: nextFixture, fixtures: nextFixture ? [nextFixture] : [], mode: "next" };
}

function todayMatchCard(fixture, fixtures, mode) {
  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const confidence = getDataConfidence();
  const status = fixtureStatusLabel(fixture);
  const tone = statusTone(fixture);
  const title = mode === "today"
    ? fixtures.length === 1 ? "Today's match" : `${fixtures.length} matches today`
    : "Next match";
  const rail = fixtures.length > 1 ? `
    <div class="today-rail" aria-label="All matches today">
      ${fixtures.map(todayRailItem).join("")}
    </div>
  ` : "";

  return `
    <article class="today-card ${tone} ${favClass(fixture)}">
      <div class="today-main">
        <div class="today-copy">
          <span class="eyebrow">${escapeHtml(title)}</span>
          <h2>${flag(home)}${escapeHtml(home.name)} <span class="versus-word">v</span> ${escapeHtml(away.name)}${flag(away, "right")}</h2>
          <p>${escapeHtml(matchStageText(fixture))} at ${escapeHtml(venue.name || "Venue TBC")}</p>
        </div>
        <div class="countdown-tile">
          <span>${escapeHtml(status)}</span>
          <strong>${escapeHtml(formatCountdown(fixture))}</strong>
          <small>${escapeHtml(formatFullDate(fixture.kickoff))}</small>
        </div>
      </div>

      <div class="today-scoreboard">
        <div class="today-team">
          <span>${flag(home)}</span>
          <strong>${escapeHtml(home.name)}</strong>
          <small>${escapeHtml(home.short)}</small>
        </div>
        <div class="today-score">
          <strong>${escapeHtml(scoreText(fixture))}</strong>
          <span>${escapeHtml(status)}</span>
        </div>
        <div class="today-team is-away">
          <span>${flag(away)}</span>
          <strong>${escapeHtml(away.name)}</strong>
          <small>${escapeHtml(away.short)}</small>
        </div>
      </div>

      <dl class="today-details">
        <div><dt>Kickoff</dt><dd>${escapeHtml(formatTime(fixture.kickoff))}</dd></div>
        <div><dt>Stadium</dt><dd>${escapeHtml(venueName(venue))}</dd></div>
        <div><dt>Venue time</dt><dd>${escapeHtml(formatVenueTime(fixture.kickoff, venue.tz))}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(confidence.short)}</dd></div>
      </dl>
      ${rail}
    </article>
  `;
}

function todayRailItem(fixture) {
  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};

  return `
    <div class="today-rail-item ${statusTone(fixture)}">
      <span>${escapeHtml(formatTime(fixture.kickoff))}</span>
      <strong>${flag(home)}${escapeHtml(home.short)} ${escapeHtml(scoreText(fixture))} ${escapeHtml(away.short)}${flag(away, "right")}</strong>
      <small>${escapeHtml(venueName(venue))}</small>
    </div>
  `;
}

function dataConfidenceCard() {
  const confidence = getDataConfidence();
  const details = confidence.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("");

  return `
    <div class="confidence-shell ${confidence.tone}">
      <span class="confidence-dot" aria-hidden="true"></span>
      <div>
        <span class="eyebrow">Data confidence</span>
        <h2>${escapeHtml(confidence.title)}</h2>
        <p>${escapeHtml(confidence.summary)}</p>
      </div>
      <ul>${details}</ul>
    </div>
  `;
}

function renderGroups() {
  const groups = appData.groups || [];
  const left = groups.slice(0, 6);
  const right = groups.slice(6);
  const all = groups.filter((group) => groupMatchesSearch(group, groupFixtures(group.id)));

  document.querySelector("#leftGroups").innerHTML = left.map(groupCard).join("");
  document.querySelector("#rightGroups").innerHTML = right.map(groupCard).join("");
  document.querySelector("#groupsGrid").innerHTML = all.map(groupCard).join("") || emptyState("No groups match that search.");
  document.querySelector("#thirdPlaceTable").innerHTML = thirdPlaceRows();
}

function renderBracket() {
  const fixturesByRound = new Map(
    ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final", "Third-place play-off"]
      .map((round) => [round, (appData.knockoutFixtures || []).filter((fixture) => fixture.stage === round)])
  );

  document.querySelector("#bracketGrid").innerHTML = `
    <div class="round round-r32">${roundColumn("Round of 32", fixturesByRound.get("Round of 32").slice(0, 8))}</div>
    <div class="round round-r16">${roundColumn("Round of 16", fixturesByRound.get("Round of 16").slice(0, 4))}</div>
    <div class="round round-qf">${roundColumn("Quarter-final", fixturesByRound.get("Quarter-final").slice(0, 2))}</div>
    <div class="round round-center">
      ${roundColumn("Semi-finals", fixturesByRound.get("Semi-final"))}
      ${roundColumn("Final", fixturesByRound.get("Final"))}
      ${roundColumn("Third-place", fixturesByRound.get("Third-place play-off"))}
    </div>
    <div class="round round-qf">${roundColumn("Quarter-final", fixturesByRound.get("Quarter-final").slice(2, 4))}</div>
    <div class="round round-r16">${roundColumn("Round of 16", fixturesByRound.get("Round of 16").slice(4, 8))}</div>
    <div class="round round-r32">${roundColumn("Round of 32", fixturesByRound.get("Round of 32").slice(8, 16))}</div>
  `;
}

function renderFixtures() {
  const fixtures = (appData.allFixtures || [])
    .filter((fixture) => matchesSearch(fixture))
    .slice()
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const days = groupBy(fixtures, (fixture) => formatDay(fixture.kickoff));

  document.querySelector("#fixtureCount").textContent = fixtures.length;
  document.querySelector("#fixtureList").innerHTML = Object.entries(days)
    .map(([day, items]) => `
      <section class="fixture-day">
        <h3>${escapeHtml(day)}</h3>
        <div class="fixture-day-list">${items.map(fixtureRow).join("")}</div>
      </section>
    `)
    .join("") || emptyState("No fixtures match that search.");
}

function groupCard(group) {
  const fixtures = groupFixtures(group.id);
  const next = fixtures.find(isLiveFixture) || fixtures.find((fixture) => fixture.status === "scheduled") || fixtures[0];
  const hidden = appState.search && !groupMatchesSearch(group, fixtures);
  const leader = group.teams[0];
  const rows = group.teams.map((team, index) => standingRow(team, index)).join("");

  return `
    <article class="group-card ${hidden ? "is-hidden" : ""}" style="--accent:${group.accent}" data-group="${escapeHtml(group.id)}">
      <header class="group-head">
        <div>
          <span class="eyebrow">Group ${escapeHtml(group.id)}</span>
          <h2>${escapeHtml(leader.name)}</h2>
        </div>
        <span class="group-badge">${escapeHtml(leader.shortName)} leads</span>
      </header>
      <table class="standings" aria-label="Group ${escapeHtml(group.id)} standings">
        <thead>
          <tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="group-foot">${miniFixture(next)}</footer>
    </article>
  `;
}

function standingRow(team, index) {
  const status = appState.qualification[team.id];
  const zone = status ? `q-${status.tone}` : index < 2 ? "qualifies" : index === 2 ? "watch" : "";
  const favHighlight = isFavorite(team.id) ? "is-fav" : "";

  return `
    <tr class="${zone} ${favHighlight}">
      <td class="pos">${index + 1}</td>
      <td class="team-cell">
        ${favStar(team.id)}
        <span class="flag">${team.flag || ""}</span>
        <span class="team-name">${escapeHtml(team.name)}</span>
        ${qualBadge(status)}
      </td>
      <td>${team.played}</td>
      <td>${team.wins}</td>
      <td>${team.draws}</td>
      <td>${team.losses}</td>
      <td title="${team.goalsFor}:${team.goalsAgainst} goals">${signed(team.goalDifference)}</td>
      <td class="points">${team.points}</td>
    </tr>
  `;
}

function statusCard(fixture, isLive) {
  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const statusText = isLive ? fixtureStatusLabel(fixture) : formatTime(fixture.kickoff);

  return `
    <article class="status-card ${statusTone(fixture)} ${favClass(fixture)}">
      <div class="status-top">
        <span>${escapeHtml(formatShortDate(fixture.kickoff))}</span>
        <b>${escapeHtml(statusText)}</b>
      </div>
      <div class="status-match">
        <span>${flag(home)}${escapeHtml(home.short)}</span>
        <strong>${escapeHtml(scoreText(fixture))}</strong>
        <span>${escapeHtml(away.short)}${flag(away, "right")}</span>
      </div>
      <div class="status-meta">
        <span>${escapeHtml(matchStageText(fixture))}</span>
        <span>${escapeHtml(venueName(venue))}</span>
      </div>
    </article>
  `;
}

function roundColumn(title, fixtures) {
  return `
    <section class="round-column" aria-label="${escapeHtml(title)}">
      <header class="round-title">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(formatRoundRange(fixtures))}</span>
      </header>
      <div class="round-stack">${fixtures.map(knockoutCard).join("")}</div>
    </section>
  `;
}

function knockoutCard(fixture) {
  const venue = venueById.get(fixture.venue) || {};
  const statusClass = isLiveFixture(fixture) ? "is-live" : fixture.status === "finished" ? "is-finished" : "";
  const resolved = appState.projection.resolved[fixture.id] || {};
  const home = resolved.home || { slot: fixture.home, teamId: null, projected: false };
  const away = resolved.away || { slot: fixture.away, teamId: null, projected: false };

  return `
    <article class="knockout-card ${fixture.stage === "Final" ? "is-final" : ""} ${statusClass} ${favClass(fixture)}">
      <div class="match-meta">
        <span>${escapeHtml(formatShortDate(fixture.kickoff))}</span>
        <span>${escapeHtml(formatTime(fixture.kickoff))}</span>
      </div>
      ${slotRow(home, fixture.homeScore)}
      <div class="versus">v</div>
      ${slotRow(away, fixture.awayScore)}
      <div class="venue-line">${escapeHtml(venueName(venue))}</div>
    </article>
  `;
}

function slotRow(resolved, score) {
  const teamId = resolved.teamId;
  const label = slotDisplayLabel(resolved);
  const pendingClass = teamId ? "" : "is-pending";
  const projectedClass = resolved.projected ? "is-projected" : "";
  const favHighlight = isFavorite(teamId) ? "is-fav" : "";
  const scoreClass = score === null || score === undefined ? "is-empty" : "";
  const projTag = resolved.projected ? '<i class="proj-tag" title="Projected from current standings">proj</i>' : "";

  return `
    <div class="slot-row ${pendingClass} ${projectedClass} ${favHighlight}">
      <span>${flag(label)}${escapeHtml(label.name)}${projTag}</span>
      <span class="score-box ${scoreClass}">${score ?? ""}</span>
    </div>
  `;
}

function slotDisplayLabel(resolved) {
  if (resolved.teamId && teamById.has(resolved.teamId)) {
    const team = teamById.get(resolved.teamId);
    return { name: team.name, short: team.shortName, flag: team.flag };
  }
  return slotLabelFor(resolved.slot);
}

function fixtureRow(fixture) {
  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const status = fixtureStatusLabel(fixture);

  return `
    <article class="fixture-row ${statusTone(fixture)} ${favClass(fixture)}">
      <div class="fixture-time">
        <span>${escapeHtml(formatShortDate(fixture.kickoff))}</span>
        <strong>${escapeHtml(formatTime(fixture.kickoff))}</strong>
      </div>
      <div class="fixture-teams">
        <span>${flag(home)}${escapeHtml(home.name)}</span>
        <b>${escapeHtml(scoreText(fixture))}</b>
        <span>${escapeHtml(away.name)}${flag(away, "right")}</span>
      </div>
      <div class="fixture-stage">
        <span class="fixture-status-pill">${escapeHtml(status)}</span>
        <div class="fixture-meta-line"><b>Round</b><span>${escapeHtml(fixtureRoundLabel(fixture))}</span></div>
        <div class="fixture-meta-line"><b>Game week</b><span>${escapeHtml(fixtureGameWeekLabel(fixture))}</span></div>
      </div>
      <div class="fixture-venue">${escapeHtml(venue.name || "Venue TBC")}<span>${escapeHtml(venue.city || "")}</span></div>
    </article>
  `;
}

function miniFixture(fixture) {
  if (!fixture) return "";

  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const kicker = isLiveFixture(fixture) ? fixtureStatusLabel(fixture) : `${formatShortDate(fixture.kickoff)} · ${formatTime(fixture.kickoff)}`;

  return `
    <div class="mini-fixture">
      <span>${escapeHtml(kicker)}</span>
      <strong>${escapeHtml(home.short)} ${escapeHtml(scoreText(fixture))} ${escapeHtml(away.short)}</strong>
      <span>${escapeHtml(venueName(venue))}</span>
    </div>
  `;
}

function thirdPlaceRows() {
  const thirds = WCProjection.rankThirdPlaceTeams(appData.groups || []);

  return thirds.map((team, index) => `
    <tr class="${index < 8 ? "is-qualifying" : ""}">
      <td>${index + 1}</td>
      <td>Group ${escapeHtml(team.group)}</td>
      <td><span class="flag">${team.flag || ""}</span>${escapeHtml(team.name)}</td>
      <td>${team.points}</td>
      <td>${signed(team.goalDifference)}</td>
    </tr>
  `).join("");
}

function matchesSearch(fixture) {
  if (!appState.search) return true;
  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const haystack = [
    fixture.stage,
    fixture.group || "",
    fixtureRoundLabel(fixture),
    fixtureGameWeekLabel(fixture),
    home.name,
    home.short,
    away.name,
    away.short,
    venue.name || "",
    venue.city || ""
  ].join(" ").toLowerCase();
  return haystack.includes(appState.search);
}

function groupMatchesSearch(group, fixtures) {
  if (!appState.search) return true;
  const teamText = group.teams.map((team) => `${team.name} ${team.shortName}`).join(" ");
  const fixtureText = fixtures.map((fixture) => {
    const venue = venueById.get(fixture.venue) || {};
    return `${labelFor(fixture.home).name} ${labelFor(fixture.away).name} ${venue.name || ""} ${venue.city || ""}`;
  }).join(" ");
  return `${group.id} ${teamText} ${fixtureText}`.toLowerCase().includes(appState.search);
}

function venueName(venue) {
  return venue?.name || "Venue TBC";
}

function labelFor(value) {
  const team = teamById.get(value);
  if (team) {
    return { name: team.name, short: team.shortName, flag: team.flag };
  }

  return { name: value || "TBC", short: value || "TBC", flag: "" };
}

function scoreText(fixture) {
  if (fixture.homeScore === null || fixture.homeScore === undefined || fixture.awayScore === null || fixture.awayScore === undefined) {
    return "v";
  }

  return `${fixture.homeScore}-${fixture.awayScore}`;
}

function matchStageText(fixture) {
  if (fixture.stage === "Group") {
    return `Group ${fixture.group}${fixture.matchday ? ` · Matchday ${fixture.matchday}` : ""}`;
  }

  return fixture.stage;
}

function fixtureRoundLabel(fixture) {
  if (fixture.stage === "Group") return `Group ${fixture.group}`;
  return fixture.stage;
}

function fixtureGameWeekLabel(fixture) {
  if (fixture.stage === "Group") return fixture.matchday ? `GW ${fixture.matchday}` : "GW TBC";
  return "Knockout";
}

function fixtureStatusLabel(fixture) {
  if (fixture.status === "half-time") return "HT";
  if (fixture.status === "live") return fixture.minute ? `${fixture.minute}' live` : "Live";
  if (fixture.status === "finished") return "Final";
  if (fixture.status === "postponed") return "Postponed";
  return "Scheduled";
}

function statusTone(fixture) {
  if (isLiveFixture(fixture)) return "is-live";
  if (fixture.status === "finished") return "is-finished";
  if (fixture.status === "postponed") return "is-postponed";
  return "is-scheduled";
}

function slotLabelFor(value) {
  const team = teamById.get(value);
  if (team) {
    return { name: team.name, short: team.shortName, flag: team.flag };
  }

  const raw = String(value || "TBC");
  return { name: formatSlotName(raw), short: raw, flag: "" };
}

function formatSlotName(value) {
  const winner = value.match(/^1([A-L])$/);
  if (winner) return `Winner Group ${winner[1]}`;

  const runnerUp = value.match(/^2([A-L])$/);
  if (runnerUp) return `Runner-up Group ${runnerUp[1]}`;

  const thirdPlace = value.match(/^3([A-L](?:\/[A-L])*)$/);
  if (thirdPlace) return `Best third ${thirdPlace[1]}`;

  const matchWinner = value.match(/^W(\d+)$/);
  if (matchWinner) return `Winner Match ${matchWinner[1]}`;

  const matchLoser = value.match(/^L(\d+)$/);
  if (matchLoser) return `Loser Match ${matchLoser[1]}`;

  return value;
}

function formatRoundRange(fixtures) {
  const sorted = fixtures
    .filter((fixture) => fixture.kickoff)
    .slice()
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  if (!sorted.length) return "Dates TBC";

  const first = formatShortDate(sorted[0].kickoff);
  const last = formatShortDate(sorted[sorted.length - 1].kickoff);
  return first === last ? first : `${first} - ${last}`;
}

function getDataConfidence() {
  const errors = appState.dataQuality.errors || [];
  const warnings = appState.warnings || [];
  const hasMissingKey = warnings.some((warning) => warning.includes("RAPIDAPI_KEY"));
  const hasMissingEndpoint = appState.providerQuota?.status === "path_not_configured" ||
    warnings.some((warning) => warning.includes("Live provider endpoint is not configured"));
  const quotaAlert = quotaAlertState(appState.providerQuota);

  if (errors.length) {
    return {
      tone: "is-error",
      title: "Data blocked",
      short: "Data checks blocked",
      summary: errors[0],
      details: ["Suspicious live data is not merged.", "The verified local schedule remains available."]
    };
  }

  if (quotaAlert) return quotaAlert;

  if (appState.dataMode === "live-provider-merged") {
    return {
      tone: "is-live",
      title: "Live provider connected",
      short: "Live provider verified",
      summary: "Scores update only after team, group, and kickoff checks pass.",
      details: [REFRESH_DETAIL_TEXT, "Schedule and live data are cross-checked.", ...quotaDetailLines(appState.providerQuota)]
    };
  }

  if (appState.dataMode === "stored-results") {
    return {
      tone: "is-verified",
      title: "Stored results verified",
      short: "Stored results",
      summary: "Finished scores are loaded from durable storage after matches leave the live feed.",
      details: ["Final scores remain visible after live coverage ends.", REFRESH_DETAIL_TEXT, ...quotaDetailLines(appState.providerQuota)]
    };
  }

  if (hasMissingKey) {
    return {
      tone: "is-verified",
      title: "Verified schedule mode",
      short: "Verified schedule",
      summary: "The full tournament schedule is source-checked. Live scores need the provider key.",
      details: ["No unverified live scores are shown.", REFRESH_DETAIL_TEXT]
    };
  }

  if (hasMissingEndpoint) {
    return {
      tone: "is-verified",
      title: "Verified schedule mode",
      short: "Live endpoint not configured",
      summary: "The tournament schedule is verified. Live scores will start after a valid Sofascore endpoint path is configured.",
      details: ["No unverified live scores are shown.", REFRESH_DETAIL_TEXT, ...quotaDetailLines(appState.providerQuota)]
    };
  }

  if (warnings.length || appState.dataQuality.level === "warning") {
    return {
      tone: "is-warning",
      title: "Provider delayed",
      short: "Schedule fallback active",
      summary: warnings[0] || "Using the verified schedule while live data is delayed.",
      details: ["The app rejects ambiguous provider events.", "Refresh continues automatically.", ...quotaDetailLines(appState.providerQuota)]
    };
  }

  return {
    tone: "is-verified",
    title: "Verified schedule",
    short: "Verified schedule",
    summary: "All fixtures, teams, venues, and opening-day checks are passing.",
    details: [REFRESH_DETAIL_TEXT, "Live scores are merged only after validation.", ...quotaDetailLines(appState.providerQuota)]
  };
}

function quotaAlertState(quota) {
  if (!quota) return null;

  if (quota.status === "limit_reached") {
    return {
      tone: "is-error",
      title: "API limit reached",
      short: "API limit reached",
      summary: quota.message || "RapidAPI is rejecting live requests because the plan limit has been reached.",
      details: [
        quotaRemainingText(quota),
        quota.resetAt ? `Resets ${formatQuotaReset(quota.resetAt)}` : "Check RapidAPI for the reset time.",
        "Upgrade the RapidAPI plan or wait for the quota reset."
      ].filter(Boolean)
    };
  }

  if (quota.status === "near_limit") {
    return {
      tone: "is-warning",
      title: "API quota low",
      short: "API quota low",
      summary: quota.message || "RapidAPI usage is close to the plan limit.",
      details: [
        quotaRemainingText(quota),
        quota.resetAt ? `Resets ${formatQuotaReset(quota.resetAt)}` : "",
        "Consider upgrading before match traffic increases."
      ].filter(Boolean)
    };
  }

  return null;
}

function quotaDetailLines(quota) {
  if (!quota || ["not_configured", "path_not_configured", "unknown"].includes(quota.status)) return [];
  return [quotaRemainingText(quota) || quota.message].filter(Boolean);
}

function quotaRemainingText(quota) {
  if (!quota || !Number.isFinite(quota.remaining)) return quota?.message || "";
  if (Number.isFinite(quota.limit)) return `${quota.remaining} API requests remaining of ${quota.limit}.`;
  return `${quota.remaining} API requests remaining.`;
}

function formatQuotaReset(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: appState.timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function groupFixtures(groupId) {
  return (appData.groupFixtures || []).filter((fixture) => fixture.group === groupId);
}

function rebuildIndexes() {
  teamById = new Map((appData.groups || []).flatMap((group) => group.teams.map((team) => [team.id, team])));
  venueById = new Map((appData.venues || []).map((venue) => [venue.id, venue]));
}

function normalizeSnapshot(snapshot) {
  const fallback = cloneData(WC_DATA);
  return {
    groups: snapshot.groups || fallback.groups,
    venues: snapshot.venues || fallback.venues,
    groupFixtures: snapshot.groupFixtures || fallback.groupFixtures,
    knockoutFixtures: snapshot.knockoutFixtures || fallback.knockoutFixtures,
    allFixtures: snapshot.allFixtures || fallback.allFixtures
  };
}

function updateSyncText(override) {
  const sync = new Intl.DateTimeFormat("en-GB", {
    timeZone: appState.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(appState.lastSync);
  const confidence = getDataConfidence();
  const source = [confidence.short, appState.dataSource, mostImportantDataNotice()].filter(Boolean).join(" · ");

  document.querySelector("#syncText").textContent = override || `Last sync ${sync}`;
  document.querySelector("#refreshText").textContent = REFRESH_INTERVAL_LABEL;
  document.querySelector("#dataSource").textContent = source;
}

function dataQualityLabel() {
  return getDataConfidence().short;
}

function mostImportantDataNotice() {
  if (appState.dataQuality.errors?.length) return appState.dataQuality.errors[0];
  if (["limit_reached", "near_limit"].includes(appState.providerQuota?.status)) return appState.providerQuota.message;
  if (appState.dataMode === "live-provider-merged") return "";
  if (appState.providerQuota?.status === "path_not_configured") return "verified schedule mode";
  if (appState.dataMode === "schedule-only" && appState.warnings.some((warning) => warning.includes("RAPIDAPI_KEY"))) {
    return "live scores unavailable";
  }
  return appState.warnings[0] || "";
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: appState.timezone,
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDay(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: appState.timezone,
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: appState.timezone,
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatFullDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: appState.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatVenueTime(value, timeZone) {
  if (!timeZone) return "Venue TBC";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function formatCountdown(fixture) {
  if (fixture.status === "half-time") return "Half-time";
  if (fixture.status === "live") return "Live now";
  if (fixture.status === "finished") return "Final";
  if (fixture.status === "postponed") return "Postponed";

  const diff = new Date(fixture.kickoff).getTime() - Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < -2 * hour) return "Result pending";
  if (diff <= 0) return "Kickoff window";

  const days = Math.floor(diff / day);
  const hours = Math.floor((diff % day) / hour);
  const minutes = Math.max(1, Math.floor((diff % hour) / minute));

  if (days > 0) return `Starts in ${days}d ${hours}h`;
  if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
  return `Starts in ${minutes}m`;
}

function isLiveFixture(fixture) {
  return ["live", "half-time"].includes(fixture?.status);
}

function localDateKey(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function groupBy(items, getKey) {
  return items.reduce((map, item) => {
    const key = getKey(item);
    map[key] = map[key] || [];
    map[key].push(item);
    return map;
  }, {});
}

function signed(value) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function flag(team, side = "left") {
  if (!team.flag) return "";
  return `<span class="flag ${side === "right" ? "flag-right" : ""}">${team.flag}</span>`;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}
