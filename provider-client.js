const { createStaticSnapshot, createWorldCupSnapshot } = require("./data-service.js");

const DEFAULT_REFRESH_SECONDS = 60;
const DEFAULT_LIMIT_WARNING_THRESHOLD = 10;
const DEFAULT_LIVE_PROVIDER_PATH = "/tournaments/get-live-events?sport=football";

let snapshotCache = null;
let snapshotCacheTime = 0;
let lastProviderQuota = quotaStatus("unknown", {
  message: "No provider request has completed yet."
});

async function getWorldCupSnapshot(options = {}) {
  const refreshEvery = getRefreshEvery();
  const cacheTtlMs = Math.max(5, refreshEvery) * 1000;
  const now = Date.now();

  if (!options.force && snapshotCache && now - snapshotCacheTime < cacheTtlMs) {
    return snapshotCache;
  }

  const warnings = [];
  let providerPayloads = [];
  let providerQuota = null;
  const providerPaths = getProviderPaths();

  if (process.env.RAPIDAPI_KEY) {
    if (providerPaths.length === 0) {
      providerQuota = quotaStatus("path_not_configured", {
        message: "Sofascore RapidAPI key is configured, but no valid live endpoint path is configured."
      });
      warnings.push("Live provider endpoint is not configured; using verified schedule mode.");
    } else {
      try {
        const result = await fetchProviderPayloads(providerPaths);
        providerPayloads = result.payloads;
        providerQuota = result.quota;
        if (providerPayloads.length === 0) {
          warnings.push("No configured Sofascore RapidAPI endpoint returned usable data.");
        }
      } catch (error) {
        providerQuota = error.quota || quotaStatus("unknown", {
          message: "Provider quota could not be read from the failed response."
        });
        warnings.push(`Live provider unavailable: ${error.message}`);
      }
    }
  } else {
    providerQuota = quotaStatus("not_configured", {
      message: "RAPIDAPI_KEY is not configured; quota is not being consumed."
    });
    warnings.push("RAPIDAPI_KEY is not configured; using local tournament model.");
  }

  const quotaWarning = providerQuotaWarning(providerQuota);
  if (quotaWarning) warnings.push(quotaWarning);
  lastProviderQuota = providerQuota;

  snapshotCache = providerPayloads.length
    ? createWorldCupSnapshot({ providerPayloads, refreshEvery, warnings, providerQuota })
    : createStaticSnapshot({ refreshEvery, warnings, providerQuota });
  snapshotCacheTime = now;
  return snapshotCache;
}

async function fetchProviderPayloads(paths = getProviderPaths()) {
  const payloads = [];
  const errors = [];
  const quotaReports = [];

  for (const providerPath of paths) {
    try {
      const { payload, quota } = await fetchRapidApiJson(providerPath);
      payloads.push(payload);
      quotaReports.push(quota);
    } catch (error) {
      if (error.quota) quotaReports.push(error.quota);
      errors.push(`${providerPath}: ${error.message}`);
    }
  }

  const quota = summarizeProviderQuota(quotaReports);

  if (payloads.length === 0 && errors.length > 0) {
    const error = new Error(errors.join("; "));
    error.quota = quota;
    throw error;
  }

  return { payloads, quota };
}

function getProviderPaths() {
  const explicit = splitList(process.env.SOFASCORE_PATHS);
  if (explicit.length > 0) return explicit;

  return [DEFAULT_LIVE_PROVIDER_PATH];
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
  const quota = readProviderQuota(response.headers, providerPath, response.status);

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 160)}` : ""}`);
    error.quota = quota;
    throw error;
  }

  return { payload: await response.json(), quota };
}

function getProviderConfigSummary() {
  const providerPaths = getProviderPaths();
  return {
    liveProviderConfigured: Boolean(process.env.RAPIDAPI_KEY),
    liveProviderReady: Boolean(process.env.RAPIDAPI_KEY && providerPaths.length > 0),
    refreshEvery: getRefreshEvery(),
    providerPaths,
    providerQuota: lastProviderQuota
  };
}

function getRefreshEvery() {
  return Number(process.env.REFRESH_INTERVAL_SECONDS || DEFAULT_REFRESH_SECONDS);
}

