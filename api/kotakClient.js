const axios = require("axios");
const { apiConfig } = require("./kotakConfig");
const { setSession, getSession } = require("./sessionStore");

const FIXED_LOGIN_BASE = "https://mis.kotaksecurities.com";
const TOTP_LOGIN_URL = `${FIXED_LOGIN_BASE}/login/1.0/tradeApiLogin`;
const MPIN_VALIDATE_URL = `${FIXED_LOGIN_BASE}/login/1.0/tradeApiValidate`;

// Access-token headers (short token from Neo dashboard)
function accessHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    // v2 migration: use plain token (no Bearer) in Authorization for access token.[web:46]
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

  if (!preAuthToken) throw new Error("TOTP login: token missing in response");
  return { preAuthToken, preAuthSid };
}

// Step 2: MPIN validate
// IMPORTANT: Send the preAuthToken in header `Auth` (NOT Authorization)
async function mpinValidate({ preAuthToken, preAuthSid }) {
  if (!apiConfig.mpin) throw new Error("MPIN is not set in api/kotakConfig.js");

  const payload = { mpin: String(apiConfig.mpin) };

  const headers = {
    ...accessHeaders(),
    Auth: preAuthToken // <-- THIS FIXES "Missing required field 'Auth'"
  };

  if (preAuthSid) headers.sid = preAuthSid;

  const res = await axios.post(MPIN_VALIDATE_URL, payload, { headers });

  const token = res?.data?.data?.token || res?.data?.token;
  const sid = res?.data?.data?.sid || res?.data?.sid;
  const baseUrl = res?.data?.data?.baseUrl || res?.data?.baseUrl;

  if (!token || !baseUrl) throw new Error("MPIN validate: token/baseUrl missing");

  setSession({ token, sid, baseUrl });
  return { token, sid, baseUrl };
}

async function loginWithTotp(totp) {
  const { preAuthToken, preAuthSid } = await totpLogin(totp);
  return mpinValidate({ preAuthToken, preAuthSid });
}

// For order/report/positions APIs (dynamic baseUrl)
// Migration guide: call using baseUrl, and for these APIs drop Authorization header.[web:46]
function sessionHeaders() {
  const { sessionToken, sessionSid } = getSession();
  if (!sessionToken) throw new Error("No session. Call /api/auth/login first.");

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
  if (!baseUrl) throw new Error("No baseUrl. Call /api/auth/login first.");
  return baseUrl;
}

async function placeOrder(payload) {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/order/rule/ms/place`; // v2 endpoint[web:46]
  const res = await axios.post(url, payload, { headers: sessionHeaders() });
  return res.data;
}

async function getOrders() {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/user/orders`; // v2 endpoint[web:46]
  const res = await axios.get(url, { headers: sessionHeaders() });
  return res.data;
}

async function getPositions() {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/user/positions`; // v2 endpoint[web:46]
  const res = await axios.get(url, { headers: sessionHeaders() });
  return res.data;
}

module.exports = {
  loginWithTotp,
  placeOrder,
  getOrders,
  getPositions
};
