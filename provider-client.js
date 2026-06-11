const { createStaticSnapshot, createWorldCupSnapshot } = require("./data-service.js");

const DEFAULT_REFRESH_SECONDS = 60;

let snapshotCache = null;
let snapshotCacheTime = 0;

async function getWorldCupSnapshot(options = {}) {
  const refreshEvery = getRefreshEvery();
  const cacheTtlMs = Math.max(5, refreshEvery) * 1000;
  const now = Date.now();

  if (!options.force && snapshotCache && now - snapshotCacheTime < cacheTtlMs) {
    return snapshotCache;
  }

  const warnings = [];
  let providerPayloads = [];

  if (process.env.RAPIDAPI_KEY) {
    try {
      providerPayloads = await fetchProviderPayloads();
      if (providerPayloads.length === 0) {
        warnings.push("No configured Sofascore RapidAPI endpoint returned usable data.");
      }
    } catch (error) {
      warnings.push(`Live provider unavailable: ${error.message}`);
    }
  } else {
    warnings.push("RAPIDAPI_KEY is not configured; using local tournament model.");
  }

  snapshotCache = providerPayloads.length
    ? createWorldCupSnapshot({ providerPayloads, refreshEvery, warnings })
    : createStaticSnapshot({ refreshEvery, warnings });
  snapshotCacheTime = now;
  return snapshotCache;
}

async function fetchProviderPayloads() {
  const paths = getProviderPaths();
  const payloads = [];
  const errors = [];

  for (const providerPath of paths) {
    try {
      const payload = await fetchRapidApiJson(providerPath);
      payloads.push(payload);
    } catch (error) {
      errors.push(`${providerPath}: ${error.message}`);
    }
  }

  if (payloads.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return payloads;
}

function getProviderPaths() {
  const explicit = splitList(process.env.SOFASCORE_PATHS);
  if (explicit.length > 0) return explicit;

  const uniqueTournamentId = process.env.SOFASCORE_UNIQUE_TOURNAMENT_ID || "16";
  const seasonId = process.env.SOFASCORE_SEASON_ID;
  const defaults = ["/matches/get-live"];

  if (seasonId) {
    defaults.unshift(
      `/tournaments/get-events?uniqueTournamentId=${encodeURIComponent(uniqueTournamentId)}&seasonId=${encodeURIComponent(seasonId)}`,
      `/tournaments/get-matches?uniqueTournamentId=${encodeURIComponent(uniqueTournamentId)}&seasonId=${encodeURIComponent(seasonId)}`
    );
  }

  return defaults;
}

async function fetchRapidApiJson(providerPath) {
  const baseUrl = process.env.RAPIDAPI_BASE_URL || "https://sofascore.p.rapidapi.com";
  const hostHeader = process.env.RAPIDAPI_HOST || "sofascore.p.rapidapi.com";
  const url = new URL(providerPath, baseUrl);

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": hostHeader,
      "x-rapidapi-key": process.env.RAPIDAPI_KEY
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 160)}` : ""}`);
  }

  return response.json();
}

function getProviderConfigSummary() {
  return {
    liveProviderConfigured: Boolean(process.env.RAPIDAPI_KEY),
    refreshEvery: getRefreshEvery(),
    providerPaths: getProviderPaths()
  };
}

function getRefreshEvery() {
  return Number(process.env.REFRESH_INTERVAL_SECONDS || DEFAULT_REFRESH_SECONDS);
}

function splitList(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

module.exports = {
  fetchProviderPayloads,
  getProviderConfigSummary,
  getProviderPaths,
  getWorldCupSnapshot
};
