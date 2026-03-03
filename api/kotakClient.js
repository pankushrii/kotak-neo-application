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
    "Content-Type": "application/x-www-form-urlencoded", 
    "Accept": "application/json",
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
}

  // Session-based headers for quick APIs
function sessionHeaders(session) {
  const token = session?.sessionToken;
  const sid = session?.sessionSid;

  if (!token) {
    throw new Error("No session. Login first.");
  }

  return {
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json",
    "neo-fin-key": apiConfig.neoFinKey,
    Auth: token,
    ...(sid && sid !== "none" && { sid })
  };
}

// Updated baseUrl to accept a session object
function baseUrlOrThrow(session) {
  if (!session || !session.baseUrl) {
    throw new Error("No baseUrl. Login first.");
  }
  return session.baseUrl;
}
// ---------- Trading APIs ----------

async function placeOrder(uiPayload,session) {

  console.log("🚀 [Kotak Client]: placeOrder called with session:", {
    baseUrl: session?.baseUrl,
    tokenLength: session?.sessionToken?.length || 0
  });

  const baseUrl = baseUrlOrThrow(session);
  const headers = sessionHeaders(session);
  const url = `${baseUrl}/quick/order/rule/ms/place`;

  // Map UI payload to exact Kotak V2 requirements
// 1. Build the jData object exactly as per your working structure
  const jData = {
    am: 'NO',
    dq: '0',
    es: uiPayload.trading_symbol.includes("NIFTY") ? "nse_fo" : "nse_cm",
    mp: '0',
    pc: uiPayload.product || 'NRML',
    pf: 'N',
    pr: '0', // 0 for MKT orders
    pt: 'MKT',
    qt: "65",
    rt: 'DAY',
    tp: '0',
    ts: uiPayload.trading_symbol,
    tt: uiPayload.side === "BUY" ? "B" : "S", // 'B' or 'S'
  };

  // 2. Handle Bracket Order (BO) fields if necessary
  if (uiPayload.orderType === 'BO') {
    jData.sot = 'LIMIT';
    jData.slt = uiPayload.slt || 'Absolute';
    jData.slv = uiPayload.slv || '0';
    jData.sov = 'LIMIT';
    jData.tlt = uiPayload.tlt || 'N';
    jData.tsv = uiPayload.tsv || '0';
  }
  // 3. Form Encoding logic exactly like your working example
  const formBody = new URLSearchParams({
    jData: JSON.stringify(jData),
  }).toString();

  // --- LOGGING HEADERS ---
  const headers_const = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json",
    "neo-fin-key": "neotradeapi",
    "Auth": session.sessionToken,
    "Sid": session.sessionSid || ""
  };

  console.log("📤 [OUTGOING HEADERS]:", JSON.stringify(headers_const, null, 2));
  console.log("📦 [OUTGOING BODY]:", formBody);
  console.log("🚀 [Kotak Client]: Sending jData:", JSON.stringify(jData));
  console.log('🚀 [Kotak Client] Sending formBody:', formBody);

  try {
    const res = await axios.post(url, formBody, { 
      headers: headers_const
    });
    return res.data;
  } catch (err) {
    console.error("❌ [Kotak Rejection]:", JSON.stringify(err.response?.data || err.message));
    throw err;
  }
}

async function getOrders(session) {
  const baseUrl = baseUrlOrThrow(session);
  const url = `${baseUrl}/quick/user/orders`; // v2 endpoint
  const res = await axios.get(url, { headers: sessionHeaders(session) });
  return res.data;
}

async function getPositions(session) {
  const baseUrl = baseUrlOrThrow(session);
  const url = `${baseUrl}/quick/user/positions`; // v2 endpoint
  const res = await axios.get(url, { headers: sessionHeaders() });
  return res.data;
}

// ---------- Scrip Search (for autosuggest) ----------
//
// Maps to Python client's search_scrip. Adjust URL if your Notion/Postman
// says something slightly different.

async function searchScrip({ exchange_segment = "nse_cm", symbol }) {
  console.log("🔍 searchScrip called with:", { exchange_segment, symbol });

  const baseUrl = baseUrlOrThrow();
  console.log("📍 baseUrl from session:", baseUrl);

  const url = `${baseUrl}/scrip/1.0/masterscrip/file-paths`;
  console.log("🌐 Full search URL:", url);

  const payload = {
    exchange_segment,
    symbol,
    expiry: "",
    option_type: "",
    strike_price: ""
  };
  console.log("📤 Request payload:", payload);

  const headers = sessionHeaders();
  console.log("📤 Request headers:", {
    Auth: headers.Auth ? "present" : "missing",
    "neo-fin-key": headers["neo-fin-key"],
    sid: headers.sid ? "present" : "missing"
  });

  try {
    console.log("🚀 Sending POST to Kotak...");
    const res = await axios.post(url, payload, { headers });
    console.log("✅ Kotak response status:", res.status);
    console.log("📥 Kotak response data keys:", Object.keys(res.data || {}));
    return res.data;
  } catch (err) {
    console.error("❌ Kotak error status:", err.response?.status);
    console.error("❌ Kotak error data:", JSON.stringify(err.response?.data || err.message));
    console.error("❌ Full error:", err.message);
    throw err;
  }
}

module.exports = {
  loginWithTotp,
  placeOrder,
  getOrders,
  getPositions,
  searchScrip
};
