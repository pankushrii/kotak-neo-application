// api/kotakClient.js

const axios = require("axios");
const { apiConfig } = require("./kotakConfig");
const { setSession, getSession } = require("./sessionStore");

// From migration guide: fixed login base
const FIXED_LOGIN_BASE = "https://mis.kotaksecurities.com";
const TOTP_LOGIN_URL = `${FIXED_LOGIN_BASE}/login/1.0/tradeApiLogin`;
const MPIN_VALIDATE_URL = `${FIXED_LOGIN_BASE}/login/1.0/tradeApiValidate`;

// Access-token headers (short token from Neo dashboard)
function accessHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    // v2: plain token (no Bearer) in Authorization for access token
    Authorization: apiConfig.accessToken,
    "neo-fin-key": apiConfig.neoFinKey
  };
}

// Step 1: TOTP login (uses Authorization = accessToken)
async function totpLogin(totp) {
  const payload = {
    ucc: apiConfig.ucc,
    mobileNumber: apiConfig.mobileNumber,
    totp: String(totp)
  };

  const res = await axios.post(TOTP_LOGIN_URL, payload, { headers: accessHeaders() });

  const preAuthToken =
    res?.data?.data?.token || res?.data?.data?.Token || res?.data?.token;
  const preAuthSid =
    res?.data?.data?.sid || res?.data?.data?.Sid || res?.data?.sid;

  if (!preAuthToken) {
    throw new Error("TOTP login: token missing in response");
  }

  return { preAuthToken, preAuthSid };
}

// Step 2: MPIN validate (final trading session)
// IMPORTANT: send preAuth token in header `Auth`
async function mpinValidate({ preAuthToken, preAuthSid }) {
  if (!apiConfig.mpin) {
    throw new Error("MPIN is not set in api/kotakConfig.js");
  }

  const payload = { mpin: String(apiConfig.mpin) };

  const headers = {
    ...accessHeaders(),
    Auth: preAuthToken
  };

  if (preAuthSid) headers.sid = preAuthSid;

  const res = await axios.post(MPIN_VALIDATE_URL, payload, { headers });

  const token = res?.data?.data?.token || res?.data?.token;
  const sid = res?.data?.data?.sid || res?.data?.sid;
  const baseUrl = res?.data?.data?.baseUrl || res?.data?.baseUrl;

  if (!token || !baseUrl) {
    throw new Error("MPIN validate: token/baseUrl missing in response");
  }

  setSession({ token, sid, baseUrl });

  return { token, sid, baseUrl };
}

// Public function for login from Express route
async function loginWithTotp(totp) {
  const { preAuthToken, preAuthSid } = await totpLogin(totp);
  return mpinValidate({ preAuthToken, preAuthSid });
}

// Session-based headers for quick APIs
function sessionHeaders() {
  const { sessionToken, sessionSid } = getSession();
  if (!sessionToken) {
    throw new Error("No session. Login first.");
  }

  // v2: use Auth header for session token, no Authorization for quick APIs
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "neo-fin-key": apiConfig.neoFinKey,
    Auth: sessionToken
  };

  if (sessionSid) headers.sid = sessionSid;
  return headers;
}

function baseUrlOrThrow() {
  const { baseUrl } = getSession();
  if (!baseUrl) {
    throw new Error("No baseUrl. Login first.");
  }
  return baseUrl;
}

// ---------- Trading APIs ----------

async function placeOrder(payload) {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/order/rule/ms/place`; // v2 endpoint
  const res = await axios.post(url, payload, { headers: sessionHeaders() });
  return res.data;
}

async function getOrders() {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/user/orders`; // v2 endpoint
  const res = await axios.get(url, { headers: sessionHeaders() });
  return res.data;
}

async function getPositions() {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/user/positions`; // v2 endpoint
  const res = await axios.get(url, { headers: sessionHeaders() });
  return res.data;
}

// ---------- Scrip Search (for autosuggest) ----------
//
// Maps to Python client's search_scrip. Adjust URL if your Notion/Postman
// says something slightly different.

async function searchScrip({ exchange_segment = "nse_cm", symbol }) {
  const baseUrl = baseUrlOrThrow();

  // Replace path if your docs show a different one, e.g. /quick/scrip/v1/search
  const url = `${baseUrl}/quick/scrip/search`;

  const payload = {
    exchange_segment,
    symbol,
    expiry: "",
    option_type: "",
    strike_price: ""
  };

  const res = await axios.post(url, payload, { headers: sessionHeaders() });
  return res.data;
}

module.exports = {
  loginWithTotp,
  placeOrder,
  getOrders,
  getPositions,
  searchScrip
};
