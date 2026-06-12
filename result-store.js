const RESULT_STORE_PATH = "worldcup/results.json";
const RESULT_STORE_VERSION = 1;

let blobModulePromise = null;

async function readStoredResults() {
  if (!isResultStoreConfigured()) {
    return { enabled: false, results: emptyStore(), warning: "" };
  }

  try {
    const { get } = await getBlobModule();
    const blob = await get(RESULT_STORE_PATH, { access: "private", useCache: false });
    if (!blob?.stream) return { enabled: true, results: emptyStore(), warning: "" };

    const text = await new Response(blob.stream).text();
    return { enabled: true, results: normalizeStore(JSON.parse(text)), warning: "" };
  } catch (error) {
    if (isNotFound(error)) return { enabled: true, results: emptyStore(), warning: "" };
    return {
      enabled: true,
      results: emptyStore(),
      warning: `Result store unavailable: ${error.message}`
    };
  }
}

async function persistFinishedResults(snapshot) {
  if (!isResultStoreConfigured()) return { enabled: false, saved: 0, warning: "" };

  const finished = collectFinishedResults(snapshot);
  if (!finished.length) return { enabled: true, saved: 0, warning: "" };

  const read = await readStoredResults();
  const store = read.results;
  let saved = 0;

  for (const result of finished) {
    const existing = store.fixtures[result.id];
    if (!existing || resultFingerprint(existing) !== resultFingerprint(result)) {
      store.fixtures[result.id] = result;
      saved += 1;
    }
  }

  if (!saved) return { enabled: true, saved: 0, warning: read.warning || "" };

  store.updatedAt = new Date().toISOString();
  try {
    const { put } = await getBlobModule();
    await put(RESULT_STORE_PATH, JSON.stringify(store, null, 2), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60
    });
    return { enabled: true, saved, warning: read.warning || "" };
  } catch (error) {
    return { enabled: true, saved: 0, warning: `Result store write failed: ${error.message}` };
  }
}

function applyStoredResults(data, storedResults) {
  const store = normalizeStore(storedResults);
  const byId = new Map((data.allFixtures || []).map((fixture) => [fixture.id, fixture]));

  for (const result of Object.values(store.fixtures)) {
    if (!isUsableStoredResult(result)) continue;
    const fixture = byId.get(result.id);
    if (!fixture) continue;

    Object.assign(fixture, {
      providerId: result.providerId || fixture.providerId,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      status: "finished",
      minute: null,
      sourceUrl: result.sourceUrl || fixture.sourceUrl
    });
  }

  syncCollections(data);
}

function collectFinishedResults(snapshot) {
  return (snapshot.allFixtures || [])
    .filter((fixture) => fixture.status === "finished" && Number.isInteger(fixture.homeScore) && Number.isInteger(fixture.awayScore))
    .map((fixture) => ({
      id: fixture.id,
      providerId: fixture.providerId || null,
      home: fixture.home,
      away: fixture.away,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      status: "finished",
      kickoff: fixture.kickoff,
      venue: fixture.venue,
      sourceUrl: fixture.sourceUrl || null,
      storedAt: new Date().toISOString()
    }));
}

function emptyStore() {
  return { version: RESULT_STORE_VERSION, updatedAt: null, fixtures: {} };
}

function normalizeStore(value) {
  if (!value || typeof value !== "object") return emptyStore();
  return {
    version: RESULT_STORE_VERSION,
    updatedAt: value.updatedAt || null,
    fixtures: value.fixtures && typeof value.fixtures === "object" ? value.fixtures : {}
  };
}

function isUsableStoredResult(result) {
  return result &&
    typeof result.id === "string" &&
    result.status === "finished" &&
    Number.isInteger(result.homeScore) &&
    Number.isInteger(result.awayScore);
}

function resultFingerprint(result) {
  return [result.status, result.homeScore, result.awayScore, result.providerId || "", result.sourceUrl || ""].join(":");
}

function syncCollections(data) {
  const byId = new Map((data.allFixtures || []).map((fixture) => [fixture.id, fixture]));
  data.groupFixtures = (data.groupFixtures || []).map((fixture) => byId.get(fixture.id) || fixture);
  data.knockoutFixtures = (data.knockoutFixtures || []).map((fixture) => byId.get(fixture.id) || fixture);
}

function isResultStoreConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID));
}

async function getBlobModule() {
  if (!blobModulePromise) blobModulePromise = import("@vercel/blob");
  return blobModulePromise;
}

function isNotFound(error) {
  return error?.name === "BlobNotFoundError" || /not found/i.test(error?.message || "");
}

module.exports = {
  RESULT_STORE_PATH,
  applyStoredResults,
  collectFinishedResults,
  emptyStore,
  isResultStoreConfigured,
  persistFinishedResults,
  readStoredResults
};
