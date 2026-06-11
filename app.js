let appData = cloneData(WC_DATA);
let teamById = new Map();
let venueById = new Map();

const appState = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London",
  refreshEvery: 60,
  search: "",
  lastSync: new Date(),
  tick: 0,
  isLoading: false,
  dataSource: "Local model",
  dataMode: "schedule-only",
  dataQuality: { level: "warning", errors: [], warnings: [] },
  warnings: []
};

document.addEventListener("DOMContentLoaded", () => {
  rebuildIndexes();
  renderApp();
  bindControls();
  loadSnapshot({ force: false });
  startRefreshLoop();
});

function bindControls() {
  const search = document.querySelector("#search");
  const timezone = document.querySelector("#timezone");
  const refresh = document.querySelector("#refresh");
  const refreshNow = document.querySelector("#refreshNow");
  const viewButtons = document.querySelectorAll("[data-view]");

  if ([...timezone.options].some((option) => option.value === appState.timezone)) {
    timezone.value = appState.timezone;
  }

  search.addEventListener("input", (event) => {
    appState.search = event.target.value.trim().toLowerCase();
    renderGroups();
    renderFixtures();
  });

  timezone.addEventListener("change", (event) => {
    appState.timezone = event.target.value;
    renderApp();
  });

  refresh.addEventListener("change", (event) => {
    appState.refreshEvery = Number(event.target.value);
    appState.tick = 0;
    document.documentElement.style.setProperty("--refresh-progress", "0%");
    updateSyncText();
  });

  refreshNow.addEventListener("click", async () => {
    await loadSnapshot({ force: true });
    refreshNow.classList.add("is-spinning");
    window.setTimeout(() => refreshNow.classList.remove("is-spinning"), 600);
  });

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      viewButtons.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      document.querySelector(`#${button.dataset.view}`).scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function loadSnapshot({ force }) {
  if (appState.isLoading) return;
  appState.isLoading = true;
  updateSyncText("Updating...");

  try {
    const response = await fetch(`/api/worldcup${force ? "?force=1" : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`API returned ${response.status}`);

    const snapshot = await response.json();
    appData = normalizeSnapshot(snapshot);
    appState.lastSync = new Date(snapshot.lastUpdated || Date.now());
    appState.refreshEvery = Number(snapshot.refreshEvery || appState.refreshEvery);
    appState.dataSource = snapshot.provider || snapshot.source || "Live data";
    appState.dataMode = snapshot.dataMode || snapshot.source || "unknown";
    appState.dataQuality = snapshot.dataQuality || { level: "warning", errors: [], warnings: [] };
    appState.warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    document.querySelector("#refresh").value = String(appState.refreshEvery);
    rebuildIndexes();
    renderApp();
  } catch (error) {
    appState.warnings = [`Live update failed: ${error.message}`];
    appState.dataSource = "Local fallback";
    appState.dataMode = "schedule-only";
    appState.dataQuality = { level: "warning", errors: [], warnings: appState.warnings };
    renderApp();
  } finally {
    appState.isLoading = false;
    appState.tick = 0;
    document.documentElement.style.setProperty("--refresh-progress", "0%");
    updateSyncText();
  }
}

function startRefreshLoop() {
  window.setInterval(() => {
    appState.tick = (appState.tick + 1) % appState.refreshEvery;
    const progress = Math.round((appState.tick / appState.refreshEvery) * 100);
    document.documentElement.style.setProperty("--refresh-progress", `${progress}%`);

    if (appState.tick === 0) {
      loadSnapshot({ force: false });
    } else {
      updateSyncText();
    }
  }, 1000);
}

function renderApp() {
  renderStatusBar();
  renderGroups();
  renderBracket();
  renderFixtures();
  updateSyncText();
}

function renderStatusBar() {
  const fixtures = appData.allFixtures || [];
  const live = fixtures.filter((fixture) => fixture.status === "live");
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
  const next = fixtures.find((fixture) => fixture.status === "live") || fixtures.find((fixture) => fixture.status === "scheduled") || fixtures[0];
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
          <tr><th>#</th><th>Team</th><th>P</th><th>GD</th><th>Pts</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <footer class="group-foot">${miniFixture(next)}</footer>
    </article>
  `;
}

function standingRow(team, index) {
  const zone = index < 2 ? "qualifies" : index === 2 ? "watch" : "";
  return `
    <tr class="${zone}">
      <td class="pos">${index + 1}</td>
      <td class="team-cell"><span class="flag">${team.flag || ""}</span><span>${escapeHtml(team.name)}</span></td>
      <td>${team.played}</td>
      <td>${signed(team.goalDifference)}</td>
      <td class="points">${team.points}</td>
    </tr>
  `;
}

function statusCard(fixture, isLive) {
  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const statusText = isLive
    ? `${formatShortDate(fixture.kickoff)} · ${fixture.minute ? `${fixture.minute}' ` : ""}live`
    : `${formatShortDate(fixture.kickoff)} · ${formatTime(fixture.kickoff)}`;

  return `
    <article class="status-card ${isLive ? "is-live" : ""}">
      <div class="status-kicker">${escapeHtml(statusText)}</div>
      <div class="status-match">
        <span>${flag(home)}${escapeHtml(home.short)}</span>
        <strong>${escapeHtml(scoreText(fixture))}</strong>
        <span>${escapeHtml(away.short)}${flag(away, "right")}</span>
      </div>
      <div class="status-meta">${escapeHtml(fixture.stage)}${fixture.group ? ` ${escapeHtml(fixture.group)}` : ""} · ${escapeHtml(venue.city || "TBC")}</div>
    </article>
  `;
}

function roundColumn(title, fixtures) {
  return `
    <section class="round-column" aria-label="${escapeHtml(title)}">
      <h3>${escapeHtml(title)}</h3>
      <div class="round-stack">${fixtures.map(knockoutCard).join("")}</div>
    </section>
  `;
}

function knockoutCard(fixture) {
  const venue = venueById.get(fixture.venue) || {};
  const statusClass = fixture.status === "live" ? "is-live" : fixture.status === "finished" ? "is-finished" : "";

  return `
    <article class="knockout-card ${fixture.stage === "Final" ? "is-final" : ""} ${statusClass}">
      <div class="match-meta">
        <span>${escapeHtml(formatShortDate(fixture.kickoff))}</span>
        <span>${escapeHtml(formatTime(fixture.kickoff))}</span>
      </div>
      ${slotRow(fixture.home, fixture.homeScore)}
      <div class="versus">v</div>
      ${slotRow(fixture.away, fixture.awayScore)}
      <div class="venue-line">${escapeHtml(venue.city || "Venue TBC")}</div>
    </article>
  `;
}

function slotRow(teamOrSlot, score) {
  const label = labelFor(teamOrSlot);
  return `
    <div class="slot-row">
      <span>${flag(label)}${escapeHtml(label.name)}</span>
      <span class="score-box">${score ?? ""}</span>
    </div>
  `;
}

function fixtureRow(fixture) {
  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const status = fixture.status === "live" ? `${fixture.minute ? `${fixture.minute}'` : "Live"}` : fixture.status;
  const dateStatus = `${formatShortDate(fixture.kickoff)} · ${status}`;

  return `
    <article class="fixture-row ${fixture.status === "live" ? "is-live" : ""}">
      <div class="fixture-time">
        <strong>${escapeHtml(formatTime(fixture.kickoff))}</strong>
        <span>${escapeHtml(dateStatus)}</span>
      </div>
      <div class="fixture-teams">
        <span>${flag(home)}${escapeHtml(home.name)}</span>
        <b>${escapeHtml(scoreText(fixture))}</b>
        <span>${escapeHtml(away.name)}${flag(away, "right")}</span>
      </div>
      <div class="fixture-stage">${escapeHtml(fixture.stage)}${fixture.group ? ` · Group ${escapeHtml(fixture.group)}` : ""}</div>
      <div class="fixture-venue">${escapeHtml(venue.name || "Venue TBC")}<span>${escapeHtml(venue.city || "")}</span></div>
    </article>
  `;
}

function miniFixture(fixture) {
  if (!fixture) return "";

  const home = labelFor(fixture.home);
  const away = labelFor(fixture.away);
  const venue = venueById.get(fixture.venue) || {};
  const kicker = fixture.status === "live" ? `${fixture.minute ? `${fixture.minute}' ` : ""}live` : `${formatShortDate(fixture.kickoff)} · ${formatTime(fixture.kickoff)}`;

  return `
    <div class="mini-fixture">
      <span>${escapeHtml(kicker)}</span>
      <strong>${escapeHtml(home.short)} ${escapeHtml(scoreText(fixture))} ${escapeHtml(away.short)}</strong>
      <span>${escapeHtml(venue.city || "Venue TBC")}</span>
    </div>
  `;
}

function thirdPlaceRows() {
  const thirds = (appData.groups || [])
    .map((group) => ({ group: group.id, ...group.teams[2] }))
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.group.localeCompare(b.group));

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
  const haystack = `${fixture.stage} ${fixture.group || ""} ${home.name} ${home.short} ${away.name} ${away.short} ${venue.name || ""} ${venue.city || ""}`.toLowerCase();
  return haystack.includes(appState.search);
}

function groupMatchesSearch(group, fixtures) {
  if (!appState.search) return true;
  const teamText = group.teams.map((team) => `${team.name} ${team.shortName}`).join(" ");
  const fixtureText = fixtures.map((fixture) => {
    const venue = venueById.get(fixture.venue) || {};
    return `${labelFor(fixture.home).name} ${labelFor(fixture.away).name} ${venue.city || ""}`;
  }).join(" ");
  return `${group.id} ${teamText} ${fixtureText}`.toLowerCase().includes(appState.search);
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
  const next = Math.max(0, appState.refreshEvery - appState.tick);
  const qualityLabel = dataQualityLabel();
  const source = [qualityLabel, appState.dataSource, mostImportantDataNotice()].filter(Boolean).join(" · ");

  document.querySelector("#syncText").textContent = override || `Last sync ${sync}`;
  document.querySelector("#refreshText").textContent = `${next}s`;
  document.querySelector("#dataSource").textContent = source;
}

function dataQualityLabel() {
  if (appState.dataQuality.level === "error") return "Data blocked";
  if (appState.dataMode === "live-provider-merged") return "Live provider verified";
  if (appState.dataQuality.level === "verified") return "Verified schedule";
  return "Schedule check warning";
}

function mostImportantDataNotice() {
  if (appState.dataQuality.errors?.length) return appState.dataQuality.errors[0];
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
