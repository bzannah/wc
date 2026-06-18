const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { getProviderConfigSummary, getWorldCupSnapshot } = require("./provider-client.js");

const root = __dirname;
const staticRoot = path.join(root, "public");

loadEnvFile(".env");
loadEnvFile(".env.local");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (url.pathname === "/api/health") {
      const checkQuota = url.searchParams.get("checkQuota") === "1";
      const snapshot = checkQuota ? await getWorldCupSnapshot({ force: true }) : null;
      const summary = getProviderConfigSummary();
      return sendJson(response, 200, {
        ok: true,
        ...summary,
        quotaChecked: checkQuota,
        providerQuota: snapshot?.providerQuota || summary.providerQuota
      });
    }

    if (url.pathname === "/api/worldcup") {
      const snapshot = await getWorldCupSnapshot();
      const refreshEvery = getProviderConfigSummary().refreshEvery;
      return sendJson(response, 200, snapshot, {
        "Cache-Control": `private, max-age=${refreshEvery}`
      });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, {
      error: "Internal server error",
      message: error.message
    });
  }
});

server.listen(port, host, () => {
  console.log(`World Cup chart running at http://${host}:${port}`);
});

function serveStatic(urlPath, response) {
  const cleanPath = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const filePath = path.normalize(path.join(staticRoot, cleanPath));

  if (!filePath.startsWith(staticRoot)) {
    return sendText(response, 403, "Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      return sendText(response, 404, "Not found");
    }

    response.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-cache"
    });
    response.end(data);
  });
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function sendText(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  }[ext] || "application/octet-stream";
}

function loadEnvFile(fileName) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
