const { getProviderConfigSummary, getWorldCupSnapshot } = require("../provider-client.js");

module.exports = async function worldcup(request, response) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const force = url.searchParams.get("force") === "1";
    const snapshot = await getWorldCupSnapshot({ force });
    const refreshEvery = getProviderConfigSummary().refreshEvery;

    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader(
      "Cache-Control",
      force ? "no-store" : `s-maxage=${Math.max(1, Math.floor(refreshEvery / 2))}, stale-while-revalidate=${refreshEvery}`
    );
    response.status(200).send(JSON.stringify(snapshot));
  } catch (error) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.status(500).send(JSON.stringify({
      error: "Internal server error",
      message: error.message
    }));
  }
};