function splitList(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readProviderQuota(headers, providerPath, httpStatus, now = new Date()) {
  const values = headerMap(headers);
  const limit = headerNumber(values, [
    "x-ratelimit-requests-limit",
    "x-ratelimit-limit",
    "x-rate-limit-limit",
    "ratelimit-limit"
  ]);
  const remaining = headerNumber(values, [
    "x-ratelimit-requests-remaining",
    "x-ratelimit-remaining",
    "x-rate-limit-remaining",
    "ratelimit-remaining"
  ]);
  const reset = parseResetHeader(headerValue(values, [
    "x-ratelimit-requests-reset",
    "x-ratelimit-reset",
    "x-rate-limit-reset",
    "ratelimit-reset"
  ]), now);
  const used = Number.isFinite(limit) && Number.isFinite(remaining) ? Math.max(0, limit - remaining) : null;
  const threshold = getLimitWarningThreshold(limit);
  const status = quotaLevel({ httpStatus, remaining, limit, threshold });

  return quotaStatus(status, {
    path: providerPath,
    httpStatus,
    limit,
    remaining,
    used,
    resetAt: reset.resetAt,
    resetSeconds: reset.resetSeconds,
    threshold,
    checkedAt: now.toISOString()
  });
}

function summarizeProviderQuota(reports, now = new Date()) {
  const usable = reports.filter(Boolean);
  if (!usable.length) {
    return quotaStatus("unknown", {
      checkedAt: now.toISOString(),
      message: "Provider did not return quota headers."
    });
  }

  const levelOrder = { limit_reached: 4, near_limit: 3, ok: 2, unknown: 1, path_not_configured: 0, not_configured: 0 };
  const status = usable
    .map((report) => report.status || "unknown")
    .sort((a, b) => (levelOrder[b] || 0) - (levelOrder[a] || 0))[0];
  const remainingValues = usable.map((report) => report.remaining).filter(Number.isFinite);
  const limitValues = usable.map((report) => report.limit).filter(Number.isFinite);
  const resetValues = usable.map((report) => report.resetAt).filter(Boolean).sort();
  const limit = limitValues.length ? Math.max(...limitValues) : null;
  const remaining = remainingValues.length ? Math.min(...remainingValues) : null;

  return quotaStatus(status, {
    checkedAt: now.toISOString(),
    limit,
    remaining,
    used: Number.isFinite(limit) && Number.isFinite(remaining) ? Math.max(0, limit - remaining) : null,
    resetAt: resetValues[0] || null,
    threshold: getLimitWarningThreshold(limit),
    endpoints: usable,
    message: quotaMessage(status, remaining, limit, resetValues[0])
  });
}

function providerQuotaWarning(quota) {
  if (!quota) return "";
  if (quota.status === "limit_reached") {
    return `RapidAPI usage limit reached${quota.resetAt ? ` until ${quota.resetAt}` : ""}. Upgrade the plan or reduce refresh frequency.`;
  }
  if (quota.status === "near_limit") {
    return `RapidAPI usage is low: ${quota.remaining} requests remaining${quota.limit ? ` of ${quota.limit}` : ""}.`;
  }
  return "";
}

function quotaLevel({ httpStatus, remaining, limit, threshold }) {
  if (httpStatus === 429 || remaining === 0) return "limit_reached";
  if (Number.isFinite(remaining)) {
    if (remaining <= threshold) return "near_limit";
    if (Number.isFinite(limit) && limit > 0 && remaining / limit <= 0.1) return "near_limit";
    return "ok";
  }
  return "unknown";
}

function quotaStatus(status, fields = {}) {
  return {
    provider: "RapidAPI",
    status,
    checkedAt: fields.checkedAt || new Date().toISOString(),
    path: fields.path || null,
    httpStatus: fields.httpStatus ?? null,
    limit: fields.limit ?? null,
    remaining: fields.remaining ?? null,
    used: fields.used ?? null,
    resetAt: fields.resetAt || null,
    resetSeconds: fields.resetSeconds ?? null,
    threshold: fields.threshold ?? getLimitWarningThreshold(fields.limit),
    endpoints: fields.endpoints || [],
    message: fields.message || quotaMessage(status, fields.remaining, fields.limit, fields.resetAt)
  };
}

function quotaMessage(status, remaining, limit, resetAt) {
  if (status === "not_configured") return "RapidAPI is not configured.";
  if (status === "path_not_configured") return "Sofascore RapidAPI endpoint path is not configured.";
  if (status === "limit_reached") return `RapidAPI limit reached${resetAt ? ` until ${resetAt}` : ""}.`;
  if (status === "near_limit") return `RapidAPI quota is low: ${remaining} remaining${limit ? ` of ${limit}` : ""}.`;
  if (status === "ok") return `RapidAPI quota is healthy${Number.isFinite(remaining) ? `: ${remaining} remaining` : ""}.`;
  return "RapidAPI quota headers were not available.";
}

function getLimitWarningThreshold(limit) {
  const configured = Number(process.env.API_LIMIT_WARNING_THRESHOLD || DEFAULT_LIMIT_WARNING_THRESHOLD);
  if (!Number.isFinite(limit) || limit <= 0) return configured;
  return Math.max(configured, Math.ceil(limit * 0.1));
}

function headerMap(headers) {
  const values = {};
  if (!headers || typeof headers.forEach !== "function") return values;
  headers.forEach((value, key) => {
    values[String(key).toLowerCase()] = value;
  });
  return values;
}

function headerValue(values, names) {
  for (const name of names) {
    if (values[name] !== undefined) return values[name];
  }
  return undefined;
}

function headerNumber(values, names) {
  const value = headerValue(values, names);
  if (value === undefined) return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResetHeader(value, now) {
  if (value === undefined) return { resetAt: null, resetSeconds: null };
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) return { resetAt: null, resetSeconds: null };

  if (parsed > 10_000_000_000) {
    return { resetAt: new Date(parsed).toISOString(), resetSeconds: Math.max(0, Math.round((parsed - now.getTime()) / 1000)) };
  }
  if (parsed > 1_000_000_000) {
    return { resetAt: new Date(parsed * 1000).toISOString(), resetSeconds: Math.max(0, Math.round((parsed * 1000 - now.getTime()) / 1000)) };
  }

  return { resetAt: new Date(now.getTime() + parsed * 1000).toISOString(), resetSeconds: Math.max(0, Math.round(parsed)) };
}

module.exports = {
  fetchProviderPayloads,
  getProviderConfigSummary,
  getProviderPaths,
  getWorldCupSnapshot,
  providerQuotaWarning,
  readProviderQuota,
  summarizeProviderQuota
};
