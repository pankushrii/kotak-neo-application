// api/kotakClient.js
const axios = require("axios");
const { apiConfig } = require("./kotakConfig");
const { setSession, getSession } = require("./sessionStore");

const FIXED_LOGIN_BASE = "https://mis.kotaksecurities.com";
const TOTP_LOGIN_URL = `${FIXED_LOGIN_BASE}/login/1.0/tradeApiLogin`;
const MPIN_VALIDATE_URL = `${FIXED_LOGIN_BASE}/login/1.0/tradeApiValidate`;

function commonHeaders() {
  // Migration guide: access token is plain token (no Bearer).[page:2]
  // We also pass neoFinKey as a separate header (name may vary in your Notion doc).
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: apiConfig.accessToken,
    "neo-fin-key": apiConfig.neoFinKey
  };
}

// Step 1: TOTP Login
async function totpLogin(totp) {
  // .NET wrapper indicates request has Ucc, MobileNumber, Totp.[web:62]
  const payload = {
    ucc: apiConfig.ucc,
    mobileNumber: apiConfig.mobileNumber,
    totp: String(totp)
  };

  const res = await axios.post(TOTP_LOGIN_URL, payload, {
    headers: commonHeaders()
  });

  // Expect token+sid in response data (pre-auth). This mirrors public SDK samples.[web:62]
  const preAuthToken = res?.data?.data?.token || res?.data?.data?.Token || res?.data?.token;
  const preAuthSid = res?.data?.data?.sid || res?.data?.data?.Sid || res?.data?.sid;

  if (!preAuthToken) throw new Error("TOTP login succeeded but token missing in response");
  return { preAuthToken, preAuthSid };
}

// Step 2: MPIN Validate => final session token + baseUrl
async function mpinValidate({ preAuthToken, preAuthSid }) {
  const payload = { mpin: apiConfig.mpin };

  const headers = {
    ...commonHeaders(),
    Authorization: preAuthToken
  };

  // Some implementations require sid header on validate.[web:62]
  if (preAuthSid) headers["sid"] = preAuthSid;

  const res = await axios.post(MPIN_VALIDATE_URL, payload, { headers });

  const token = res?.data?.data?.token || res?.data?.token;
  const sid = res?.data?.data?.sid || res?.data?.sid;
  const baseUrl = res?.data?.data?.baseUrl || res?.data?.baseUrl;

  if (!token || !baseUrl) {
    throw new Error("MPIN validate response missing token/baseUrl");
  }

  setSession({ token, sid, baseUrl });
  return { token, sid, baseUrl };
}

async function loginWithTotp(totp) {
  const { preAuthToken, preAuthSid } = await totpLogin(totp);
  return mpinValidate({ preAuthToken, preAuthSid });
}

function sessionHeaders() {
  const { sessionToken, sessionSid } = getSession();
  if (!sessionToken) throw new Error("No sessionToken. Call /api/auth/login first.");

  // Migration says use baseUrl for APIs and plain token approach.[page:2]
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: sessionToken,
    "neo-fin-key": apiConfig.neoFinKey
  };

  if (sessionSid) headers["sid"] = sessionSid;
  return headers;
}

function baseUrlOrThrow() {
  const { baseUrl } = getSession();
  if (!baseUrl) throw new Error("No baseUrl. Call /api/auth/login first.");
  return baseUrl;
}

// v2 endpoints from migration guide.[page:2]
async function placeOrder(payload) {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/order/rule/ms/place`;
  const res = await axios.post(url, payload, { headers: sessionHeaders() });
  return res.data;
}

async function getOrders() {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/user/orders`;
  const res = await axios.get(url, { headers: sessionHeaders() });
  return res.data;
}

async function getPositions() {
  const baseUrl = baseUrlOrThrow();
  const url = `${baseUrl}/quick/user/positions`;
  const res = await axios.get(url, { headers: sessionHeaders() });
  return res.data;
}

module.exports = {
  loginWithTotp,
  placeOrder,
  getOrders,
  getPositions
};
