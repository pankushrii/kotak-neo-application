// api/kotakConfig.js
const apiConfigs = {
  "1": {
    accessToken: "a3de4fd6-da0b-49bc-8f11-256b84b5ec0f", // your Neo dashboard access token
    neoFinKey: "neotradeapi",
    mobileNumber: "+917000560918",
    ucc: "YIVKF",
    mpin: "190996" // <-- SET YOUR MPIN HERE (keep hardcoded)
  }
};

// choose which config to use
const ACTIVE_CONFIG_ID = "1";

module.exports = {
  apiConfig: apiConfigs[ACTIVE_CONFIG_ID]
};
