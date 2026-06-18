const { getProviderConfigSummary, getWorldCupSnapshot } = require("../provider-client.js");

module.exports = async function worldcup(request, response) {
  try {
    const snapshot = await getWorldCupSnapshot();
    const refreshEvery = getProviderConfigSummary().refreshEvery;

    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader(
      "Cache-Control",
      `s-maxage=${refreshEvery}, stale-while-revalidate=${refreshEvery}`
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
