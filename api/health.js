const { getProviderConfigSummary, getWorldCupSnapshot } = require("../provider-client.js");

module.exports = async function health(request, response) {
  const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  const checkQuota = url.searchParams.get("checkQuota") === "1";
  const snapshot = checkQuota ? await getWorldCupSnapshot({ force: true }) : null;
  const summary = getProviderConfigSummary();

  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(200).send(JSON.stringify({
    ok: true,
    ...summary,
    quotaChecked: checkQuota,
    providerQuota: snapshot?.providerQuota || summary.providerQuota
  }));
};
