const { getProviderConfigSummary } = require("../provider-client.js");

module.exports = function health(_request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(200).send(JSON.stringify({
    ok: true,
    ...getProviderConfigSummary()
  }));
};
